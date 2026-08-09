import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { startService } from '@polis/service-runtime';
import { contributionRoutes } from './index.js';

test('contribution-service exposes §19 contribution + M-RA filing routes', () => {
  // Handlers are lazy closures, so building the table never touches the DB
  // (mirrors governance-graph-api/src/index.test.ts).
  assert.deepEqual(
    contributionRoutes({} as never).map((route) => `${route.method} ${route.path}`),
    [
      'GET /healthz',
      'GET /readyz',
      'GET /metrics',
      'GET /version',
      'POST /api/v1/contribute/evidence',
      'POST /api/v1/contribute/graph-edit',
      'GET /api/v1/contributions/:id',
      'GET /api/v1/contributors/:id',
      'GET /internal/review/queue',
      'POST /internal/review/:id/decide',
      'POST /internal/mandate-holders/:id/commitments',
      'POST /internal/commitments/:id/resolutions',
      'POST /internal/commitments/:id/questions',
      'POST /internal/commitment-questions/:id/answers',
      'GET /internal/contributions/graph-proposals',
    ],
  );
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

async function withInternalToken<T>(token: string | undefined, run: () => Promise<T>): Promise<T> {
  const previous = process.env.INTERNAL_API_TOKEN;
  if (token === undefined) delete process.env.INTERNAL_API_TOKEN;
  else process.env.INTERNAL_API_TOKEN = token;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = previous;
  }
}

async function withAudit<T>(implementation: typeof fetch, run: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  const originalAuditUrl = process.env.AUDIT_INTERNAL_URL;
  globalThis.fetch = implementation;
  process.env.AUDIT_INTERNAL_URL = 'http://audit.internal';
  try {
    return await withInternalToken('contribution-audit-token', run);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalAuditUrl === undefined) delete process.env.AUDIT_INTERNAL_URL;
    else process.env.AUDIT_INTERNAL_URL = originalAuditUrl;
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
  contributorId?: string;
  decidedAt?: Date | null;
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

const queuedDb = (
  selectRows: unknown[][],
  failures: {
    insertAt?: number;
    updateAt?: number;
    transactionSelectRows?: unknown[][];
    updateReturningRows?: unknown[][];
  } = {},
) => {
  const inserts: Array<{ table: unknown; values: unknown }> = [];
  const updates: Array<{ table: unknown; values: unknown }> = [];
  const operations: Array<{ kind: 'insert' | 'update'; values: unknown }> = [];
  const transactionOptions: unknown[] = [];
  let selectCalls = 0;
  let insertAttempts = 0;
  let updateAttempts = 0;
  const nextRows = () => selectRows.shift() ?? [];
  const selectChain = (rows: unknown[]) => {
    const chain = {
      from: () => chain,
      where: () => chain,
      innerJoin: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(rows).then(resolve, reject),
    };
    return chain;
  };
  const returningRow = (values: unknown, ordinal: number) => {
    if (values && typeof values === 'object' && 'decision' in values) {
      return {
        id: `review-${ordinal}`,
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
    if (values && typeof values === 'object' && 'type' in values && 'contributorId' in values) {
      return {
        ...values,
        id: `submission-${ordinal}`,
        submittedAt: new Date('2026-01-01T00:00:00Z'),
        decidedAt: 'decidedAt' in values ? (values.decidedAt as Date | null) : null,
      };
    }
    if (values && typeof values === 'object' && 'targetTable' in values) {
      return {
        ...values,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      };
    }
    if (
      values &&
      typeof values === 'object' &&
      'commitmentId' in values &&
      'resolutionClaimId' in values
    ) {
      return {
        ...values,
        id: `status-event-${ordinal}`,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      };
    }
    return {
      id: `submission-${ordinal}`,
      contributorId: 'citizen-1',
      type: 'claim',
      status: 'pending',
      contributionClass: 'mandate_commitment',
      payload: values && typeof values === 'object' && 'payload' in values ? values.payload : {},
      submittedAt: new Date('2026-01-01T00:00:00Z'),
      decidedAt: null,
    };
  };
  const makeDb = (
    targetInserts: Array<{ table: unknown; values: unknown }>,
    targetUpdates: Array<{ table: unknown; values: unknown }>,
    targetOperations: Array<{ kind: 'insert' | 'update'; values: unknown }>,
    rowSource: () => unknown[] = nextRows,
  ) => ({
    select: () => {
      selectCalls += 1;
      return selectChain(rowSource());
    },
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        insertAttempts += 1;
        if (insertAttempts === failures.insertAt) throw new Error('injected insert failure');
        targetOperations.push({ kind: 'insert', values });
        targetInserts.push({ table, values });
        return {
          returning: async () => [returningRow(values, targetInserts.length)],
        };
      },
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => {
        updateAttempts += 1;
        if (updateAttempts === failures.updateAt) throw new Error('injected update failure');
        targetOperations.push({ kind: 'update', values });
        targetUpdates.push({ table, values });
        return {
          where: () => ({
            returning: async () => failures.updateReturningRows?.shift() ?? [],
          }),
        };
      },
    }),
  });
  const db = {
    ...makeDb(inserts, updates, operations),
    transaction: async <T>(
      callback: (tx: unknown) => Promise<T>,
      options?: unknown,
    ): Promise<T> => {
      transactionOptions.push(options);
      const stagedInserts: Array<{ table: unknown; values: unknown }> = [];
      const stagedUpdates: Array<{ table: unknown; values: unknown }> = [];
      const stagedOperations: Array<{ kind: 'insert' | 'update'; values: unknown }> = [];
      const transactionRows = failures.transactionSelectRows;
      const rowSource = transactionRows ? () => transactionRows.shift() ?? [] : nextRows;
      const value = await callback(
        makeDb(stagedInserts, stagedUpdates, stagedOperations, rowSource),
      );
      inserts.push(...stagedInserts);
      updates.push(...stagedUpdates);
      operations.push(...stagedOperations);
      return value;
    },
  };
  return {
    inserts,
    operations,
    updates,
    transactionOptions,
    get remainingSelectRows() {
      return selectRows.length;
    },
    get selectCalls() {
      return selectCalls;
    },
    get insertAttempts() {
      return insertAttempts;
    },
    get updateAttempts() {
      return updateAttempts;
    },
    db,
  };
};

const acceptedSignedCharter = {
  id: 'charter-1',
  status: 'accepted',
  acceptedSigningRequestId: 'signing-request-1',
  signedArtifactId: 'signed-artifact-1',
  proofManifestId: 'proof-manifest-1',
  charterDoc: { scope: 'all' },
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
    [[{ id: 'signed-artifact-1', kind: 'uploaded_document' }], [proofManifest], [], []],
  ],
  ['revoked charter proof', [[signedArtifact], [proofManifest], [{ id: 'revocation-1' }], []]],
  ['superseded charter proof', [[signedArtifact], [proofManifest], [], [{ id: 'supersession-1' }]]],
  [
    'unknown-registry charter proof',
    [[signedArtifact], [{ ...proofManifest, registryStatus: 'unknown' }], [], []],
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
  assert.equal(
    inserts.length,
    0,
    'scope denial must not create claims, commitments, status events, or submissions',
  );
});

