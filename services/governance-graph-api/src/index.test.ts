import test from 'node:test';
import assert from 'node:assert/strict';
import { graphRoutes } from './index.js';

test('governance-graph-api exposes §23.1 institutions + roles + processes + traverse', () => {
  const paths = graphRoutes({} as never).map((r) => `${r.method} ${r.path}`);
  for (const p of [
    'GET /api/v1/institutions',
    'GET /api/v1/institutions/:id',
    'GET /api/v1/roles/:id',
    'GET /api/v1/processes/:id',
    'GET /api/v1/claims',
    'GET /api/v1/relationships',
    'GET /api/v1/graph/traverse',
    'GET /api/v1/mandate-holders',
    'GET /api/v1/mandate-holders/:id',
    'GET /api/v1/mandate-holders/:id/scorecard',
    'GET /api/v1/commitments/:id',
    'GET /api/v1/commitments/:id/questions',
  ]) {
    assert.ok(paths.includes(p), `missing ${p}`);
  }
});


const asRecord = (value: unknown): Record<string, unknown> => {
  assert.ok(value && typeof value === 'object');
  // Test boundary: route handlers return object payloads; narrow once before field assertions.
  const record = value as Record<string, unknown>;
  return record;
};

const requestUrl = (url: string) => ({ url }) as never;

const queuedDb = (selectRows: unknown[][]) => {
  const nextRows = () => selectRows.shift() ?? [];
  const selectChain = (rows: unknown[]) => {
    const chain = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(rows).then(resolve, reject),
    };
    return chain;
  };
  return {
    select: () => selectChain(nextRows()),
  };
};

const commitment = (id: string, dueAt: Date | null) => ({
  id,
  claimId: `claim-${id}`,
  mandateHolderId: 'holder-1',
  processId: null,
  jurisdictionId: null,
  successCriterion: `criterion-${id}`,
  dueAt,
});

test('scorecard counts read-derived overdue without grades or rankings', async () => {
  const route = graphRoutes(
    queuedDb([
      [{ id: 'holder-1' }],
      [
        commitment('overdue-1', new Date('2000-01-01T00:00:00Z')),
        commitment('future-1', new Date('2999-01-01T00:00:00Z')),
        commitment('delivered-1', new Date('2000-01-01T00:00:00Z')),
      ],
      [],
      [],
      [{ status: 'delivered' }],
    ]) as never,
  ).find((r) => r.method === 'GET' && r.path === '/api/v1/mandate-holders/:id/scorecard');
  assert.ok(route);

  const out = await route.handler(requestUrl('/api/v1/mandate-holders/holder-1/scorecard'), {}, { id: 'holder-1' });

  assert.deepEqual(out, {
    mandateHolderId: 'holder-1',
    totals: {
      delivered: 1,
      partial: 0,
      notDelivered: 0,
      inProgress: 0,
      proposed: 1,
      overdue: 1,
    },
  });
  const scorecard = asRecord(out);
  assert.equal('grade' in scorecard, false);
  assert.equal('ranking' in scorecard, false);
});

test('commitment detail derives overdue at read time without a status event', async () => {
  const route = graphRoutes(
    queuedDb([
      [commitment('commitment-1', new Date('2000-01-01T00:00:00Z'))],
      [],
      [],
    ]) as never,
  ).find((r) => r.method === 'GET' && r.path === '/api/v1/commitments/:id');
  assert.ok(route);

  const out = asRecord(
    await route.handler(requestUrl('/api/v1/commitments/commitment-1'), {}, { id: 'commitment-1' }),
  );

  assert.equal(out.effectiveStatus, 'overdue');
  assert.deepEqual(out.statusTimeline, []);
});

