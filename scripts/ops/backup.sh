#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'backup: %s\n' "$*" >&2
  exit 1
}

require_env() {
  local name=$1
  [[ -n ${!name:-} ]] || fail "$name is required"
}

require_positive_integer() {
  local name=$1
  [[ ${!name} =~ ^[1-9][0-9]*$ ]] || fail "$name must be a positive integer"
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

[[ ${DEPLOYMENT_PROFILE:-} == pilot ]] || fail 'DEPLOYMENT_PROFILE must be pilot'
[[ ${BACKUP_ENABLED:-} == true ]] || fail 'BACKUP_ENABLED must be true'
require_env DATABASE_URL
require_env RESTIC_REPOSITORY
require_env RESTIC_PASSWORD_FILE
repository_class=$(classify_restic_repository)
if [[ $repository_class == off-host ]]; then
  production_eligible=true
else
  production_eligible=false
fi

: "${RESTIC_CHECK_TIMEOUT_SECONDS:=300}"
: "${RESTIC_KEEP_DAILY:=7}"
: "${RESTIC_KEEP_WEEKLY:=4}"
: "${RESTIC_KEEP_MONTHLY:=6}"
require_positive_integer RESTIC_CHECK_TIMEOUT_SECONDS
require_positive_integer RESTIC_KEEP_DAILY
require_positive_integer RESTIC_KEEP_WEEKLY
require_positive_integer RESTIC_KEEP_MONTHLY

for tool in cut date git mktemp node pg_dump pg_restore psql restic sha256sum stat timeout; do
  require_command "$tool"
done
require_owner_only_password_file

unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_OBJECT_DIRECTORY
unset GIT_ALTERNATE_OBJECT_DIRECTORIES
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
git_top_level=$(git -C "$repo_root" rev-parse --show-toplevel 2>/dev/null) ||
  fail 'could not verify repository root'
git_top_level=$(cd "$git_top_level" && pwd -P) || fail 'could not resolve repository root'
[[ $git_top_level == "$repo_root" ]] || fail 'backup script must run from its owning repository'
worktree_status=$(git -C "$repo_root" status --porcelain=v1 --untracked-files=all 2>/dev/null) ||
  fail 'could not verify clean working tree'
[[ -z $worktree_status ]] || fail 'working tree must be clean before a release backup'
git_sha=$(git -C "$repo_root" rev-parse --verify 'HEAD^{commit}' 2>/dev/null) ||
  fail 'could not determine a valid Git SHA'
[[ $git_sha =~ ^[0-9a-f]{40,64}$ ]] || fail 'could not determine a valid Git SHA'

pg_dump_version=$(pg_dump --version)
[[ $pg_dump_version =~ ([0-9]+)\.[0-9]+ ]] || fail 'could not determine pg_dump major version'
pg_dump_major=${BASH_REMATCH[1]}
source_server_version_num=$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc 'SHOW server_version_num')
[[ $source_server_version_num =~ ^[0-9]{5,6}$ ]] || fail 'source PostgreSQL version is invalid'
source_postgres_major=$((source_server_version_num / 10000))
[[ $pg_dump_major == "$source_postgres_major" ]] ||
  fail "pg_dump major ${pg_dump_major} must match source PostgreSQL major ${source_postgres_major}"

umask 077
staging_dir=$(mktemp -d "${TMPDIR:-/tmp}/polis-backup.XXXXXXXX")
snapshot_holder_pid=''
snapshot_holder_input_fd=''
cleanup() {
  local status=$?
  if [[ -n $snapshot_holder_pid ]]; then
    printf 'ROLLBACK;\n\\q\n' >&"$snapshot_holder_input_fd" 2>/dev/null || true
    wait "$snapshot_holder_pid" 2>/dev/null || true
  fi
  rm -rf -- "$staging_dir"
  return "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

readonly dump_name='polis.dump'
readonly manifest_name='manifest.json'
readonly backup_tag='polis-pilot-backup'
readonly dump_path="$staging_dir/$dump_name"
readonly manifest_path="$staging_dir/$manifest_name"
readonly backup_output="$staging_dir/restic-backup.jsonl"

created_at=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
coproc SNAPSHOT_HOLDER {
  psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atq
}
snapshot_holder_pid=$SNAPSHOT_HOLDER_PID
snapshot_holder_input_fd=${SNAPSHOT_HOLDER[1]}
snapshot_holder_output_fd=${SNAPSHOT_HOLDER[0]}
printf 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;\nSELECT pg_export_snapshot();\n' \
  >&"$snapshot_holder_input_fd"
IFS= read -r database_snapshot <&"$snapshot_holder_output_fd" ||
  fail 'could not export a consistent source database snapshot'
[[ $database_snapshot =~ ^[0-9A-Fa-f-]+$ ]] || fail 'source database returned an invalid snapshot ID'


audit_export="$staging_dir/audit.ndjson"
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atq -v snapshot_id="$database_snapshot" <<'SQL' >"$audit_export"
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;
SET TRANSACTION SNAPSHOT :'snapshot_id';
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
  'createdAt', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'hash', hash,
  'previousHash', previous_hash
)::text
FROM public.audit_events
ORDER BY created_at, id;
COMMIT;
SQL

