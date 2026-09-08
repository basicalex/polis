import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

export interface MigrationFile {
  version: string;
  hash: string;
  sql: string;
}

export const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../migrations');

export function readMigrations(folder = migrationsFolder): MigrationFile[] {
  const names = readdirSync(folder)
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  if (names.length === 0) throw new Error('no trace migrations found');
  const versions = new Set<string>();
  return names.map((name) => {
    const version = name.slice(0, 4);
    if (versions.has(version)) throw new Error(`duplicate trace migration version ${version}`);
    versions.add(version);
    const sql = readFileSync(join(folder, name), 'utf8');
    return { version, hash: createHash('sha256').update(sql).digest('hex'), sql };
  });
}

function assertMigrationState(
  migrations: readonly MigrationFile[],
  applied: readonly { version: string; sha256: string }[],
): void {
  if (applied.length !== migrations.length) {
    throw new Error('trace migration set is incomplete or contains unknown versions');
  }
  for (let index = 0; index < applied.length; index += 1) {
    const row = applied[index]!;
    const local = migrations[index];
    if (!local || row.version !== local.version) {
      throw new Error(`trace migration order mismatch at ${row.version}`);
    }
    if (row.sha256.trim() !== local.hash) {
      throw new Error(`trace migration hash mismatch for ${row.version}`);
    }
  }
}

export async function verifyTraceMigrations(
  databaseUrl: string | undefined,
  folder = migrationsFolder,
): Promise<void> {
  if (!databaseUrl || !databaseUrl.trim()) {
    throw new Error('DATABASE_URL is required for trace migration verification');
  }
  const parsed = new URL(databaseUrl);
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must be PostgreSQL');
  }
  const migrations = readMigrations(folder);
  const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => undefined });
  try {
    const exists = await sql<{ relation: string | null }[]>`
      SELECT to_regclass('public.trace_schema_migrations')::text AS relation
    `;
    if (!exists[0]?.relation) throw new Error('trace migration ledger is missing');
    const applied = await sql<{ version: string; sha256: string }[]>`
      SELECT version, sha256 FROM trace_schema_migrations ORDER BY version
    `;
    assertMigrationState(migrations, applied);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function runTraceMigrations(
  databaseUrl: string | undefined,
  folder = migrationsFolder,
): Promise<void> {
  if (!databaseUrl || !databaseUrl.trim())
    throw new Error('DATABASE_URL is required for trace migrations');
  const parsed = new URL(databaseUrl);
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must be PostgreSQL');
  }
  const migrations = readMigrations(folder);
  const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => undefined });
  try {
    await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext('polis'), hashtext('trace-service-migrations'))`;
      await tx.unsafe(`
        CREATE TABLE IF NOT EXISTS trace_schema_migrations (
          version text PRIMARY KEY,
          sha256 char(64) NOT NULL,
          applied_at timestamptz NOT NULL
        )
      `);
      const applied = await tx<{ version: string; sha256: string }[]>`
        SELECT version, sha256 FROM trace_schema_migrations ORDER BY version
      `;
      for (let index = 0; index < applied.length; index += 1) {
        const row = applied[index]!;
        const local = migrations[index];
        if (!local || row.version !== local.version) {
          throw new Error(`trace migration order mismatch at ${row.version}`);
        }
        if (row.sha256.trim() !== local.hash) {
          throw new Error(`trace migration hash mismatch for ${row.version}`);
        }
      }
      for (const migration of migrations.slice(applied.length)) {
        await tx.unsafe(migration.sql);
        await tx`
          INSERT INTO trace_schema_migrations (version, sha256, applied_at)
          VALUES (${migration.version}, ${migration.hash}, NOW())
        `;
      }
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
