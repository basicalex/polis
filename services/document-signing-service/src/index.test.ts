import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import test from 'node:test';
import type { ArtifactStore } from './artifact-store.js';
import {
  createReconcileDue,
  createSigningProvider,
  HttpProofRegistrar,
  signingRoutes,
} from './index.js';
import type { SigningLifecycle } from './lifecycle.js';
import {
  InMemorySigningRepository,
  type DocumentArtifactRecord,
  type SigningContext,
  type SigningRequestRecord,
} from './repository.js';
import { StubSigningProvider } from './stub-provider.js';

const now = new Date('2026-07-30T00:00:00.000Z');
const request: SigningRequestRecord = {
  id: 'request-1',
  provider: 'stub',
  charterId: 'charter-1',
  mandateHolderId: 'holder-1',
  unsignedArtifactId: 'unsigned-1',
  signedArtifactId: null,
  proofManifestId: null,
  idempotencyKey: 'key-1',
  providerEnvelopeId: 'stub-envelope-missing',
  status: 'distributed',
  lastReconciledAt: null,
  reconcileAttempts: 0,
  providerCompletedAt: null,
  failureCode: null,
  createdAt: now,
  updatedAt: now,
};

const signingContext: SigningContext = {
  holder: {
    id: 'holder-1',
    citizenId: 'citizen-owner',
    displayName: 'Owner',
    status: 'active',
    roleId: 'mayor',
  },
  charter: {
    id: 'charter-1',
    mandateHolderId: 'holder-1',
    charterDoc: { purpose: 'reporting', scope: { jurisdictions: ['jurisdiction-1'] } },
    version: 1,
    status: 'pending',
  },
  citizen: {
    id: 'citizen-owner',
    email: 'owner@example.test',
    displayName: 'Owner',
    identityLevel: 'verified_official',
  },
};

function fakeRequest(headers: Record<string, string>): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

test('route table exposes the complete internal signing surface', () => {
  const repository = new InMemorySigningRepository();
  const routes = signingRoutes({
    repository,
    lifecycle: {} as SigningLifecycle,
    artifactStore: { mode: 'database' } as ArtifactStore,
    provider: new StubSigningProvider(),
    providerName: 'stub',
  });
  const surface = routes.map((route) => `${route.method} ${route.path}`);
  for (const expected of [
    'POST /internal/signing/charter-requests',
    'GET /internal/signing/charter-status/:mandateHolderId',
    'GET /internal/signing/requests/:id',
    'POST /internal/signing/requests/:id/reconcile',
    'POST /internal/signing/requests/:id/stub-complete',
    'GET /internal/signing/artifacts/:id/content',
    'POST /internal/signing/webhooks/documenso',
  ])
    assert.ok(surface.includes(expected), expected);
  const webhook = routes.find((route) => route.path === '/internal/signing/webhooks/documenso')!;
  assert.equal(webhook.bodyMode, 'raw');
  assert.equal(webhook.maxBodyBytes, 1_000_000);
});

test('documenso provider mode fails when any required configuration is missing', () => {
  assert.throws(
    () => createSigningProvider({ SIGNING_PROVIDER: 'documenso' }),
    /configuration is incomplete/,
  );
  assert.throws(
    () =>
      createSigningProvider({
        SIGNING_PROVIDER: 'documenso',
        DOCUMENSO_API_URL: 'https://documenso.test',
        DOCUMENSO_API_TOKEN: 'token',
      }),
    /configuration is incomplete/,
  );
});

test('proof registration sends exact service provenance and requires active proof', async () => {
  const previousToken = process.env.INTERNAL_API_TOKEN;
  process.env.INTERNAL_API_TOKEN = 'test-internal-token';
  const bodies: Array<Record<string, unknown>> = [];
  let registryStatus = 'unknown';
  const registrar = new HttpProofRegistrar('http://proof.test', async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ id: 'proof-1', registryStatus }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  });
  const input: Parameters<HttpProofRegistrar['register']>[0] = {
    originalFileHash: 'a'.repeat(64),
    canonicalPdfHash: 'a'.repeat(64),
    manifestHash: 'b'.repeat(64),
    documentClass: 'restricted-administrative-record' as const,
    issuerId: 'holder-1',
    issuerName: 'Polis mandate holder',
    originalFilename: 'signed-charter.pdf',
    originalMime: 'application/pdf',
    originalBytes: 10,
    contentVisibility: 'restricted' as const,
    proofVisibility: 'public' as const,
    algorithm: 'sha256' as const,
  };

  await assert.rejects(() => registrar.register(input), /proof_registration_inactive_response/);
  assert.equal(bodies[0]?.createdByService, 'document-signing-service');

  registryStatus = 'active';
  try {
    assert.deepEqual(await registrar.register(input), { id: 'proof-1' });
    assert.equal(bodies[1]?.createdByService, 'document-signing-service');
  } finally {
    if (previousToken === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = previousToken;
  }
});

test('stub completion rejects a citizen who is not the signing recipient', async () => {
  const repository = new InMemorySigningRepository({
    requests: [request],
    recipients: [
      {
        id: 'recipient-1',
        signingRequestId: request.id,
        citizenId: 'citizen-owner',
        role: 'signer',
        signingOrder: 1,
        providerRecipientId: 'provider-recipient-1',
        status: 'sent',
      },
    ],
  });
  const routes = signingRoutes({
    repository,
    lifecycle: {} as SigningLifecycle,
    artifactStore: { mode: 'database' } as ArtifactStore,
    provider: new StubSigningProvider(),
    providerName: 'stub',
  });
  const route = routes.find((candidate) => candidate.path.endsWith('/stub-complete'))!;
  const response = (await route.handler(
    fakeRequest({ 'x-polis-citizen': 'citizen-other' }),
    {},
    { id: request.id },
  )) as { status: number; body: { error: string } };
  assert.equal(response.status, 403);
  assert.equal(response.body.error, 'signing_recipient_required');
});

