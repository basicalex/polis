import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { getClient, type DbClient } from '@polis/db';
import {
  binaryResult,
  internalHeaders,
  operationalRoutes,
  result,
  startService,
  type Route,
} from '@polis/service-runtime';
import {
  createArtifactStore,
  sha256Hex,
  type ArtifactStore,
  type ArtifactStoreEnvironment,
} from './artifact-store.js';
import { DocumensoClient } from './documenso-client.js';
import {
  SigningLifecycle,
  SigningLifecycleError,
  type PaperlessArchiver,
  type ProofRegistrar,
  type SigningAuditEmitter,
} from './lifecycle.js';
import {
  DrizzleSigningRepository,
  TERMINAL_SIGNING_STATUSES,
  type SigningRepository,
  type SigningRequestRecord,
} from './repository.js';
import type { SigningProvider } from './signing-provider.js';
import { StubSigningProvider } from './stub-provider.js';

export * from './signing-provider.js';
export * from './charter-pdf.js';
export * from './stub-provider.js';
export * from './documenso-client.js';
export * from './repository.js';
export * from './artifact-store.js';
export * from './lifecycle.js';

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface SigningServiceEnvironment extends NodeJS.ProcessEnv, ArtifactStoreEnvironment {
  SIGNING_PROVIDER?: string;
  DOCUMENSO_API_URL?: string;
  DOCUMENSO_API_TOKEN?: string;
  DOCUMENSO_WEBHOOK_SECRET?: string;
  SIGNING_RECONCILE_INTERVAL_MS?: string;
  SIGNING_RECONCILE_BATCH_SIZE?: string;
  SIGNING_RECONCILE_MAX_ATTEMPTS?: string;
  SIGNING_WEBHOOK_MAX_UNRESOLVED_RECEIPTS?: string;
  SIGNING_ALLOW_STUB_COMPLETION?: string;
  PROOF_INTERNAL_URL?: string;
  PAPERLESS_INTERNAL_URL?: string;
  AUDIT_INTERNAL_URL?: string;
}

export interface SelectedSigningProvider {
  name: 'stub' | 'documenso';
  provider: SigningProvider;
  webhookSecret?: string;
}

export function createSigningProvider(
  env: SigningServiceEnvironment = process.env,
  fetchImplementation: FetchImplementation = globalThis.fetch,
): SelectedSigningProvider {
  const mode = env.SIGNING_PROVIDER ?? 'stub';
  if (mode === 'stub') return { name: 'stub', provider: new StubSigningProvider() };
  if (mode !== 'documenso') throw new Error(`Unsupported SIGNING_PROVIDER: ${mode}`);
  if (
    !env.DOCUMENSO_API_URL?.trim() ||
    !env.DOCUMENSO_API_TOKEN?.trim() ||
    !env.DOCUMENSO_WEBHOOK_SECRET?.trim()
  ) {
    throw new Error('Documenso configuration is incomplete');
  }
  return {
    name: 'documenso',
    provider: new DocumensoClient({
      baseUrl: env.DOCUMENSO_API_URL,
      apiToken: env.DOCUMENSO_API_TOKEN,
      fetch: fetchImplementation,
    }),
    webhookSecret: env.DOCUMENSO_WEBHOOK_SECRET,
  };
}

function safeRequest(request: SigningRequestRecord | null): Record<string, unknown> | null {
  if (!request) return null;
  return {
    id: request.id,
    provider: request.provider,
    charterId: request.charterId,
    mandateHolderId: request.mandateHolderId,
    unsignedArtifactId: request.unsignedArtifactId,
    signedArtifactId: request.signedArtifactId,
    proofManifestId: request.proofManifestId,
    status: request.status,
    lastReconciledAt: request.lastReconciledAt?.toISOString() ?? null,
    providerCompletedAt: request.providerCompletedAt?.toISOString() ?? null,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
  };
}

function actorCitizenId(
  headers: Readonly<Record<string, string | string[] | undefined>>,
): string | null {
  const value = headers['x-polis-citizen'];
  return typeof value === 'string' && value.trim() ? value : null;
}

async function canReadSigningState(
  req: IncomingMessage,
  repository: SigningRepository,
  mandateHolderId: string,
): Promise<boolean> {
  const actor = actorCitizenId(req.headers);
  if (!actor) return false;
  if (req.headers['x-polis-identity-level'] === 'staff') return true;
  return (await repository.getMandateHolderCitizenId(mandateHolderId)) === actor;
}

