import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { getClient, runMigrationsOnce, schema } from './index.js';

type SeedRow = Record<string, unknown>;
type SeedTable = {
  id: unknown;
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const seedDir = path.join(repoRoot, 'data/seed/governance-v1');

const timestampColumns = new Set(['published_at', 'retrieved_at']);

function camelizeKey(key: string): string {
  return key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function toDrizzleRow(row: SeedRow): SeedRow {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      camelizeKey(key),
      timestampColumns.has(key) && typeof value === 'string' ? new Date(value) : value,
    ]),
  );
}

async function loadRows(fileName: string): Promise<SeedRow[]> {
  const content = await readFile(path.join(seedDir, fileName), 'utf8');
  const rows = JSON.parse(content) as unknown;
  if (!Array.isArray(rows)) throw new Error(`${fileName} must contain a JSON array`);
  return rows.map((row) => toDrizzleRow(row as SeedRow));
}

function updateSet(columns: readonly string[]): SeedRow {
  return Object.fromEntries(
    columns.map((column) => [camelizeKey(column), sql.raw(`excluded.${column}`)]),
  );
}

async function upsert(
  tableName: string,
  table: SeedTable,
  fileName: string,
  updatableColumns: readonly string[],
): Promise<void> {
  const rows = await loadRows(fileName);
  if (rows.length === 0) {
    console.log(`seeded ${tableName} 0 rows`);
    return;
  }
  const db = getClient();
  await db
    .insert(table as never)
    .values(rows as never)
    .onConflictDoUpdate({ target: table.id as never, set: updateSet(updatableColumns) as never });
  console.log(`seeded ${tableName} ${rows.length} rows`);
}

async function main(): Promise<void> {
  await runMigrationsOnce();
  await upsert('jurisdictions', schema.jurisdictions, 'jurisdictions.json', [
    'name',
    'slug',
    'jurisdiction_path',
    'description',
    'confidence_state',
    'review_state',
    'visibility',
    'created_by_user_id',
    'updated_by_user_id',
    'status',
    'audit_correlation_id',
  ]);
  await upsert('mandates', schema.mandates, 'mandates.json', [
    'name',
    'description',
    'legal_basis',
    'created_by_user_id',
    'updated_by_user_id',
    'status',
    'audit_correlation_id',
  ]);
  await upsert('laws', schema.laws, 'laws.json', [
    'citation',
    'title',
    'jurisdiction_id',
    'url',
    'created_by_user_id',
    'updated_by_user_id',
    'status',
    'audit_correlation_id',
  ]);
  await upsert('institutions', schema.institutions, 'institutions.json', [
    'name',
    'jurisdiction_id',
    'description',
    'confidence_state',
    'review_state',
    'visibility',
    'created_by_user_id',
    'updated_by_user_id',
    'status',
    'audit_correlation_id',
  ]);
  await upsert('roles', schema.roles, 'roles.json', [
    'name',
    'institution_id',
    'mandate_id',
    'description',
    'authorized_by_law',
    'decision_rights',
    'confidence_state',
    'review_state',
    'visibility',
    'created_by_user_id',
    'updated_by_user_id',
    'status',
    'audit_correlation_id',
  ]);
  await upsert('decision_rights', schema.decisionRights, 'decision_rights.json', [
    'role_id',
    'name',
    'description',
    'created_by_user_id',
    'updated_by_user_id',
    'status',
    'audit_correlation_id',
  ]);
  await upsert('processes', schema.processes, 'processes.json', [
    'name',
    'need',
    'legal_basis',
    'jurisdiction_id',
    'confidence_state',
    'review_state',
    'visibility',
    'created_by_user_id',
    'updated_by_user_id',
    'status',
    'audit_correlation_id',
  ]);
  await upsert('process_steps', schema.processSteps, 'process_steps.json', [
    'process_id',
    'ordinal',
    'name',
    'description',
    'created_by_user_id',
    'updated_by_user_id',
    'status',
    'audit_correlation_id',
  ]);
  await upsert('document_types', schema.documentTypes, 'document_types.json', [
    'name',
    'jurisdiction_id',
    'legal_basis',
    'description',
    'created_by_user_id',
    'updated_by_user_id',
    'status',
    'audit_correlation_id',
  ]);
  await upsert('failure_modes', schema.failureModes, 'failure_modes.json', [
    'name',
    'process_id',
    'description',
    'created_by_user_id',
    'updated_by_user_id',
    'status',
    'audit_correlation_id',
  ]);
  await upsert('controls', schema.controls, 'controls.json', [
    'name',
    'failure_mode_id',
    'description',
    'created_by_user_id',
    'updated_by_user_id',
    'status',
    'audit_correlation_id',
  ]);
  await upsert('sources', schema.sources, 'sources.json', [
    'title',
    'url',
    'jurisdiction_id',
    'source_type',
    'publisher',
    'published_at',
    'created_by_user_id',
    'updated_by_user_id',
    'status',
    'audit_correlation_id',
  ]);
  await upsert('source_snapshots', schema.sourceSnapshots, 'source_snapshots.json', [
    'source_id',
    'url',
    'content_hash',
    'retrieved_at',
    'created_by_user_id',
    'updated_by_user_id',
    'status',
    'audit_correlation_id',
  ]);
  await upsert('claims', schema.claims, 'claims.json', [
    'text',
    'claim_type',
    'subject_type',
    'subject_id',
    'confidence',
    'confidence_state',
    'review_state',
    'visibility',
    'method_version',
    'ai_trace_id',
    'created_by_user_id',
    'updated_by_user_id',
    'status',
    'audit_correlation_id',
  ]);
  await upsert('evidence_links', schema.evidenceLinks, 'evidence_links.json', [
    'claim_id',
    'source_id',
    'locator',
    'quote',
    'paraphrase',
    'source_hash',
    'retrieved_at',
    'confidence',
  ]);
  await upsert('relationships', schema.relationships, 'relationships.json', [
    'relationship_type',
    'from_entity_type',
    'from_entity_id',
    'to_entity_type',
    'to_entity_id',
    'confidence_state',
    'review_state',
    'visibility',
    'source_confidence',
    'method_version',
    'created_by_user_id',
    'updated_by_user_id',
    'status',
    'audit_correlation_id',
  ]);
  await Promise.resolve();
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