test('webhook secret mismatch makes no repository state change', async () => {
  const repository = new InMemorySigningRepository();
  let receipts = 0;
  const lifecycle = {
    recordProviderEvent: async () => {
      receipts += 1;
      return true;
    },
  } as unknown as SigningLifecycle;
  const routes = signingRoutes({
    repository,
    lifecycle,
    artifactStore: { mode: 'database' } as ArtifactStore,
    provider: new StubSigningProvider(),
    providerName: 'documenso',
    webhookSecret: 'correct-secret',
  });
  const route = routes.find(
    (candidate) => candidate.path === '/internal/signing/webhooks/documenso',
  )!;
  const response = (await route.handler(
    fakeRequest({ 'x-documenso-secret': 'wrong-secret' }),
    Buffer.from('{}'),
    {},
  )) as { status: number; body: { error: string } };
  assert.equal(response.status, 401);
  assert.equal(receipts, 0);
  assert.equal(repository.providerEvents.size, 0);
});

test('production stub mode omits the completion route unless explicitly allowed', () => {
  const routes = signingRoutes({
    repository: new InMemorySigningRepository(),
    lifecycle: {} as SigningLifecycle,
    artifactStore: { mode: 'database' } as ArtifactStore,
    provider: new StubSigningProvider(),
    providerName: 'stub',
    allowStubCompletion: false,
  });
  assert.equal(
    routes.some((route) => route.path.endsWith('/stub-complete')),
    false,
  );
});

test('signing status is limited to the owner or staff', async () => {
  const repository = new InMemorySigningRepository({
    contexts: [signingContext],
    requests: [request],
  });
  const routes = signingRoutes({
    repository,
    lifecycle: {} as SigningLifecycle,
    artifactStore: { mode: 'database' } as ArtifactStore,
    provider: new StubSigningProvider(),
    providerName: 'stub',
  });
  const route = routes.find((candidate) => candidate.path.includes('/charter-status/'))!;
  const denied = (await route.handler(
    fakeRequest({ 'x-polis-citizen': 'citizen-other' }),
    {},
    { mandateHolderId: 'holder-1' },
  )) as { status: number };
  const owner = (await route.handler(
    fakeRequest({ 'x-polis-citizen': 'citizen-owner' }),
    {},
    { mandateHolderId: 'holder-1' },
  )) as { status: number | string };
  const staff = (await route.handler(
    fakeRequest({ 'x-polis-citizen': 'reviewer-1', 'x-polis-identity-level': 'staff' }),
    {},
    { mandateHolderId: 'holder-1' },
  )) as { status: number | string };
  assert.equal(denied.status, 403);
  assert.equal(owner.status, 'distributed');
  assert.equal(staff.status, 'distributed');
  const detailRoute = routes.find(
    (candidate) => candidate.path === '/internal/signing/requests/:id',
  )!;
  const detailDenied = (await detailRoute.handler(
    fakeRequest({ 'x-polis-citizen': 'citizen-other' }),
    {},
    { id: request.id },
  )) as { status: number };
  const detailOwner = (await detailRoute.handler(
    fakeRequest({ 'x-polis-citizen': 'citizen-owner' }),
    {},
    { id: request.id },
  )) as { status: number | string };
  assert.equal(detailDenied.status, 403);
  assert.equal(detailOwner.status, 'distributed');
});

test('artifact download verifies stored bytes against artifact metadata', async () => {
  const artifact: DocumentArtifactRecord = {
    id: 'artifact-1',
    subjectType: 'signing_request',
    subjectId: request.id,
    kind: 'charter_signed',
    version: 1,
    derivedFromArtifactId: request.unsignedArtifactId,
    sha256: '0'.repeat(64),
    mimeType: 'application/pdf',
    byteCount: 8,
    filename: 'charter.pdf',
    visibility: 'restricted',
    storageMode: 'database',
    storageRef: 'database:artifact-1',
    provenance: null,
    createdByService: 'document-signing-service',
    createdAt: now,
  };
  const repository = new InMemorySigningRepository({ artifacts: [artifact] });
  const artifactStore = {
    mode: 'database',
    get: async () => Buffer.from('tampered'),
  } as unknown as ArtifactStore;
  const routes = signingRoutes({
    repository,
    lifecycle: {} as SigningLifecycle,
    artifactStore,
    provider: new StubSigningProvider(),
    providerName: 'stub',
  });
  const route = routes.find((candidate) => candidate.path.includes('/artifacts/'))!;
  await assert.rejects(async () => {
    await route.handler(fakeRequest({}), {}, { id: artifact.id });
  }, /artifact_hash_mismatch/);
});

test('reconciliation failures persist and stop at the configured attempt cap', async () => {
  const repository = new InMemorySigningRepository({ requests: [request] });
  const lifecycle = {
    reconcile: async () => {
      throw new Error('provider_down');
    },
  } as unknown as SigningLifecycle;
  const reconcileDue = createReconcileDue(repository, lifecycle, 25, 2);
  await reconcileDue();
  await reconcileDue();
  await reconcileDue();
  const failed = await repository.getSigningRequest(request.id);
  assert.equal(failed?.failureCode, 'reconcile_error');
  assert.equal(failed?.reconcileAttempts, 2);
});