function lifecycleFailure(error: unknown) {
  if (error instanceof SigningLifecycleError) return result(error.status, { error: error.code });
  throw error;
}

function secretMatches(
  supplied: string | string[] | undefined,
  expected: string | undefined,
): boolean {
  if (typeof supplied !== 'string' || !expected) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  const comparable =
    suppliedBytes.length === expectedBytes.length
      ? suppliedBytes
      : Buffer.alloc(expectedBytes.length);
  return (
    timingSafeEqual(expectedBytes, comparable) && suppliedBytes.length === expectedBytes.length
  );
}

function eventName(rawBody: Uint8Array): string {
  try {
    const value = JSON.parse(Buffer.from(rawBody).toString('utf8')) as Record<string, unknown>;
    const name = value.event ?? value.eventName ?? value.type;
    return typeof name === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(name) ? name : 'webhook';
  } catch {
    return 'webhook';
  }
}

export interface SigningRoutesDependencies {
  repository: SigningRepository;
  lifecycle: SigningLifecycle;
  artifactStore: ArtifactStore;
  provider: SigningProvider;
  providerName: 'stub' | 'documenso';
  webhookSecret?: string;
  scheduleReconciliation?: () => void;
  allowStubCompletion?: boolean;
  maxUnresolvedWebhookReceipts?: number;
}

export function signingRoutes(dependencies: SigningRoutesDependencies): Route[] {
  const { repository, lifecycle, artifactStore, provider, providerName } = dependencies;
  return [
    ...operationalRoutes('document-signing-service'),
    {
      method: 'POST',
      path: '/internal/signing/charter-requests',
      handler: async (req, body) => {
        const actor = actorCitizenId(req.headers);
        if (!actor) return result(401, { error: 'trusted_actor_required' });
        const input = body as { mandateHolderId?: unknown; idempotencyKey?: unknown };
        if (typeof input.mandateHolderId !== 'string' || typeof input.idempotencyKey !== 'string')
          return result(400, { error: 'invalid_request' });
        try {
          const request = await lifecycle.initiateCharterSigning({
            mandateHolderId: input.mandateHolderId,
            actorCitizenId: actor,
            idempotencyKey: input.idempotencyKey,
          });
          return result(201, safeRequest(request));
        } catch (error) {
          return lifecycleFailure(error);
        }
      },
    },
    {
      method: 'GET',
      path: '/internal/signing/charter-status/:mandateHolderId',
      handler: async (req, _body, params) => {
        const mandateHolderId = params.mandateHolderId ?? '';
        if (!(await canReadSigningState(req, repository, mandateHolderId))) {
          return result(403, { error: 'signing_state_forbidden' });
        }
        const request = await repository.getLatestSigningRequestForHolder(mandateHolderId);
        return request ? safeRequest(request) : result(404, { error: 'signing_request_not_found' });
      },
    },
    {
      method: 'GET',
      path: '/internal/signing/requests/:id',
      handler: async (req, _body, params) => {
        const request = await repository.getSigningRequest(params.id ?? '');
        if (!request) return result(404, { error: 'signing_request_not_found' });
        if (!(await canReadSigningState(req, repository, request.mandateHolderId))) {
          return result(403, { error: 'signing_state_forbidden' });
        }
        return safeRequest(request);
      },
    },
    {
      method: 'POST',
      path: '/internal/signing/requests/:id/reconcile',
      handler: async (_req, _body, params) => {
        try {
          return safeRequest(await lifecycle.reconcile(params.id ?? ''));
        } catch (error) {
          return lifecycleFailure(error);
        }
      },
    },
    ...(providerName === 'stub' &&
    provider instanceof StubSigningProvider &&
    dependencies.allowStubCompletion !== false
      ? [
          {
            method: 'POST' as const,
            path: '/internal/signing/requests/:id/stub-complete',
            handler: async (
              req: Parameters<Route['handler']>[0],
              _body: unknown,
              params: Record<string, string>,
            ) => {
              const actor = actorCitizenId(req.headers);
              if (!actor) return result(401, { error: 'trusted_actor_required' });
              const request = await repository.getSigningRequest(params.id ?? '');
              if (!request || request.provider !== 'stub' || !request.providerEnvelopeId)
                return result(404, { error: 'signing_request_not_found' });
              const recipients = await repository.listRecipients(request.id);
              if (!recipients.some((recipient) => recipient.citizenId === actor))
                return result(403, { error: 'signing_recipient_required' });
              // Already-terminal requests are returned as-is: a repeated completion
              // must not create a second artifact, proof, or charter acceptance.
              if (TERMINAL_SIGNING_STATUSES.includes(request.status)) return safeRequest(request);
              provider.completeForTest(request.providerEnvelopeId);
              try {
                return safeRequest(await lifecycle.reconcile(request.id));
              } catch (error) {
                return lifecycleFailure(error);
              }
            },
          },
        ]
      : []),
    {
      method: 'GET',
      path: '/internal/signing/artifacts/:id/content',
      handler: async (_req, _body, params) => {
        const artifact = await repository.getArtifact(params.id ?? '');
        if (!artifact) return result(404, { error: 'artifact_not_found' });
        const bytes = await artifactStore.get(artifact.storageRef);
        if (sha256Hex(bytes) !== artifact.sha256) throw new Error('artifact_hash_mismatch');
        return binaryResult(200, bytes, artifact.mimeType, {
          'cache-control': 'private, no-store',
          'content-disposition': `attachment; filename="${(artifact.filename ?? 'document.pdf').replace(/["\\\r\n]/g, '_')}"`,
        });
      },
    },
    {
      method: 'POST',
      path: '/internal/signing/webhooks/documenso',
      bodyMode: 'raw',
      maxBodyBytes: 1_000_000,
      handler: async (req, body) => {
        if (!secretMatches(req.headers['x-documenso-secret'], dependencies.webhookSecret))
          return result(401, { error: 'invalid_webhook_secret' });
        const rawBody = body instanceof Uint8Array ? body : new Uint8Array();
        const isNew = await lifecycle.recordProviderEvent(
          rawBody,
          eventName(rawBody),
          dependencies.maxUnresolvedWebhookReceipts,
        );
        if (isNew) queueMicrotask(() => dependencies.scheduleReconciliation?.());
        return result(202, { accepted: true, duplicate: !isNew });
      },
    },
  ];
}