const invalidCharterScopeCases = [
  ['missing', { ...acceptedSignedCharter, charterDoc: {} }, 'charter_scope_required'],
  ['null', { ...acceptedSignedCharter, charterDoc: { scope: null } }, 'charter_scope_required'],
  [
    'malformed',
    { ...acceptedSignedCharter, charterDoc: { scope: { jurisdictions: 'all' } } },
    'invalid_charter_scope',
  ],
  [
    'malformed entry',
    { ...acceptedSignedCharter, charterDoc: { scope: { jurisdictions: [42] } } },
    'invalid_charter_scope',
  ],
] as const;

for (const [name, charter, reason] of invalidCharterScopeCases) {
  test(`commitment filing rejects ${name} charter scope`, async () => {
    const state = queuedDb([
      [{ identityLevel: 'verified_official' }],
      [{ citizenId: 'citizen-1', status: 'active', jurisdictionId: 'jurisdiction-a' }],
      [charter],
      [completedSigningRequest],
      [signedArtifact],
      [proofManifest],
      [],
      [],
    ]);
    const audits: Array<Record<string, unknown>> = [];
    await withAudit(
      (async (_input, init) => {
        audits.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(null, { status: 204 });
      }) as typeof fetch,
      async () => {
        const route = contributionRoutes(state.db as never).find(
          (candidate) =>
            candidate.method === 'POST' &&
            candidate.path === '/internal/mandate-holders/:id/commitments',
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
          reason,
          field: 'scope',
        });
      },
    );
    assert.equal(state.inserts.length, 0);
    assert.equal(state.operations.length, 0);
    assert.deepEqual(state.transactionOptions, [{ isolationLevel: 'serializable' }]);
    assert.equal(audits.length, 1);
    assert.equal(audits[0]?.eventType, 'representative.commitment.publish_denied');
    assert.equal(audits[0]?.visibility, 'restricted');
  });
}

