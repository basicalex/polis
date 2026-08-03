import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256Hex, type ArtifactPutMetadata, type ArtifactStore } from './artifact-store.js';
import {
  SigningLifecycle,
  SigningLifecycleError,
  type ProofRegistrationInput,
} from './lifecycle.js';
import {
  InMemorySigningRepository,
  type SigningContext,
  type SigningRequestRecord,
} from './repository.js';
import { StubSigningProvider } from './stub-provider.js';

class MemoryArtifactStore implements ArtifactStore {
  readonly mode = 'database' as const;
  readonly bytes = new Map<string, Uint8Array>();
  failNextPut = false;

  async put(bytes: Uint8Array, metadata: ArtifactPutMetadata): Promise<string> {
    if (this.failNextPut) {
      this.failNextPut = false;
      throw new Error('storage_unavailable');
    }
    assert.equal(sha256Hex(bytes), metadata.sha256);
    const ref = `memory:${metadata.artifactId}:${metadata.sha256}`;
    this.bytes.set(ref, Uint8Array.from(bytes));
    return ref;
  }

  async get(ref: string): Promise<Uint8Array> {
    const bytes = this.bytes.get(ref);
    if (!bytes) throw new Error('not_found');
    const expected = ref.split(':').at(-1);
    if (sha256Hex(bytes) !== expected) throw new Error('artifact_hash_mismatch');
    return Uint8Array.from(bytes);
  }

  async exists(ref: string): Promise<boolean> {
    return this.bytes.has(ref);
  }
}

const context: SigningContext = {
  holder: {
    id: 'holder-1',
    citizenId: 'citizen-1',
    displayName: 'Official One',
    status: 'active',
    roleId: 'mayor',
  },
  charter: {
    id: 'charter-1',
    mandateHolderId: 'holder-1',
    charterDoc: {
      purpose: 'public reporting',
      scope: { jurisdictions: ['jurisdiction-1'], processes: ['process-1'] },
    },
    version: 1,
    status: 'pending',
  },
  citizen: {
    id: 'citizen-1',
    email: 'official@example.test',
    displayName: 'Official One',
    identityLevel: 'verified_official',
  },
};

function requestTemplate(id: string): SigningRequestRecord {
  const now = new Date('2026-07-30T00:00:00.000Z');
  return {
    id,
    provider: 'stub',
    charterId: 'charter-1',
    mandateHolderId: 'holder-1',
    unsignedArtifactId: 'unsigned-1',
    signedArtifactId: null,
    proofManifestId: null,
    idempotencyKey: `key-${id}`,
    providerEnvelopeId: `envelope-${id}`,
    status: 'distributed',
    lastReconciledAt: null,
    reconcileAttempts: 0,
    providerCompletedAt: null,
    failureCode: null,
    createdAt: now,
    updatedAt: now,
  };
}

function fixture(contexts: SigningContext[] = [context]) {
  const repository = new InMemorySigningRepository({ contexts });
  const provider = new StubSigningProvider();
  const store = new MemoryArtifactStore();
  const proofInputs: ProofRegistrationInput[] = [];
  const paperlessBytes: Uint8Array[] = [];
  const lifecycle = new SigningLifecycle({
    repository,
    provider,
    providerName: 'stub',
    artifactStore: store,
    proofRegistrar: {
      register: async (input) => {
        proofInputs.push(input);
        return { id: `proof-${proofInputs.length}` };
      },
    },
    paperlessArchiver: {
      archive: async ({ bytes }) => {
        paperlessBytes.push(Uint8Array.from(bytes));
      },
    },
  });
  return { repository, provider, store, lifecycle, proofInputs, paperlessBytes };
}

