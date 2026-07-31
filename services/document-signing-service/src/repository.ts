import { randomUUID } from 'node:crypto';
import { schema, type DbClient } from '@polis/db';
import { and, count, desc, eq, inArray, isNull, lt, notInArray, sql } from 'drizzle-orm';

export type SigningRequestStatus =
  | 'created'
  | 'distributed'
  | 'awaiting_signatures'
  | 'completed'
  | 'declined'
  | 'expired'
  | 'voided'
  | 'failed';

export const TERMINAL_SIGNING_STATUSES: readonly SigningRequestStatus[] = [
  'completed',
  'declined',
  'expired',
  'voided',
  'failed',
];

export class SigningRequestIdempotencyConflictError extends Error {
  constructor() {
    super('idempotency_key_conflict');
    this.name = 'SigningRequestIdempotencyConflictError';
  }
}

export interface SigningContext {
  holder: {
    id: string;
    citizenId: string;
    displayName: string;
    status: string;
    roleId: string | null;
  };
  charter: {
    id: string;
    mandateHolderId: string;
    charterDoc: unknown;
    version: number;
    status: string;
  };
  citizen: {
    id: string;
    email: string;
    displayName: string;
    identityLevel: string;
  };
}

export interface DocumentArtifactRecord {
  id: string;
  subjectType: string;
  subjectId: string;
  kind: 'charter_unsigned' | 'charter_signed' | 'provider_receipt';
  version: number;
  derivedFromArtifactId: string | null;
  sha256: string;
  mimeType: string;
  byteCount: number;
  filename: string | null;
  visibility: string;
  storageMode: 'database' | 's3';
  storageRef: string;
  provenance: unknown;
  createdByService: string;
  createdAt: Date;
}

