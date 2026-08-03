import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPLAINT_APPEAL_STATUSES,
  COMPLAINT_DECISION_KINDS,
  COMPLAINT_EVENT_TYPES,
  COMPLAINT_STATUSES,
  assessProcess,
  createProofManifest,
  demoProcess,
  sha256Hex,
  verifyProof,
  type CharterSigningSummary,
  type ComplaintAppeal,
  type ComplaintDecision,
  type ComplaintDetail,
  type ComplaintEvent,
  type ComplaintInformationRequest,
  type ComplaintSummary,
} from './index.js';
test('proof manifests verify matching active hashes only', async () => {
  const manifest = await createProofManifest('demo');
  assert.equal(verifyProof(manifest, await sha256Hex('demo')).ok, true);
  assert.equal(verifyProof(manifest, await sha256Hex('other')).ok, false);
});
test('assessment scores stay bounded', () => {
  const a = assessProcess(demoProcess);
  for (const d of Object.values(a.dimensions)) assert.ok(d.score >= 0 && d.score <= 1);
});

test('charter signing summary contains public-safe proof metadata only', () => {
  const summary: CharterSigningSummary = {
    charterId: 'charter-1',
    mandateHolderId: 'holder-1',
    charterVersion: 1,
    charterStatus: 'accepted',
    signingStatus: 'completed',
    signedAt: '2026-07-30T00:00:00.000Z',
    signedArtifact: {
      id: 'artifact-1',
      sha256: 'abc123',
      mimeType: 'application/pdf',
      byteCount: 42,
      filename: 'charter.pdf',
      proofManifestId: 'proof-1',
    },
  };

  assert.deepEqual(Object.keys(summary).sort(), [
    'charterId',
    'charterStatus',
    'charterVersion',
    'mandateHolderId',
    'signedArtifact',
    'signedAt',
    'signingStatus',
  ]);
  assert.equal('providerEnvelopeId' in summary, false);
  assert.equal('storageRef' in summary.signedArtifact!, false);
  assert.equal('content' in summary.signedArtifact!, false);
});

test('complaint constants define the complete lifecycle contract', () => {
  assert.deepEqual(COMPLAINT_STATUSES, [
    'submitted',
    'assigned',
    'awaiting_information',
    'decided',
    'appealed',
    'closed',
  ]);
  assert.deepEqual(COMPLAINT_EVENT_TYPES, [
    'submitted',
    'assigned',
    'information_requested',
    'information_received',
    'decided',
    'appealed',
    'appeal_decided',
    'closed',
  ]);
  assert.deepEqual(COMPLAINT_DECISION_KINDS, ['initial', 'appeal']);
  assert.deepEqual(COMPLAINT_APPEAL_STATUSES, ['filed', 'decided']);
});

test('complaint wire shapes expose case data without internal identifiers', () => {
  const summary: ComplaintSummary = {
    id: 'complaint-1',
    caseNumber: 'CMP-2026-0001',
    institutionId: 'inst-complaints-office',
    processId: 'process-citizen-service-complaint',
    jurisdictionId: 'jur-croatia-local',
    subject: 'Missed waste collection',
    status: 'appealed',
    assignedMandateHolderId: 'mh-complaint-appeal-officer-demo',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-02T10:00:00.000Z',
    closedAt: null,
  };
  const informationRequest: ComplaintInformationRequest = {
    id: 'request-1',
    complaintId: summary.id,
    requestedBy: 'mh-complaint-decision-officer-demo',
    question: 'Which collection date was missed?',
    dueAt: null,
    respondedBy: 'citizen-owner',
    response: '2026-07-30',
    respondedAt: '2026-08-01T12:00:00.000Z',
    createdAt: '2026-08-01T11:00:00.000Z',
  };
  const initialDecision: ComplaintDecision = {
    id: 'decision-1',
    complaintId: summary.id,
    appealId: null,
    kind: 'initial',
    outcome: 'denied',
    reason: 'Collection was recorded as completed.',
    decidedBy: 'mh-complaint-decision-officer-demo',
    decidedAt: '2026-08-02T09:00:00.000Z',
  };
  const appeal: ComplaintAppeal = {
    id: 'appeal-1',
    complaintId: summary.id,
    initialDecisionId: initialDecision.id,
    grounds: 'The collection record is inaccurate.',
    status: 'filed',
    filedAt: '2026-08-02T10:00:00.000Z',
    decidedAt: null,
  };
  const event: ComplaintEvent = {
    id: 'event-1',
    complaintId: summary.id,
    eventType: 'appealed',
    actorId: 'citizen-owner',
    actorType: 'user',
    fromStatus: 'decided',
    toStatus: 'appealed',
    data: { appealId: appeal.id, decisionId: initialDecision.id },
    occurredAt: appeal.filedAt,
  };
  const detail: ComplaintDetail = {
    ...summary,
    narrative: 'Waste was not collected on the scheduled date.',
    informationRequests: [informationRequest],
    decisions: [initialDecision],
    appeal,
    events: [event],
  };

  assert.deepEqual(Object.keys(summary).sort(), [
    'assignedMandateHolderId',
    'caseNumber',
    'closedAt',
    'createdAt',
    'id',
    'institutionId',
    'jurisdictionId',
    'processId',
    'status',
    'subject',
    'updatedAt',
  ]);
  assert.equal('residentCitizenId' in detail, false);
  assert.equal('auditCorrelationId' in detail, false);
  assert.equal('auditCorrelationId' in event, false);
  assert.deepEqual(Object.keys(event.data).sort(), ['appealId', 'decisionId']);
  assert.equal('narrative' in event.data, false);
  assert.equal('response' in event.data, false);
  assert.equal('reason' in event.data, false);
});
