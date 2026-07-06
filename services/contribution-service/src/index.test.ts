import test from 'node:test';
import assert from 'node:assert/strict';
import { contributionRoutes } from './index.js';

test('contribution-service exposes §19 contribution + M-RA filing routes', () => {
  // Handlers are lazy closures, so building the table never touches the DB
  // (mirrors governance-graph-api/src/index.test.ts).
  const paths = contributionRoutes({} as never).map((r) => `${r.method} ${r.path}`);
  for (const p of [
    'POST /api/v1/contribute/evidence',
    'POST /api/v1/contribute/graph-edit',
    'POST /internal/review/:id/decide',
    'POST /internal/mandate-holders/:id/commitments',
    'POST /internal/commitments/:id/resolutions',
    'POST /internal/commitments/:id/questions',
    'POST /internal/commitment-questions/:id/answers',
  ]) {
    assert.ok(paths.includes(p), `missing ${p}`);
  }
});


const reqWithCitizen = (citizenId: string) =>
  ({ headers: { 'x-polis-citizen': citizenId } }) as never;

const httpStatus = (value: unknown): number | undefined => {
  if (value && typeof value === 'object' && 'status' in value && typeof value.status === 'number') {
    return value.status;
  }
  return undefined;
};

type InsertedSubmission = {
  status?: string;
  contributionClass?: string;
  payload?: {
    kind?: string;
    status?: string;
    commitmentId?: string;
    resolutionClaimId?: string | null;
  };
};

const insertedSubmission = (value: unknown): InsertedSubmission => {
  assert.ok(value && typeof value === 'object');
  return value;
};

const queuedDb = (selectRows: unknown[][]) => {
  const inserts: Array<{ table: unknown; values: unknown }> = [];
  const updates: Array<{ table: unknown; values: unknown }> = [];
  const operations: Array<{ kind: 'insert' | 'update'; values: unknown }> = [];
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
  const returningRow = (values: unknown) => {
    if (values && typeof values === 'object' && 'decision' in values) {
      return {
        id: `review-${inserts.length}`,
        submissionId: 'submission-resolution-1',
        reviewerId: 'reviewer-1',
        decision: values.decision,
        notes: null,
        decidedAt: new Date('2026-01-01T00:00:00Z'),
        createdAt: new Date('2026-01-01T00:00:00Z'),
      };
    }
    if (values && typeof values === 'object' && 'commitmentId' in values && 'resolutionClaimId' in values) {
      return {
        id: `status-event-${inserts.length}`,
        ...values,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      };
    }
    return {
      id: `submission-${inserts.length}`,
      contributorId: 'citizen-1',
      type: 'claim',
      status: 'pending',
      contributionClass: 'mandate_commitment',
      payload: values && typeof values === 'object' && 'payload' in values ? values.payload : {},
      submittedAt: new Date('2026-01-01T00:00:00Z'),
      decidedAt: null,
    };
  };
  return {
    inserts,
    operations,
    updates,
    db: {
      select: () => selectChain(nextRows()),
      insert: (table: unknown) => ({
        values: (values: unknown) => {
          operations.push({ kind: 'insert', values });
          inserts.push({ table, values });
          return {
            returning: async () => [returningRow(values)],
          };
        },
      }),
      update: (table: unknown) => ({
        set: (values: unknown) => {
          operations.push({ kind: 'update', values });
          updates.push({ table, values });
          return { where: async () => undefined };
        },
      }),
    },
  };
};

test('commitment filing rejects direct terminal status instead of self-adjudicating', async () => {
  const { db, inserts } = queuedDb([
    [{ identityLevel: 'verified_official' }],
    [{ citizenId: 'citizen-1', status: 'active' }],
    [{ status: 'accepted' }],
  ]);
  const route = contributionRoutes(db as never).find(
    (r) => r.method === 'POST' && r.path === '/internal/mandate-holders/:id/commitments',
  );
  assert.ok(route);

  const out = await route.handler(
    reqWithCitizen('citizen-1'),
    {
      claimId: 'claim-1',
      successCriterion: 'Open the clinic',
      status: 'delivered',
      resolutionClaimId: 'resolution-claim-1',
    },
    { id: 'holder-1' },
  );

  assert.equal(httpStatus(out), 400);
  assert.equal(inserts.length, 0, 'terminal self-assignment must not create a submission');
});

