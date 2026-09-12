// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { readMigrations } from './migrations.js';

test('bundled channel migration is ordered, hashed, and complete', () => {
  const migrations = readMigrations();
  assert.deepEqual(
    migrations.map((migration) => migration.version),
    ['0001'],
  );
  assert.match(migrations[0]!.hash, /^[a-f0-9]{64}$/);
  for (const table of [
    'channel_identities',
    'channel_links',
    'channel_events',
    'channel_inbox',
    'channel_outbox',
    'channel_recordings',
    'channel_rate_windows',
  ]) {
    assert.match(migrations[0]!.sql, new RegExp(`CREATE TABLE ${table}`));
  }
});

test('migration ledger is serialized and hash verified', () => {
  const source = readFileSync(new URL('./migrations.ts', import.meta.url), 'utf8');
  assert.match(source, /channel_schema_migrations/);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /channel-gateway-migrations/);
  assert.match(source, /migration hash mismatch/);
});
