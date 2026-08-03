import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHARTER_STATUSES, IDENTITY_AUTH_LEVELS, RELATIONSHIP_TYPES } from './schema.js';

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
  'citizens.json',
  'mandate_holders.json',
  'mandate_holder_charters.json',
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

  it('contains a pending normalized charter and staff reviewer', async () => {
    const citizens = await load('citizens.json');
    const charters = await load('mandate_holder_charters.json');

    assert.ok(
      citizens.some(
        (citizen) =>
          citizen.id === 'reviewer-demo' &&
          citizen.identity_level === 'staff' &&
          IDENTITY_AUTH_LEVELS.some((level) => level === citizen.identity_level),
      ),
      'expected reviewer-demo staff citizen',
    );

    const charter = charters.find((row) => row.id === 'charter-mh-demo');
    assert.ok(charter, 'expected charter-mh-demo');
    assert.ok(CHARTER_STATUSES.some((status) => status === charter.status));
    assert.equal(charter.version, 1);
    assert.deepEqual((charter.charter_doc as JsonRow).scope, {
      jurisdictions: ['jur-croatia-local'],
      processes: ['all'],
    });
    assert.equal(charter.accepted_signing_request_id, null);
    assert.equal(charter.signed_artifact_id, null);
    assert.equal(charter.proof_manifest_id, null);
    assert.equal(charter.signed_at, null);
  });

  it('separates complaint intake, initial decision, and appeal authority', async () => {
    const decisionRights = await load('decision_rights.json');
    const roles = await load('roles.json');
    const citizens = await load('citizens.json');
    const mandateHolders = await load('mandate_holders.json');

    const initialRoleId = 'role-complaint-decision-officer';
    const appealRoleId = 'role-complaint-appeal-officer';
    const initialCitizenId = 'citizen-complaint-decision-officer-demo';
    const appealCitizenId = 'citizen-complaint-appeal-officer-demo';
    const intakeRoleId = 'role-complaints-intake-officer';
    const intakeCitizenId = 'citizen-complaint-intake-officer-demo';

    const initialRight = decisionRights.find((right) => right.name === 'decide_complaint');
    const appealRight = decisionRights.find((right) => right.name === 'decide_complaint_appeal');
    assert.equal(initialRight?.role_id, initialRoleId);
    assert.equal(appealRight?.role_id, appealRoleId);

    const initialRole = roles.find((role) => role.id === initialRoleId);
    const appealRole = roles.find((role) => role.id === appealRoleId);
    const intakeRole = roles.find((role) => role.id === intakeRoleId);
    assert.ok(
      Array.isArray(intakeRole?.decision_rights) &&
        intakeRole.decision_rights.includes('route_case_to_sector_office'),
    );
    assert.ok(
      Array.isArray(intakeRole?.decision_rights) &&
        intakeRole.decision_rights.includes('request_missing_identity_or_residence_evidence'),
    );
    assert.equal(intakeRole?.institution_id, 'inst-complaints-office');
    assert.deepEqual(initialRole?.decision_rights, ['decide_complaint']);
    assert.deepEqual(appealRole?.decision_rights, ['decide_complaint_appeal']);
    assert.equal(initialRole?.institution_id, 'inst-complaints-office');
    assert.equal(appealRole?.institution_id, 'inst-complaints-office');

    const initialCitizen = citizens.find((citizen) => citizen.id === initialCitizenId);
    const appealCitizen = citizens.find((citizen) => citizen.id === appealCitizenId);
    const intakeCitizen = citizens.find((citizen) => citizen.id === intakeCitizenId);
    assert.equal(intakeCitizen?.identity_level, 'staff');
    assert.notEqual(intakeCitizen?.id, initialCitizen?.id);
    assert.notEqual(intakeCitizen?.id, appealCitizen?.id);
    assert.equal(initialCitizen?.identity_level, 'staff');
    assert.equal(appealCitizen?.identity_level, 'staff');
    assert.notEqual(initialCitizen?.id, appealCitizen?.id);

    const initialHolder = mandateHolders.find(
      (holder) => holder.id === 'mh-complaint-decision-officer-demo',
    );
    const appealHolder = mandateHolders.find(
      (holder) => holder.id === 'mh-complaint-appeal-officer-demo',
    );
    const intakeHolder = mandateHolders.find(
      (holder) => holder.id === 'mh-complaint-intake-officer-demo',
    );
    assert.deepEqual(
      {
        citizenId: intakeHolder?.citizen_id,
        jurisdictionId: intakeHolder?.jurisdiction_id,
        roleId: intakeHolder?.role_id,
        status: intakeHolder?.status,
      },
      {
        citizenId: intakeCitizenId,
        jurisdictionId: 'jur-croatia-local',
        roleId: intakeRoleId,
        status: 'active',
      },
    );
    assert.deepEqual(
      {
        citizenId: initialHolder?.citizen_id,
        jurisdictionId: initialHolder?.jurisdiction_id,
        roleId: initialHolder?.role_id,
        status: initialHolder?.status,
      },
      {
        citizenId: initialCitizenId,
        jurisdictionId: 'jur-croatia-local',
        roleId: initialRoleId,
        status: 'active',
      },
    );
    assert.deepEqual(
      {
        citizenId: appealHolder?.citizen_id,
        jurisdictionId: appealHolder?.jurisdiction_id,
        roleId: appealHolder?.role_id,
        status: appealHolder?.status,
      },
      {
        citizenId: appealCitizenId,
        jurisdictionId: 'jur-croatia-local',
        roleId: appealRoleId,
        status: 'active',
      },
    );
    assert.notEqual(initialHolder?.citizen_id, appealHolder?.citizen_id);
    assert.notEqual(initialHolder?.role_id, appealHolder?.role_id);
    assert.notEqual(intakeHolder?.citizen_id, initialHolder?.citizen_id);
    assert.notEqual(intakeHolder?.citizen_id, appealHolder?.citizen_id);
    assert.notEqual(intakeHolder?.role_id, initialHolder?.role_id);
    assert.notEqual(intakeHolder?.role_id, appealHolder?.role_id);
  });
});
