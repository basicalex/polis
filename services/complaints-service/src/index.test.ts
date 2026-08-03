import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { schema } from '@polis/db';
import { startService } from '@polis/service-runtime';

import { canComplaintTransition, complaintRoutes, databaseReadiness } from './index.js';
import { complaintDetailWire, complaintSummaryWire } from './serialize.js';

const fixedDate = new Date('2026-01-01T00:00:00.000Z');

const complaintRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'complaint-1',
  caseNumber: 'CMP-2026-0001',
  residentCitizenId: 'resident-1',
  institutionId: 'inst-complaints-office',
  processId: 'process-citizen-service-complaint',
  jurisdictionId: 'jur-croatia-local',
  subject: 'Missed waste collection',
  narrative: 'Private complaint narrative',
  status: 'assigned',
  assignedMandateHolderId: 'holder-initial',
  createdAt: fixedDate,
  updatedAt: fixedDate,
  closedAt: null,
  auditCorrelationId: 'correlation-1',
  ...overrides,
});

const staffRow = (rights: string[], overrides: Record<string, unknown> = {}) => ({
  id: 'holder-initial',
  citizenId: 'officer-1',
  roleId: 'role-initial',
  jurisdictionId: 'jur-croatia-local',
  status: 'active',
  startsAt: new Date('2025-01-01T00:00:00.000Z'),
  endsAt: null,
  institutionId: 'inst-complaints-office',
  decisionRights: rights,
  ...overrides,
});

const informationRequestRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'request-1',
  complaintId: 'complaint-1',
  requestedBy: 'holder-intake',
  question: 'Private evidence question',
  dueAt: new Date('2026-09-01T00:00:00.000Z'),
  respondedBy: null,
  response: null,
  respondedAt: null,
  createdAt: fixedDate,
  ...overrides,
});

const decisionRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'decision-initial',
  complaintId: 'complaint-1',
  appealId: null,
  kind: 'initial',
  outcome: 'upheld',
  reason: 'Private decision reason',
  decidedBy: 'holder-initial',
  decidedAt: fixedDate,
  auditCorrelationId: 'correlation-1',
  ...overrides,
});

const appealRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'appeal-1',
  complaintId: 'complaint-1',
  residentCitizenId: 'resident-1',
  initialDecisionId: 'decision-initial',
  grounds: 'Private appeal grounds',
  status: 'filed',
  filedAt: fixedDate,
  decidedAt: null,
  ...overrides,
});

const actorRequest = (citizenId: string, identityLevel: string): IncomingMessage =>
  ({
    headers: {
      'x-polis-citizen': citizenId,
      'x-polis-identity-level': identityLevel,
      'x-correlation-id': 'request-correlation',
    },
  }) as unknown as IncomingMessage;

const httpStatus = (value: unknown): number | undefined => {
  if (value && typeof value === 'object' && 'status' in value && typeof value.status === 'number') {
    return value.status;
  }
  return undefined;
};

const httpBody = (value: unknown): unknown => {
  if (value && typeof value === 'object' && 'body' in value) return value.body;
  return undefined;
};

type RecordedWrite = { table: unknown; values: Record<string, unknown> };

