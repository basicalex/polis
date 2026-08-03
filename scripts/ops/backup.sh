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

[[ ${DEPLOYMENT_PROFILE:-} == pilot ]] || fail 'DEPLOYMENT_PROFILE must be pilot'
[[ ${BACKUP_ENABLED:-} == true ]] || fail 'BACKUP_ENABLED must be true'
require_env DATABASE_URL
require_env RESTIC_REPOSITORY
require_env RESTIC_PASSWORD_FILE

repository_is_off_host=false
case "${RESTIC_REPOSITORY,,}" in
  *localhost*|*127.0.0.1*|*::1*|rclone:*) ;;
  s3:*|sftp:*|rest:*|azure:*|gs:*|b2:*|swift:*) repository_is_off_host=true ;;
esac
[[ $repository_is_off_host == true || ${OPS_ALLOW_LOCAL_RESTIC_REPOSITORY_FOR_TESTS:-} == true ]] ||
  fail 'RESTIC_REPOSITORY must be off-host; local repositories require OPS_ALLOW_LOCAL_RESTIC_REPOSITORY_FOR_TESTS=true'

[[ -f $RESTIC_PASSWORD_FILE && -r $RESTIC_PASSWORD_FILE && -s $RESTIC_PASSWORD_FILE ]] ||
  fail 'RESTIC_PASSWORD_FILE must name a readable, non-empty file'

: "${RESTIC_CHECK_TIMEOUT_SECONDS:=300}"
: "${RESTIC_KEEP_DAILY:=7}"
: "${RESTIC_KEEP_WEEKLY:=4}"
: "${RESTIC_KEEP_MONTHLY:=6}"
require_positive_integer RESTIC_CHECK_TIMEOUT_SECONDS
require_positive_integer RESTIC_KEEP_DAILY
require_positive_integer RESTIC_KEEP_WEEKLY
require_positive_integer RESTIC_KEEP_MONTHLY

for tool in cut date git mktemp node pg_dump pg_restore psql restic sha256sum timeout; do
  require_command "$tool"
done

umask 077
staging_dir=$(mktemp -d "${TMPDIR:-/tmp}/polis-backup.XXXXXXXX")
cleanup() {
  rm -rf -- "$staging_dir"
}
trap cleanup EXIT HUP INT TERM

readonly dump_name='polis.dump'
readonly manifest_name='manifest.json'
readonly backup_tag='polis-pilot-backup'
readonly dump_path="$staging_dir/$dump_name"
readonly manifest_path="$staging_dir/$manifest_name"
readonly backup_output="$staging_dir/restic-backup.jsonl"

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
created_at=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
git_sha=$(git -C "$repo_root" rev-parse --verify 'HEAD^{commit}')
[[ $git_sha =~ ^[0-9a-f]{40,64}$ ]] || fail 'could not determine a valid Git SHA'

pg_dump \
  --dbname="$DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="$dump_path"

dump_sha256=$(sha256sum "$dump_path" | cut -d' ' -f1)
restore_list_sha256=$(pg_restore --list "$dump_path" | sha256sum | cut -d' ' -f1)
[[ $dump_sha256 =~ ^[0-9a-f]{64}$ ]] || fail 'invalid dump digest'
[[ $restore_list_sha256 =~ ^[0-9a-f]{64}$ ]] || fail 'invalid restore-list digest'

has_audit_table=$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc \
  "SELECT (to_regclass('public.audit_events') IS NOT NULL)::text")
[[ $has_audit_table == true ]] || fail 'source database is missing public.audit_events'
public_table_count=$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc \
  "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public'")
audit_event_count=$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc \
  'SELECT count(*) FROM public.audit_events')
[[ $public_table_count =~ ^[1-9][0-9]*$ ]] || fail 'source public-table count is invalid'
[[ $audit_event_count =~ ^[0-9]+$ ]] || fail 'source audit-event count is invalid'

cat >"$manifest_path" <<EOF
{
  "formatVersion": 1,
  "deploymentProfile": "pilot",
  "createdAt": "$created_at",
  "gitSha": "$git_sha",
  "dumpFile": "$dump_name",
  "dumpSha256": "$dump_sha256",
  "restoreListSha256": "$restore_list_sha256",
  "publicTableCount": $public_table_count,
  "auditEventCount": $audit_event_count
}
EOF

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
  restic check --read-data-subset=1/20
restic forget \
  --tag "$backup_tag" \
  --keep-daily "$RESTIC_KEEP_DAILY" \
  --keep-weekly "$RESTIC_KEEP_WEEKLY" \
  --keep-monthly "$RESTIC_KEEP_MONTHLY" \
  --prune

printf '{"ok":true,"snapshotId":"%s","createdAt":"%s","dumpSha256":"%s"}\n' \
  "$snapshot_id" "$created_at" "$dump_sha256"