test('stub charter flow finalizes once and preserves exact signed bytes', async () => {
  const f = fixture();
  const initiated = await f.lifecycle.initiateCharterSigning({
    mandateHolderId: 'holder-1',
    actorCitizenId: 'citizen-1',
    idempotencyKey: 'key-1',
  });
  assert.equal(initiated.status, 'distributed');
  const duplicate = await f.lifecycle.initiateCharterSigning({
    mandateHolderId: 'holder-1',
    actorCitizenId: 'citizen-1',
    idempotencyKey: 'key-1',
  });
  assert.equal(duplicate.id, initiated.id);
  assert.equal(f.repository.requests.size, 1);

  f.provider.completeForTest(initiated.providerEnvelopeId!);
  const completed = await f.lifecycle.reconcile(initiated.id);
  assert.equal(completed.status, 'completed');
  const signed = [...f.repository.artifacts.values()].filter(
    (artifact) => artifact.kind === 'charter_signed',
  );
  assert.equal(signed.length, 1);
  assert.equal(f.proofInputs.length, 1);
  assert.equal(f.repository.acceptedCharters.size, 1);
  assert.equal(f.repository.charterEvents.filter((event) => event.event === 'completed').length, 1);
  assert.equal(f.repository.charterEvents.filter((event) => event.event === 'accepted').length, 1);

  const signedBytes = await f.store.get(signed[0]!.storageRef);
  assert.deepEqual(f.paperlessBytes[0], signedBytes);
  assert.equal(sha256Hex(signedBytes), signed[0]!.sha256);
  assert.equal(f.proofInputs[0]!.originalFileHash, signed[0]!.sha256);
  assert.equal(f.proofInputs[0]!.canonicalPdfHash, signed[0]!.sha256);
  assert.equal(f.proofInputs[0]!.contentVisibility, 'restricted');
  assert.equal(f.proofInputs[0]!.proofVisibility, 'public');

  await f.lifecycle.reconcile(initiated.id);
  assert.equal(
    [...f.repository.artifacts.values()].filter((artifact) => artifact.kind === 'charter_signed')
      .length,
    1,
  );
  assert.equal(f.proofInputs.length, 1);
  assert.equal(f.repository.acceptedCharters.size, 1);
});

test('webhook receipts deduplicate and never override authoritative pending state', async () => {
  const f = fixture();
  const request = await f.lifecycle.initiateCharterSigning({
    mandateHolderId: 'holder-1',
    actorCitizenId: 'citizen-1',
    idempotencyKey: 'key-webhook',
  });
  const payload = Buffer.from('{"event":"completed"}');
  assert.equal(await f.lifecycle.recordProviderEvent(payload, 'completed'), true);
  assert.equal(await f.lifecycle.recordProviderEvent(payload, 'completed'), false);
  const reconciled = await f.lifecycle.reconcile(request.id);
  assert.equal(reconciled.status, 'awaiting_signatures');
  assert.equal(f.proofInputs.length, 0);
  assert.equal(f.repository.acceptedCharters.size, 0);
});

test('stale observations cannot regress a completed request', async () => {
  const f = fixture();
  const request = await f.lifecycle.initiateCharterSigning({
    mandateHolderId: 'holder-1',
    actorCitizenId: 'citizen-1',
    idempotencyKey: 'key-stale',
  });
  f.provider.completeForTest(request.providerEnvelopeId!);
  await f.lifecycle.reconcile(request.id);
  const stale = await f.repository.updateSigningRequest(request.id, {
    status: 'awaiting_signatures',
    reconciled: true,
  });
  assert.equal(stale!.status, 'completed');
  assert.equal((await f.lifecycle.reconcile(request.id)).status, 'completed');
});

test('storage failure leaves completion retryable', async () => {
  const f = fixture();
  const request = await f.lifecycle.initiateCharterSigning({
    mandateHolderId: 'holder-1',
    actorCitizenId: 'citizen-1',
    idempotencyKey: 'key-retry',
  });
  f.provider.completeForTest(request.providerEnvelopeId!);
  f.store.failNextPut = true;
  await assert.rejects(f.lifecycle.reconcile(request.id), /storage_unavailable/);
  assert.equal((await f.repository.getSigningRequest(request.id))!.status, 'distributed');
  assert.equal(f.proofInputs.length, 0);
  const completed = await f.lifecycle.reconcile(request.id);
  assert.equal(completed.status, 'completed');
  assert.equal(f.proofInputs.length, 1);
});

test('non-owner cannot initiate charter signing', async () => {
  const f = fixture();
  await assert.rejects(
    f.lifecycle.initiateCharterSigning({
      mandateHolderId: 'holder-1',
      actorCitizenId: 'citizen-2',
      idempotencyKey: 'key-owner',
    }),
    (error: unknown) =>
      error instanceof SigningLifecycleError && error.code === 'mandate_holder_owner_required',
  );
  assert.equal(f.repository.requests.size, 0);
});

test('same idempotency key cannot cross mandate-holder boundaries', async () => {
  const second: SigningContext = {
    holder: {
      id: 'holder-2',
      citizenId: 'citizen-2',
      displayName: 'Official Two',
      status: 'active',
      roleId: 'councillor',
    },
    charter: {
      id: 'charter-2',
      mandateHolderId: 'holder-2',
      charterDoc: { purpose: 'publish minutes', scope: { jurisdictions: ['jurisdiction-2'] } },
      version: 1,
      status: 'pending',
    },
    citizen: {
      id: 'citizen-2',
      email: 'second@example.test',
      displayName: 'Official Two',
      identityLevel: 'verified_official',
    },
  };
  const f = fixture([context, second]);
  const first = await f.lifecycle.initiateCharterSigning({
    mandateHolderId: 'holder-1',
    actorCitizenId: 'citizen-1',
    idempotencyKey: 'shared-key',
  });
  await assert.rejects(
    f.lifecycle.initiateCharterSigning({
      mandateHolderId: 'holder-2',
      actorCitizenId: 'citizen-2',
      idempotencyKey: 'shared-key',
    }),
    (error: unknown) =>
      error instanceof SigningLifecycleError &&
      error.code === 'idempotency_key_conflict' &&
      error.status === 409,
  );
  assert.equal(f.repository.requests.size, 1);
  assert.equal(first.mandateHolderId, 'holder-1');
});

