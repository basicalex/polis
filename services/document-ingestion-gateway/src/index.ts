/**
 * @polis/document-ingestion-gateway — §14.3 pipeline conductor.
 *
 * Orchestrates the single public upload path:
 *   Upload → Paperless (consume) → Canonicalization (hashes) → Proof Service (registry)
 *
 * One orchestrating route. Each upstream call is a sequential `fetch`; any
 * non-2xx or thrown fetch returns a 502 naming the failing stage so the
 * operator can see exactly where the pipeline broke. No DB of its own —
 * persistence lives in proof-service.
 */
import {
  internalHeaders,
  operationalRoutes,
  result,
  startService,
  type Route,
} from '@polis/service-runtime';

type IngestionInput = {
  contentBase64?: string;
  filename?: string | null;
  mime?: string | null;
  documentClass?: string | null;
  issuerId?: string | null;
  issuerName?: string | null;
  contentVisibility?: string | null;
  proofVisibility?: string | null;
};

type StageName = 'paperless' | 'canonicalization' | 'proof';

const ALLOWED_MIME: Record<string, true> = {
  'application/pdf': true,
  'image/png': true,
  'image/jpeg': true,
};
const CONTENT_VISIBILITIES: Record<string, true> = {
  public: true,
  private: true,
  restricted: true,
  redacted: true,
  sealed: true,
};
const PROOF_VISIBILITIES: Record<string, true> = {
  public: true,
  restricted: true,
  private: true,
  commitment_only: true,
};
const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_FILENAME_BYTES = 255;

/** POST JSON to an internal service; throw on non-2xx so the caller can map to 502. */
async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: internalHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ status: res.status }));
    throw new Error(JSON.stringify(detail));
  }
  return (await res.json()) as T;
}

const badGateway = (stage: StageName, message: string) =>
  result(502, { error: 'bad_gateway', stage, detail: message });
/**
 * Best-effort audit emit. Failures (audit-service unreachable) are swallowed
 * and never fail the originating request — matches proof-service / platform-api.
 * Payload shape mirrors proof-service's emitAudit (required visibility + actor).
 */
async function emitAudit(event: {
  eventType: string;
  action: string;
  target: { type: string; id: string };
  data: Record<string, unknown>;
}): Promise<void> {
  const base = process.env.AUDIT_INTERNAL_URL ?? 'http://localhost:8600';
  try {
    await fetch(base + '/internal/audit/events', {
      method: 'POST',
      headers: internalHeaders(),
      body: JSON.stringify({
        eventType: event.eventType,
        action: event.action,
        visibility: 'public',
        actor: { type: 'service', id: 'document-ingestion-gateway' },
        target: event.target,
        data: event.data,
        correlationId: null,
      }),
    });
  } catch {
    /* best-effort, never throw — matches proof-service */
  }
}

