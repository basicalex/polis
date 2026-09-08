import { access } from 'node:fs/promises';
import path from 'node:path';

import {
  PG_BIN,
  ROOT,
  PilotError,
  TEST_MARKER,
  curatedEnvironment,
  runBounded,
} from './runtime-lib.mjs';

const databaseUrl = process.env.DATABASE_URL;
if (process.env.PILOT_TEST_DATABASE_MARKER !== TEST_MARKER || !databaseUrl) {
  throw new PilotError('trace chain checker requires an explicit owned test database');
}
const target = new URL(databaseUrl);
if (target.hostname !== '127.0.0.1' || !target.pathname.endsWith('_test')) {
  throw new PilotError('trace chain checker requires a loopback *_test database');
}
const canonicalModule = path.join(ROOT, 'services/trace-service/dist/canonical.js');
await access(canonicalModule).catch(() => {
  throw new PilotError('trace service is not built; run runtime start --build');
});
const { verifyEventChain, verifyReceiptHash } = await import(canonicalModule);
const database = target.pathname.slice(1);
const pgEnv = curatedEnvironment({
  PGHOST: target.hostname,
  PGPORT: target.port || '5432',
  PGUSER: decodeURIComponent(target.username),
  PGPASSWORD: decodeURIComponent(target.password),
  PGDATABASE: database,
});

async function queryJson(query) {
  const { stdout } = await runBounded(
    path.join(PG_BIN, 'psql'),
    [
      '--no-password',
      '--set',
      'ON_ERROR_STOP=1',
      '--tuples-only',
      '--no-align',
      '--dbname',
      database,
      '--command',
      query,
    ],
    { env: pgEnv, capture: true, timeoutMs: 30_000 },
  );
  return JSON.parse(stdout.trim() || '[]');
}

const records = await queryJson(`
  SELECT COALESCE(json_agg(json_build_object('id', id, 'version', version, 'status', status) ORDER BY id), '[]'::json)
  FROM trace_records;
`);
for (const record of records) {
  if (typeof record.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(record.id)) {
    throw new PilotError('trace record identifier is invalid');
  }
  const events = await queryJson(`
    SELECT COALESCE(json_agg(json_build_object(
      'id', id, 'recordId', record_id, 'sequence', sequence,
      'previousHash', nullif(rtrim(previous_hash), ''), 'hash', rtrim(hash),
      'stage', stage, 'action', action, 'actorId', actor_id, 'actorRole', actor_role,
      'note', note, 'payload', payload, 'resultingVersion', resulting_version,
      'resultingStatus', resulting_status,
      'createdAt', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ) ORDER BY sequence), '[]'::json)
    FROM trace_events WHERE record_id = '${record.id}';
  `);
  const result = verifyEventChain(events, { version: record.version, status: record.status });
  if (!result.valid) throw new PilotError('trace event chain verification failed');
}
const snapshots = await queryJson(`
  SELECT COALESCE(json_agg(json_build_object(
    'id', record_id, 'municipalityId', municipality_id, 'category', category, 'office', office,
    'status', public_status, 'publicSummary', public_summary, 'commitment', commitment,
    'dueDate', to_char(due_date, 'YYYY-MM-DD'), 'evidenceNote', evidence_note,
    'evidenceUrls', evidence_urls,
    'publishedAt', to_char(published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'resolvedAt', CASE WHEN resolved_at IS NULL THEN NULL ELSE to_char(resolved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
    'events', public_events, 'receiptHash', rtrim(receipt_hash), 'testEnvironment', true
  ) ORDER BY record_id), '[]'::json)
  FROM trace_public_snapshots;
`);
for (const snapshot of snapshots) {
  if (!verifyReceiptHash(snapshot)) throw new PilotError('trace receipt hash verification failed');
}
console.log(
  JSON.stringify({
    chainVerified: true,
    records: records.length,
    publicSnapshots: snapshots.length,
    scope: 'local-only',
  }),
);