function scriptedDb(selectRows: unknown[][] = [], initialComplaint = complaintRow()) {
  const inserts: RecordedWrite[] = [];
  const updates: RecordedWrite[] = [];
  let transactions = 0;
  let currentComplaint = { ...initialComplaint };
  let currentRequest = informationRequestRow();
  const rows = [...selectRows];
  const nextRows = () => rows.shift() ?? [];
  const query = (selectedRows: unknown[]) => {
    const chain = {
      from: (_table?: unknown) => chain,
      innerJoin: (_table?: unknown, _condition?: unknown) => chain,
      where: (_condition?: unknown) => chain,
      orderBy: (..._order: unknown[]) => chain,
      limit: (_limit?: number) => chain,
      for: (_strength?: string) => chain,
      then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(selectedRows).then(resolve, reject),
    };
    return chain;
  };
  const returnedInsert = (table: unknown, values: Record<string, unknown>) => {
    if (table === schema.complaintCases) {
      currentComplaint = {
        ...complaintRow({
          status: 'submitted',
          assignedMandateHolderId: null,
          auditCorrelationId: null,
        }),
        ...values,
        createdAt: fixedDate,
        updatedAt: fixedDate,
        closedAt: null,
      };
      return currentComplaint;
    }
    if (table === schema.complaintInformationRequests) {
      currentRequest = {
        ...informationRequestRow({ respondedBy: null, response: null, respondedAt: null }),
        ...values,
        createdAt: fixedDate,
      };
      return currentRequest;
    }
    if (table === schema.complaintDecisions) {
      return {
        ...decisionRow({ appealId: null }),
        ...values,
        decidedAt: values.decidedAt instanceof Date ? values.decidedAt : fixedDate,
      };
    }
    if (table === schema.complaintAppeals) {
      return { ...appealRow(), ...values, status: 'filed', filedAt: fixedDate, decidedAt: null };
    }
    return { ...values };
  };
  const db = {
    select: (_selection?: unknown) => query(nextRows()),
    insert: (table: unknown) => ({
      values: (rawValues: unknown) => {
        assert.ok(rawValues && typeof rawValues === 'object' && !Array.isArray(rawValues));
        const values = rawValues as Record<string, unknown>;
        inserts.push({ table, values });
        const returned = returnedInsert(table, values);
        return { returning: async () => [returned] };
      },
    }),
    update: (table: unknown) => ({
      set: (rawValues: unknown) => {
        assert.ok(rawValues && typeof rawValues === 'object' && !Array.isArray(rawValues));
        const values = rawValues as Record<string, unknown>;
        updates.push({ table, values });
        if (table === schema.complaintCases) currentComplaint = { ...currentComplaint, ...values };
        if (table === schema.complaintInformationRequests)
          currentRequest = { ...currentRequest, ...values };
        const returned = table === schema.complaintCases ? currentComplaint : currentRequest;
        const updateQuery = {
          where: (_condition?: unknown) => updateQuery,
          returning: async () => [returned],
          then: (resolve: (value: undefined) => unknown, reject?: (reason: unknown) => unknown) =>
            Promise.resolve(undefined).then(resolve, reject),
        };
        return updateQuery;
      },
    }),
    transaction: async <T>(run: (tx: unknown) => Promise<T>): Promise<T> => {
      transactions += 1;
      return run(db);
    },
  };
  return {
    db,
    inserts,
    updates,
    get transactions() {
      return transactions;
    },
  };
}

const findRoute = (db: unknown, method: string, path: string) => {
  const route = complaintRoutes(db as never).find(
    (candidate) => candidate.method === method && candidate.path === path,
  );
  assert.ok(route, `missing ${method} ${path}`);
  return route;
};

async function captureAudit(run: () => Promise<unknown>): Promise<{
  output: unknown;
  requests: Array<{ url: string; body: Record<string, unknown> }>;
}> {
  const previousToken = process.env.INTERNAL_API_TOKEN;
  const previousFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  process.env.INTERNAL_API_TOKEN = 'complaints-test-token';
  globalThis.fetch = async (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const requestBody = init?.body;
    assert.equal(typeof requestBody, 'string');
    if (typeof requestBody !== 'string') throw new TypeError('audit body must be JSON');
    const parsed: unknown = JSON.parse(requestBody);
    assert.ok(parsed && typeof parsed === 'object' && !Array.isArray(parsed));
    requests.push({ url: raw, body: { ...parsed } });
    return new Response('{}', { status: 201 });
  };
  try {
    return { output: await run(), requests };
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = previousToken;
  }
}