test('commitment filing rejects malformed legacy scope without requested scope', async () => {
  const state = queuedDb([
    [{ identityLevel: 'verified_official' }],
    [{ citizenId: 'citizen-1', status: 'active', jurisdictionId: 'jurisdiction-a' }],
    [{ ...acceptedSignedCharter, charterDoc: { scope: 'arbitrary-scope' } }],
    [completedSigningRequest],
    [signedArtifact],
    [proofManifest],
    [],
    [],
  ]);
  await withAudit((async () => new Response(null, { status: 204 })) as typeof fetch, async () => {
    const route = contributionRoutes(state.db as never).find(
      (candidate) =>
        candidate.method === 'POST' &&
        candidate.path === '/internal/mandate-holders/:id/commitments',
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
      error: 'charter_scope_not_covered',
      reason: 'invalid_charter_scope',
      field: 'scope',
    });
  });
  assert.equal(state.insertAttempts, 0);
  assert.equal(state.operations.length, 0);
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

  const out = await withAudit(
    (async () => new Response(null, { status: 204 })) as typeof fetch,
    async () =>
      route.handler(
        reqWithCitizen('citizen-1'),
        {
          text: 'Open the clinic',
          successCriterion: 'Clinic is open',
          jurisdictionId: 'jurisdiction-a',
          processId: 'process-1',
        },
        { id: 'holder-1' },
      ),
  );

  assert.equal(httpStatus(out), 201);
  assert.ok(out && typeof out === 'object' && 'body' in out);
  assert.ok(out.body && typeof out.body === 'object' && 'decidedAt' in out.body);
  assert.notEqual(out.body.decidedAt, null);
  assert.equal(
    inserts.length,
    4,
    'publish path creates claim, commitment, initial status event, and submission',
  );
  const commitmentSubmission = inserts.find((entry) => {
    const values = entry.values;
    return (
      values !== null &&
      typeof values === 'object' &&
      'contributionClass' in values &&
      values.contributionClass === 'mandate_commitment'
    );
  });
  assert.equal(insertedSubmission(commitmentSubmission?.values).status, 'approved');
  assert.ok(insertedSubmission(commitmentSubmission?.values).decidedAt instanceof Date);
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

  const out = await withAudit(
    (async () => new Response(null, { status: 204 })) as typeof fetch,
    async () =>
      route.handler(
        reqWithCitizen('citizen-1'),
        {
          text: 'Open the clinic',
          successCriterion: 'Clinic is open',
          jurisdictionId: 'jurisdiction-a',
          evidence: [{ quote: 'private quote', locator: { uri: 'urn:private' } }],
        },
        { id: 'holder-1' },
      ),
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

  const out = await withAudit(
    (async () => new Response(null, { status: 204 })) as typeof fetch,
    async () =>
      route.handler(
        reqWithCitizen('citizen-1'),
        { status: 'delivered', resolutionClaimId: 'claim-resolution-1' },
        { id: 'commitment-1' },
      ),
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

const authorizedCommitmentRows = (): unknown[][] => [
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
];

const authorizedResolutionRows = (): unknown[][] => [
  [{ mandateHolderId: 'holder-1', jurisdictionId: 'jurisdiction-a', processId: 'process-1' }],
  ...authorizedCommitmentRows(),
];

test('transactional representative gate rejects a stale earlier allowed view', async () => {
  const state = queuedDb(authorizedCommitmentRows(), {
    transactionSelectRows: [
      [{ identityLevel: 'verified_official' }],
      [{ citizenId: 'citizen-1', status: 'inactive', jurisdictionId: 'jurisdiction-a' }],
    ],
  });
  const audits: Array<Record<string, unknown>> = [];
  await withAudit(
    (async (_input, init) => {
      assert.equal(state.inserts.length, 0, 'denial audit must run only after rollback');
      audits.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(null, { status: 204 });
    }) as typeof fetch,
    async () => {
      const route = contributionRoutes(state.db as never).find(
        (candidate) =>
          candidate.method === 'POST' &&
          candidate.path === '/internal/mandate-holders/:id/commitments',
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
      assert.equal(httpStatus(out), 403);
      assert.ok(out && typeof out === 'object' && 'body' in out);
      assert.deepEqual(out.body, {
        error: 'mandate_inactive',
        reason: 'mandate_holder_not_active',
        field: 'status',
      });
    },
  );
  assert.equal(state.remainingSelectRows, authorizedCommitmentRows().length);
  assert.deepEqual(state.transactionOptions, [{ isolationLevel: 'serializable' }]);
  assert.equal(state.insertAttempts, 0);
  assert.equal(state.operations.length, 0);
  assert.equal(audits.length, 1);
  assert.equal(audits[0]?.eventType, 'representative.commitment.publish_denied');
  assert.equal(audits[0]?.visibility, 'restricted');
});

test('representative authorization audit failures return 503 without mutation', async () => {
  const scenarios = [
    {
      path: '/internal/mandate-holders/:id/commitments',
      rows: authorizedCommitmentRows(),
      body: {
        text: 'Open the clinic',
        successCriterion: 'Clinic is open',
        jurisdictionId: 'jurisdiction-a',
        processId: 'process-1',
      },
      params: { id: 'holder-1' },
    },
    {
      path: '/internal/commitments/:id/resolutions',
      rows: authorizedResolutionRows(),
      body: { status: 'delivered', text: 'The clinic opened' },
      params: { id: 'commitment-1' },
    },
  ] as const;
  for (const scenario of scenarios) {
    const state = queuedDb(scenario.rows);
    let auditCalls = 0;
    await withAudit(
      (async () => {
        auditCalls += 1;
        return new Response(null, { status: 503 });
      }) as typeof fetch,
      async () => {
        const route = contributionRoutes(state.db as never).find(
          (candidate) => candidate.method === 'POST' && candidate.path === scenario.path,
        );
        assert.ok(route);
        const out = await route.handler(
          reqWithCitizen(' citizen-1 '),
          scenario.body,
          scenario.params,
        );
        assert.equal(httpStatus(out), 503);
      },
    );
    assert.equal(auditCalls, 1);
    assert.equal(state.insertAttempts, 0);
    assert.equal(state.inserts.length, 0);
    assert.equal(state.operations.length, 0);
  }
});

test('representative completion audit failures roll back every staged mutation', async () => {
  const scenarios = [
    {
      path: '/internal/mandate-holders/:id/commitments',
      rows: authorizedCommitmentRows(),
      body: {
        text: 'Open the clinic',
        successCriterion: 'Clinic is open',
        jurisdictionId: 'jurisdiction-a',
        processId: 'process-1',
      },
      params: { id: 'holder-1' },
      expectedInsertAttempts: 4,
      fail: 'non_2xx',
    },
    {
      path: '/internal/commitments/:id/resolutions',
      rows: authorizedResolutionRows(),
      body: { status: 'delivered', text: 'The clinic opened' },
      params: { id: 'commitment-1' },
      expectedInsertAttempts: 2,
      fail: 'throw',
    },
  ] as const;
  for (const scenario of scenarios) {
    const state = queuedDb(scenario.rows);
    let auditCalls = 0;
    await withAudit(
      (async () => {
        auditCalls += 1;
        if (auditCalls === 1) return new Response(null, { status: 204 });
        assert.equal(state.insertAttempts, scenario.expectedInsertAttempts);
        assert.equal(
          state.inserts.length,
          0,
          'transaction must remain staged during completion audit',
        );
        if (scenario.fail === 'non_2xx') return new Response(null, { status: 503 });
        throw new Error('completion audit offline');
      }) as typeof fetch,
      async () => {
        const route = contributionRoutes(state.db as never).find(
          (candidate) => candidate.method === 'POST' && candidate.path === scenario.path,
        );
        assert.ok(route);
        const out = await route.handler(
          reqWithCitizen('citizen-1'),
          scenario.body,
          scenario.params,
        );
        assert.equal(httpStatus(out), 503);
      },
    );
    assert.equal(auditCalls, 2);
    assert.equal(state.insertAttempts, scenario.expectedInsertAttempts);
    assert.equal(state.inserts.length, 0);
    assert.equal(state.operations.length, 0);
  }
});

test('representative writes audit authorization then staged completion with bound actor', async () => {
  const commitmentState = queuedDb(authorizedCommitmentRows());
  const commitmentEvents: Array<Record<string, unknown>> = [];
  await withAudit(
    (async (_input, init) => {
      const event = JSON.parse(String(init?.body)) as Record<string, unknown>;
      commitmentEvents.push(event);
      if (commitmentEvents.length === 1) assert.equal(commitmentState.insertAttempts, 0);
      if (commitmentEvents.length === 2) {
        assert.equal(commitmentState.insertAttempts, 5);
        assert.equal(commitmentState.inserts.length, 0);
      }
      if (commitmentEvents.length === 3) assert.equal(commitmentState.inserts.length, 5);
      return new Response(null, { status: 204 });
    }) as typeof fetch,
    async () => {
      const route = contributionRoutes(commitmentState.db as never).find(
        (candidate) =>
          candidate.method === 'POST' &&
          candidate.path === '/internal/mandate-holders/:id/commitments',
      );
      assert.ok(route);
      const out = await route.handler(
        reqWithCitizen(' citizen-1 '),
        {
          text: 'Open the clinic',
          successCriterion: 'Clinic is open',
          jurisdictionId: 'jurisdiction-a',
          processId: 'process-1',
          evidence: [{ quote: 'restricted source' }],
        },
        { id: 'holder-1' },
      );
      assert.equal(httpStatus(out), 201);
    },
  );
  assert.deepEqual(
    commitmentEvents.map((event) => event.eventType),
    [
      'representative.commitment.publish_authorized',
      'representative.commitment.published',
      'representative.commitment.evidence_attached',
    ],
  );
  assert.deepEqual(commitmentEvents[0]?.actor, { type: 'user', id: 'citizen-1' });
  assert.equal(commitmentEvents[0]?.visibility, 'restricted');
  assert.equal(commitmentEvents[0]?.action, 'publish_authorized');
  assert.deepEqual(commitmentEvents[0]?.target, { type: 'mandate-holder', id: 'holder-1' });
  assert.deepEqual(commitmentEvents[0]?.data, {
    mandateHolderId: 'holder-1',
    requestedScope: { jurisdictionId: 'jurisdiction-a', processId: 'process-1' },
  });
  assert.deepEqual(commitmentEvents[1]?.actor, { type: 'user', id: 'citizen-1' });
  assert.equal(commitmentEvents[1]?.visibility, 'restricted');
  assert.equal(commitmentEvents[1]?.action, 'publish');
  assert.deepEqual(commitmentEvents[1]?.target, { type: 'commitment', id: 'submission-2' });
  const commitmentSubmission = insertedSubmission(
    commitmentState.inserts.find((entry) => {
      const values = entry.values;
      return values !== null && typeof values === 'object' && 'contributionClass' in values;
    })?.values,
  );
  assert.equal(commitmentSubmission.status, 'approved');
  assert.ok(commitmentSubmission.decidedAt instanceof Date);
  assert.equal(commitmentSubmission.contributorId, 'citizen-1');
  assert.deepEqual(commitmentEvents[1]?.data, {
    mandateHolderId: 'holder-1',
    claimId: 'submission-1',
    submissionId: 'submission-4',
  });

  const resolutionState = queuedDb(authorizedResolutionRows());
  assert.deepEqual(commitmentState.transactionOptions, [{ isolationLevel: 'serializable' }]);
  const resolutionEvents: Array<Record<string, unknown>> = [];
  await withAudit(
    (async (_input, init) => {
      const event = JSON.parse(String(init?.body)) as Record<string, unknown>;
      resolutionEvents.push(event);
      if (resolutionEvents.length === 1) assert.equal(resolutionState.insertAttempts, 0);
      if (resolutionEvents.length === 2) {
        assert.equal(resolutionState.insertAttempts, 2);
        assert.equal(resolutionState.inserts.length, 0);
      }
      return new Response(null, { status: 204 });
    }) as typeof fetch,
    async () => {
      const route = contributionRoutes(resolutionState.db as never).find(
        (candidate) =>
          candidate.method === 'POST' && candidate.path === '/internal/commitments/:id/resolutions',
      );
      assert.ok(route);
      const out = await route.handler(
        reqWithCitizen(' citizen-1 '),
        { status: 'delivered', text: 'The clinic opened' },
        { id: 'commitment-1' },
      );
      assert.equal(httpStatus(out), 201);
    },
  );
  assert.deepEqual(
    resolutionEvents.map((event) => event.eventType),
    [
      'representative.commitment.resolution_authorized',
      'representative.commitment.resolution_filed',
    ],
  );
  assert.deepEqual(resolutionEvents[0]?.actor, { type: 'user', id: 'citizen-1' });
  assert.equal(resolutionEvents[0]?.visibility, 'restricted');
  assert.equal(resolutionEvents[0]?.action, 'resolution_authorized');
  assert.deepEqual(resolutionEvents[0]?.target, { type: 'commitment', id: 'commitment-1' });
  assert.deepEqual(resolutionEvents[0]?.data, {
    mandateHolderId: 'holder-1',
    requestedScope: { jurisdictionId: 'jurisdiction-a', processId: 'process-1' },
  });
  assert.deepEqual(resolutionEvents[1]?.actor, { type: 'user', id: 'citizen-1' });
  assert.equal(resolutionEvents[1]?.visibility, 'restricted');
  assert.equal(resolutionEvents[1]?.action, 'submit');
  assert.deepEqual(resolutionEvents[1]?.target, {
    type: 'contribution',
    id: 'submission-2',
  });
  assert.deepEqual(resolutionEvents[1]?.data, {
    commitmentId: 'commitment-1',
    status: 'delivered',
    resolutionClaimId: 'submission-1',
  });
  const resolutionSubmission = insertedSubmission(
    resolutionState.inserts.find((entry) => {
      const values = entry.values;
      return values !== null && typeof values === 'object' && 'contributionClass' in values;
    })?.values,
  );
  assert.equal(resolutionSubmission.status, 'pending');
  assert.equal(resolutionSubmission.decidedAt, null);
  assert.equal(resolutionSubmission.contributorId, 'citizen-1');
  assert.deepEqual(resolutionState.transactionOptions, [{ isolationLevel: 'serializable' }]);
});

const activeReviewBinding = {
  status: 'active',
  startsAt: new Date('2025-01-01T00:00:00Z'),
  endsAt: null,
  decisionRightName: 'review_contribution',
};

const validEvidenceBody = {
  payload: {
    text: 'Trusted evidence',
    claimType: 'other',
    subjectType: 'claim',
    subjectId: 'claim-1',
    confidence: 0.8,
  },
};

const validGraphEditBody = {
  payload: {
    targetTable: 'claims',
    op: 'insert',
    proposedPayload: { id: 'claim-proposed', text: 'Proposed claim' },
  },
};

test('submission handlers require trusted actors and reject caller contributor authority', async () => {
  const missingDb = queuedDb([]);
  const evidence = contributionRoutes(missingDb.db as never).find(
    (route) => route.method === 'POST' && route.path === '/api/v1/contribute/evidence',
  );
  assert.ok(evidence);
  assert.equal(
    httpStatus(await evidence.handler({ headers: {} } as never, validEvidenceBody, {})),
    401,
  );
  for (const level of ['casual', 'constructor', 'toString', '__proto__']) {
    assert.equal(
      httpStatus(
        await evidence.handler(reqWithActor('legacy-citizen', level), validEvidenceBody, {}),
      ),
      403,
      `${level} must not pass the identity allowlist`,
    );
  }
  for (const level of ['verified_resident', 'verified_official', 'staff']) {
    assert.equal(
      httpStatus(
        await evidence.handler(reqWithActor('trusted-citizen', level), { payload: {} }, {}),
      ),
      400,
      `${level} must pass identity authorization and reach payload validation`,
    );
  }
  assert.equal(missingDb.selectCalls, 0);
  assert.equal(missingDb.inserts.length, 0);

  for (const body of [
    { ...validEvidenceBody, contributorId: 'forged-contributor' },
    {
      ...validEvidenceBody,
      contributor: { displayName: 'Forged', identityLevel: 'staff' },
    },
  ]) {
    const deniedDb = queuedDb([]);
    const route = contributionRoutes(deniedDb.db as never).find(
      (candidate) =>
        candidate.method === 'POST' && candidate.path === '/api/v1/contribute/evidence',
    );
    assert.ok(route);
    assert.equal(
      httpStatus(await route.handler(reqWithActor('citizen-1', 'staff'), body, {})),
      400,
    );
    assert.equal(deniedDb.selectCalls, 0);
    assert.equal(deniedDb.inserts.length, 0);
  }
});

test('trusted evidence and graph-edit submissions bind the verified citizen after audit', async () => {
  const auditBodies: Array<Record<string, unknown>> = [];
  await withAudit(
    (async (_input, init) => {
      auditBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(null, { status: 204 });
    }) as typeof fetch,
    async () => {
      const evidenceDb = queuedDb([[]]);
      const evidence = contributionRoutes(evidenceDb.db as never).find(
        (route) => route.method === 'POST' && route.path === '/api/v1/contribute/evidence',
      );
      assert.ok(evidence);
      const evidenceOut = await evidence.handler(
        reqWithActor('trusted-resident', 'verified_resident'),
        validEvidenceBody,
        {},
      );
      assert.equal(httpStatus(evidenceOut), 201);
      const evidenceSubmission = evidenceDb.inserts.find((entry) => {
        const values = entry.values;
        return (
          values !== null &&
          typeof values === 'object' &&
          'type' in values &&
          values.type === 'evidence'
        );
      });
      assert.ok(evidenceSubmission);
      const evidenceValues = evidenceSubmission.values;
      assert.ok(
        evidenceValues !== null &&
          typeof evidenceValues === 'object' &&
          'contributorId' in evidenceValues &&
          typeof evidenceValues.contributorId === 'string',
      );
      assert.equal(evidenceValues.contributorId, 'trusted-resident');
      const contributor = evidenceDb.inserts.find((entry) => {
        const values = entry.values;
        return values !== null && typeof values === 'object' && 'displayName' in values;
      });
      assert.ok(contributor);
      const contributorValues = contributor.values;
      assert.ok(
        contributorValues !== null &&
          typeof contributorValues === 'object' &&
          'id' in contributorValues &&
          'identityLevel' in contributorValues &&
          'displayName' in contributorValues,
      );
      assert.deepEqual(
        {
          id: contributorValues.id,
          identityLevel: contributorValues.identityLevel,
          displayName: contributorValues.displayName,
        },
        {
          id: 'trusted-resident',
          identityLevel: 'verified',
          displayName: 'trusted-resident',
        },
      );

      const graphDb = queuedDb([[]]);
      const graphEdit = contributionRoutes(graphDb.db as never).find(
        (route) => route.method === 'POST' && route.path === '/api/v1/contribute/graph-edit',
      );
      assert.ok(graphEdit);
      const graphOut = await graphEdit.handler(
        reqWithActor('trusted-official', 'verified_official'),
        validGraphEditBody,
        {},
      );
      assert.equal(httpStatus(graphOut), 201);
      const graphSubmission = graphDb.inserts.find((entry) => {
        const values = entry.values;
        return (
          values !== null &&
          typeof values === 'object' &&
          'type' in values &&
          values.type === 'graph_edit'
        );
      });
      assert.ok(graphSubmission);
      const graphValues = graphSubmission.values;
      assert.ok(
        graphValues !== null &&
          typeof graphValues === 'object' &&
          'contributorId' in graphValues &&
          typeof graphValues.contributorId === 'string',
      );
      assert.equal(graphValues.contributorId, 'trusted-official');
    },
  );

  const authorizedAttempts = auditBodies.filter(
    (body) => body.eventType === 'contribution.submission_authorized',
  );
  assert.equal(authorizedAttempts.length, 2);
  for (const event of authorizedAttempts) {
    assert.equal(event.visibility, 'restricted');
    assert.equal(event.action, 'submit_authorized');
  }
});

test('required submission audit failures return 503 with zero DB mutation', async () => {
  const missingAuth = queuedDb([]);
  const originalFetch = globalThis.fetch;
  let unauthenticatedFetchCalls = 0;
  globalThis.fetch = (async () => {
    unauthenticatedFetchCalls += 1;
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  try {
    await withInternalToken(undefined, async () => {
      const route = contributionRoutes(missingAuth.db as never).find(
        (candidate) =>
          candidate.method === 'POST' && candidate.path === '/api/v1/contribute/evidence',
      );
      assert.ok(route);
      const out = await route.handler(
        reqWithActor('trusted-citizen', 'verified_resident'),
        validEvidenceBody,
        {},
      );
      assert.equal(httpStatus(out), 503);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(unauthenticatedFetchCalls, 0);
  assert.equal(missingAuth.selectCalls, 0);
  assert.equal(missingAuth.inserts.length, 0);
  const cases: Array<{
    path: '/api/v1/contribute/evidence' | '/api/v1/contribute/graph-edit';
    body: unknown;
    audit: typeof fetch;
  }> = [
    {
      path: '/api/v1/contribute/evidence',
      body: validEvidenceBody,
      audit: (async () => {
        throw new Error('audit offline');
      }) as typeof fetch,
    },
    {
      path: '/api/v1/contribute/evidence',
      body: validEvidenceBody,
      audit: ((_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            reject(new Error('audit request lacked timeout signal'));
            return;
          }
          const rejectOnAbort = () => reject(signal.reason ?? new Error('audit request aborted'));
          if (signal.aborted) rejectOnAbort();
          else signal.addEventListener('abort', rejectOnAbort, { once: true });
        })) as typeof fetch,
    },
    {
      path: '/api/v1/contribute/graph-edit',
      body: validGraphEditBody,
      audit: (async () => new Response(null, { status: 503 })) as typeof fetch,
    },
  ];

  for (const scenario of cases) {
    const state = queuedDb([]);
    await withAudit(scenario.audit, async () => {
      const route = contributionRoutes(state.db as never).find(
        (candidate) => candidate.method === 'POST' && candidate.path === scenario.path,
      );
      assert.ok(route);
      const out = await route.handler(
        reqWithActor('trusted-citizen', 'verified_resident'),
        scenario.body,
        {},
      );
      assert.equal(httpStatus(out), 503);
    });
    assert.equal(state.selectCalls, 0);
    assert.equal(state.inserts.length, 0);
    assert.equal(state.updates.length, 0);
  }
});

test('submission completion audit failures roll back every staged mutation', async () => {
  for (const scenario of [
    {
      path: '/api/v1/contribute/evidence',
      body: validEvidenceBody,
      fail: 'non_2xx',
    },
    {
      path: '/api/v1/contribute/graph-edit',
      body: validGraphEditBody,
      fail: 'throw',
    },
  ] as const) {
    const state = queuedDb([[]]);
    let auditCalls = 0;
    await withAudit(
      (async () => {
        auditCalls += 1;
        if (auditCalls === 1) return new Response(null, { status: 204 });
        if (scenario.fail === 'non_2xx') return new Response(null, { status: 503 });
        throw new Error('completion audit offline');
      }) as typeof fetch,
      async () => {
        const route = contributionRoutes(state.db as never).find(
          (candidate) => candidate.method === 'POST' && candidate.path === scenario.path,
        );
        assert.ok(route);
        const out = await route.handler(
          reqWithActor('trusted-citizen', 'verified_resident'),
          scenario.body,
          {},
        );
        assert.equal(httpStatus(out), 503);
      },
    );
    assert.equal(auditCalls, 2);
    assert.equal(state.inserts.length, 0);
    assert.equal(state.updates.length, 0);
    assert.equal(state.operations.length, 0);
  }
});

test('review completion audit failure rolls back review and status update', async () => {
  const submission = {
    id: 'submission-review-rollback',
    contributorId: 'contributor-1',
    type: 'evidence',
    status: 'pending',
    contributionClass: 'civic',
    payload: {},
    submittedAt: new Date('2026-01-01T00:00:00Z'),
    decidedAt: null,
  };
  const state = queuedDb([[activeReviewBinding], [submission], [activeReviewBinding]], {
    updateReturningRows: [
      [{ ...submission, status: 'in_review' }],
      [{ ...submission, status: 'rejected', decidedAt: new Date('2026-01-02T00:00:00Z') }],
    ],
  });
  let auditCalls = 0;
  await withAudit(
    (async () => {
      auditCalls += 1;
      return new Response(null, { status: auditCalls === 1 ? 204 : 503 });
    }) as typeof fetch,
    async () => {
      const route = contributionRoutes(state.db as never).find(
        (candidate) =>
          candidate.method === 'POST' && candidate.path === '/internal/review/:id/decide',
      );
      assert.ok(route);
      const out = await route.handler(
        reqWithActor('staff-reviewer', 'staff'),
        { decision: 'reject' },
        { id: submission.id },
      );
      assert.equal(httpStatus(out), 503);
    },
  );
  assert.equal(auditCalls, 2);
  assert.equal(state.inserts.length, 0);
  assert.equal(state.updates.length, 0);
  assert.equal(state.operations.length, 0);
});

test('approved review completion audit failure rolls back successful apply mutations', async () => {
  const submission = {
    id: 'submission-approved-completion-rollback',
    contributorId: 'contributor-1',
    type: 'evidence',
    status: 'pending',
    contributionClass: 'civic',
    payload: {
      text: 'Approved claim',
      claimType: 'other',
      subjectType: 'claim',
      subjectId: 'claim-1',
      confidence: 0.8,
    },
    submittedAt: new Date('2026-01-01T00:00:00Z'),
    decidedAt: null,
  };
  const state = queuedDb([[activeReviewBinding], [submission], [activeReviewBinding]], {
    updateReturningRows: [
      [{ ...submission, status: 'in_review' }],
      [{ ...submission, status: 'approved', decidedAt: new Date('2026-01-02T00:00:00Z') }],
    ],
  });
  const auditEvents: Array<Record<string, unknown>> = [];
  await withAudit(
    (async (_input, init) => {
      const event = JSON.parse(String(init?.body)) as Record<string, unknown>;
      auditEvents.push(event);
      return new Response(null, {
        status: event.eventType === 'contribution.approved' ? 503 : 204,
      });
    }) as typeof fetch,
    async () => {
      const route = contributionRoutes(state.db as never).find(
        (candidate) =>
          candidate.method === 'POST' && candidate.path === '/internal/review/:id/decide',
      );
      assert.ok(route);
      const out = await route.handler(
        reqWithActor('staff-reviewer', 'staff'),
        { decision: 'approve' },
        { id: submission.id },
      );
      assert.equal(httpStatus(out), 503);
    },
  );
  assert.deepEqual(
    auditEvents.map((event) => event.eventType),
    ['contribution.review_authorized', 'contribution.approved'],
  );
  assert.equal(state.insertAttempts, 2, 'review and claim inserts must succeed before audit');
  assert.equal(state.updateAttempts, 2, 'claim and terminal status updates must precede audit');
  assert.equal(state.inserts.length, 0);
  assert.equal(state.updates.length, 0);
  assert.equal(state.operations.length, 0);
});

test('review apply failure rolls back the decision and all apply mutations', async () => {
  const submission = {
    id: 'submission-apply-rollback',
    contributorId: 'contributor-1',
    type: 'evidence',
    status: 'pending',
    contributionClass: 'civic',
    payload: {
      text: 'Approved claim',
      claimType: 'other',
      subjectType: 'claim',
      subjectId: 'claim-1',
      confidence: 0.8,
    },
    submittedAt: new Date('2026-01-01T00:00:00Z'),
    decidedAt: null,
  };
  const state = queuedDb([[activeReviewBinding], [submission], [activeReviewBinding]], {
    insertAt: 2,
    updateReturningRows: [[{ ...submission, status: 'in_review' }]],
  });
  let auditCalls = 0;
  await withAudit(
    (async () => {
      auditCalls += 1;
      return new Response(null, { status: 204 });
    }) as typeof fetch,
    async () => {
      const route = contributionRoutes(state.db as never).find(
        (candidate) =>
          candidate.method === 'POST' && candidate.path === '/internal/review/:id/decide',
      );
      assert.ok(route);
      await assert.rejects(async () => {
        await route.handler(
          reqWithActor('staff-reviewer', 'staff'),
          { decision: 'approve' },
          { id: submission.id },
        );
      }, /injected insert failure/);
    },
  );
  assert.equal(auditCalls, 1);
  assert.equal(state.inserts.length, 0);
  assert.equal(state.updates.length, 0);
  assert.equal(state.operations.length, 0);
});

test('review queue requires staff with a current review_contribution binding', async () => {
  const baseRoute = (db: unknown) => {
    const route = contributionRoutes(db as never).find(
      (candidate) => candidate.method === 'GET' && candidate.path === '/internal/review/queue',
    );
    assert.ok(route);
    return route;
  };

  const missingActor = queuedDb([]);
  assert.equal(
    httpStatus(await baseRoute(missingActor.db).handler({ headers: {} } as never, {}, {})),
    401,
  );
  assert.equal(missingActor.selectCalls, 0);

  const nonStaff = queuedDb([]);
  assert.equal(
    httpStatus(
      await baseRoute(nonStaff.db).handler(reqWithActor('citizen-1', 'verified_resident'), {}, {}),
    ),
    403,
  );
  assert.equal(nonStaff.selectCalls, 0);

  for (const rows of [
    [],
    [{ ...activeReviewBinding, status: 'inactive' }],
    [{ ...activeReviewBinding, endsAt: new Date('2025-02-01T00:00:00Z') }],
    [{ ...activeReviewBinding, decisionRightName: 'decide_complaint' }],
    [
      {
        status: 'active',
        startsAt: new Date('2025-01-01T00:00:00Z'),
        endsAt: null,
        decisionRights: ['review_contribution'],
      },
    ],
  ]) {
    const denied = queuedDb([rows]);
    const out = await baseRoute(denied.db).handler(reqWithActor('staff-reviewer', 'staff'), {}, {});
    assert.equal(httpStatus(out), 403);
    assert.equal(denied.inserts.length, 0);
    assert.equal(denied.updates.length, 0);
  }
  const authorized = queuedDb([[activeReviewBinding], []]);
  const out = await baseRoute(authorized.db).handler(
    reqWithActor('staff-reviewer', 'staff'),
    {},
    {},
  );
  assert.deepEqual(out, { items: [] });
});

test('review decide rejects body authority and self-review before audit or mutation', async () => {
  const forged = queuedDb([[activeReviewBinding]]);
  const forgedRoute = contributionRoutes(forged.db as never).find(
    (route) => route.method === 'POST' && route.path === '/internal/review/:id/decide',
  );
  assert.ok(forgedRoute);
  for (const body of [
    { decision: 'approve', reviewerId: 'forged-reviewer' },
    { decision: 'approve', reviewerRole: 'reviewer' },
  ]) {
    const out = await forgedRoute.handler(reqWithActor('staff-reviewer', 'staff'), body, {
      id: 'submission-1',
    });
    assert.equal(httpStatus(out), 400);
  }
  assert.equal(forged.selectCalls, 0);
  assert.equal(forged.inserts.length, 0);

  const selfSubmission = {
    id: 'submission-self',
    contributorId: 'staff-reviewer',
    type: 'evidence',
    status: 'pending',
    contributionClass: 'civic',
    payload: {},
    submittedAt: new Date('2026-01-01T00:00:00Z'),
    decidedAt: null,
  };
  const self = queuedDb([[activeReviewBinding], [selfSubmission]]);
  let auditCalls = 0;
  await withAudit(
    (async () => {
      auditCalls += 1;
      return new Response(null, { status: 204 });
    }) as typeof fetch,
    async () => {
      const route = contributionRoutes(self.db as never).find(
        (candidate) =>
          candidate.method === 'POST' && candidate.path === '/internal/review/:id/decide',
      );
      assert.ok(route);
      const out = await route.handler(
        reqWithActor('staff-reviewer', 'staff'),
        { decision: 'approve' },
        { id: 'submission-self' },
      );
      assert.equal(httpStatus(out), 403);
    },
  );
  assert.equal(auditCalls, 0);
  assert.equal(self.inserts.length, 0);
  assert.equal(self.updates.length, 0);
});

test('review decide returns existing conflict when the pending claim loses the race', async () => {
  const submission = {
    id: 'submission-race-loser',
    contributorId: 'contributor-1',
    type: 'evidence',
    status: 'pending',
    contributionClass: 'civic',
    payload: {},
    submittedAt: new Date('2026-01-01T00:00:00Z'),
    decidedAt: null,
  };
  const state = queuedDb([[activeReviewBinding], [submission], [activeReviewBinding]], {
    updateReturningRows: [[]],
  });
  let auditCalls = 0;
  await withAudit(
    (async () => {
      auditCalls += 1;
      return new Response(null, { status: 204 });
    }) as typeof fetch,
    async () => {
      const route = contributionRoutes(state.db as never).find(
        (candidate) =>
          candidate.method === 'POST' && candidate.path === '/internal/review/:id/decide',
      );
      assert.ok(route);
      const out = await route.handler(
        reqWithActor('staff-reviewer', 'staff'),
        { decision: 'approve' },
        { id: submission.id },
      );
      assert.equal(httpStatus(out), 409);
      assert.ok(out && typeof out === 'object' && 'body' in out);
      assert.deepEqual(out.body, { error: 'already_decided' });
    },
  );
  assert.equal(auditCalls, 0);
  assert.equal(state.insertAttempts, 0);
  assert.equal(state.updateAttempts, 1);
  assert.equal(state.inserts.length, 0);
  assert.equal(state.updates.length, 0);
  assert.equal(state.operations.length, 0);
});

test('review decide rechecks authority and self-review inside the transaction', async () => {
  const submission = {
    id: 'submission-transaction-checks',
    contributorId: 'contributor-1',
    type: 'evidence',
    status: 'pending',
    contributionClass: 'civic',
    payload: {},
    submittedAt: new Date('2026-01-01T00:00:00Z'),
    decidedAt: null,
  };
  let auditCalls = 0;
  await withAudit(
    (async () => {
      auditCalls += 1;
      return new Response(null, { status: 204 });
    }) as typeof fetch,
    async () => {
      const revoked = queuedDb([[activeReviewBinding], [submission], []]);
      const revokedRoute = contributionRoutes(revoked.db as never).find(
        (candidate) =>
          candidate.method === 'POST' && candidate.path === '/internal/review/:id/decide',
      );
      assert.ok(revokedRoute);
      const revokedOut = await revokedRoute.handler(
        reqWithActor('staff-reviewer', 'staff'),
        { decision: 'approve' },
        { id: submission.id },
      );
      assert.equal(httpStatus(revokedOut), 403);
      assert.ok(revokedOut && typeof revokedOut === 'object' && 'body' in revokedOut);
      assert.deepEqual(revokedOut.body, { error: 'review_authority_required' });
      assert.equal(revoked.updateAttempts, 0, 'transaction authority must precede the claim');
      assert.equal(revoked.inserts.length, 0);
      assert.equal(revoked.updates.length, 0);

      const self = queuedDb([[activeReviewBinding], [submission], [activeReviewBinding]], {
        updateReturningRows: [
          [{ ...submission, contributorId: 'staff-reviewer', status: 'in_review' }],
        ],
      });
      const selfRoute = contributionRoutes(self.db as never).find(
        (candidate) =>
          candidate.method === 'POST' && candidate.path === '/internal/review/:id/decide',
      );
      assert.ok(selfRoute);
      const selfOut = await selfRoute.handler(
        reqWithActor('staff-reviewer', 'staff'),
        { decision: 'approve' },
        { id: submission.id },
      );
      assert.equal(httpStatus(selfOut), 403);
      assert.ok(selfOut && typeof selfOut === 'object' && 'body' in selfOut);
      assert.deepEqual(selfOut.body, { error: 'self_review_forbidden' });
      assert.equal(self.updateAttempts, 1);
      assert.equal(self.insertAttempts, 0);
      assert.equal(self.inserts.length, 0);
      assert.equal(self.updates.length, 0);
      assert.equal(self.operations.length, 0);
    },
  );
  assert.equal(auditCalls, 0);
});

test('review audit failure returns 503 and distinct authorized reviewer can decide', async () => {
  const submission = {
    id: 'submission-1',
    contributorId: 'contributor-1',
    type: 'evidence',
    status: 'pending',
    contributionClass: 'political_agreement',
    payload: {},
    submittedAt: new Date('2026-01-01T00:00:00Z'),
    decidedAt: null,
  };
  const unavailable = queuedDb([[activeReviewBinding], [submission], [activeReviewBinding]], {
    updateReturningRows: [[{ ...submission, status: 'in_review' }]],
  });
  await withAudit(
    (async () => {
      throw new Error('audit offline');
    }) as typeof fetch,
    async () => {
      const route = contributionRoutes(unavailable.db as never).find(
        (candidate) =>
          candidate.method === 'POST' && candidate.path === '/internal/review/:id/decide',
      );
      assert.ok(route);
      const out = await route.handler(
        reqWithActor('staff-reviewer', 'staff'),
        { decision: 'approve' },
        { id: 'submission-1' },
      );
      assert.equal(httpStatus(out), 503);
    },
  );
  assert.equal(unavailable.inserts.length, 0);
  assert.equal(unavailable.updates.length, 0);

  const updated = {
    ...submission,
    status: 'approved',
    decidedAt: new Date('2026-01-02T00:00:00Z'),
  };
  const authorized = queuedDb([[activeReviewBinding], [submission], [activeReviewBinding]], {
    updateReturningRows: [[{ ...submission, status: 'in_review' }], [updated]],
  });
  const auditEvents: Array<Record<string, unknown>> = [];
  await withAudit(
    (async (_input, init) => {
      auditEvents.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(null, { status: 204 });
    }) as typeof fetch,
    async () => {
      const route = contributionRoutes(authorized.db as never).find(
        (candidate) =>
          candidate.method === 'POST' && candidate.path === '/internal/review/:id/decide',
      );
      assert.ok(route);
      const out = await route.handler(
        reqWithActor('staff-reviewer', 'staff'),
        { decision: 'approve', notes: 'checked' },
        { id: 'submission-1' },
      );
      assert.equal(httpStatus(out), 201);
    },
  );
  const reviewInsert = authorized.inserts.find((entry) => {
    const values = entry.values;
    return values !== null && typeof values === 'object' && 'decision' in values;
  });
  assert.ok(reviewInsert);
  const reviewValues = reviewInsert.values;
  assert.ok(
    reviewValues !== null &&
      typeof reviewValues === 'object' &&
      'reviewerId' in reviewValues &&
      typeof reviewValues.reviewerId === 'string',
  );
  assert.equal(reviewValues.reviewerId, 'staff-reviewer');
  const preflight = auditEvents.find(
    (event) => event.eventType === 'contribution.review_authorized',
  );
  assert.ok(preflight);
  assert.equal(preflight.visibility, 'restricted');
  assert.equal(preflight.action, 'review_authorized');
  const completion = auditEvents.find((event) => event.eventType === 'contribution.approved');
  assert.ok(completion);
  assert.equal(completion.visibility, 'restricted');
  const completionData = completion.data;
  assert.ok(
    completionData !== null &&
      typeof completionData === 'object' &&
      'decision' in completionData &&
      'applied' in completionData,
  );
  assert.equal(completionData.decision, 'approved');
  assert.equal(completionData.applied, false);
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
  const { db, inserts, updates, operations } = queuedDb(
    [[activeReviewBinding], [resolutionSubmission], [activeReviewBinding]],
    {
      updateReturningRows: [
        [{ ...resolutionSubmission, status: 'in_review' }],
        [updatedSubmission],
      ],
    },
  );
  const auditEvents: Array<Record<string, unknown>> = [];
  await withAudit(
    (async (_input, init) => {
      const event = JSON.parse(String(init?.body)) as Record<string, unknown>;
      auditEvents.push(event);
      if (event.eventType === 'representative.commitment.status_changed') {
        assert.ok(inserts.length > 0, 'status audit must run only after transaction commit');
      }
      return new Response(null, { status: 204 });
    }) as typeof fetch,
    async () => {
      const route = contributionRoutes(db as never).find(
        (candidate) =>
          candidate.method === 'POST' && candidate.path === '/internal/review/:id/decide',
      );
      assert.ok(route);
      const out = await route.handler(
        reqWithActor('staff-reviewer', 'staff'),
        { decision: 'approve' },
        { id: 'submission-resolution-1' },
      );
      assert.equal(httpStatus(out), 201);
    },
  );
  const reviewInsert = inserts.find((entry) => {
    const values = entry.values;
    return values !== null && typeof values === 'object' && 'decision' in values;
  });
  assert.ok(reviewInsert);
  const reviewValues = reviewInsert.values;
  assert.ok(
    reviewValues !== null &&
      typeof reviewValues === 'object' &&
      'reviewerId' in reviewValues &&
      typeof reviewValues.reviewerId === 'string',
  );
  assert.equal(reviewValues.reviewerId, 'staff-reviewer');
  assert.deepEqual(
    auditEvents.map((event) => event.eventType),
    [
      'contribution.review_authorized',
      'contribution.approved',
      'representative.commitment.status_changed',
    ],
  );
  const statusAudit = auditEvents[2];
  assert.deepEqual(statusAudit?.target, {
    type: 'commitment-status-event',
    id: 'status-event-2',
  });
  assert.ok(
    inserts.some((entry) => {
      const values = entry.values as {
        commitmentId?: string;
        status?: string;
        resolutionClaimId?: string;
      };
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
