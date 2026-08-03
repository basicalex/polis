#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'restore-verify: %s\n' "$*" >&2
  exit 1
}

require_env() {
  local name=$1
  [[ -n ${!name:-} ]] || fail "$name is required"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

assert_disposable_target() {
  [[ ${DEPLOYMENT_PROFILE:-} == pilot ]] || fail 'DEPLOYMENT_PROFILE must be pilot'
  [[ ${RESTORE_TARGET_IS_DISPOSABLE:-} == true ]] ||
    fail 'RESTORE_TARGET_IS_DISPOSABLE must be true'
  [[ ${RESTORE_DRILL_CONFIRMATION:-} == DESTROY_ONLY_POLIS_DISPOSABLE_RESTORE_TARGET ]] ||
    fail 'RESTORE_DRILL_CONFIRMATION must exactly confirm the disposable target'

  require_env DATABASE_URL
  require_env SOURCE_DATABASE_URL

  node -e '
    function parse(name, value) {
      let url;
      try {
        url = new URL(value);
      } catch {
        throw new Error(`${name} must be a valid PostgreSQL URL`);
      }
      if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
        throw new Error(`${name} must use postgres: or postgresql:`);
      }
      const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
      if (!url.hostname || !database || database.includes("/")) {
        throw new Error(`${name} must include one host and database name`);
      }
      return {
        database,
        identity: `${url.hostname.toLowerCase()}:${url.port || "5432"}/${database}`,
      };
    }

    const target = parse("DATABASE_URL", process.env.DATABASE_URL);
    const source = parse("SOURCE_DATABASE_URL", process.env.SOURCE_DATABASE_URL);
    if (target.identity === source.identity) {
      throw new Error("DATABASE_URL must not target the source database");
    }
    if (process.env.PRODUCTION_DATABASE_URL) {
      const production = parse("PRODUCTION_DATABASE_URL", process.env.PRODUCTION_DATABASE_URL);
      if (target.identity === production.identity) {
        throw new Error("DATABASE_URL must not target the production database");
      }
    }
    if (!/(^|[_-])(restore[_-]?drill|disposable)([_-]|$)/i.test(target.database)) {
      throw new Error("target database name must contain restore_drill or disposable");
    }
    if (/^(postgres|template0|template1)$/i.test(target.database)) {
      throw new Error("system databases cannot be restore targets");
    }
    process.stdout.write(target.database);
  ' >/dev/null || fail 'disposable target checks failed'
}

assert_disposable_target
require_env RESTIC_REPOSITORY
require_env RESTIC_PASSWORD_FILE
require_env RESTIC_SNAPSHOT
[[ $RESTIC_SNAPSHOT =~ ^[0-9a-f]{8,64}$ ]] ||
  fail 'RESTIC_SNAPSHOT must be a nominated hexadecimal snapshot ID, not latest'
[[ -f $RESTIC_PASSWORD_FILE && -r $RESTIC_PASSWORD_FILE && -s $RESTIC_PASSWORD_FILE ]] ||
  fail 'RESTIC_PASSWORD_FILE must name a readable, non-empty file'

repository_is_off_host=false
case "${RESTIC_REPOSITORY,,}" in
  *localhost*|*127.0.0.1*|*::1*|rclone:*) ;;
  s3:*|sftp:*|rest:*|azure:*|gs:*|b2:*|swift:*) repository_is_off_host=true ;;
esac
[[ $repository_is_off_host == true || ${OPS_ALLOW_LOCAL_RESTIC_REPOSITORY_FOR_TESTS:-} == true ]] ||
  fail 'RESTIC_REPOSITORY must be off-host; local repositories require OPS_ALLOW_LOCAL_RESTIC_REPOSITORY_FOR_TESTS=true'

for tool in cut date mktemp node pg_restore psql restic sha256sum wc; do
  require_command "$tool"
done

umask 077
restore_dir=$(mktemp -d "${TMPDIR:-/tmp}/polis-restore-verify.XXXXXXXX")
cleanup() {
  rm -rf -- "$restore_dir"
}
trap cleanup EXIT HUP INT TERM

restic restore "$RESTIC_SNAPSHOT" --target "$restore_dir"

manifest_path="$restore_dir/manifest.json"
[[ -f $manifest_path && -r $manifest_path ]] || fail 'snapshot is missing manifest.json'

