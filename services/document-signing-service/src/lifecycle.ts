import { createHash, randomUUID } from 'node:crypto';
import { renderCharterPdf } from './charter-pdf.js';
import { sha256Hex, type ArtifactStore } from './artifact-store.js';
import {
  SigningRequestIdempotencyConflictError,
  TERMINAL_SIGNING_STATUSES,
  type SigningRepository,
  type SigningRequestRecord,
  type SigningRequestStatus,
} from './repository.js';
import type { SigningEnvelope, SigningProvider, SigningProviderState } from './signing-provider.js';

export interface ProofRegistrationInput {
  originalFileHash: string;
  canonicalPdfHash: string;
  manifestHash: string;
  documentClass: 'restricted-administrative-record';
  issuerId: string;
  issuerName: string;
  originalFilename: string;
  originalMime: 'application/pdf';
  originalBytes: number;
  contentVisibility: 'restricted';
  proofVisibility: 'public';
  algorithm: 'sha256';
}

export interface ProofRegistrar {
  register(input: ProofRegistrationInput): Promise<{ id: string }>;
}

export interface PaperlessArchiver {
  archive(input: { bytes: Uint8Array; filename: string; documentClass: string }): Promise<void>;
}

export interface SigningAuditEmitter {
  emit(input: {
    lifecycle: string;
    requestId?: string;
    charterId?: string;
    mandateHolderId?: string;
    actorCitizenId?: string;
  }): Promise<void>;
}

export interface SigningLifecycleDependencies {
  repository: SigningRepository;
  provider: SigningProvider;
  providerName: 'stub' | 'documenso';
  artifactStore: ArtifactStore;
  proofRegistrar: ProofRegistrar;
  paperlessArchiver?: PaperlessArchiver;
  audit?: SigningAuditEmitter;
  now?: () => Date;
}

export interface InitiateCharterSigningInput {
  mandateHolderId: string;
  actorCitizenId: string;
  idempotencyKey: string;
}

const STATE_TO_REQUEST_STATUS: Readonly<Record<SigningProviderState, SigningRequestStatus>> = {
  draft: 'created',
  pending: 'awaiting_signatures',
  completed: 'completed',
  rejected: 'declined',
  cancelled: 'voided',
  expired: 'expired',
};
function charterDocument(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new SigningLifecycleError('charter_document_missing', 409);
  return value as Readonly<Record<string, unknown>>;
}

function providerEnvelopeId(rawBody: Uint8Array): string | null {
  try {
    const root = JSON.parse(Buffer.from(rawBody).toString('utf8')) as Record<string, unknown>;
    const data =
      root.data && typeof root.data === 'object' && !Array.isArray(root.data)
        ? (root.data as Record<string, unknown>)
        : null;
    const rootEnvelope =
      root.envelope && typeof root.envelope === 'object' && !Array.isArray(root.envelope)
        ? (root.envelope as Record<string, unknown>)
        : null;
    const dataEnvelope =
      data?.envelope && typeof data.envelope === 'object' && !Array.isArray(data.envelope)
        ? (data.envelope as Record<string, unknown>)
        : null;
    const value = root.envelopeId ?? rootEnvelope?.id ?? data?.envelopeId ?? dataEnvelope?.id;
    return typeof value === 'string' && value.trim() ? value : null;
  } catch {
    return null;
  }
}

export class SigningLifecycleError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = 'SigningLifecycleError';
  }
}

export class SigningLifecycle {
  readonly #repository: SigningRepository;
  readonly #provider: SigningProvider;
  readonly #providerName: 'stub' | 'documenso';
  readonly #store: ArtifactStore;
  readonly #proofs: ProofRegistrar;
  readonly #paperless?: PaperlessArchiver;
  readonly #audit?: SigningAuditEmitter;
  readonly #now: () => Date;
  // This mutex protects one service instance. Multi-instance deployments also
  // need a database-level guard around proof registration and finalization.
  readonly #reconcileTails = new Map<string, Promise<void>>();
  #providerEventTail: Promise<void> = Promise.resolve();

  constructor(dependencies: SigningLifecycleDependencies) {
    this.#repository = dependencies.repository;
    this.#provider = dependencies.provider;
    this.#providerName = dependencies.providerName;
    this.#store = dependencies.artifactStore;
    this.#proofs = dependencies.proofRegistrar;
    this.#paperless = dependencies.paperlessArchiver;
    this.#audit = dependencies.audit;
    this.#now = dependencies.now ?? (() => new Date());
  }

