// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

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
  if (names.length === 0) throw new Error('no channel gateway migrations found');
  const versions = new Set<string>();
  return names.map((name) => {
    const version = name.slice(0, 4);
    if (versions.has(version))
      throw new Error(`duplicate channel gateway migration version ${version}`);
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
    throw new Error('channel gateway migration set is incomplete or contains unknown versions');
  }
  for (let index = 0; index < applied.length; index += 1) {
    const row = applied[index]!;
    const local = migrations[index];
    if (!local || row.version !== local.version) {
      throw new Error(`channel gateway migration order mismatch at ${row.version}`);
    }
    if (row.sha256.trim() !== local.hash) {
      throw new Error(`channel gateway migration hash mismatch for ${row.version}`);
    }
  }
}

function requireDatabaseUrl(databaseUrl: string | undefined, operation: string): string {
  if (!databaseUrl || !databaseUrl.trim()) {
    throw new Error(`DATABASE_URL is required for channel gateway ${operation}`);
  }
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be PostgreSQL');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must be PostgreSQL');
  }
  return databaseUrl;
}

export async function verifyChannelMigrations(
  databaseUrl: string | undefined,
  folder = migrationsFolder,
): Promise<void> {
  const target = requireDatabaseUrl(databaseUrl, 'migration verification');
  const migrations = readMigrations(folder);
  const sql = postgres(target, { max: 1, prepare: false, onnotice: () => undefined });
  try {
    const exists = await sql<{ relation: string | null }[]>`
      SELECT to_regclass('public.channel_schema_migrations')::text AS relation
    `;
    if (!exists[0]?.relation) throw new Error('channel gateway migration ledger is missing');
    const applied = await sql<{ version: string; sha256: string }[]>`
      SELECT version, sha256 FROM channel_schema_migrations ORDER BY version
    `;
    assertMigrationState(migrations, applied);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function runChannelMigrations(
  databaseUrl: string | undefined,
  folder = migrationsFolder,
): Promise<void> {
  const target = requireDatabaseUrl(databaseUrl, 'migrations');
  const migrations = readMigrations(folder);
  const sql = postgres(target, { max: 1, prepare: false, onnotice: () => undefined });
  try {
    await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext('polis'), hashtext('channel-gateway-migrations'))`;
      await tx.unsafe(`
        CREATE TABLE IF NOT EXISTS channel_schema_migrations (
          version text PRIMARY KEY,
          sha256 char(64) NOT NULL,
          applied_at timestamptz NOT NULL
        )
      `);
      const applied = await tx<{ version: string; sha256: string }[]>`
        SELECT version, sha256 FROM channel_schema_migrations ORDER BY version
      `;
      for (let index = 0; index < applied.length; index += 1) {
        const row = applied[index]!;
        const local = migrations[index];
        if (!local || row.version !== local.version) {
          throw new Error(`channel gateway migration order mismatch at ${row.version}`);
        }
        if (row.sha256.trim() !== local.hash) {
          throw new Error(`channel gateway migration hash mismatch for ${row.version}`);
        }
      }
      for (const migration of migrations.slice(applied.length)) {
        await tx.unsafe(migration.sql);
        await tx`
          INSERT INTO channel_schema_migrations (version, sha256, applied_at)
          VALUES (${migration.version}, ${migration.hash}, NOW())
        `;
      }
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
