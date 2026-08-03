/**
 * @polis/db — PostgreSQL access for Polis Interface services.
 *
 * Exports the drizzle schema plus a named {@link DbClient} type, a
 * {@link getClient} factory, and {@link runMigrations} (canonical DDL).
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from './schema.js';

export type DbClient = PostgresJsDatabase<typeof schema>;

const minimumDatabaseCheckTimeoutMs = 100;
const maximumDatabaseCheckTimeoutMs = 10_000;
const defaultDatabaseCheckTimeoutMs = 3_000;

type DatabaseCheckConnection = {
  unsafe(query: string): PromiseLike<readonly Record<string, unknown>[]>;
  end(options: { timeout: number }): PromiseLike<void>;
};

type DatabaseCheckConnectionFactory = (
  url: string,
  options: { max: number; connect_timeout: number; idle_timeout: number },
) => DatabaseCheckConnection;

const createDatabaseCheckConnection: DatabaseCheckConnectionFactory = (url, options) =>
  postgres(url, options);

export type MigrationState = {
  migrationsTableExists: boolean;
  latestMigration: string | null;
};

function validateDatabaseCheckTimeout(timeoutMs: number): void {
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < minimumDatabaseCheckTimeoutMs ||
    timeoutMs > maximumDatabaseCheckTimeoutMs
  ) {
    throw new Error(
      `Database check timeout must be an integer between ${minimumDatabaseCheckTimeoutMs} and ${maximumDatabaseCheckTimeoutMs}ms`,
    );
  }
}

async function withinTimeout<T>(operation: PromiseLike<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('DATABASE_CHECK_TIMEOUT')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function closeDatabaseCheckConnection(connection: DatabaseCheckConnection): Promise<void> {
  try {
    await connection.end({ timeout: 0 });
  } catch {
    // A failed close must not hide the already-safe readiness result.
  }
}

const migrationsTableExistsQuery = `
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
  ) AS "migrationsTableExists"
`;

const latestMigrationQuery = `
  SELECT hash AS "latestMigration"
  FROM drizzle.__drizzle_migrations
  ORDER BY created_at DESC
  LIMIT 1
`;

export { schema } from './schema.js';

/**
 * Location of the committed migrations folder, resolved relative to this
 * module so it is correct regardless of the caller's cwd (dev, CI, container).
 */
export const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/**
 * Create a drizzle {@link DbClient} for the given Postgres URL. Throws if no
 * URL is provided and `DATABASE_URL` is unset — callers must wire it
 * explicitly so connection failures surface at the boundary, not silently.
 */
export function getClient(url: string | undefined = process.env.DATABASE_URL): DbClient {
  if (!url) throw new Error('DATABASE_URL is required');
  const queryClient = postgres(url, { max: 1 });
  return drizzle(queryClient, { schema });
}

/**
 * Open a bounded, short-lived connection and verify that it can execute a
 * trivial query. The optional final parameter is an internal deterministic-test
 * seam; production callers use the default postgres client.
 */
export async function checkDatabase(
  url: string | undefined = process.env.DATABASE_URL,
  timeoutMs: number = defaultDatabaseCheckTimeoutMs,
  connectionFactory: DatabaseCheckConnectionFactory = createDatabaseCheckConnection,
): Promise<{ ready: true }> {
  if (!url) throw new Error('DATABASE_URL is required');
  validateDatabaseCheckTimeout(timeoutMs);

  let connection: DatabaseCheckConnection | undefined;
  try {
    connection = connectionFactory(url, {
      max: 1,
      connect_timeout: Math.max(1, Math.ceil(timeoutMs / 1_000)),
      idle_timeout: 0,
    });
    await withinTimeout(connection.unsafe('SELECT 1'), timeoutMs);
    return { ready: true };
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message === 'DATABASE_CHECK_TIMEOUT'
        ? 'DATABASE_CHECK_TIMEOUT'
        : 'DATABASE_CHECK_FAILED',
    );
  } finally {
    if (connection) await closeDatabaseCheckConnection(connection);
  }
}

/**
 * Read Drizzle's migration ledger without applying migrations. The optional
 * final parameter is an internal deterministic-test seam.
 */
export async function inspectMigrationState(
  url: string | undefined = process.env.DATABASE_URL,
  timeoutMs: number = defaultDatabaseCheckTimeoutMs,
  connectionFactory: DatabaseCheckConnectionFactory = createDatabaseCheckConnection,
): Promise<MigrationState> {
  if (!url) throw new Error('DATABASE_URL is required');
  validateDatabaseCheckTimeout(timeoutMs);

  let connection: DatabaseCheckConnection | undefined;
  try {
    connection = connectionFactory(url, {
      max: 1,
      connect_timeout: Math.max(1, Math.ceil(timeoutMs / 1_000)),
      idle_timeout: 0,
    });
    const [tableState] = await withinTimeout(
      connection.unsafe(migrationsTableExistsQuery),
      timeoutMs,
    );
    const tableExists = tableState?.migrationsTableExists;
    if (
      tableExists !== true &&
      tableExists !== 't' &&
      tableExists !== 'true' &&
      tableExists !== 1
    ) {
      return { migrationsTableExists: false, latestMigration: null };
    }

    const [migration] = await withinTimeout(connection.unsafe(latestMigrationQuery), timeoutMs);
    return {
      migrationsTableExists: true,
      latestMigration:
        typeof migration?.latestMigration === 'string' ? migration.latestMigration : null,
    };
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message === 'DATABASE_CHECK_TIMEOUT'
        ? 'MIGRATION_STATE_CHECK_TIMEOUT'
        : 'MIGRATION_STATE_CHECK_FAILED',
    );
  } finally {
    if (connection) await closeDatabaseCheckConnection(connection);
  }
}

/**
 * Run committed drizzle migrations against the target database. Used at service
 * boot (platform-api) and by the dev/seed scripts.
 */
export async function runMigrations(
  client: DbClient = getClient(),
  folder: string = migrationsFolder,
): Promise<void> {
  await migrate(client, { migrationsFolder: folder });
}

/**
 * Run migrations against the target database using a short-lived connection that
 * is closed when done. Intended for service boot and CLI scripts that do not
 * keep a long-lived client around.
 */
export async function runMigrationsOnce(
  url: string | undefined = process.env.DATABASE_URL,
  folder: string = migrationsFolder,
): Promise<void> {
  if (!url) throw new Error('DATABASE_URL is required');
  const sql = postgres(url, { max: 1 });
  try {
    await migrate(drizzle(sql, { schema }), { migrationsFolder: folder });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
