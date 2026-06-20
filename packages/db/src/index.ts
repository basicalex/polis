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
