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

repository_endpoint_class() {
  require_command node
  node - "$RESTIC_REPOSITORY" <<'NODE'
const repository = process.argv[2].toLowerCase();

function repositoryHost() {
  if (repository.startsWith('rest:')) {
    return new URL(repository.slice(5)).hostname;
  }
  if (repository.startsWith('s3:')) {
    const endpoint = repository.slice(3);
    if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
      return new URL(endpoint).hostname;
    }
    return new URL(`https://${endpoint.split('/', 1)[0]}`).hostname;
  }
  if (repository.startsWith('sftp://')) {
    return new URL(repository).hostname;
  }
  if (repository.startsWith('sftp:')) {
    let authority = repository.slice(5);
    const pathIndex = authority.indexOf(':/');
    if (pathIndex >= 0) authority = authority.slice(0, pathIndex);
    const atIndex = authority.lastIndexOf('@');
    if (atIndex >= 0) authority = authority.slice(atIndex + 1);
    if (authority.startsWith('[')) {
      const end = authority.indexOf(']');
      if (end < 0) throw new Error('invalid IPv6 authority');
      authority = authority.slice(0, end + 1);
    } else {
      authority = authority.split(':', 1)[0];
    }
    return new URL(`https://${authority}`).hostname;
  }
  return null;
}

function isLocal(hostname) {
  if (hostname === null) return false;
  const host = hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '0.0.0.0' || host.startsWith('127.')) return true;
  if (host === '::' || host === '::1') return true;
  return /^::(?:ffff:)?7f[0-9a-f]{2}:/.test(host);
}

try {
  process.stdout.write(isLocal(repositoryHost()) ? 'local' : 'remote');
} catch {
  process.stdout.write('unknown');
}
NODE
}

classify_restic_repository() {
  local repository=${RESTIC_REPOSITORY,,}
  local override=${OPS_ALLOW_LOCAL_RESTIC_REPOSITORY_FOR_TESTS:-}
  local class=''
  local reason='RESTIC_REPOSITORY must be off-host'
  local endpoint_class='unknown'

  case "$repository" in
    *localhost*|*127.0.0.1*|*::1*)
      reason='RESTIC_REPOSITORY loopback/local endpoints are local-test only'
      ;;
    rclone:*)
      reason='RESTIC_REPOSITORY rclone repositories are local-test only'
      ;;
    rest:http://*|s3:http://*)
      reason='RESTIC_REPOSITORY rest:http and s3:http repositories are local-test only'
      ;;
    *)
      endpoint_class=$(repository_endpoint_class)
      if [[ $endpoint_class == local ]]; then
        reason='RESTIC_REPOSITORY loopback/local endpoints are local-test only'
      elif [[ $endpoint_class != remote ]]; then
        reason='RESTIC_REPOSITORY endpoint is invalid or unsupported'
      else
        case "$repository" in
          s3:*|sftp:*|rest:https://*|azure:*|gs:*|b2:*|swift:*)
            class='off-host'
            ;;
          *)
            reason='RESTIC_REPOSITORY must use a supported off-host repository scheme'
            ;;
        esac
      fi
      ;;
  esac

  if [[ -z $class ]]; then
    [[ $override == true ]] ||
      fail "$reason; set OPS_ALLOW_LOCAL_RESTIC_REPOSITORY_FOR_TESTS=true only for local tests"
    class='local-test'
  fi

  printf '%s' "$class"
}

