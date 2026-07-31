import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { startService } from '@polis/service-runtime';
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


async function withServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = startService('contribution-service', 0, contributionRoutes({} as never));
  try {
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function withInternalToken<T>(token: string, run: () => Promise<T>): Promise<T> {
  const previous = process.env.INTERNAL_API_TOKEN;
  process.env.INTERNAL_API_TOKEN = token;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = previous;
  }
}

test('contribution internal routes reject unauthenticated HTTP requests', async () => {
  await withInternalToken('contribution-test-token', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/internal/review/queue`);
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), {
        error: 'internal_auth_required',
        service: 'contribution-service',
      });
    });
  });
});

const reqWithCitizen = (citizenId: string) =>
  ({ headers: { 'x-polis-citizen': citizenId } }) as never;
const reqWithActor = (citizenId: string, identityLevel: string) =>
  ({
    headers: {
      'x-polis-citizen': citizenId,
      'x-polis-identity-level': identityLevel,
    },
  }) as never;

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
        reviewerId:
          values && typeof values === 'object' && 'reviewerId' in values
            ? String(values.reviewerId)
            : '',
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

const acceptedSignedCharter = {
  id: 'charter-1',
  status: 'accepted',
  acceptedSigningRequestId: 'signing-request-1',
  signedArtifactId: 'signed-artifact-1',
  proofManifestId: 'proof-manifest-1',
};
const completedSigningRequest = {
  id: 'signing-request-1',
  charterId: 'charter-1',
  mandateHolderId: 'holder-1',
  status: 'completed',
  signedArtifactId: 'signed-artifact-1',
  proofManifestId: 'proof-manifest-1',
};
const signedArtifact = { id: 'signed-artifact-1', kind: 'charter_signed' };
const proofManifest = { id: 'proof-manifest-1', registryStatus: 'active' };

const invalidSignatureEvidenceCases: Array<[string, unknown[][]]> = [
  [
    'wrong-kind signed artifact',
    [
      [{ id: 'signed-artifact-1', kind: 'uploaded_document' }],
      [proofManifest],
      [],
      [],
    ],
  ],
  [
    'revoked charter proof',
    [[signedArtifact], [proofManifest], [{ id: 'revocation-1' }], []],
  ],
  [
    'superseded charter proof',
    [[signedArtifact], [proofManifest], [], [{ id: 'supersession-1' }]],
  ],
];

for (const [name, evidenceRows] of invalidSignatureEvidenceCases) {
  test(`commitment filing rejects ${name}`, async () => {
    const { db, inserts } = queuedDb([
      [{ identityLevel: 'verified_official' }],
      [{ citizenId: 'citizen-1', status: 'active', jurisdictionId: 'jurisdiction-a' }],
      [acceptedSignedCharter],
      [completedSigningRequest],
      ...evidenceRows,
    ]);
    const route = contributionRoutes(db as never).find(
      (candidate) =>
        candidate.method === 'POST' &&
        candidate.path === '/internal/mandate-holders/:id/commitments',
    );
    assert.ok(route);
    const output = await route.handler(
      reqWithCitizen('citizen-1'),
      { text: 'Open the clinic', successCriterion: 'Clinic is open' },
      { id: 'holder-1' },
    );
    assert.equal(httpStatus(output), 403);
    assert.ok(output && typeof output === 'object' && 'body' in output);
    assert.deepEqual(output.body, {
      error: 'charter_signature_required',
      reason: 'signature_backed_charter_required',
      field: 'charter',
    });
    assert.equal(inserts.length, 0);
  });
}

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

test('commitment filing denies an accepted charter without signing evidence', async () => {
  const { db, inserts } = queuedDb([
    [{ identityLevel: 'verified_official' }],
    [{ citizenId: 'citizen-1', status: 'active', jurisdictionId: 'jurisdiction-a' }],
    [{ id: 'charter-unsigned', status: 'accepted' }],
  ]);
  const route = contributionRoutes(db as never).find(
    (r) => r.method === 'POST' && r.path === '/internal/mandate-holders/:id/commitments',
  );
  assert.ok(route);
  const out = await route.handler(
    reqWithCitizen('citizen-1'),
    { text: 'Open the clinic', successCriterion: 'Clinic is open' },
    { id: 'holder-1' },
  );
  assert.equal(httpStatus(out), 403);
  assert.ok(out && typeof out === 'object' && 'body' in out);
  assert.deepEqual(out.body, {
    error: 'charter_signature_required',
    reason: 'signature_backed_charter_required',
    field: 'charter',
  });
  assert.equal(inserts.length, 0);
});

test('commitment filing rejects non-covering charter scope before inserts', async () => {
  const { db, inserts } = queuedDb([
    [{ identityLevel: 'verified_official' }],
    [{ citizenId: 'citizen-1', status: 'active', jurisdictionId: 'jurisdiction-a' }],
    [
      {
        ...acceptedSignedCharter,
        charterDoc: { scope: { jurisdictions: ['jurisdiction-b'] } },
      },
    ],
    [completedSigningRequest],
    [signedArtifact],
    [proofManifest],
    [],
    [],
  ]);
  const route = contributionRoutes(db as never).find(
    (r) => r.method === 'POST' && r.path === '/internal/mandate-holders/:id/commitments',
  );
  assert.ok(route);

  const out = await route.handler(
    reqWithCitizen('citizen-1'),
    {
      text: 'Open the clinic',
      successCriterion: 'Clinic is open',
      jurisdictionId: 'jurisdiction-a',
    },
    { id: 'holder-1' },
  );

  assert.equal(httpStatus(out), 403);
  assert.ok(out && typeof out === 'object' && 'body' in out);
  assert.deepEqual(out.body, {
    error: 'charter_scope_not_covered',
    reason: 'jurisdiction_not_covered',
    field: 'jurisdictionId',
  });
  assert.equal(inserts.length, 0, 'scope denial must not create claims, commitments, status events, or submissions');
});

test('commitment filing allows covering charter scope', async () => {
  const { db, inserts } = queuedDb([
    [{ identityLevel: 'verified_official' }],
    [{ citizenId: 'citizen-1', status: 'active', jurisdictionId: 'jurisdiction-a' }],
    [
      {
        ...acceptedSignedCharter,
        charterDoc: { scope: { jurisdictions: ['jurisdiction-a'], processes: ['process-1'] } },
      },
    ],
    [completedSigningRequest],
    [signedArtifact],
    [proofManifest],
    [],
    [],
  ]);
  const route = contributionRoutes(db as never).find(
    (r) => r.method === 'POST' && r.path === '/internal/mandate-holders/:id/commitments',
  );
  assert.ok(route);

  const out = await route.handler(
    reqWithCitizen('citizen-1'),
    {
      text: 'Open the clinic',
      successCriterion: 'Clinic is open',
      jurisdictionId: 'jurisdiction-a',
      processId: 'process-1',
    },
    { id: 'holder-1' },
  );

  assert.equal(httpStatus(out), 201);
  assert.equal(inserts.length, 4, 'publish path creates claim, commitment, initial status event, and submission');
  assert.ok(
    inserts.some((entry) => {
      const values = entry.values;
      return (
        values !== null &&
        typeof values === 'object' &&
        'jurisdictionId' in values &&
        'processId' in values &&
        values.jurisdictionId === 'jurisdiction-a' &&
        values.processId === 'process-1'
      );
    }),
    'commitment insert must retain requested scope',
  );
});

test('commitment filing persists restricted evidence with restricted default visibility', async () => {
  const { db, inserts } = queuedDb([
    [{ identityLevel: 'verified_official' }],
    [{ citizenId: 'citizen-1', status: 'active', jurisdictionId: 'jurisdiction-a' }],
    [
      {
        ...acceptedSignedCharter,
        charterDoc: { scope: { jurisdictions: ['jurisdiction-a'] } },
      },
    ],
    [completedSigningRequest],
    [signedArtifact],
    [proofManifest],
    [],
    [],
  ]);
  const route = contributionRoutes(db as never).find(
    (r) => r.method === 'POST' && r.path === '/internal/mandate-holders/:id/commitments',
  );
  assert.ok(route);

  const out = await route.handler(
    reqWithCitizen('citizen-1'),
    {
      text: 'Open the clinic',
      successCriterion: 'Clinic is open',
      jurisdictionId: 'jurisdiction-a',
      evidence: [{ quote: 'private quote', locator: { uri: 'urn:private' } }],
    },
    { id: 'holder-1' },
  );

  assert.equal(httpStatus(out), 201);
  const evidenceInsert = inserts.find((entry) => Array.isArray(entry.values));
  assert.ok(evidenceInsert, 'evidence payload must create evidence_links rows');
  const values = (evidenceInsert.values as Array<Record<string, unknown>>)[0];
  assert.equal(values.visibility, 'restricted');
  assert.equal(values.confidence, '0.5');
  assert.equal(values.quote, 'private quote');
  assert.deepEqual(values.locator, { uri: 'urn:private' });
  assert.equal(typeof values.sourceId, 'string');
  assert.match(values.sourceId as string, /^representative:/);
});

test('commitment filing rejects requested jurisdiction when object scope omits jurisdictions array', async () => {
  const { db, inserts } = queuedDb([
    [{ identityLevel: 'verified_official' }],
    [{ citizenId: 'citizen-1', status: 'active', jurisdictionId: 'jurisdiction-a' }],
    [
      {
        ...acceptedSignedCharter,
        charterDoc: { scope: { processes: ['process-1'] } },
      },
    ],
    [completedSigningRequest],
    [signedArtifact],
    [proofManifest],
    [],
    [],
  ]);
  const route = contributionRoutes(db as never).find(
    (r) => r.method === 'POST' && r.path === '/internal/mandate-holders/:id/commitments',
  );
  assert.ok(route);

  const out = await route.handler(
    reqWithCitizen('citizen-1'),
    {
      text: 'Open the clinic',
      successCriterion: 'Clinic is open',
      jurisdictionId: 'jurisdiction-a',
    },
    { id: 'holder-1' },
  );

  assert.equal(httpStatus(out), 403);
  assert.ok(out && typeof out === 'object' && 'body' in out);
  assert.deepEqual(out.body, {
    error: 'charter_scope_not_covered',
    reason: 'jurisdiction_not_covered',
    field: 'jurisdictionId',
  });
  assert.equal(inserts.length, 0);
});

test('resolution filing records requested terminal status as a pending claim only', async () => {
  const { db, inserts } = queuedDb([
    [{ mandateHolderId: 'holder-1' }],
    [{ identityLevel: 'verified_official' }],
    [{ citizenId: 'citizen-1', status: 'active' }],
    [acceptedSignedCharter],
    [completedSigningRequest],
    [signedArtifact],
    [proofManifest],
    [],
    [],
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

test('internal review handlers reject actors who are missing or non-staff', async () => {
  const { db } = queuedDb([]);
  const routes = contributionRoutes(db as never);
  const queue = routes.find(
    (r) => r.method === 'GET' && r.path === '/internal/review/queue',
  );
  const decide = routes.find(
    (r) => r.method === 'POST' && r.path === '/internal/review/:id/decide',
  );
  assert.ok(queue);
  assert.ok(decide);
  for (const out of [
    await queue.handler({ headers: {} } as never, {}, {}),
    await queue.handler(reqWithActor('citizen-1', 'verified'), {}, {}),
    await decide.handler(reqWithActor('citizen-1', 'verified'), { decision: 'approve' }, { id: 'submission-1' }),
  ]) {
    assert.equal(httpStatus(out), 403);
  }
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
    reqWithActor('staff-reviewer', 'staff'),
    {
      reviewerId: 'forged-reviewer',
      reviewerRole: 'reviewer',
      decision: 'approve',
    },
    { id: 'submission-resolution-1' },
  );

  assert.equal(httpStatus(out), 201);
  const reviewInsert = inserts.find((entry) => {
    const values = entry.values;
    return values !== null && typeof values === 'object' && 'decision' in values;
  });
  assert.ok(reviewInsert);
  assert.ok(
    reviewInsert.values &&
      typeof reviewInsert.values === 'object' &&
      'reviewerId' in reviewInsert.values,
  );
  assert.equal(reviewInsert.values.reviewerId, 'staff-reviewer');
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