IFS=$'\t' read -r dump_file expected_dump_sha expected_list_sha expected_table_count expected_audit_count < <(
  node -e '
    const fs = require("node:fs");
    const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    function digest(name) {
      if (typeof manifest[name] !== "string" || !/^[0-9a-f]{64}$/.test(manifest[name])) {
        throw new Error(`invalid ${name}`);
      }
      return manifest[name];
    }
    if (manifest.formatVersion !== 1 || manifest.deploymentProfile !== "pilot") {
      throw new Error("unsupported or non-pilot manifest");
    }
    if (manifest.dumpFile !== "polis.dump") throw new Error("unexpected dump filename");
    if (typeof manifest.createdAt !== "string" || !manifest.createdAt.endsWith("Z")) {
      throw new Error("invalid manifest timestamp");
    }
    if (typeof manifest.gitSha !== "string" || !/^[0-9a-f]{40,64}$/.test(manifest.gitSha)) {
      throw new Error("invalid manifest Git SHA");
    }
    if (!Number.isSafeInteger(manifest.publicTableCount) || manifest.publicTableCount < 1) {
      throw new Error("invalid public-table count");
    }
    if (!Number.isSafeInteger(manifest.auditEventCount) || manifest.auditEventCount < 0) {
      throw new Error("invalid audit-event count");
    }
    process.stdout.write([
      manifest.dumpFile,
      digest("dumpSha256"),
      digest("restoreListSha256"),
      manifest.publicTableCount,
      manifest.auditEventCount,
    ].join("\t") + "\n");
  ' "$manifest_path"
) || fail 'manifest validation failed'

dump_path="$restore_dir/$dump_file"
[[ -f $dump_path && -r $dump_path ]] || fail 'snapshot is missing the nominated dump'
actual_dump_sha=$(sha256sum "$dump_path" | cut -d' ' -f1)
[[ $actual_dump_sha == "$expected_dump_sha" ]] || fail 'dump SHA-256 mismatch'
actual_list_sha=$(pg_restore --list "$dump_path" | sha256sum | cut -d' ' -f1)
[[ $actual_list_sha == "$expected_list_sha" ]] || fail 'pg_restore list digest mismatch'

# All destructive pg_restore flags stay below the confirmation, URL identity, database-name,
# snapshot, manifest, and content-integrity checks above.
pg_restore \
  --dbname="$DATABASE_URL" \
  --clean \
  --if-exists \
  --exit-on-error \
  --no-owner \
  --no-privileges \
  "$dump_path"

required_schema=$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc \
  "SELECT (to_regclass('public.app_meta') IS NOT NULL AND to_regclass('public.audit_events') IS NOT NULL)::text")
[[ $required_schema == true ]] || fail 'restored database is missing required schema'
actual_table_count=$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc \
  "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public'")
actual_audit_count=$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc \
  'SELECT count(*) FROM public.audit_events')
[[ $actual_table_count == "$expected_table_count" ]] || fail 'restored public-table count mismatch'
[[ $actual_audit_count == "$expected_audit_count" ]] || fail 'restored audit-event count mismatch'

audit_export="$restore_dir/audit.ndjson"
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atq -c "
  SELECT json_build_object(
    'id', id,
    'eventType', event_type,
    'actorType', actor_type,
    'actorId', actor_id,
    'targetType', target_type,
    'targetId', target_id,
    'action', action,
    'reason', reason,
    'correlationId', correlation_id,
    'visibility', visibility,
    'data', data,
    'redactedData', redacted_data,
    'createdAt', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),
    'hash', hash,
    'previousHash', previous_hash
  )::text
  FROM public.audit_events
  ORDER BY created_at, id
" >"$audit_export"

exported_audit_count=$(wc -l <"$audit_export")
exported_audit_count=${exported_audit_count//[[:space:]]/}
[[ $exported_audit_count == "$expected_audit_count" ]] || fail 'audit export count mismatch'

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
verifier_arguments=("$script_dir/verify-audit-chain.mjs")
if [[ ${RESTORE_ALLOW_EMPTY_AUDIT_CHAIN:-} == true ]]; then
  verifier_arguments+=(--allow-empty)
fi
verifier_arguments+=("$audit_export")
audit_result=$(node "${verifier_arguments[@]}") || fail 'restored audit chain verification failed'

verified_at=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
printf '{"ok":true,"snapshotId":"%s","verifiedAt":"%s","publicTableCount":%s,"auditEventCount":%s,"audit":%s}\n' \
  "$RESTIC_SNAPSHOT" "$verified_at" "$actual_table_count" "$actual_audit_count" "$audit_result"
