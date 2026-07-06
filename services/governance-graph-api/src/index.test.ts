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