test('complaints-service exposes only the required internal complaint routes in safe order', () => {
  const paths = complaintRoutes({} as never).map((route) => `${route.method} ${route.path}`);
  const required = [
    'POST /internal/complaints',
    'GET /internal/complaints/mine',
    'GET /internal/complaints/:id',
    'GET /internal/complaints/queue',
    'POST /internal/complaints/:id/assign',
    'POST /internal/complaints/:id/information-requests',
    'POST /internal/complaints/:id/information-requests/:requestId/respond',
    'POST /internal/complaints/:id/decisions',
    'POST /internal/complaints/:id/appeals',
    'POST /internal/complaints/:id/appeals/:appealId/decisions',
    'POST /internal/complaints/:id/close',
  ];
  for (const path of required) assert.ok(paths.includes(path), `missing ${path}`);
  assert.ok(
    paths.indexOf('GET /internal/complaints/mine') < paths.indexOf('GET /internal/complaints/:id'),
  );
  assert.ok(
    paths.indexOf('GET /internal/complaints/queue') < paths.indexOf('GET /internal/complaints/:id'),
  );
  assert.equal(
    paths.some((path) => path.includes('/api/v1/complaints')),
    false,
  );
});

test('complaint internal HTTP routes reject a missing service token', async () => {
  const previous = process.env.INTERNAL_API_TOKEN;
  process.env.INTERNAL_API_TOKEN = 'complaints-http-token';
  const server = startService('complaints-service', 0, complaintRoutes({} as never));
  try {
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/internal/complaints/mine`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: 'internal_auth_required',
      service: 'complaints-service',
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    if (previous === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = previous;
  }
});

test('complaints-service readiness reports only database failures', async () => {
  assert.deepEqual(await databaseReadiness(async () => undefined), { ready: true });
  assert.deepEqual(
    await databaseReadiness(async () => {
      throw new Error('postgres://credentials@db.internal/polis');
    }),
    { ready: false, dependency: 'database' },
  );
});

test('complaint transition matrix permits only schema lifecycle edges', () => {
  const statuses = [
    'submitted',
    'assigned',
    'awaiting_information',
    'decided',
    'appealed',
    'closed',
  ] as const;
  const allowed: Record<string, true> = {
    'submitted:assigned': true,
    'assigned:awaiting_information': true,
    'awaiting_information:assigned': true,
    'assigned:decided': true,
    'decided:appealed': true,
    'decided:closed': true,
    'appealed:closed': true,
  };
  for (const from of statuses) {
    for (const to of statuses) {
      assert.equal(
        canComplaintTransition(from, to),
        `${from}:${to}` in allowed,
        `${from} -> ${to}`,
      );
    }
  }
});

test('serializers expose private case content only in detail and strip internal ownership metadata', () => {
  const row = complaintRow({
    residentCitizenId: 'resident-secret',
    auditCorrelationId: 'audit-secret',
  });
  const summary = complaintSummaryWire(row as never);
  assert.equal('narrative' in summary, false);
  assert.equal('residentCitizenId' in summary, false);
  assert.equal('auditCorrelationId' in summary, false);
  const detail = complaintDetailWire(row as never, [], [], null, []);
  assert.equal(detail.narrative, 'Private complaint narrative');
  assert.equal('residentCitizenId' in detail, false);
  assert.equal('auditCorrelationId' in detail, false);
});

test('resident creation fixes ownership and scope from trusted headers and keeps audit/event payloads safe', async () => {
  const state = scriptedDb();
  const route = findRoute(state.db, 'POST', '/internal/complaints');
  const privateText = 'Private narrative never leaves the complaint record';
  const { output, requests } = await captureAudit(async () =>
    route.handler(
      actorRequest('resident-1', 'verified_resident'),
      {
        subject: '  Missed collection  ',
        narrative: `  ${privateText}  `,
        residentCitizenId: 'forged-resident',
        jurisdictionId: 'forged-jurisdiction',
      },
      {},
    ),
  );
  assert.equal(httpStatus(output), 201);
  assert.equal(state.transactions, 1);
  const caseInsert = state.inserts.find((write) => write.table === schema.complaintCases);
  assert.ok(caseInsert);
  assert.equal(caseInsert.values.residentCitizenId, 'resident-1');
  assert.equal(caseInsert.values.jurisdictionId, 'jur-croatia-local');
  assert.equal(caseInsert.values.institutionId, 'inst-complaints-office');
  assert.equal(caseInsert.values.processId, 'process-citizen-service-complaint');
  assert.equal(caseInsert.values.narrative, privateText);
  const eventInsert = state.inserts.find((write) => write.table === schema.complaintCaseEvents);
  assert.ok(eventInsert);
  assert.deepEqual(eventInsert.values.data, {});
  assert.equal(JSON.stringify(eventInsert.values).includes(privateText), false);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.visibility, 'restricted');
  assert.equal(JSON.stringify(requests[0].body).includes(privateText), false);
  assert.equal(JSON.stringify(requests[0].body).includes('forged-resident'), false);
});

test('creation rejects unverified actors and bounded-text violations before a transaction', async () => {
  for (const [identityLevel, body] of [
    ['staff', { subject: 'Valid', narrative: 'Valid' }],
    ['verified_resident', { subject: ' ', narrative: 'Valid' }],
    ['verified_official', { subject: 'x'.repeat(201), narrative: 'Valid' }],
  ] as const) {
    const state = scriptedDb();
    const route = findRoute(state.db, 'POST', '/internal/complaints');
    const output = await route.handler(actorRequest('resident-1', identityLevel), body, {});
    assert.ok([400, 403].includes(httpStatus(output) ?? 0));
    assert.equal(state.transactions, 0);
  }
});

test('detail enforces resident ownership and denies plain staff without an active reader binding', async () => {
  const ownerMismatch = scriptedDb([[complaintRow()], []]);
  const detail = findRoute(ownerMismatch.db, 'GET', '/internal/complaints/:id');
  const deniedOwner = await detail.handler(
    actorRequest('resident-2', 'verified_resident'),
    {},
    { id: 'complaint-1' },
  );
  assert.equal(httpStatus(deniedOwner), 403);

  const plainStaff = scriptedDb([[complaintRow()], []]);
  const deniedStaff = await findRoute(plainStaff.db, 'GET', '/internal/complaints/:id').handler(
    actorRequest('plain-staff', 'staff'),
    {},
    { id: 'complaint-1' },
  );
  assert.equal(httpStatus(deniedStaff), 403);
});

test('queue access accepts decision, intake, and evidence reader rights in the fixed jurisdiction', async () => {
  const cases: Array<[unknown[], number]> = [
    [[staffRow(['decide_complaint'])], 200],
    [[staffRow(['decide_complaint_appeal'])], 200],
    [[staffRow(['route_case_to_sector_office'])], 200],
    [[staffRow(['request_missing_identity_or_residence_evidence'])], 200],
    [[staffRow([])], 403],
    [[staffRow(['route_case_to_sector_office'], { jurisdictionId: 'jur-other' })], 403],
    [[staffRow(['request_missing_identity_or_residence_evidence'], { status: 'ended' })], 403],
    [[], 403],
  ];
  for (const [bindings, expected] of cases) {
    const selections = expected === 200 ? [bindings, []] : [bindings];
    const state = scriptedDb(selections);
    const output = await findRoute(state.db, 'GET', '/internal/complaints/queue').handler(
      actorRequest('officer-1', 'staff'),
      {},
      {},
    );
    assert.equal(httpStatus(output) ?? 200, expected);
  }
});

test('detail access accepts intake and evidence reader rights in the fixed jurisdiction', async () => {
  for (const right of [
    'route_case_to_sector_office',
    'request_missing_identity_or_residence_evidence',
  ]) {
    const state = scriptedDb([[complaintRow()], [staffRow([right])], [], [], [], []]);
    const output = await findRoute(state.db, 'GET', '/internal/complaints/:id').handler(
      actorRequest('officer-1', 'staff'),
      {},
      { id: 'complaint-1' },
    );
    assert.equal(httpStatus(output) ?? 200, 200);
    const detail = output as { narrative?: unknown };
    assert.equal(detail.narrative, 'Private complaint narrative');
  }
});

test('assignment validates intake authority, target role, and jurisdiction inside one transaction', async () => {
  const intake = staffRow(['route_case_to_sector_office'], {
    id: 'holder-intake',
    citizenId: 'intake-officer',
  });
  const target = staffRow(['decide_complaint']);
  const state = scriptedDb([
    [intake],
    [target],
    [complaintRow({ status: 'submitted', assignedMandateHolderId: null })],
  ]);
  const route = findRoute(state.db, 'POST', '/internal/complaints/:id/assign');
  const { output } = await captureAudit(async () =>
    route.handler(
      actorRequest('intake-officer', 'staff'),
      { assignedMandateHolderId: 'holder-initial', actorId: 'forged-actor' },
      { id: 'complaint-1' },
    ),
  );
  assert.equal(httpStatus(output), 200);
  assert.equal(state.transactions, 1);
  const event = state.inserts.find((write) => write.table === schema.complaintCaseEvents);
  assert.ok(event);
  assert.equal(event.values.actorId, 'intake-officer');
  assert.deepEqual(event.values.data, { assignedMandateHolderId: 'holder-initial' });

  for (const targetRows of [
    [staffRow([], { id: 'holder-target' })],
    [staffRow(['decide_complaint'], { id: 'holder-target', jurisdictionId: 'jur-other' })],
    [staffRow(['decide_complaint'], { id: 'holder-target', status: 'ended' })],
  ]) {
    const invalid = scriptedDb([[intake], targetRows]);
    const denied = await findRoute(invalid.db, 'POST', '/internal/complaints/:id/assign').handler(
      actorRequest('intake-officer', 'staff'),
      { assignedMandateHolderId: 'holder-target' },
      { id: 'complaint-1' },
    );
    assert.equal(httpStatus(denied), 400);
  }
});

test('information requests require the right, allow only one unanswered request, and never audit the question', async () => {
  const intake = staffRow(['request_missing_identity_or_residence_evidence'], {
    id: 'holder-intake',
    citizenId: 'intake-officer',
  });
  const pending = scriptedDb([[intake], [complaintRow()], [{ id: 'existing-request' }]]);
  const pendingOutput = await findRoute(
    pending.db,
    'POST',
    '/internal/complaints/:id/information-requests',
  ).handler(
    actorRequest('intake-officer', 'staff'),
    { question: 'Sensitive question' },
    { id: 'complaint-1' },
  );
  assert.equal(httpStatus(pendingOutput), 409);

  const state = scriptedDb([[intake], [complaintRow()], []]);
  const privateQuestion = 'Sensitive proof request';
  const { output, requests } = await captureAudit(async () =>
    findRoute(state.db, 'POST', '/internal/complaints/:id/information-requests').handler(
      actorRequest('intake-officer', 'staff'),
      { question: privateQuestion, dueAt: '2026-09-01T00:00:00.000Z' },
      { id: 'complaint-1' },
    ),
  );
  assert.equal(httpStatus(output), 201);
  const event = state.inserts.find((write) => write.table === schema.complaintCaseEvents);
  assert.ok(event);
  assert.equal(JSON.stringify(event.values).includes(privateQuestion), false);
  assert.equal(JSON.stringify(requests[0].body).includes(privateQuestion), false);
  assert.deepEqual(Object.keys(event.values.data as object).sort(), [
    'dueAt',
    'informationRequestId',
  ]);
});

test('information response requires the owning resident and preserves the assigned holder', async () => {
  const denied = scriptedDb([[complaintRow({ status: 'awaiting_information' })]]);
  const route = findRoute(
    denied.db,
    'POST',
    '/internal/complaints/:id/information-requests/:requestId/respond',
  );
  const deniedOutput = await route.handler(
    actorRequest('resident-2', 'verified_resident'),
    { response: 'Private response' },
    { id: 'complaint-1', requestId: 'request-1' },
  );
  assert.equal(httpStatus(deniedOutput), 403);

  const state = scriptedDb([
    [complaintRow({ status: 'awaiting_information', assignedMandateHolderId: 'holder-initial' })],
    [informationRequestRow()],
  ]);
  const { output, requests } = await captureAudit(async () =>
    findRoute(
      state.db,
      'POST',
      '/internal/complaints/:id/information-requests/:requestId/respond',
    ).handler(
      actorRequest('resident-1', 'verified_resident'),
      { response: 'Private resident response', respondedBy: 'forged-resident' },
      { id: 'complaint-1', requestId: 'request-1' },
    ),
  );
  assert.equal(httpStatus(output), 200);
  const requestUpdate = state.updates.find(
    (write) => write.table === schema.complaintInformationRequests,
  );
  assert.ok(requestUpdate);
  assert.equal(requestUpdate.values.respondedBy, 'resident-1');
  const caseUpdate = state.updates.find((write) => write.table === schema.complaintCases);
  assert.ok(caseUpdate);
  assert.equal('assignedMandateHolderId' in caseUpdate.values, false);
  assert.equal(JSON.stringify(requests[0].body).includes('Private resident response'), false);
});

test('initial decision requires assignment, no pending request, one decision, and the assigned authorized holder', async () => {
  const officer = staffRow(['decide_complaint']);
  const routePath = '/internal/complaints/:id/decisions';
  const submitted = scriptedDb([[officer], [complaintRow({ status: 'submitted' })]]);
  assert.equal(
    httpStatus(
      await findRoute(submitted.db, 'POST', routePath).handler(
        actorRequest('officer-1', 'staff'),
        { outcome: 'upheld', reason: 'Private reason' },
        { id: 'complaint-1' },
      ),
    ),
    409,
  );
  const pending = scriptedDb([[officer], [complaintRow()], [{ id: 'request-1' }], []]);
  assert.equal(
    httpStatus(
      await findRoute(pending.db, 'POST', routePath).handler(
        actorRequest('officer-1', 'staff'),
        { outcome: 'upheld', reason: 'Private reason' },
        { id: 'complaint-1' },
      ),
    ),
    409,
  );
  const duplicate = scriptedDb([[officer], [complaintRow()], [], [{ id: 'decision-initial' }]]);
  assert.equal(
    httpStatus(
      await findRoute(duplicate.db, 'POST', routePath).handler(
        actorRequest('officer-1', 'staff'),
        { outcome: 'upheld', reason: 'Private reason' },
        { id: 'complaint-1' },
      ),
    ),
    409,
  );

  const state = scriptedDb([[officer], [complaintRow()], [], []]);
  const privateReason = 'Private initial rationale';
  const { output, requests } = await captureAudit(async () =>
    findRoute(state.db, 'POST', routePath).handler(
      actorRequest('officer-1', 'staff'),
      { outcome: 'partially_upheld', reason: privateReason, decidedBy: 'forged-holder' },
      { id: 'complaint-1' },
    ),
  );
  assert.equal(httpStatus(output), 201);
  const decision = state.inserts.find((write) => write.table === schema.complaintDecisions);
  assert.ok(decision);
  assert.equal(decision.values.decidedBy, 'holder-initial');
  const event = state.inserts.find((write) => write.table === schema.complaintCaseEvents);
  assert.ok(event);
  assert.equal(JSON.stringify(event.values).includes(privateReason), false);
  assert.equal(JSON.stringify(requests[0].body).includes(privateReason), false);
});

test('appeal requires ownership, an initial decision, and no existing appeal', async () => {
  const path = '/internal/complaints/:id/appeals';
  const mismatch = scriptedDb([[complaintRow({ status: 'decided' })]]);
  assert.equal(
    httpStatus(
      await findRoute(mismatch.db, 'POST', path).handler(
        actorRequest('resident-2', 'verified_resident'),
        { grounds: 'Private grounds' },
        { id: 'complaint-1' },
      ),
    ),
    403,
  );
  const duplicate = scriptedDb([
    [complaintRow({ status: 'decided' })],
    [decisionRow()],
    [{ id: 'appeal-existing' }],
  ]);
  assert.equal(
    httpStatus(
      await findRoute(duplicate.db, 'POST', path).handler(
        actorRequest('resident-1', 'verified_resident'),
        { grounds: 'Private grounds' },
        { id: 'complaint-1' },
      ),
    ),
    409,
  );
});

test('appeal decision enforces distinct citizen and holder and closes the case atomically', async () => {
  const path = '/internal/complaints/:id/appeals/:appealId/decisions';
  const appealOfficer = staffRow(['decide_complaint_appeal'], {
    id: 'holder-appeal',
    citizenId: 'appeal-officer',
  });
  const sameCitizen = scriptedDb([
    [appealOfficer],
    [complaintRow({ status: 'appealed' })],
    [appealRow()],
    [decisionRow()],
    [],
    [{ citizenId: 'appeal-officer' }],
  ]);
  const denied = await findRoute(sameCitizen.db, 'POST', path).handler(
    actorRequest('appeal-officer', 'staff'),
    { outcome: 'dismissed', reason: 'Private appeal reason' },
    { id: 'complaint-1', appealId: 'appeal-1' },
  );
  assert.equal(httpStatus(denied), 403);

  const state = scriptedDb([
    [appealOfficer],
    [complaintRow({ status: 'appealed' })],
    [appealRow()],
    [decisionRow()],
    [],
    [{ citizenId: 'officer-1' }],
  ]);
  const privateReason = 'Private final appeal rationale';
  const { output, requests } = await captureAudit(async () =>
    findRoute(state.db, 'POST', path).handler(
      actorRequest('appeal-officer', 'staff'),
      { outcome: 'dismissed', reason: privateReason },
      { id: 'complaint-1', appealId: 'appeal-1' },
    ),
  );
  assert.equal(httpStatus(output), 201);
  assert.equal(state.transactions, 1);
  const caseUpdate = state.updates.find(
    (write) => write.table === schema.complaintCases && write.values.status === 'closed',
  );
  assert.ok(caseUpdate);
  assert.ok(caseUpdate.values.closedAt instanceof Date);
  const appealUpdate = state.updates.find(
    (write) => write.table === schema.complaintAppeals && write.values.status === 'decided',
  );
  assert.ok(appealUpdate);
  const event = state.inserts.find((write) => write.table === schema.complaintCaseEvents);
  assert.ok(event);
  assert.equal(event.values.eventType, 'appeal_decided');
  assert.equal(JSON.stringify(event.values).includes(privateReason), false);
  assert.equal(JSON.stringify(requests[0].body).includes(privateReason), false);
});

test('direct close requires the assigned initial decider, an initial decision, and no appeal', async () => {
  const path = '/internal/complaints/:id/close';
  const officer = staffRow(['decide_complaint']);
  const closed = scriptedDb([[officer], [complaintRow({ status: 'closed', closedAt: fixedDate })]]);
  assert.equal(
    httpStatus(
      await findRoute(closed.db, 'POST', path).handler(
        actorRequest('officer-1', 'staff'),
        {},
        { id: 'complaint-1' },
      ),
    ),
    409,
  );
  const appealed = scriptedDb([
    [officer],
    [complaintRow({ status: 'decided' })],
    [{ id: 'decision-initial' }],
    [{ id: 'appeal-1' }],
  ]);
  const output = await findRoute(appealed.db, 'POST', path).handler(
    actorRequest('officer-1', 'staff'),
    {},
    { id: 'complaint-1' },
  );
  assert.equal(httpStatus(output), 409);
  assert.deepEqual(httpBody(output), { error: 'appeal_already_exists' });
});