test('retry after a terminal outcome reuses the unsigned artifact', async () => {
  const f = fixture();
  const first = await f.lifecycle.initiateCharterSigning({
    mandateHolderId: 'holder-1',
    actorCitizenId: 'citizen-1',
    idempotencyKey: 'terminal-key-1',
  });
  await f.repository.updateSigningRequest(first.id, { status: 'expired', reconciled: true });

  const retried = await f.lifecycle.initiateCharterSigning({
    mandateHolderId: 'holder-1',
    actorCitizenId: 'citizen-1',
    idempotencyKey: 'terminal-key-2',
  });
  assert.notEqual(retried.id, first.id);
  assert.equal(retried.status, 'distributed');
  assert.equal(f.repository.requests.size, 2);
  assert.equal(
    [...f.repository.artifacts.values()].filter((artifact) => artifact.kind === 'charter_unsigned')
      .length,
    1,
  );
});

test('concurrent reconciliation registers one proof and one terminal event pair', async () => {
  const f = fixture();
  const request = await f.lifecycle.initiateCharterSigning({
    mandateHolderId: 'holder-1',
    actorCitizenId: 'citizen-1',
    idempotencyKey: 'concurrent-key',
  });
  f.provider.completeForTest(request.providerEnvelopeId!);
  const [left, right] = await Promise.all([
    f.lifecycle.reconcile(request.id),
    f.lifecycle.reconcile(request.id),
  ]);
  assert.equal(left.status, 'completed');
  assert.equal(right.status, 'completed');
  assert.equal(f.proofInputs.length, 1);
  assert.equal(f.repository.charterEvents.filter((event) => event.event === 'completed').length, 1);
  assert.equal(f.repository.charterEvents.filter((event) => event.event === 'accepted').length, 1);
});

test('webhook receipts associate known envelopes and cap unresolved events', async () => {
  const f = fixture();
  const request = await f.lifecycle.initiateCharterSigning({
    mandateHolderId: 'holder-1',
    actorCitizenId: 'citizen-1',
    idempotencyKey: 'receipt-key',
  });
  const known = Buffer.from(
    JSON.stringify({ data: { envelope: { id: request.providerEnvelopeId } } }),
  );
  assert.equal(await f.lifecycle.recordProviderEvent(known, 'completed', 1), true);
  assert.equal(await f.repository.countUnresolvedProviderEvents('stub'), 0);
  assert.equal(
    await f.lifecycle.recordProviderEvent(
      Buffer.from('{"envelopeId":"unknown-1"}'),
      'completed',
      1,
    ),
    true,
  );
  assert.equal(
    await f.lifecycle.recordProviderEvent(
      Buffer.from('{"envelopeId":"unknown-2"}'),
      'completed',
      1,
    ),
    false,
  );
  assert.equal(await f.repository.countUnresolvedProviderEvents('stub'), 1);
});

test('concurrent unresolved webhook receipts cannot exceed the cap', async () => {
  const f = fixture();
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      f.lifecycle.recordProviderEvent(
        Buffer.from(`{"envelopeId":"unknown-${index}"}`),
        'completed',
        1,
      ),
    ),
  );
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(await f.repository.countUnresolvedProviderEvents('stub'), 1);
});

test('accepted charter guard emits one acceptance across competing requests', async () => {
  const first = requestTemplate('request-a');
  const second = requestTemplate('request-b');
  const repository = new InMemorySigningRepository({
    contexts: [context],
    requests: [first, second],
  });
  await repository.finalizeSigning({
    requestId: first.id,
    signedArtifactId: 'signed-a',
    proofManifestId: 'proof-a',
    completedAt: new Date(),
  });
  await repository.finalizeSigning({
    requestId: second.id,
    signedArtifactId: 'signed-b',
    proofManifestId: 'proof-b',
    completedAt: new Date(),
  });
  assert.equal(repository.charterEvents.filter((event) => event.event === 'accepted').length, 1);
  assert.equal(repository.acceptedCharters.get('charter-1')?.requestId, first.id);
});