export interface SigningRequestRecord {
  id: string;
  provider: 'stub' | 'documenso';
  charterId: string;
  mandateHolderId: string;
  unsignedArtifactId: string;
  signedArtifactId: string | null;
  proofManifestId: string | null;
  idempotencyKey: string;
  providerEnvelopeId: string | null;
  status: SigningRequestStatus;
  lastReconciledAt: Date | null;
  reconcileAttempts: number;
  providerCompletedAt: Date | null;
  failureCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SigningRecipientRecord {
  id: string;
  signingRequestId: string;
  citizenId: string;
  role: 'signer' | 'approver' | 'witness';
  signingOrder: number;
  providerRecipientId: string | null;
  status: 'pending' | 'sent' | 'opened' | 'signed' | 'declined';
}

export interface CreateSigningRequestInput {
  id?: string;
  provider: 'stub' | 'documenso';
  charterId: string;
  mandateHolderId: string;
  unsignedArtifactId: string;
  idempotencyKey: string;
}

export interface SigningRequestPatch {
  providerEnvelopeId?: string;
  status?: SigningRequestStatus;
  signedArtifactId?: string;
  proofManifestId?: string;
  providerCompletedAt?: Date;
  failureCode?: string | null;
  reconciled?: boolean;
}

export interface FinalizeSigningInput {
  requestId: string;
  signedArtifactId: string;
  proofManifestId: string;
  actorId?: string | null;
  completedAt: Date;
}

export interface SigningRepository {
  loadSigningContext(mandateHolderId: string): Promise<SigningContext | null>;
  insertArtifact(artifact: Omit<DocumentArtifactRecord, 'createdAt'>): Promise<DocumentArtifactRecord>;
  getArtifact(id: string): Promise<DocumentArtifactRecord | null>;
  findArtifact(subjectId: string, kind: DocumentArtifactRecord['kind']): Promise<DocumentArtifactRecord | null>;
  findArtifactByNaturalKey(input: Pick<DocumentArtifactRecord, 'subjectType' | 'subjectId' | 'kind' | 'version'>): Promise<DocumentArtifactRecord | null>;
  createSigningRequest(input: CreateSigningRequestInput): Promise<SigningRequestRecord>;
  findSigningRequestByIdempotencyKey(mandateHolderId: string, key: string): Promise<SigningRequestRecord | null>;
  hasIdempotencyKey(key: string): Promise<boolean>;
  getSigningRequest(id: string): Promise<SigningRequestRecord | null>;
  getLatestSigningRequestForHolder(mandateHolderId: string): Promise<SigningRequestRecord | null>;
  getMandateHolderCitizenId(mandateHolderId: string): Promise<string | null>;
  findSigningRequestByProviderEnvelopeId(provider: 'stub' | 'documenso', envelopeId: string): Promise<SigningRequestRecord | null>;
  updateSigningRequest(id: string, patch: SigningRequestPatch): Promise<SigningRequestRecord | null>;
  insertRecipient(input: Omit<SigningRecipientRecord, 'id'> & { id?: string }): Promise<SigningRecipientRecord>;
  listRecipients(requestId: string): Promise<SigningRecipientRecord[]>;
  updateRecipientProviderId(id: string, providerRecipientId: string): Promise<void>;
  recordProviderEvent(input: {
    provider: 'stub' | 'documenso';
    signingRequestId?: string | null;
    eventName: string;
    eventFingerprint: string;
    payloadHash: string;
  }): Promise<boolean>;
  countUnresolvedProviderEvents(provider: 'stub' | 'documenso'): Promise<number>;
  listDueRequests(limit: number, maxAttempts: number): Promise<SigningRequestRecord[]>;
  insertCharterEvent(input: {
    charterId: string;
    signingRequestId?: string | null;
    event: 'initiated' | 'distributed' | 'completed' | 'accepted' | 'declined' | 'expired' | 'withdrawn';
    actorId?: string | null;
  }): Promise<void>;
  finalizeSigning(input: FinalizeSigningInput): Promise<SigningRequestRecord>;
}

const requestSelect = {
  id: schema.signingRequests.id,
  provider: schema.signingRequests.provider,
  charterId: schema.signingRequests.charterId,
  mandateHolderId: schema.signingRequests.mandateHolderId,
  unsignedArtifactId: schema.signingRequests.unsignedArtifactId,
  signedArtifactId: schema.signingRequests.signedArtifactId,
  proofManifestId: schema.signingRequests.proofManifestId,
  idempotencyKey: schema.signingRequests.idempotencyKey,
  providerEnvelopeId: schema.signingRequests.providerEnvelopeId,
  status: schema.signingRequests.status,
  lastReconciledAt: schema.signingRequests.lastReconciledAt,
  reconcileAttempts: schema.signingRequests.reconcileAttempts,
  providerCompletedAt: schema.signingRequests.providerCompletedAt,
  failureCode: schema.signingRequests.failureCode,
  createdAt: schema.signingRequests.createdAt,
  updatedAt: schema.signingRequests.updatedAt,
};

function requestRow(row: typeof requestSelect extends Record<string, infer _> ? Record<string, unknown> : never): SigningRequestRecord {
  return row as unknown as SigningRequestRecord;
}

export class DrizzleSigningRepository implements SigningRepository {
  constructor(readonly db: DbClient) {}

  async loadSigningContext(mandateHolderId: string): Promise<SigningContext | null> {
    const holders = await this.db.select().from(schema.mandateHolders).where(eq(schema.mandateHolders.id, mandateHolderId)).limit(1);
    const holder = holders[0];
    if (!holder) return null;
    const [charters, citizens] = await Promise.all([
      this.db.select().from(schema.mandateHolderCharters).where(and(eq(schema.mandateHolderCharters.mandateHolderId, mandateHolderId), eq(schema.mandateHolderCharters.status, 'pending'))).orderBy(desc(schema.mandateHolderCharters.version)).limit(1),
      this.db.select().from(schema.citizens).where(eq(schema.citizens.id, holder.citizenId)).limit(1),
    ]);
    const charter = charters[0];
    const citizen = citizens[0];
    if (!charter || !citizen) return null;
    return {
      holder: { id: holder.id, citizenId: holder.citizenId, displayName: holder.displayName, status: holder.status, roleId: holder.roleId },
      charter: { id: charter.id, mandateHolderId: charter.mandateHolderId, charterDoc: charter.charterDoc, version: charter.version, status: charter.status },
      citizen: { id: citizen.id, email: citizen.email, displayName: citizen.displayName, identityLevel: citizen.identityLevel },
    };
  }

