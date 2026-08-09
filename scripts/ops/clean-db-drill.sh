#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'clean-db-drill: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

for tool in bun cut docker node psql sha256sum sleep; do
  require_command "$tool"
done

readonly image='pgvector/pgvector:pg16'
readonly owner_label_name='org.polis.task'
readonly owner_label_value='task11-clean-db-drill'
readonly repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
readonly run_id="$(node -e 'const crypto = require("crypto"); process.stdout.write(crypto.randomUUID().replace(/-/g, "").slice(0, 16))')"
readonly container_name="polis-task11-disposable-clean-db-drill-${run_id}"
readonly database_name="polis_task11_disposable_clean_db_drill_${run_id}"
readonly database_user='postgres'
readonly database_password="$(node -e 'const crypto = require("crypto"); process.stdout.write(crypto.randomBytes(32).toString("base64url"))')"
cd "$repo_root"

container_id=''

cleanup() {
  local status=$?
  if [[ -n $container_id ]]; then
    local actual_label=''
    actual_label=$(docker inspect --format "{{ index .Config.Labels \"${owner_label_name}\" }}" "$container_id" 2>/dev/null || true)
    if [[ $actual_label == "$owner_label_value" ]]; then
      docker rm -f "$container_id" >/dev/null 2>&1 || true
    else
      printf 'clean-db-drill: refusing cleanup for container without expected ownership label\n' >&2
    fi
  fi
  return "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

container_id=$(docker run \
  --detach \
  --name "$container_name" \
  --label "${owner_label_name}=${owner_label_value}" \
  --env "POSTGRES_DB=${database_name}" \
  --env "POSTGRES_USER=${database_user}" \
  --env "POSTGRES_PASSWORD=${database_password}" \
  --publish '127.0.0.1::5432' \
  "$image")

actual_label=$(docker inspect --format "{{ index .Config.Labels \"${owner_label_name}\" }}" "$container_id")
[[ $actual_label == "$owner_label_value" ]] || fail 'container ownership label mismatch'

host_port=$(docker port "$container_id" 5432/tcp | cut -d: -f2)
[[ $host_port =~ ^[0-9]+$ ]] || fail 'could not determine disposable PostgreSQL port'

database_url="postgres://${database_user}:${database_password}@127.0.0.1:${host_port}/${database_name}"

ready=false
for _ in {1..60}; do
  if PGPASSWORD="$database_password" psql \
    --host=127.0.0.1 \
    --port="$host_port" \
    --username="$database_user" \
    --dbname="$database_name" \
    --no-psqlrc \
    --quiet \
    --tuples-only \
    --command='select 1' >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
[[ $ready == true ]] || fail 'PostgreSQL readiness timed out'

psql_db() {
  PGPASSWORD="$database_password" psql \
    --host=127.0.0.1 \
    --port="$host_port" \
    --username="$database_user" \
    --dbname="$database_name" \
    --no-psqlrc \
    --quiet \
    --tuples-only \
    --no-align \
    --field-separator=$'\t' \
    "$@"
}

DATABASE_URL="$database_url" bun run --filter @polis/db build >/dev/null
DATABASE_URL="$database_url" bun run --filter @polis/db seed >/dev/null

journal_tsv=$(node <<'NODE'
const fs = require('fs');
const journal = JSON.parse(fs.readFileSync('packages/db/migrations/meta/_journal.json', 'utf8'));
if (!Array.isArray(journal.entries) || journal.entries.length === 0) {
  throw new Error('migration journal is empty');
}
const latest = journal.entries[journal.entries.length - 1];
if (!latest || typeof latest.tag !== 'string' || !latest.tag) {
  throw new Error('latest journal entry is missing tag');
}
process.stdout.write(`${journal.entries.length}\t${latest.tag}`);
NODE
)
IFS=$'\t' read -r journal_count latest_tag <<<"$journal_tsv"
[[ $journal_count =~ ^[1-9][0-9]*$ ]] || fail 'migration journal count must be positive'

latest_sql="packages/db/migrations/${latest_tag}.sql"
[[ -f $latest_sql && -r $latest_sql ]] || fail "latest migration SQL not found: $latest_sql"
latest_migration_hash=$(sha256sum "$latest_sql" | cut -d' ' -f1)
[[ $latest_migration_hash =~ ^[0-9a-f]{64}$ ]] || fail 'invalid latest migration hash'

live_migration_tsv=$(psql_db --command="select count(*)::text, coalesce((array_agg(hash order by created_at desc, id desc))[1], '') from drizzle.__drizzle_migrations")
IFS=$'\t' read -r live_migration_count live_migration_hash <<<"$live_migration_tsv"
[[ $live_migration_count == "$journal_count" ]] || fail "migration count mismatch: journal=${journal_count} live=${live_migration_count}"
[[ $live_migration_hash == "$latest_migration_hash" ]] || fail 'latest live migration hash does not match latest journal SQL SHA-256'

required_tables=(
  app_meta
  audit_events
  submissions
  reviews
  mandate_holders
  commitments
  commitment_status_events
  complaint_cases
  complaint_case_events
  complaint_decisions
  complaint_appeals
  complaint_information_requests
)
for table in "${required_tables[@]}"; do
  exists=$(psql_db --command="select to_regclass('public.${table}') is not null")
  [[ $exists == t ]] || fail "required workflow table missing: $table"
done

counts_query=$(psql_db --command="select string_agg(format('select %L as table_name, count(*)::bigint as row_count from %I.%I', table_name, table_schema, table_name), ' union all ' order by table_name) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'")
[[ -n $counts_query ]] || fail 'no public tables found'
first_counts=$(psql_db --command="$counts_query order by table_name")
public_table_count=$(PUBLIC_COUNTS="$first_counts" node -e 'const rows = (process.env.PUBLIC_COUNTS || "").split("\n").filter(Boolean); process.stdout.write(String(rows.length));')
[[ $public_table_count =~ ^[1-9][0-9]*$ ]] || fail 'public table count must be positive'

DATABASE_URL="$database_url" bun run --filter @polis/db seed >/dev/null
second_counts=$(psql_db --command="$counts_query order by table_name")
[[ $first_counts == "$second_counts" ]] || fail 'public table row counts changed after second seed'

seed_row_count=$(PUBLIC_COUNTS="$first_counts" node <<'NODE'
const rows = (process.env.PUBLIC_COUNTS || '').split('\n').filter(Boolean);
const total = rows.reduce((sum, row) => {
  const count = Number(row.split('\t')[1]);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('invalid public table row count');
  return sum + count;
}, 0);
if (!Number.isSafeInteger(total) || total <= 0) throw new Error('seed row count must be positive');
process.stdout.write(String(total));
NODE
)

IMAGE="$image" \
MIGRATION_COUNT="$live_migration_count" \
LATEST_MIGRATION_HASH="$latest_migration_hash" \
PUBLIC_TABLE_COUNT="$public_table_count" \
SEED_ROW_COUNT="$seed_row_count" \
node <<'NODE'
const payload = {
  ok: true,
  image: process.env.IMAGE,
  migrationCount: Number(process.env.MIGRATION_COUNT),
  latestMigrationHash: process.env.LATEST_MIGRATION_HASH,
  publicTableCount: Number(process.env.PUBLIC_TABLE_COUNT),
  seedRowCount: Number(process.env.SEED_ROW_COUNT),
  idempotent: true,
};
process.stdout.write(`${JSON.stringify(payload)}\n`);
NODE