  async initiateCharterSigning(input: InitiateCharterSigningInput): Promise<SigningRequestRecord> {
    if (!input.idempotencyKey.trim())
      throw new SigningLifecycleError('idempotency_key_required', 400);
    const context = await this.#repository.loadSigningContext(input.mandateHolderId);
    if (!context) throw new SigningLifecycleError('pending_charter_not_found', 404);
    if (context.holder.citizenId !== input.actorCitizenId)
      throw new SigningLifecycleError('mandate_holder_owner_required', 403);
    if (context.holder.status !== 'active')
      throw new SigningLifecycleError('mandate_holder_not_active', 409);
    if (context.citizen.identityLevel !== 'verified_official')
      throw new SigningLifecycleError('verified_official_required', 403);

    const existing = await this.#repository.findSigningRequestByIdempotencyKey(
      input.mandateHolderId,
      input.idempotencyKey,
    );
    if (existing) return existing;
    if (await this.#repository.hasIdempotencyKey(input.idempotencyKey)) {
      throw new SigningLifecycleError('idempotency_key_conflict', 409);
    }

    const rendered = renderCharterPdf(charterDocument(context.charter.charterDoc), [
      { displayName: context.holder.displayName, mandate: context.holder.roleId ?? undefined },
    ]);
    const unsignedHash = sha256Hex(rendered.pdf);
    const artifactKey = {
      subjectType: 'mandate_holder_charter',
      subjectId: context.charter.id,
      kind: 'charter_unsigned' as const,
      version: context.charter.version,
    };
    let unsignedArtifact = await this.#repository.findArtifactByNaturalKey(artifactKey);
    if (unsignedArtifact) {
      const existingBytes = await this.#store.get(unsignedArtifact.storageRef);
      if (
        unsignedArtifact.sha256 !== unsignedHash ||
        sha256Hex(existingBytes) !== unsignedArtifact.sha256
      ) {
        throw new SigningLifecycleError('artifact_hash_mismatch', 409);
      }
    } else {
      const unsignedId = randomUUID();
      const unsignedStorageRef = await this.#store.put(rendered.pdf, {
        artifactId: unsignedId,
        sha256: unsignedHash,
        mimeType: 'application/pdf',
      });
      unsignedArtifact = await this.#repository.insertArtifact({
        id: unsignedId,
        ...artifactKey,
        derivedFromArtifactId: null,
        sha256: unsignedHash,
        mimeType: 'application/pdf',
        byteCount: rendered.pdf.byteLength,
        filename: `charter-${context.charter.id}.pdf`,
        visibility: 'restricted',
        storageMode: this.#store.mode,
        storageRef: unsignedStorageRef,
        provenance: { renderer: 'polis-charter-pdf-v1', charterVersion: context.charter.version },
        createdByService: 'document-signing-service',
      });
      if (unsignedArtifact.sha256 !== unsignedHash)
        throw new SigningLifecycleError('artifact_hash_mismatch', 409);
    }

    let request: SigningRequestRecord;
    try {
      request = await this.#repository.createSigningRequest({
        provider: this.#providerName,
        charterId: context.charter.id,
        mandateHolderId: context.holder.id,
        unsignedArtifactId: unsignedArtifact.id,
        idempotencyKey: input.idempotencyKey,
      });
    } catch (error) {
      if (error instanceof SigningRequestIdempotencyConflictError) {
        throw new SigningLifecycleError('idempotency_key_conflict', 409);
      }
      throw error;
    }
    const recipient = await this.#repository.insertRecipient({
      signingRequestId: request.id,
      citizenId: context.citizen.id,
      role: 'signer',
      signingOrder: 1,
      providerRecipientId: null,
      status: 'pending',
    });
    await this.#repository.insertCharterEvent({
      charterId: context.charter.id,
      signingRequestId: request.id,
      event: 'initiated',
      actorId: input.actorCitizenId,
    });

    const envelope = await this.#provider.createEnvelope({
      title: `Charter ${context.charter.id}`,
      fileName: `charter-${context.charter.id}.pdf`,
      pdf: rendered.pdf,
      recipients: [{ name: context.citizen.displayName, email: context.citizen.email }],
      fields: rendered.fields,
    });
    await this.#repository.updateSigningRequest(request.id, { providerEnvelopeId: envelope.id });
    if (envelope.recipients[0])
      await this.#repository.updateRecipientProviderId(recipient.id, envelope.recipients[0].id);
    const distributed = await this.#provider.distributeEnvelope(envelope.id);
    const updated = await this.#repository.updateSigningRequest(request.id, {
      status:
        distributed.state === 'pending'
          ? 'distributed'
          : STATE_TO_REQUEST_STATUS[distributed.state],
    });
    await this.#repository.insertCharterEvent({
      charterId: context.charter.id,
      signingRequestId: request.id,
      event: 'distributed',
      actorId: input.actorCitizenId,
    });
    await this.#emitAudit({
      lifecycle: 'charter_signing_distributed',
      requestId: request.id,
      charterId: context.charter.id,
      mandateHolderId: context.holder.id,
      actorCitizenId: input.actorCitizenId,
    });
    return updated ?? request;
  }

  async recordProviderEvent(
    rawBody: Uint8Array,
    eventName: string,
    maxUnresolvedReceipts = 100,
  ): Promise<boolean> {
    const previous = this.#providerEventTail;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#providerEventTail = previous.then(() => gate);
    await previous;
    try {
      const envelopeId = providerEnvelopeId(rawBody);
      const request = envelopeId
        ? await this.#repository.findSigningRequestByProviderEnvelopeId(
            this.#providerName,
            envelopeId,
          )
        : null;
      if (
        !request &&
        (await this.#repository.countUnresolvedProviderEvents(this.#providerName)) >=
          maxUnresolvedReceipts
      ) {
        return false;
      }
      const payloadHash = sha256Hex(rawBody);
      const eventFingerprint = createHash('sha256')
        .update(this.#providerName)
        .update('\0')
        .update(eventName)
        .update('\0')
        .update(rawBody)
        .digest('hex');
      return await this.#repository.recordProviderEvent({
        provider: this.#providerName,
        signingRequestId: request?.id,
        eventName,
        eventFingerprint,
        payloadHash,
      });
    } finally {
      release();
    }
  }

  async reconcile(requestId: string): Promise<SigningRequestRecord> {
    const previous = this.#reconcileTails.get(requestId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.#reconcileTails.set(requestId, tail);
    await previous;
    try {
      return await this.#reconcileUnlocked(requestId);
    } finally {
      release();
      if (this.#reconcileTails.get(requestId) === tail) this.#reconcileTails.delete(requestId);
    }
  }

  async #reconcileUnlocked(requestId: string): Promise<SigningRequestRecord> {
    let request = await this.#repository.getSigningRequest(requestId);
    if (!request) throw new SigningLifecycleError('signing_request_not_found', 404);
    if (TERMINAL_SIGNING_STATUSES.includes(request.status)) return request;
    if (!request.providerEnvelopeId) return request;

    const envelope = await this.#provider.getEnvelope(request.providerEnvelopeId);
    if (envelope.state === 'completed') return this.#complete(request, envelope);
    if (
      envelope.state === 'rejected' ||
      envelope.state === 'expired' ||
      envelope.state === 'cancelled'
    ) {
      const status = STATE_TO_REQUEST_STATUS[envelope.state];
      const updated = await this.#repository.updateSigningRequest(request.id, {
        status,
        reconciled: true,
        failureCode: null,
      });
      const event =
        envelope.state === 'rejected'
          ? 'declined'
          : envelope.state === 'expired'
            ? 'expired'
            : 'withdrawn';
      await this.#repository.insertCharterEvent({
        charterId: request.charterId,
        signingRequestId: request.id,
        event,
      });
      await this.#emitAudit({
        lifecycle: `charter_signing_${event}`,
        requestId: request.id,
        charterId: request.charterId,
        mandateHolderId: request.mandateHolderId,
      });
      return updated ?? request;
    }

    const observed = STATE_TO_REQUEST_STATUS[envelope.state];
    if (
      request.status === 'created' ||
      request.status === 'distributed' ||
      request.status === 'awaiting_signatures'
    ) {
      request =
        (await this.#repository.updateSigningRequest(request.id, {
          status: observed,
          reconciled: true,
          failureCode: null,
        })) ?? request;
    }
    return request;
  }

  async #complete(
    request: SigningRequestRecord,
    envelope: SigningEnvelope,
  ): Promise<SigningRequestRecord> {
    let signedArtifact = request.signedArtifactId
      ? await this.#repository.getArtifact(request.signedArtifactId)
      : null;
    signedArtifact ??= await this.#repository.findArtifact(request.id, 'charter_signed');
    if (!signedArtifact) {
      const item = envelope.items.find((candidate) => candidate.mimeType === 'application/pdf');
      if (!item) throw new Error('signed_pdf_item_missing');
      const bytes = await this.#provider.downloadSignedItem(envelope.id, item.id);
      const signedHash = sha256Hex(bytes);
      const artifactId = randomUUID();
      try {
        const storageRef = await this.#store.put(bytes, {
          artifactId,
          sha256: signedHash,
          mimeType: 'application/pdf',
        });
        signedArtifact = await this.#repository.insertArtifact({
          id: artifactId,
          subjectType: 'signing_request',
          subjectId: request.id,
          kind: 'charter_signed',
          version: 1,
          derivedFromArtifactId: request.unsignedArtifactId,
          sha256: signedHash,
          mimeType: 'application/pdf',
          byteCount: bytes.byteLength,
          filename: `signed-charter-${request.charterId}.pdf`,
          visibility: 'restricted',
          storageMode: this.#store.mode,
          storageRef,
          provenance: { provider: this.#providerName, lifecycle: 'provider_completed' },
          createdByService: 'document-signing-service',
        });
        if (signedArtifact.sha256 !== signedHash) throw new Error('artifact_hash_mismatch');
        await this.#repository.updateSigningRequest(request.id, {
          signedArtifactId: signedArtifact.id,
          providerCompletedAt: this.#now(),
        });
      } catch (error) {
        await this.#repository.updateSigningRequest(request.id, {
          failureCode: 'artifact_store_error',
          reconciled: true,
        });
        throw error;
      }
    }

    const exactBytes = await this.#store.get(signedArtifact.storageRef);
    if (sha256Hex(exactBytes) !== signedArtifact.sha256) throw new Error('artifact_hash_mismatch');
    if (this.#paperless) {
      try {
        await this.#paperless.archive({
          bytes: exactBytes,
          filename: signedArtifact.filename ?? 'signed-charter.pdf',
          documentClass: 'restricted-administrative-record',
        });
      } catch {
        /* best-effort */
      }
    }

    request = (await this.#repository.getSigningRequest(request.id)) ?? request;
    let proofManifestId = request.proofManifestId;
    if (!proofManifestId) {
      const manifestHash = createHash('sha256')
        .update(`charter-proof-v1\0${request.id}\0${signedArtifact.sha256}`)
        .digest('hex');
      const proof = await this.#proofs.register({
        originalFileHash: signedArtifact.sha256,
        canonicalPdfHash: signedArtifact.sha256,
        manifestHash,
        documentClass: 'restricted-administrative-record',
        issuerId: request.mandateHolderId,
        issuerName: 'Polis mandate holder',
        originalFilename: signedArtifact.filename ?? 'signed-charter.pdf',
        originalMime: 'application/pdf',
        originalBytes: signedArtifact.byteCount,
        contentVisibility: 'restricted',
        proofVisibility: 'public',
        algorithm: 'sha256',
      });
      proofManifestId = proof.id;
      await this.#repository.updateSigningRequest(request.id, { proofManifestId });
    }

    const completed = await this.#repository.finalizeSigning({
      requestId: request.id,
      signedArtifactId: signedArtifact.id,
      proofManifestId,
      completedAt: this.#now(),
    });
    await this.#emitAudit({
      lifecycle: 'charter_signing_completed',
      requestId: request.id,
      charterId: request.charterId,
      mandateHolderId: request.mandateHolderId,
    });
    return completed;
  }

  async #emitAudit(input: {
    lifecycle: string;
    requestId?: string;
    charterId?: string;
    mandateHolderId?: string;
    actorCitizenId?: string;
  }): Promise<void> {
    if (!this.#audit) return;
    try {
      await this.#audit.emit(input);
    } catch {
      /* best-effort */
    }
  }
}