  async insertArtifact(input: Omit<DocumentArtifactRecord, 'createdAt'>): Promise<DocumentArtifactRecord> {
    const rows = await this.db.insert(schema.documentArtifacts).values(input).onConflictDoNothing().returning();
    if (rows[0]) return rows[0] as DocumentArtifactRecord;
    const existing = await this.findArtifactByNaturalKey(input);
    if (!existing) throw new Error('artifact_insert_conflict');
    return existing;
  }

  async getArtifact(id: string): Promise<DocumentArtifactRecord | null> {
    const rows = await this.db.select().from(schema.documentArtifacts).where(eq(schema.documentArtifacts.id, id)).limit(1);
    return (rows[0] as DocumentArtifactRecord | undefined) ?? null;
  }


  async findArtifact(subjectId: string, kind: DocumentArtifactRecord['kind']): Promise<DocumentArtifactRecord | null> {
    const rows = await this.db.select().from(schema.documentArtifacts).where(and(eq(schema.documentArtifacts.subjectId, subjectId), eq(schema.documentArtifacts.kind, kind))).orderBy(desc(schema.documentArtifacts.version)).limit(1);
    return (rows[0] as DocumentArtifactRecord | undefined) ?? null;
  }

  async findArtifactByNaturalKey(input: Pick<DocumentArtifactRecord, 'subjectType' | 'subjectId' | 'kind' | 'version'>): Promise<DocumentArtifactRecord | null> {
    const rows = await this.db.select().from(schema.documentArtifacts).where(and(
      eq(schema.documentArtifacts.subjectType, input.subjectType),
      eq(schema.documentArtifacts.subjectId, input.subjectId),
      eq(schema.documentArtifacts.kind, input.kind),
      eq(schema.documentArtifacts.version, input.version),
    )).limit(1);
    return (rows[0] as DocumentArtifactRecord | undefined) ?? null;
  }

  async createSigningRequest(input: CreateSigningRequestInput): Promise<SigningRequestRecord> {
    const rows = await this.db.insert(schema.signingRequests).values({ ...input, id: input.id ?? randomUUID() }).onConflictDoNothing().returning(requestSelect);
    if (rows[0]) return requestRow(rows[0]);
    const existing = await this.findSigningRequestByIdempotencyKey(input.mandateHolderId, input.idempotencyKey);
    if (existing) return existing;
    if (await this.hasIdempotencyKey(input.idempotencyKey)) throw new SigningRequestIdempotencyConflictError();
    throw new Error('signing_request_insert_conflict');
  }

  async findSigningRequestByIdempotencyKey(mandateHolderId: string, key: string): Promise<SigningRequestRecord | null> {
    const rows = await this.db.select(requestSelect).from(schema.signingRequests).where(and(
      eq(schema.signingRequests.mandateHolderId, mandateHolderId),
      eq(schema.signingRequests.idempotencyKey, key),
    )).limit(1);
    return rows[0] ? requestRow(rows[0]) : null;
  }

  async hasIdempotencyKey(key: string): Promise<boolean> {
    const rows = await this.db.select({ id: schema.signingRequests.id }).from(schema.signingRequests).where(eq(schema.signingRequests.idempotencyKey, key)).limit(1);
    return rows.length === 1;
  }

  async getSigningRequest(id: string): Promise<SigningRequestRecord | null> {
    const rows = await this.db.select(requestSelect).from(schema.signingRequests).where(eq(schema.signingRequests.id, id)).limit(1);
    return rows[0] ? requestRow(rows[0]) : null;
  }

  async getLatestSigningRequestForHolder(mandateHolderId: string): Promise<SigningRequestRecord | null> {
    const rows = await this.db.select(requestSelect).from(schema.signingRequests).where(eq(schema.signingRequests.mandateHolderId, mandateHolderId)).orderBy(desc(schema.signingRequests.createdAt)).limit(1);
    return rows[0] ? requestRow(rows[0]) : null;
  }

  async getMandateHolderCitizenId(mandateHolderId: string): Promise<string | null> {
    const rows = await this.db.select({ citizenId: schema.mandateHolders.citizenId }).from(schema.mandateHolders).where(eq(schema.mandateHolders.id, mandateHolderId)).limit(1);
    return rows[0]?.citizenId ?? null;
  }

