import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELATIONSHIP_TYPES } from './schema.js';

type JsonRow = Record<string, unknown>;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const seedDir = path.join(repoRoot, 'data/seed/governance-v1');

const seedFiles = [
  'jurisdictions.json',
  'mandates.json',
  'laws.json',
  'institutions.json',
  'roles.json',
  'decision_rights.json',
  'processes.json',
  'process_steps.json',
  'document_types.json',
  'failure_modes.json',
  'controls.json',
  'sources.json',
  'source_snapshots.json',
  'claims.json',
  'evidence_links.json',
  'relationships.json',
  'commitment_questions.json',
  'commitment_answers.json',
] as const;

async function load(fileName: string): Promise<JsonRow[]> {
  const parsed = JSON.parse(await readFile(path.join(seedDir, fileName), 'utf8')) as unknown;
  assert.ok(Array.isArray(parsed), `${fileName} must contain a top-level array`);
  return parsed as JsonRow[];
}

describe('governance v1 seed data', () => {
  it('parses every required JSON file', async () => {
    for (const fileName of seedFiles) {
      const rows = await load(fileName);
      assert.ok(rows.length > 0, `${fileName} should not be empty`);
    }
  });

  it('meets the §34 municipal duplication scenario minimums', async () => {
    const institutions = await load('institutions.json');
    const processes = await load('processes.json');
    const processSteps = await load('process_steps.json');
    const documentTypes = await load('document_types.json');
    const claims = await load('claims.json');
    const evidenceLinks = await load('evidence_links.json');

    assert.ok(institutions.length >= 2, 'expected at least two institutions');
    assert.ok(documentTypes.length >= 2, 'expected at least two document types');
    assert.ok(claims.length >= 3, 'expected at least three claims');
    assert.ok(
      processes.some(
        (process) => processSteps.filter((step) => step.process_id === process.id).length >= 3,
      ),
      'expected at least one process with at least three steps',
    );

    for (const claim of claims) {
      const hasEvidence = evidenceLinks.some((link) => link.claim_id === claim.id);
      const isUnsupportedDraft =
        claim.confidence_state === 'unsupported_draft' && claim.review_state === 'draft';
      assert.ok(
        hasEvidence || isUnsupportedDraft,
        `${String(claim.id)} must have evidence or be an unsupported draft`,
      );
    }
  });

  it('uses only canonical relationship_type values', async () => {
    const allowedRelationshipTypes = new Set<string>(RELATIONSHIP_TYPES);
    const relationships = await load('relationships.json');

    for (const relationship of relationships) {
      assert.equal(
        typeof relationship.relationship_type,
        'string',
        `${String(relationship.id)} must have a string relationship_type`,
      );
      const relationshipType = relationship.relationship_type;
      assert.ok(
        typeof relationshipType === 'string' && allowedRelationshipTypes.has(relationshipType),
        `${String(relationship.id)} uses unknown relationship_type ${String(relationshipType)}`,
      );
    }
  });
});
