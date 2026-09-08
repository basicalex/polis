import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { getTableConfig } from 'drizzle-orm/pg-core';
import postgres from 'postgres';

import { runMigrationsOnce } from './index.js';
import { identityOidcLoginStates, identitySessionRevocations, schema } from './schema.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const migrations = join(repoRoot, 'packages/db/migrations');

const indexNames = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table)
    .indexes.map((index) => index.config.name)
    .sort();

const checkNames = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table)
    .checks.map((check) => check.name)
    .sort();

test('identity readiness schema exposes only additive state and revocation tables', () => {
  assert.equal(schema.identitySessionRevocations, identitySessionRevocations);
  assert.equal(schema.identityOidcLoginStates, identityOidcLoginStates);
  assert.equal(getTableConfig(identitySessionRevocations).name, 'identity_session_revocations');
  assert.equal(getTableConfig(identityOidcLoginStates).name, 'identity_oidc_login_states');

  assert.deepEqual(indexNames(identitySessionRevocations), [
    'identity_session_revocations_expires_idx',
    'identity_session_revocations_token_hash_idx',
  ]);
  assert.deepEqual(checkNames(identitySessionRevocations), [
    'ck_identity_session_revocations_expiry',
    'ck_identity_session_revocations_token_hash',
  ]);
  assert.deepEqual(indexNames(identityOidcLoginStates), [
    'identity_oidc_login_states_expires_idx',
    'identity_oidc_login_states_state_hash_idx',
  ]);
  assert.deepEqual(checkNames(identityOidcLoginStates), [
    'ck_identity_oidc_login_states_expiry',
    'ck_identity_oidc_login_states_nonce',
    'ck_identity_oidc_login_states_redirect',
    'ck_identity_oidc_login_states_state_hash',
    'ck_identity_oidc_login_states_verifier',
  ]);

  const revocationColumns = getTableConfig(identitySessionRevocations).columns.map(
    (column) => column.name,
  );
  assert.ok(revocationColumns.includes('token_hash'));
  assert.ok(!revocationColumns.includes('session_token'));
  const stateColumns = getTableConfig(identityOidcLoginStates).columns.map((column) => column.name);
  assert.ok(stateColumns.includes('state_hash'));
  assert.ok(!stateColumns.includes('state'));
});

test('migration 0015 is additive and leaves citizen and legacy tables untouched', async () => {
  const migration = await readFile(join(migrations, '0015_identity_readiness.sql'), 'utf8');
  assert.match(migration, /CREATE TABLE "identity_oidc_login_states"/);
  assert.match(migration, /CREATE TABLE "identity_session_revocations"/);
  assert.doesNotMatch(migration, /\b(?:ALTER|DROP|TRUNCATE|UPDATE|DELETE)\b/i);
  assert.doesNotMatch(migration, /"citizens"|"external_identities"/);
  assert.doesNotMatch(migration, /session_token/);
});

test('migration journal and snapshots form the real 0014 to 0015 sequence', async () => {
  const [journalRaw, previousRaw, currentRaw] = await Promise.all([
    readFile(join(migrations, 'meta/_journal.json'), 'utf8'),
    readFile(join(migrations, 'meta/0014_snapshot.json'), 'utf8'),
    readFile(join(migrations, 'meta/0015_snapshot.json'), 'utf8'),
  ]);
  const journal = JSON.parse(journalRaw) as {
    entries: Array<{ idx: number; tag: string; version: string }>;
  };
  const previous = JSON.parse(previousRaw) as {
    id: string;
    tables: Record<string, unknown>;
  };
  const current = JSON.parse(currentRaw) as {
    id: string;
    prevId: string;
    tables: Record<string, unknown>;
  };

  assert.deepEqual(
    journal.entries.slice(-2).map(({ idx, tag, version }) => ({ idx, tag, version })),
    [
      { idx: 14, tag: '0014_complaint_case_v0', version: '7' },
      { idx: 15, tag: '0015_identity_readiness', version: '7' },
    ],
  );
  assert.equal(current.prevId, previous.id);
  assert.notEqual(current.id, previous.id);
  assert.equal(Object.keys(current.tables).length, Object.keys(previous.tables).length + 2);
  assert.ok(current.tables['public.identity_oidc_login_states']);
  assert.ok(current.tables['public.identity_session_revocations']);
});

const identityDatabaseUrl = process.env.IDENTITY_TEST_DATABASE_URL;

test(
  '0015 applies to the isolated PostgreSQL database and preserves legacy rows',
  { skip: !identityDatabaseUrl },
  async () => {
    assert.ok(identityDatabaseUrl);
    await runMigrationsOnce(identityDatabaseUrl);
    const sql = postgres(identityDatabaseUrl, { max: 1 });
    const sentinel = 'identity-readiness-migration-sentinel';
    try {
      await sql`
        INSERT INTO app_meta (key, value)
        VALUES (${sentinel}, 'preserve-me')
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `;
      await runMigrationsOnce(identityDatabaseUrl);

      const migrationRows = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations
      `;
      assert.equal(migrationRows[0]?.count, '16');
      const tables = await sql<{ table_name: string }[]>`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('identity_oidc_login_states', 'identity_session_revocations')
        ORDER BY table_name
      `;
      assert.deepEqual(
        tables.map((row) => row.table_name),
        ['identity_oidc_login_states', 'identity_session_revocations'],
      );
      const preserved = await sql<{ value: string }[]>`
        SELECT value FROM app_meta WHERE key = ${sentinel}
      `;
      assert.equal(preserved[0]?.value, 'preserve-me');
    } finally {
      await sql`DELETE FROM app_meta WHERE key = ${sentinel}`.catch(() => undefined);
      await sql.end({ timeout: 1 });
    }
  },
);