test('commitment detail includes public claim evidence projection with restricted fields redacted', async () => {
  const restrictedEvidence = {
    id: 'evidence-commitment-1',
    claimId: 'claim-commitment-1',
    sourceId: 'source-1',
    locator: { url: 'https://private.example/commitment' },
    quote: 'commitment restricted quote',
    paraphrase: 'commitment restricted paraphrase',
    sourceHash: 'commitment-restricted-hash',
    retrievedAt: new Date('2026-01-02T03:04:05Z'),
    confidence: '0.5',
    visibility: 'restricted',
  };
  const route = graphRoutes(
    queuedDb([
      [{ ...commitment('commitment-1', null), claimId: 'claim-commitment-1' }],
      [],
      [
        {
          id: 'claim-commitment-1',
          text: 'Commitment claim',
          claimType: 'proposal_assertion',
          subjectType: 'mandate_holder',
          subjectId: 'holder-1',
          confidence: '0.5',
          confidenceState: 'unsupported_draft',
          reviewState: 'approved',
          visibility: 'public',
          methodVersion: null,
        },
      ],
      [restrictedEvidence],
      [],
      [],
      [],
    ]) as never,
  ).find((r) => r.method === 'GET' && r.path === '/api/v1/commitments/:id');
  assert.ok(route);

  const out = asRecord(
    await route.handler(requestUrl('/api/v1/commitments/commitment-1'), {}, { id: 'commitment-1' }),
  );
  const claim = asRecord(out.claim);
  const evidence = asRecord((claim.evidence as unknown[])[0]);

  assert.equal(evidence.id, 'evidence-commitment-1');
  assert.equal(evidence.visibility, 'restricted');
  assert.equal(evidence.redacted, true);
  assert.equal(evidence.redactionReason, 'evidence_visibility');
  assert.equal(evidence.locator, null);
  assert.equal(evidence.quote, null);
  assert.equal(evidence.paraphrase, null);
  assert.equal(evidence.sourceHash, null);
  assert.equal(JSON.stringify(out).includes('commitment restricted quote'), false);
  assert.equal(JSON.stringify(out).includes('private.example'), false);
});


test('public commitment resolution keeps restricted evidence identity but redacts sensitive fields', async () => {
  const restrictedEvidence = {
    id: 'evidence-1',
    claimId: 'resolution-claim-1',
    sourceId: 'source-1',
    locator: { url: 'https://private.example/evidence' },
    quote: 'restricted quote',
    paraphrase: 'restricted paraphrase',
    sourceHash: 'restricted-hash',
    retrievedAt: new Date('2026-01-02T03:04:05Z'),
    confidence: 'high',
    visibility: 'restricted',
  };
  const route = graphRoutes(
    queuedDb([
      [commitment('commitment-1', null)],
      [
        {
          id: 'event-1',
          commitmentId: 'commitment-1',
          status: 'delivered',
          note: null,
          resolutionClaimId: 'resolution-claim-1',
          createdAt: new Date('2026-01-03T00:00:00Z'),
        },
      ],
      [
        {
          id: 'resolution-claim-1',
          text: 'Resolution claim',
          claimType: 'status_resolution',
          subjectType: 'commitment',
          subjectId: 'commitment-1',
          confidence: 'high',
          confidenceState: 'verified',
          reviewState: 'approved',
          visibility: 'public',
          methodVersion: null,
        },
      ],
      [restrictedEvidence],
      [],
      [{ status: 'delivered' }],
      [],
    ]) as never,
  ).find((r) => r.method === 'GET' && r.path === '/api/v1/commitments/:id');
  assert.ok(route);

  const out = asRecord(
    await route.handler(requestUrl('/api/v1/commitments/commitment-1'), {}, { id: 'commitment-1' }),
  );
  const resolution = asRecord(out.resolution);
  const evidence = asRecord((resolution.evidence as unknown[])[0]);
  const claim = asRecord(resolution.claim);
  const claimEvidence = asRecord((claim.evidence as unknown[])[0]);

  for (const item of [evidence, claimEvidence]) {
    assert.equal(item.id, 'evidence-1');
    assert.equal(item.claimId, 'resolution-claim-1');
    assert.equal(item.sourceId, 'source-1');
    assert.equal(item.confidence, 'high');
    assert.equal(item.retrievedAt, '2026-01-02T03:04:05.000Z');
    assert.equal(item.visibility, 'restricted');
    assert.equal(item.redacted, true);
    assert.equal(item.redactionReason, 'evidence_visibility');
    assert.equal(item.locator, null);
    assert.equal(item.quote, null);
    assert.equal(item.paraphrase, null);
    assert.equal(item.sourceHash, null);
  }
  assert.equal(JSON.stringify(out).includes('restricted quote'), false);
  assert.equal(JSON.stringify(out).includes('restricted paraphrase'), false);
  assert.equal(JSON.stringify(out).includes('restricted-hash'), false);
  assert.equal(JSON.stringify(out).includes('private.example'), false);
  assert.equal('grade' in out, false);
  assert.equal('ranking' in out, false);
  assert.equal('grade' in resolution, false);
  assert.equal('ranking' in resolution, false);
});