require_owner_only_password_file() {
  require_command stat
  local mode_hex size type
  IFS=$'\t' read -r mode_hex size type < <(stat -Lc '%f	%s	%F' -- "$RESTIC_PASSWORD_FILE" 2>/dev/null) ||
    fail 'RESTIC_PASSWORD_FILE is not usable'
  [[ $type == 'regular file' && $size =~ ^[1-9][0-9]*$ && -r $RESTIC_PASSWORD_FILE ]] ||
    fail 'RESTIC_PASSWORD_FILE is not usable'
  (( (16#$mode_hex & 077) == 0 )) || fail 'RESTIC_PASSWORD_FILE is not usable'
}

assert_disposable_target() {
  [[ ${DEPLOYMENT_PROFILE:-} == pilot ]] || fail 'DEPLOYMENT_PROFILE must be pilot'
  [[ ${RESTORE_TARGET_IS_DISPOSABLE:-} == true ]] ||
    fail 'RESTORE_TARGET_IS_DISPOSABLE must be true'
  [[ ${RESTORE_DRILL_CONFIRMATION:-} == DESTROY_ONLY_POLIS_DISPOSABLE_RESTORE_TARGET ]] ||
    fail 'RESTORE_DRILL_CONFIRMATION must exactly confirm the disposable target'

  require_env DATABASE_URL
  require_env SOURCE_DATABASE_URL
  require_env PRODUCTION_DATABASE_URL

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
      const destinationOptions = ["host", "hostaddr", "port", "dbname", "service", "servicefile"];
      for (const option of destinationOptions) {
        if (url.searchParams.has(option)) {
          throw new Error(`${name} must not override its destination with ${option}`);
        }
      }
      if (decodeURIComponent(url.hostname).includes(",")) {
        throw new Error(`${name} must name exactly one PostgreSQL host`);
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
    const production = parse("PRODUCTION_DATABASE_URL", process.env.PRODUCTION_DATABASE_URL);
    if (target.identity === production.identity) {
      throw new Error("DATABASE_URL must not target the production database");
    }
    if (!/(^|[_-])(restore[_-]?drill|disposable)([_-]|$)/i.test(target.database)) {
      throw new Error("target database name must contain restore_drill or disposable");
    }
    if (/^(postgres|template0|template1)$/i.test(target.database)) {
      throw new Error("system databases cannot be restore targets");
    }
    process.stdout.write(target.database);
  ' || fail 'disposable target checks failed'
}

disposable_database=$(assert_disposable_target)
require_env RESTIC_REPOSITORY
require_env RESTIC_PASSWORD_FILE
require_env RESTIC_SNAPSHOT
[[ $RESTIC_SNAPSHOT =~ ^[0-9a-f]{8,64}$ ]] ||
  fail 'RESTIC_SNAPSHOT must be a nominated hexadecimal snapshot ID, not latest'
repository_class=$(classify_restic_repository)
if [[ $repository_class == off-host ]]; then
  production_eligible=true
else
  production_eligible=false
fi

for tool in cut date find mktemp node pg_restore psql restic sha256sum sort stat wc; do
  require_command "$tool"
done
require_owner_only_password_file

umask 077
restore_dir=$(mktemp -d "${TMPDIR:-/tmp}/polis-restore-verify.XXXXXXXX")
cleanup() {
  local status=$?
  rm -rf -- "$restore_dir"
  return "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

restic restore "$RESTIC_SNAPSHOT" --target "$restore_dir" >&2
snapshot_entries=$(find "$restore_dir" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort)
[[ $snapshot_entries == $'manifest.json\npolis.dump' ]] ||
  fail 'snapshot must contain exactly manifest.json and polis.dump'

manifest_path="$restore_dir/manifest.json"
[[ -f $manifest_path && -r $manifest_path ]] || fail 'snapshot is missing manifest.json'

IFS=$'\t' read -r dump_file expected_repository_class expected_production_eligible expected_created_at expected_git_sha expected_postgres_major expected_dump_sha expected_list_sha expected_table_count expected_migration_count expected_latest_migration_hash expected_audit_count expected_audit_head_hash < <(
  node -e '
    const fs = require("node:fs");
    const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const currentRepositoryClass = process.argv[2];
    const currentProductionEligible = process.argv[3] === "true";
    function digest(name) {
      if (typeof manifest[name] !== "string" || !/^[0-9a-f]{64}$/.test(manifest[name])) {
        throw new Error(`invalid ${name}`);
      }
      return manifest[name];
    }
    function positiveInteger(name) {
      if (!Number.isSafeInteger(manifest[name]) || manifest[name] < 1) {
        throw new Error(`invalid ${name}`);
      }
      return manifest[name];
    }
    if (manifest.formatVersion !== 3 || manifest.deploymentProfile !== "pilot") {
      throw new Error("unsupported or non-pilot manifest");
    }
    if (manifest.repositoryClass !== "off-host" && manifest.repositoryClass !== "local-test") {
      throw new Error("invalid manifest repositoryClass");
    }
    if (typeof manifest.productionEligible !== "boolean") {
      throw new Error("invalid manifest productionEligible");
    }
    if (manifest.productionEligible !== (manifest.repositoryClass === "off-host")) {
      throw new Error("manifest repositoryClass productionEligible invariant failed");
    }
    if (
      manifest.repositoryClass !== currentRepositoryClass ||
      manifest.productionEligible !== currentProductionEligible
    ) {
      throw new Error("RESTIC_REPOSITORY class does not match manifest");
    }
    if (manifest.dumpFile !== "polis.dump") throw new Error("unexpected dump filename");
    if (typeof manifest.createdAt !== "string" || !manifest.createdAt.endsWith("Z")) {
      throw new Error("invalid manifest timestamp");
    }
    if (typeof manifest.gitSha !== "string" || !/^[0-9a-f]{40,64}$/.test(manifest.gitSha)) {
      throw new Error("invalid manifest Git SHA");
    }
    if (typeof manifest.latestMigrationHash !== "string" || !/^[0-9a-f]{64}$/.test(manifest.latestMigrationHash)) {
      throw new Error("invalid latest migration hash");
    }
    if (typeof manifest.auditHeadHash !== "string" || !/^[0-9a-f]{64}$/.test(manifest.auditHeadHash)) {
      throw new Error("invalid audit head hash");
    }
    process.stdout.write([
      manifest.dumpFile,
      manifest.repositoryClass,
      String(manifest.productionEligible),
      manifest.createdAt,
      manifest.gitSha,
      positiveInteger("postgresMajor"),
      digest("dumpSha256"),
      digest("restoreListSha256"),
      positiveInteger("publicTableCount"),
      positiveInteger("migrationCount"),
      manifest.latestMigrationHash,
      positiveInteger("auditEventCount"),
      manifest.auditHeadHash,
    ].join("\t") + "\n");
  ' "$manifest_path" "$repository_class" "$production_eligible"
) || fail 'manifest validation failed'

dump_path="$restore_dir/$dump_file"
[[ -f $dump_path && -r $dump_path ]] || fail 'snapshot is missing the nominated dump'
actual_dump_sha=$(sha256sum "$dump_path" | cut -d' ' -f1)
[[ $actual_dump_sha == "$expected_dump_sha" ]] || fail 'dump SHA-256 mismatch'
actual_list_sha=$(pg_restore --list "$dump_path" | sha256sum | cut -d' ' -f1)
[[ $actual_list_sha == "$expected_list_sha" ]] || fail 'pg_restore list digest mismatch'

pg_restore_version=$(pg_restore --version)
[[ $pg_restore_version =~ ([0-9]+)\.[0-9]+ ]] || fail 'could not determine pg_restore major version'
pg_restore_major=${BASH_REMATCH[1]}
target_server_version_num=$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc 'SHOW server_version_num')
[[ $target_server_version_num =~ ^[0-9]{5,6}$ ]] || fail 'target PostgreSQL version is invalid'
target_postgres_major=$((target_server_version_num / 10000))
[[ $target_postgres_major == "$expected_postgres_major" ]] ||
  fail "target PostgreSQL major ${target_postgres_major} does not match backup major ${expected_postgres_major}"
[[ $pg_restore_major == "$expected_postgres_major" ]] ||
  fail "pg_restore major ${pg_restore_major} must match backup PostgreSQL major ${expected_postgres_major}"

database_physical_identity() {
  local label=$1
  local url=$2
  local identity
  identity=$(psql "$url" -X -v ON_ERROR_STOP=1 -Atqc \
    "SELECT system_identifier::text || '/' || current_database() FROM pg_control_system()") ||
    fail "${label} physical database identity check failed"
  [[ $identity =~ ^[0-9]+/.+$ ]] || fail "${label} physical database identity is invalid"
  printf '%s' "$identity"
}
target_physical_identity=$(database_physical_identity target "$DATABASE_URL")
source_physical_identity=$(database_physical_identity source "$SOURCE_DATABASE_URL")
production_physical_identity=$(database_physical_identity production "$PRODUCTION_DATABASE_URL")
[[ $target_physical_identity != "$source_physical_identity" ]] ||
  fail 'DATABASE_URL must not resolve to the source database'
[[ $target_physical_identity != "$production_physical_identity" ]] ||
  fail 'DATABASE_URL must not resolve to the production database'

# All destructive pg_restore flags stay below the confirmation, logical and physical database
# identity checks, database-name, snapshot, manifest, version, and content-integrity checks above.
pg_restore \
  --dbname="$DATABASE_URL" \
  --clean \
  --if-exists \
  --exit-on-error \
  --no-owner \
  --no-privileges \
  "$dump_path"

required_schema=$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc \
  "SELECT (
    to_regclass('public.app_meta') IS NOT NULL
    AND to_regclass('public.audit_events') IS NOT NULL
    AND to_regclass('drizzle.__drizzle_migrations') IS NOT NULL
  )::text")
[[ $required_schema == true ]] || fail 'restored database is missing required schema'

IFS=$'\t' read -r actual_table_count actual_migration_count actual_latest_migration_hash actual_audit_count < <(
  psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -AtF $'\t' -c "
    WITH ledger AS (
      SELECT count(*)::bigint AS migration_count
      FROM drizzle.__drizzle_migrations
    ),
    latest AS (
      SELECT hash AS latest_migration_hash
      FROM drizzle.__drizzle_migrations
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    )
    SELECT
      (SELECT count(*)::bigint FROM pg_catalog.pg_tables WHERE schemaname = 'public'),
      ledger.migration_count,
      latest.latest_migration_hash,
      (SELECT count(*)::bigint FROM public.audit_events)
    FROM ledger
    CROSS JOIN latest
  "
) || fail 'restored migration ledger query failed'
[[ $actual_table_count == "$expected_table_count" ]] || fail 'restored public-table count mismatch'
[[ $actual_migration_count == "$expected_migration_count" ]] || fail 'restored migration count mismatch'
[[ $actual_latest_migration_hash == "$expected_latest_migration_hash" ]] ||
  fail 'restored latest migration hash mismatch'
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
audit_result=$(node "$script_dir/verify-audit-chain.mjs" "$audit_export") ||
  fail 'restored audit chain verification failed'

IFS=$'\t' read -r verified_audit_count verified_audit_head_hash < <(
  node -e '
    const result = JSON.parse(process.argv[1]);
    if (result?.ok !== true) throw new Error("audit verifier did not report ok");
    if (!Number.isSafeInteger(result.records) || result.records < 1) {
      throw new Error("audit verifier reported an empty chain");
    }
    if (typeof result.headHash !== "string" || !/^[0-9a-f]{64}$/.test(result.headHash)) {
      throw new Error("audit verifier reported an invalid head hash");
    }
    process.stdout.write(`${result.records}\t${result.headHash}\n`);
  ' "$audit_result"
) || fail 'restored audit verification output was invalid'
[[ $verified_audit_count == "$expected_audit_count" ]] || fail 'restored audit verification count mismatch'
[[ $verified_audit_head_hash == "$expected_audit_head_hash" ]] || fail 'restored audit head hash mismatch'

verified_at=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
node -e '
  const report = {
    ok: true,
    snapshotId: process.argv[1],
    repositoryClass: process.argv[14],
    productionEligible: process.argv[15] === "true",
    createdAt: process.argv[2],
    verifiedAt: process.argv[3],
    gitSha: process.argv[4],
    postgresMajor: Number(process.argv[5]),
    dumpSha256: process.argv[6],
    restoreListSha256: process.argv[7],
    disposableDbName: process.argv[8],
    publicTableCount: Number(process.argv[9]),
    migrationCount: Number(process.argv[10]),
    latestMigrationHash: process.argv[11],
    auditEventCount: Number(process.argv[12]),
    auditHeadHash: process.argv[13],
  };
  process.stdout.write(`${JSON.stringify(report)}\n`);
' "$RESTIC_SNAPSHOT" "$expected_created_at" "$verified_at" "$expected_git_sha" \
  "$expected_postgres_major" "$expected_dump_sha" "$expected_list_sha" "$disposable_database" \
  "$actual_table_count" "$actual_migration_count" "$actual_latest_migration_hash" \
  "$actual_audit_count" "$verified_audit_head_hash" "$expected_repository_class" "$expected_production_eligible"