audit_result=$(node "$repo_root/scripts/ops/verify-audit-chain.mjs" "$audit_export") ||
  fail 'source audit chain verification failed'

IFS=$'\t' read -r audit_event_count audit_head_hash < <(
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
) || fail 'source audit verification output was invalid'

IFS=$'\t' read -r public_table_count migration_count latest_migration_hash < <(
  psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -AtqF $'\t' -v snapshot_id="$database_snapshot" <<'SQL'
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;
SET TRANSACTION SNAPSHOT :'snapshot_id';
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
  latest.latest_migration_hash
FROM ledger
CROSS JOIN latest;
COMMIT;
SQL
) || fail 'source migration ledger query failed'
[[ $public_table_count =~ ^[1-9][0-9]*$ ]] || fail 'source public-table count is invalid'
[[ $migration_count =~ ^[1-9][0-9]*$ ]] || fail 'source migration count is invalid'
[[ $latest_migration_hash =~ ^[0-9a-f]{64}$ ]] || fail 'source latest migration hash is invalid'

pg_dump \
  --dbname="$DATABASE_URL" \
  --snapshot="$database_snapshot" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="$dump_path"

printf 'COMMIT;\n\\q\n' >&"$snapshot_holder_input_fd"
wait "$snapshot_holder_pid" || fail 'source database snapshot holder failed'
snapshot_holder_pid=''

dump_sha256=$(sha256sum "$dump_path" | cut -d' ' -f1)
restore_list_sha256=$(pg_restore --list "$dump_path" | sha256sum | cut -d' ' -f1)
[[ $dump_sha256 =~ ^[0-9a-f]{64}$ ]] || fail 'invalid dump digest'
[[ $restore_list_sha256 =~ ^[0-9a-f]{64}$ ]] || fail 'invalid restore-list digest'

node -e '
  const fs = require("node:fs");
  const manifest = {
    formatVersion: 3,
    repositoryClass: process.argv[12],
    productionEligible: process.argv[13] === "true",
    deploymentProfile: "pilot",
    createdAt: process.argv[2],
    gitSha: process.argv[3],
    postgresMajor: Number(process.argv[4]),
    dumpFile: "polis.dump",
    dumpSha256: process.argv[5],
    restoreListSha256: process.argv[6],
    publicTableCount: Number(process.argv[7]),
    migrationCount: Number(process.argv[8]),
    latestMigrationHash: process.argv[9],
    auditEventCount: Number(process.argv[10]),
    auditHeadHash: process.argv[11],
  };
  fs.writeFileSync(process.argv[1], `${JSON.stringify(manifest, null, 2)}\n`);
' "$manifest_path" "$created_at" "$git_sha" "$source_postgres_major" "$dump_sha256" \
  "$restore_list_sha256" "$public_table_count" "$migration_count" "$latest_migration_hash" \
  "$audit_event_count" "$audit_head_hash" "$repository_class" "$production_eligible"

(
  cd "$staging_dir"
  restic backup --json --tag "$backup_tag" -- "$dump_name" "$manifest_name" >"$backup_output"
)

snapshot_id=$(node -e '
  const fs = require("node:fs");
  const lines = fs.readFileSync(process.argv[1], "utf8").trim().split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const event = JSON.parse(lines[index]);
    if (event.message_type === "summary" && event.snapshot_id) {
      process.stdout.write(event.snapshot_id);
      process.exit(0);
    }
  }
  process.exit(1);
' "$backup_output") || fail 'restic did not report a snapshot ID'
[[ $snapshot_id =~ ^[0-9a-f]{8,64}$ ]] || fail 'restic reported an invalid snapshot ID'

timeout "${RESTIC_CHECK_TIMEOUT_SECONDS}s" \
  restic check --read-data-subset=1/20 >&2
restic forget \
  --tag "$backup_tag" \
  --keep-daily "$RESTIC_KEEP_DAILY" \
  --keep-weekly "$RESTIC_KEEP_WEEKLY" \
  --keep-monthly "$RESTIC_KEEP_MONTHLY" \
  --prune >&2

node -e '
  const report = {
    ok: true,
    snapshotId: process.argv[1],
    repositoryClass: process.argv[12],
    productionEligible: process.argv[13] === "true",
    createdAt: process.argv[2],
    gitSha: process.argv[3],
    postgresMajor: Number(process.argv[4]),
    dumpSha256: process.argv[5],
    restoreListSha256: process.argv[6],
    publicTableCount: Number(process.argv[7]),
    migrationCount: Number(process.argv[8]),
    latestMigrationHash: process.argv[9],
    auditEventCount: Number(process.argv[10]),
    auditHeadHash: process.argv[11],
  };
  process.stdout.write(`${JSON.stringify(report)}\n`);
' "$snapshot_id" "$created_at" "$git_sha" "$source_postgres_major" "$dump_sha256" \
  "$restore_list_sha256" "$public_table_count" "$migration_count" "$latest_migration_hash" \
  "$audit_event_count" "$audit_head_hash" "$repository_class" "$production_eligible"