class HttpProofRegistrar implements ProofRegistrar {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImplementation: FetchImplementation,
  ) {}
  async register(input: Parameters<ProofRegistrar['register']>[0]): Promise<{ id: string }> {
    const response = await this.fetchImplementation(`${this.baseUrl}/internal/proofs/manifests`, {
      method: 'POST',
      headers: internalHeaders(),
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(`proof_registration_failed:${response.status}`);
    const value = (await response.json()) as { id?: unknown };
    if (typeof value.id !== 'string') throw new Error('proof_registration_invalid_response');
    return { id: value.id };
  }
}

class HttpPaperlessArchiver implements PaperlessArchiver {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImplementation: FetchImplementation,
  ) {}
  async archive(input: Parameters<PaperlessArchiver['archive']>[0]): Promise<void> {
    const response = await this.fetchImplementation(`${this.baseUrl}/internal/paperless/consume`, {
      method: 'POST',
      headers: internalHeaders(),
      body: JSON.stringify({
        contentBase64: Buffer.from(input.bytes).toString('base64'),
        filename: input.filename,
        documentClass: input.documentClass,
      }),
    });
    if (!response.ok) throw new Error(`paperless_archive_failed:${response.status}`);
  }
}

class HttpAuditEmitter implements SigningAuditEmitter {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImplementation: FetchImplementation,
  ) {}
  async emit(input: Parameters<SigningAuditEmitter['emit']>[0]): Promise<void> {
    const response = await this.fetchImplementation(`${this.baseUrl}/internal/audit/events`, {
      method: 'POST',
      headers: internalHeaders(),
      body: JSON.stringify({
        eventType: `document_signing.${input.lifecycle}`,
        actor: { type: 'service', id: 'document-signing-service' },
        target: {
          type: 'signing_request',
          id: input.requestId ?? input.charterId ?? input.mandateHolderId ?? 'unknown',
        },
        action: input.lifecycle,
        visibility: 'restricted',
        data: input,
      }),
    });
    if (!response.ok) throw new Error(`audit_emit_failed:${response.status}`);
  }
}

