import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const migrationPath = path.join(repoRoot, 'packages/db/migrations/0013_documenso_signing_v0.sql');

test('migration 0013 does not reset accepted charters to pending', async () => {
  const migration = await readFile(migrationPath, 'utf8');
  const destructiveStatement = migration
    .split('--> statement-breakpoint')
    .find(
      (statement) =>
        /UPDATE\s+"mandate_holder_charters"/i.test(statement) &&
        /"status"\s*=\s*'pending'/i.test(statement) &&
        /WHERE\s+"status"\s*=\s*'accepted'/i.test(statement),
    );

  assert.equal(
    destructiveStatement,
    undefined,
    'migration 0013 must preserve already accepted charters',
  );
});