/** Build the §14.3 route table. No DB binding — reads upstream URLs from env. */
export function ingestionRoutes(): Route[] {
  const configuredMax = Number(process.env.DOCUMENT_MAX_UPLOAD_BYTES ?? DEFAULT_MAX_UPLOAD_BYTES);
  const maxUploadBytes =
    Number.isSafeInteger(configuredMax) && configuredMax > 0
      ? configuredMax
      : DEFAULT_MAX_UPLOAD_BYTES;
  const maxBodyBytes = Math.ceil(maxUploadBytes / 3) * 4 + 16 * 1024;

  return [
    ...operationalRoutes('document-ingestion-gateway'),

    {
      method: 'POST',
      path: '/internal/ingestion/documents',
      maxBodyBytes,
      handler: async (_req, body) => {
        const input = body as IngestionInput;
        if (typeof input.contentBase64 !== 'string' || input.contentBase64.length === 0) {
          return result(400, { error: 'missing_content' });
        }
        if (
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
            input.contentBase64,
          )
        ) {
          return result(400, { error: 'invalid_base64' });
        }
        const bytes = Buffer.from(input.contentBase64, 'base64');
        if (bytes.toString('base64') !== input.contentBase64) {
          return result(400, { error: 'invalid_base64' });
        }
        if (bytes.byteLength > maxUploadBytes) {
          return result(400, { error: 'upload_too_large' });
        }
        if (
          input.filename != null &&
          (typeof input.filename !== 'string' ||
            input.filename.length === 0 ||
            Buffer.byteLength(input.filename) > MAX_FILENAME_BYTES ||
            // eslint-disable-next-line no-control-regex -- Intentionally reject ASCII control characters.
            /[/\\\u0000-\u001f\u007f]/.test(input.filename))
        ) {
          return result(400, { error: 'unsafe_filename' });
        }
        if (typeof input.mime !== 'string' || !Object.hasOwn(ALLOWED_MIME, input.mime)) {
          return result(400, { error: 'invalid_mime' });
        }
        const magicMatches =
          (input.mime === 'application/pdf' && bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) ||
          (input.mime === 'image/png' &&
            bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
          (input.mime === 'image/jpeg' &&
            bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])));
        if (!magicMatches) return result(400, { error: 'mime_mismatch' });
        if (input.contentVisibility == null || input.proofVisibility == null) {
          return result(400, { error: 'missing_visibility' });
        }
        if (!Object.hasOwn(CONTENT_VISIBILITIES, input.contentVisibility)) {
          return result(400, { error: 'invalid_content_visibility' });
        }
        if (!Object.hasOwn(PROOF_VISIBILITIES, input.proofVisibility)) {
          return result(400, { error: 'invalid_proof_visibility' });
        }
        const paperlessUrl = process.env.PAPERLESS_INTERNAL_URL ?? 'http://localhost:8300';
        const canonicalizationUrl =
          process.env.CANONICALIZATION_INTERNAL_URL ?? 'http://localhost:8500';
        const proofUrl = process.env.PROOF_INTERNAL_URL ?? 'http://localhost:8700';

        const documentClass = input.documentClass ?? 'public-government-record';
        const issuerId = input.issuerId ?? 'issuer-demo-authority';
        const issuerName = input.issuerName ?? 'Polis Interface Demo Authority';
        const filename = input.filename ?? null;

        // 1. Paperless ingest.
        let paperless: {
          id: string;
          originalMime: string | null;
          originalBytes: number;
          metadata: Record<string, unknown>;
        };
        try {
          paperless = await postJson(paperlessUrl + '/internal/paperless/consume', {
            contentBase64: input.contentBase64,
            filename,
            documentClass,
          });
        } catch (err) {
          return badGateway('paperless', err instanceof Error ? err.message : 'unknown');
        }
        // Persist the observable Paperless doc-id link (best-effort). This
        // audit event is how a proof manifest traces back to its Paperless
        // document — no schema column exists for it (the roadmap's storage_uri
        // was never added; M11 deliberately adds no migration).
        await emitAudit({
          eventType: 'document.paperless.linked',
          action: 'link',
          target: { type: 'document', id: paperless.id },
          data: { paperlessDocumentId: paperless.id, originalFilename: filename, documentClass },
        });

        // 2. Canonicalize.
        let hashes: {
          originalFileHash: string;
          canonicalPdfHash: string;
          ocrTextHash: string;
          metadataHash: string;
          manifestHash: string;
          algorithm: 'sha256';
        };
        try {
          hashes = await postJson(canonicalizationUrl + '/internal/canonicalization/canonicalize', {
            contentBase64: input.contentBase64,
            metadata: paperless.metadata,
          });
        } catch (err) {
          return badGateway('canonicalization', err instanceof Error ? err.message : 'unknown');
        }

        // 3. Persist the manifest.
        try {
          const manifest = await postJson(proofUrl + '/internal/proofs/manifests', {
            ...hashes,
            documentClass,
            documentTypeId: null,
            issuerId,
            issuerName,
            originalFilename: filename,
            originalMime: input.mime,
            originalBytes: paperless.originalBytes,
            contentVisibility: input.contentVisibility,
            proofVisibility: input.proofVisibility,
            algorithm: hashes.algorithm,
          });
          return result(201, manifest);
        } catch (err) {
          return badGateway('proof', err instanceof Error ? err.message : 'unknown');
        }
      },
    },
  ];
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? process.env.DOCUMENT_INGESTION_GATEWAY_PORT ?? 8400);
  startService('document-ingestion-gateway', port, ingestionRoutes());
  console.log(JSON.stringify({ service: 'document-ingestion-gateway', port, status: 'listening' }));
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) void main();