  async findSigningRequestByProviderEnvelopeId(provider: 'stub' | 'documenso', envelopeId: string): Promise<SigningRequestRecord | null> {
    const rows = await this.db.select(requestSelect).from(schema.signingRequests).where(and(
      eq(schema.signingRequests.provider, provider),
      eq(schema.signingRequests.providerEnvelopeId, envelopeId),
    )).limit(1);
    return rows[0] ? requestRow(rows[0]) : null;
  }

  async updateSigningRequest(id: string, patch: SigningRequestPatch): Promise<SigningRequestRecord | null> {
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.providerEnvelopeId !== undefined) values.providerEnvelopeId = patch.providerEnvelopeId;
    if (patch.status !== undefined) values.status = patch.status;
    if (patch.signedArtifactId !== undefined) values.signedArtifactId = patch.signedArtifactId;
    if (patch.proofManifestId !== undefined) values.proofManifestId = patch.proofManifestId;
    if (patch.providerCompletedAt !== undefined) values.providerCompletedAt = patch.providerCompletedAt;
    if (patch.failureCode !== undefined) values.failureCode = patch.failureCode;
    if (patch.reconciled) {
      values.lastReconciledAt = new Date();
      values.reconcileAttempts = sql`${schema.signingRequests.reconcileAttempts} + 1`;
    }
    const rows = await this.db.update(schema.signingRequests).set(values).where(and(eq(schema.signingRequests.id, id), notInArray(schema.signingRequests.status, [...TERMINAL_SIGNING_STATUSES]))).returning(requestSelect);
    return rows[0] ? requestRow(rows[0]) : this.getSigningRequest(id);
  }

  async insertRecipient(input: Omit<SigningRecipientRecord, 'id'> & { id?: string }): Promise<SigningRecipientRecord> {
    const rows = await this.db.insert(schema.signingRecipients).values({ ...input, id: input.id ?? randomUUID() }).onConflictDoNothing().returning();
    if (rows[0]) return rows[0] as SigningRecipientRecord;
    const existing = await this.listRecipients(input.signingRequestId);
    const match = existing.find((row) => row.citizenId === input.citizenId && row.role === input.role);
    if (!match) throw new Error('signing_recipient_insert_conflict');
    return match;
  }

  async listRecipients(requestId: string): Promise<SigningRecipientRecord[]> {
    return await this.db.select().from(schema.signingRecipients).where(eq(schema.signingRecipients.signingRequestId, requestId)).orderBy(schema.signingRecipients.signingOrder) as SigningRecipientRecord[];
  }

  async updateRecipientProviderId(id: string, providerRecipientId: string): Promise<void> {
    await this.db.update(schema.signingRecipients).set({ providerRecipientId, status: 'sent', updatedAt: new Date() }).where(eq(schema.signingRecipients.id, id));
  }

  async recordProviderEvent(input: { provider: 'stub' | 'documenso'; signingRequestId?: string | null; eventName: string; eventFingerprint: string; payloadHash: string }): Promise<boolean> {
    const rows = await this.db.insert(schema.signingProviderEvents).values({ id: randomUUID(), provider: input.provider, signingRequestId: input.signingRequestId ?? null, eventName: input.eventName, eventFingerprint: input.eventFingerprint, payloadHash: input.payloadHash, redactedData: null }).onConflictDoNothing().returning({ id: schema.signingProviderEvents.id });
    return rows.length === 1;
  }

  async countUnresolvedProviderEvents(provider: 'stub' | 'documenso'): Promise<number> {
    const rows = await this.db.select({ value: count() }).from(schema.signingProviderEvents).where(and(
      eq(schema.signingProviderEvents.provider, provider),
      isNull(schema.signingProviderEvents.signingRequestId),
    ));
    return rows[0]?.value ?? 0;
  }

  async listDueRequests(limit: number, maxAttempts: number): Promise<SigningRequestRecord[]> {
    const rows = await this.db.select(requestSelect).from(schema.signingRequests).where(and(
      inArray(schema.signingRequests.status, ['created', 'distributed', 'awaiting_signatures']),
      lt(schema.signingRequests.reconcileAttempts, maxAttempts),
    )).orderBy(schema.signingRequests.lastReconciledAt, schema.signingRequests.createdAt).limit(limit);
    return rows.map(requestRow);
  }

