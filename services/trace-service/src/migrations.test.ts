// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';

import { readFileSync } from 'node:fs';

import { readMigrations } from './migrations.js';

test('bundled trace migrations are ordered and content hashed', () => {
  const migrations = readMigrations();
  assert.deepEqual(
    migrations.map((migration) => migration.version),
    ['0001'],
  );
  assert.match(migrations[0]!.hash, /^[a-f0-9]{64}$/);
  assert.match(migrations[0]!.sql, /CREATE TABLE trace_records/);
  assert.match(migrations[0]!.sql, /trace_events_reject_update/);
  assert.match(migrations[0]!.sql, /trace_events_reject_delete/);
});

test('migration application serializes the ledger with a transaction-scoped advisory lock', () => {
  const source = readFileSync(new URL('./migrations.ts', import.meta.url), 'utf8');
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /trace-service-migrations/);
});
