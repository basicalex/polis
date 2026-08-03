import assert from 'node:assert/strict';
import test from 'node:test';
import { checkDatabase, getClient, inspectMigrationState, schema } from './index.js';

test('schema exposes the app_meta baseline table', () => {
  assert.ok(schema.appMeta, 'schema.appMeta must exist');
});

test('getClient throws when no DATABASE_URL is provided', () => {
  // empty string is falsy in our guard and must surface as an explicit error
  assert.throws(() => getClient(''), /DATABASE_URL/);
});

test('checkDatabase requires a URL and a bounded integer timeout', async () => {
  await assert.rejects(checkDatabase(''), /DATABASE_URL/);
  await assert.rejects(checkDatabase('postgres://unused', 99), /100.*10000/);
  await assert.rejects(checkDatabase('postgres://unused', 10_001), /100.*10000/);
  await assert.rejects(checkDatabase('postgres://unused', 100.5), /integer/);
});

test('checkDatabase queries through a short-lived single connection', async () => {
  const queries: string[] = [];
  let ended = 0;
  let options: { max: number; connect_timeout: number; idle_timeout: number } | undefined;
  const connection = {
    unsafe: async (query: string) => {
      queries.push(query);
      return [{ one: 1 }];
    },
    end: async (closeOptions: { timeout: number }) => {
      assert.equal(closeOptions.timeout, 0);
      ended += 1;
    },
  };

  const result = await checkDatabase('postgres://unused', 100, (_url, clientOptions) => {
    options = clientOptions;
    return connection;
  });

  assert.deepEqual(result, { ready: true });
  assert.deepEqual(queries, ['SELECT 1']);
  assert.deepEqual(options, { max: 1, connect_timeout: 1, idle_timeout: 0 });
  assert.equal(ended, 1);
});

test('checkDatabase fails closed, sanitizes failures, and closes the connection', async () => {
  let ended = 0;
  const connection = {
    unsafe: async () => {
      throw new Error('connect postgres://alice:secret@db.internal/polis');
    },
    end: async () => {
      ended += 1;
    },
  };

  await assert.rejects(
    checkDatabase('postgres://unused', 100, () => connection),
    (error: Error) => {
      assert.equal(error.message, 'DATABASE_CHECK_FAILED');
      assert.doesNotMatch(error.message, /alice|secret|db\.internal/);
      return true;
    },
  );
  assert.equal(ended, 1);
});

test('checkDatabase reports a bounded safe timeout and closes the connection', async () => {
  let ended = 0;
  const connection = {
    unsafe: () => new Promise<never>(() => undefined),
    end: async () => {
      ended += 1;
    },
  };

  await assert.rejects(
    checkDatabase('postgres://unused', 100, () => connection),
    (error: Error) => error.message === 'DATABASE_CHECK_TIMEOUT',
  );
  assert.equal(ended, 1);
});

test('inspectMigrationState reports an absent or latest Drizzle migration without mutation', async () => {
  const absentQueries: string[] = [];
  let absentEnded = 0;
  const absentConnection = {
    unsafe: async (query: string) => {
      absentQueries.push(query);
      return [{ migrationsTableExists: false }];
    },
    end: async () => {
      absentEnded += 1;
    },
  };
  assert.deepEqual(await inspectMigrationState('postgres://unused', 100, () => absentConnection), {
    migrationsTableExists: false,
    latestMigration: null,
  });
  assert.equal(absentQueries.length, 1);
  assert.equal(absentEnded, 1);

  const presentQueries: string[] = [];
  let presentEnded = 0;
  const presentConnection = {
    unsafe: async (query: string) => {
      presentQueries.push(query);
      return presentQueries.length === 1
        ? [{ migrationsTableExists: true }]
        : [{ latestMigration: '4fa2e3' }];
    },
    end: async () => {
      presentEnded += 1;
    },
  };
  assert.deepEqual(await inspectMigrationState('postgres://unused', 100, () => presentConnection), {
    migrationsTableExists: true,
    latestMigration: '4fa2e3',
  });
  assert.equal(presentQueries.length, 2);
  assert.match(presentQueries[0]!, /information_schema\.tables/);
  assert.match(presentQueries[1]!, /FROM drizzle\.__drizzle_migrations/);
  assert.equal(presentEnded, 1);
});

test('inspectMigrationState fails closed and closes the connection', async () => {
  let failedEnded = 0;
  const failedConnection = {
    unsafe: async () => {
      throw new Error('connect postgres://alice:secret@db.internal/polis');
    },
    end: async () => {
      failedEnded += 1;
    },
  };

  await assert.rejects(
    inspectMigrationState('postgres://unused', 100, () => failedConnection),
    (error: Error) => {
      assert.equal(error.message, 'MIGRATION_STATE_CHECK_FAILED');
      assert.doesNotMatch(error.message, /alice|secret|db\.internal/);
      return true;
    },
  );
  assert.equal(failedEnded, 1);

  let timedOutEnded = 0;
  const timedOutConnection = {
    unsafe: () => new Promise<never>(() => undefined),
    end: async () => {
      timedOutEnded += 1;
    },
  };
  await assert.rejects(
    inspectMigrationState('postgres://unused', 100, () => timedOutConnection),
    (error: Error) => error.message === 'MIGRATION_STATE_CHECK_TIMEOUT',
  );
  assert.equal(timedOutEnded, 1);
});