export interface SigningService {
  repository: SigningRepository;
  lifecycle: SigningLifecycle;
  artifactStore: ArtifactStore;
  provider: SelectedSigningProvider;
  routes: Route[];
  reconcileDue(): Promise<void>;
}

export function createReconcileDue(
  repository: SigningRepository,
  lifecycle: SigningLifecycle,
  batchSize: number,
  maxAttempts: number,
): () => Promise<void> {
  let running = false;
  return async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const due = await repository.listDueRequests(batchSize, maxAttempts);
      for (const request of due) {
        try {
          await lifecycle.reconcile(request.id);
        } catch {
          try {
            await repository.updateSigningRequest(request.id, {
              reconciled: true,
              failureCode: 'reconcile_error',
            });
          } catch {
            // A database outage can also prevent recording the failed attempt.
          }
        }
      }
    } finally {
      running = false;
    }
  };
}

export function createSigningService(
  db: DbClient,
  env: SigningServiceEnvironment = process.env,
  fetchImplementation: FetchImplementation = globalThis.fetch,
): SigningService {
  const repository = new DrizzleSigningRepository(db);
  const artifactStore = createArtifactStore(db, env);
  const selected = createSigningProvider(env, fetchImplementation);
  const lifecycle = new SigningLifecycle({
    repository,
    provider: selected.provider,
    providerName: selected.name,
    artifactStore,
    proofRegistrar: new HttpProofRegistrar(
      env.PROOF_INTERNAL_URL ?? 'http://localhost:8700',
      fetchImplementation,
    ),
    paperlessArchiver: new HttpPaperlessArchiver(
      env.PAPERLESS_INTERNAL_URL ?? 'http://localhost:8300',
      fetchImplementation,
    ),
    audit: new HttpAuditEmitter(
      env.AUDIT_INTERNAL_URL ?? 'http://localhost:8600',
      fetchImplementation,
    ),
  });
  const batchSize = Number(env.SIGNING_RECONCILE_BATCH_SIZE ?? 25);
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 100)
    throw new Error('SIGNING_RECONCILE_BATCH_SIZE is invalid');
  const maxAttempts = Number(env.SIGNING_RECONCILE_MAX_ATTEMPTS ?? 10);
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 1_000)
    throw new Error('SIGNING_RECONCILE_MAX_ATTEMPTS is invalid');
  const maxUnresolvedWebhookReceipts = Number(env.SIGNING_WEBHOOK_MAX_UNRESOLVED_RECEIPTS ?? 100);
  if (
    !Number.isSafeInteger(maxUnresolvedWebhookReceipts) ||
    maxUnresolvedWebhookReceipts < 0 ||
    maxUnresolvedWebhookReceipts > 10_000
  ) {
    throw new Error('SIGNING_WEBHOOK_MAX_UNRESOLVED_RECEIPTS is invalid');
  }
  const allowStubCompletion =
    selected.name !== 'stub' ||
    env.NODE_ENV !== 'production' ||
    env.SIGNING_ALLOW_STUB_COMPLETION === 'true';
  const reconcileDue = createReconcileDue(repository, lifecycle, batchSize, maxAttempts);
  const routes = signingRoutes({
    repository,
    lifecycle,
    artifactStore,
    provider: selected.provider,
    providerName: selected.name,
    webhookSecret: selected.webhookSecret,
    scheduleReconciliation: () => {
      void reconcileDue();
    },
    allowStubCompletion,
    maxUnresolvedWebhookReceipts,
  });
  return { repository, lifecycle, artifactStore, provider: selected, routes, reconcileDue };
}

export async function main(): Promise<void> {
  const env = process.env;
  const service = createSigningService(getClient(), env);
  const port = Number(env.PORT ?? env.DOCUMENT_SIGNING_SERVICE_PORT ?? 8960);
  startService('document-signing-service', port, service.routes);
  const interval = Number(env.SIGNING_RECONCILE_INTERVAL_MS ?? 60_000);
  if (!Number.isFinite(interval) || interval < 0)
    throw new Error('SIGNING_RECONCILE_INTERVAL_MS is invalid');
  if (interval > 0)
    setInterval(() => {
      void service.reconcileDue();
    }, interval).unref();
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) void main();