  async insertCharterEvent(input: { charterId: string; signingRequestId?: string | null; event: 'initiated' | 'distributed' | 'completed' | 'accepted' | 'declined' | 'expired' | 'withdrawn'; actorId?: string | null }): Promise<void> {
    await this.db.insert(schema.mandateHolderCharterEvents).values({ id: randomUUID(), charterId: input.charterId, signingRequestId: input.signingRequestId ?? null, event: input.event, actorId: input.actorId ?? null });
  }

  async finalizeSigning(input: FinalizeSigningInput): Promise<SigningRequestRecord> {
    return this.db.transaction(async (tx) => {
      const currentRows = await tx.select(requestSelect).from(schema.signingRequests).where(eq(schema.signingRequests.id, input.requestId)).limit(1);
      const currentRaw = currentRows[0];
      if (!currentRaw) throw new Error('signing_request_not_found');
      const current = requestRow(currentRaw);
      if (current.status === 'completed') return current;
      if (TERMINAL_SIGNING_STATUSES.includes(current.status)) throw new Error('signing_request_terminal');
      const completedRows = await tx.update(schema.signingRequests).set({ status: 'completed', signedArtifactId: input.signedArtifactId, proofManifestId: input.proofManifestId, providerCompletedAt: input.completedAt, lastReconciledAt: input.completedAt, reconcileAttempts: sql`${schema.signingRequests.reconcileAttempts} + 1`, updatedAt: input.completedAt, failureCode: null }).where(and(eq(schema.signingRequests.id, input.requestId), notInArray(schema.signingRequests.status, [...TERMINAL_SIGNING_STATUSES]))).returning(requestSelect);
      const completed = completedRows[0];
      if (!completed) {
        const latest = await tx.select(requestSelect).from(schema.signingRequests).where(eq(schema.signingRequests.id, input.requestId)).limit(1);
        if (!latest[0]) throw new Error('signing_request_not_found');
        return requestRow(latest[0]);
      }
      const acceptedRows = await tx.update(schema.mandateHolderCharters).set({ status: 'accepted', acceptedSigningRequestId: input.requestId, signedArtifactId: input.signedArtifactId, proofManifestId: input.proofManifestId, signedAt: input.completedAt, updatedAt: input.completedAt }).where(and(eq(schema.mandateHolderCharters.id, current.charterId), eq(schema.mandateHolderCharters.status, 'pending'))).returning({ id: schema.mandateHolderCharters.id });
      await tx.insert(schema.mandateHolderCharterEvents).values({
        id: randomUUID(), charterId: current.charterId, signingRequestId: input.requestId, event: 'completed', actorId: input.actorId ?? null, occurredAt: input.completedAt,
      });
      if (acceptedRows.length === 1) {
        await tx.insert(schema.mandateHolderCharterEvents).values({
          id: randomUUID(), charterId: current.charterId, signingRequestId: input.requestId, event: 'accepted', actorId: input.actorId ?? null, occurredAt: input.completedAt,
        });
      }
      return requestRow(completed);
    });
  }
}

export interface InMemorySigningSeed {
  contexts?: SigningContext[];
  artifacts?: DocumentArtifactRecord[];
  requests?: SigningRequestRecord[];
  recipients?: SigningRecipientRecord[];
}

export class InMemorySigningRepository implements SigningRepository {
  readonly contexts = new Map<string, SigningContext>();
  readonly artifacts = new Map<string, DocumentArtifactRecord>();
  readonly requests = new Map<string, SigningRequestRecord>();
  readonly recipients = new Map<string, SigningRecipientRecord>();
  readonly providerEvents = new Set<string>();
  private readonly unresolvedProviderEventCount: Record<'stub' | 'documenso', number> = { stub: 0, documenso: 0 };
  readonly charterEvents: Array<{ charterId: string; signingRequestId: string | null; event: string; actorId: string | null }> = [];
  readonly acceptedCharters = new Map<string, { requestId: string; signedArtifactId: string; proofManifestId: string; signedAt: Date }>();

  constructor(seed: InMemorySigningSeed = {}) {
    for (const context of seed.contexts ?? []) this.contexts.set(context.holder.id, structuredClone(context));
    for (const artifact of seed.artifacts ?? []) this.artifacts.set(artifact.id, structuredClone(artifact));
    for (const request of seed.requests ?? []) this.requests.set(request.id, structuredClone(request));
    for (const recipient of seed.recipients ?? []) this.recipients.set(recipient.id, structuredClone(recipient));
  }