test('resolution filing records requested terminal status as a pending claim only', async () => {
  const { db, inserts } = queuedDb([
    [{ mandateHolderId: 'holder-1' }],
    [{ identityLevel: 'verified_official' }],
    [{ citizenId: 'citizen-1', status: 'active' }],
    [{ status: 'accepted' }],
    [{ id: 'claim-resolution-1' }],
  ]);
  const route = contributionRoutes(db as never).find(
    (r) => r.method === 'POST' && r.path === '/internal/commitments/:id/resolutions',
  );
  assert.ok(route);

  const out = await route.handler(
    reqWithCitizen('citizen-1'),
    { status: 'delivered', resolutionClaimId: 'claim-resolution-1' },
    { id: 'commitment-1' },
  );

  assert.equal(httpStatus(out), 201);
  assert.equal(inserts.length, 1, 'filing must not append a commitment_status_event');
  const values = insertedSubmission(inserts[0]?.values);
  assert.equal(values.status, 'pending');
  assert.equal(values.contributionClass, 'mandate_commitment');
  assert.deepEqual(values.payload, {
    kind: 'resolution',
    commitmentId: 'commitment-1',
    status: 'delivered',
    resolutionClaimId: 'claim-resolution-1',
    evidence: null,
  });
});

test('approved resolution review marks the referenced claim approved before status event is exposed', async () => {
  const resolutionSubmission = {
    id: 'submission-resolution-1',
    contributorId: 'citizen-1',
    type: 'claim',
    status: 'pending',
    contributionClass: 'mandate_commitment',
    payload: {
      kind: 'resolution',
      commitmentId: 'commitment-1',
      status: 'delivered',
      resolutionClaimId: 'claim-resolution-1',
    },
    submittedAt: new Date('2026-01-01T00:00:00Z'),
    decidedAt: null,
  };
  const updatedSubmission = {
    ...resolutionSubmission,
    status: 'approved',
    decidedAt: new Date('2026-01-01T00:00:00Z'),
  };
  const { db, inserts, updates, operations } = queuedDb([[resolutionSubmission], [updatedSubmission]]);
  const route = contributionRoutes(db as never).find(
    (r) => r.method === 'POST' && r.path === '/internal/review/:id/decide',
  );
  assert.ok(route);

  const out = await route.handler(
    {} as never,
    { reviewerId: 'reviewer-1', reviewerRole: 'reviewer', decision: 'approve' },
    { id: 'submission-resolution-1' },
  );

  assert.equal(httpStatus(out), 201);
  assert.ok(
    inserts.some((entry) => {
      const values = entry.values as { commitmentId?: string; status?: string; resolutionClaimId?: string };
      return (
        values.commitmentId === 'commitment-1' &&
        values.status === 'delivered' &&
        values.resolutionClaimId === 'claim-resolution-1'
      );
    }),
    'approved resolution review must append a status event linked to the resolution claim',
  );
  assert.ok(
    updates.some((entry) => {
      const values = entry.values as { reviewState?: string };
      return values.reviewState === 'approved';
    }),
    'approved resolution review must approve the referenced resolution claim',
  );
  const claimApprovalIndex = operations.findIndex((entry) => {
    const values = entry.values as { reviewState?: string };
    return entry.kind === 'update' && values.reviewState === 'approved';
  });
  const statusEventIndex = operations.findIndex((entry) => {
    const values = entry.values as { commitmentId?: string; resolutionClaimId?: string };
    return (
      entry.kind === 'insert' &&
      values.commitmentId === 'commitment-1' &&
      values.resolutionClaimId === 'claim-resolution-1'
    );
  });
  assert.ok(
    claimApprovalIndex >= 0 && statusEventIndex >= 0 && claimApprovalIndex < statusEventIndex,
    'resolution claim must be approved before the terminal status event insert',
  );
});