  async loadSigningContext(id: string): Promise<SigningContext | null> { return structuredClone(this.contexts.get(id) ?? null); }
  async insertArtifact(input: Omit<DocumentArtifactRecord, 'createdAt'>): Promise<DocumentArtifactRecord> {
    const existing = await this.findArtifactByNaturalKey(input);
    if (existing) return existing;
    const artifact = { ...structuredClone(input), createdAt: new Date() };
    this.artifacts.set(artifact.id, artifact);
    return structuredClone(artifact);
  }
  async getArtifact(id: string): Promise<DocumentArtifactRecord | null> { return structuredClone(this.artifacts.get(id) ?? null); }
  async findArtifact(subjectId: string, kind: DocumentArtifactRecord['kind']): Promise<DocumentArtifactRecord | null> {
    const rows = [...this.artifacts.values()].filter((row) => row.subjectId === subjectId && row.kind === kind).sort((a, b) => b.version - a.version);
    return structuredClone(rows[0] ?? null);
  }
  async findArtifactByNaturalKey(input: Pick<DocumentArtifactRecord, 'subjectType' | 'subjectId' | 'kind' | 'version'>): Promise<DocumentArtifactRecord | null> {
    return structuredClone([...this.artifacts.values()].find((row) =>
      row.subjectType === input.subjectType &&
      row.subjectId === input.subjectId &&
      row.kind === input.kind &&
      row.version === input.version
    ) ?? null);
  }
  async createSigningRequest(input: CreateSigningRequestInput): Promise<SigningRequestRecord> {
    const existing = await this.findSigningRequestByIdempotencyKey(input.mandateHolderId, input.idempotencyKey);
    if (existing) return existing;
    if (await this.hasIdempotencyKey(input.idempotencyKey)) throw new SigningRequestIdempotencyConflictError();
    const now = new Date();
    const row: SigningRequestRecord = { id: input.id ?? randomUUID(), provider: input.provider, charterId: input.charterId, mandateHolderId: input.mandateHolderId, unsignedArtifactId: input.unsignedArtifactId, signedArtifactId: null, proofManifestId: null, idempotencyKey: input.idempotencyKey, providerEnvelopeId: null, status: 'created', lastReconciledAt: null, reconcileAttempts: 0, providerCompletedAt: null, failureCode: null, createdAt: now, updatedAt: now };
    this.requests.set(row.id, row);
    return structuredClone(row);
  }
  async findSigningRequestByIdempotencyKey(mandateHolderId: string, key: string): Promise<SigningRequestRecord | null> { return structuredClone([...this.requests.values()].find((row) => row.mandateHolderId === mandateHolderId && row.idempotencyKey === key) ?? null); }
  async hasIdempotencyKey(key: string): Promise<boolean> { return [...this.requests.values()].some((row) => row.idempotencyKey === key); }
  async getSigningRequest(id: string): Promise<SigningRequestRecord | null> { return structuredClone(this.requests.get(id) ?? null); }
  async getLatestSigningRequestForHolder(id: string): Promise<SigningRequestRecord | null> { return structuredClone([...this.requests.values()].filter((row) => row.mandateHolderId === id).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null); }
  async getMandateHolderCitizenId(id: string): Promise<string | null> { return this.contexts.get(id)?.holder.citizenId ?? null; }
  async findSigningRequestByProviderEnvelopeId(provider: 'stub' | 'documenso', envelopeId: string): Promise<SigningRequestRecord | null> { return structuredClone([...this.requests.values()].find((row) => row.provider === provider && row.providerEnvelopeId === envelopeId) ?? null); }
  async updateSigningRequest(id: string, patch: SigningRequestPatch): Promise<SigningRequestRecord | null> {
    const row = this.requests.get(id);
    if (!row) return null;
    if (TERMINAL_SIGNING_STATUSES.includes(row.status)) return structuredClone(row);
    if (patch.providerEnvelopeId !== undefined) row.providerEnvelopeId = patch.providerEnvelopeId;
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.signedArtifactId !== undefined) row.signedArtifactId = patch.signedArtifactId;
    if (patch.proofManifestId !== undefined) row.proofManifestId = patch.proofManifestId;
    if (patch.providerCompletedAt !== undefined) row.providerCompletedAt = patch.providerCompletedAt;
    if (patch.failureCode !== undefined) row.failureCode = patch.failureCode;
    if (patch.reconciled) { row.lastReconciledAt = new Date(); row.reconcileAttempts += 1; }
    row.updatedAt = new Date();
    return structuredClone(row);
  }
  async insertRecipient(input: Omit<SigningRecipientRecord, 'id'> & { id?: string }): Promise<SigningRecipientRecord> {
    const existing = [...this.recipients.values()].find((row) => row.signingRequestId === input.signingRequestId && row.citizenId === input.citizenId && row.role === input.role);
    if (existing) return structuredClone(existing);
    const row = { ...structuredClone(input), id: input.id ?? randomUUID() };
    this.recipients.set(row.id, row);
    return structuredClone(row);
  }
  async listRecipients(requestId: string): Promise<SigningRecipientRecord[]> { return structuredClone([...this.recipients.values()].filter((row) => row.signingRequestId === requestId).sort((a, b) => a.signingOrder - b.signingOrder)); }
  async updateRecipientProviderId(id: string, providerRecipientId: string): Promise<void> { const row = this.recipients.get(id); if (row) { row.providerRecipientId = providerRecipientId; row.status = 'sent'; } }
  async recordProviderEvent(input: { provider: 'stub' | 'documenso'; signingRequestId?: string | null; eventFingerprint: string }): Promise<boolean> {
    const key = `${input.provider}:${input.eventFingerprint}`;
    if (this.providerEvents.has(key)) return false;
    this.providerEvents.add(key);
    if (!input.signingRequestId) this.unresolvedProviderEventCount[input.provider] += 1;
    return true;
  }
  async countUnresolvedProviderEvents(provider: 'stub' | 'documenso'): Promise<number> { return this.unresolvedProviderEventCount[provider]; }
  async listDueRequests(limit: number, maxAttempts: number): Promise<SigningRequestRecord[]> {
    return structuredClone([...this.requests.values()]
      .filter((row) => ['created', 'distributed', 'awaiting_signatures'].includes(row.status) && row.reconcileAttempts < maxAttempts)
      .sort((a, b) => (a.lastReconciledAt?.getTime() ?? 0) - (b.lastReconciledAt?.getTime() ?? 0))
      .slice(0, limit));
  }
  async insertCharterEvent(input: { charterId: string; signingRequestId?: string | null; event: 'initiated' | 'distributed' | 'completed' | 'accepted' | 'declined' | 'expired' | 'withdrawn'; actorId?: string | null }): Promise<void> { this.charterEvents.push({ charterId: input.charterId, signingRequestId: input.signingRequestId ?? null, event: input.event, actorId: input.actorId ?? null }); }
  async finalizeSigning(input: FinalizeSigningInput): Promise<SigningRequestRecord> {
    const row = this.requests.get(input.requestId);
    if (!row) throw new Error('signing_request_not_found');
    if (row.status === 'completed') return structuredClone(row);
    if (TERMINAL_SIGNING_STATUSES.includes(row.status)) throw new Error('signing_request_terminal');
    row.status = 'completed'; row.signedArtifactId = input.signedArtifactId; row.proofManifestId = input.proofManifestId; row.providerCompletedAt = input.completedAt; row.lastReconciledAt = input.completedAt; row.reconcileAttempts += 1; row.failureCode = null; row.updatedAt = input.completedAt;
    this.charterEvents.push({ charterId: row.charterId, signingRequestId: row.id, event: 'completed', actorId: input.actorId ?? null });
    const context = this.contexts.get(row.mandateHolderId);
    if (context?.charter.status === 'pending') {
      context.charter.status = 'accepted';
      this.acceptedCharters.set(row.charterId, { requestId: row.id, signedArtifactId: input.signedArtifactId, proofManifestId: input.proofManifestId, signedAt: input.completedAt });
      this.charterEvents.push({ charterId: row.charterId, signingRequestId: row.id, event: 'accepted', actorId: input.actorId ?? null });
    }
    return structuredClone(row);
  }
}
