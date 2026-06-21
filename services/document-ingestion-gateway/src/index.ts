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
import { operationalRoutes, result, startService, type Route } from '@polis/service-runtime';

type IngestionInput = {
  contentBase64?: string;
  filename?: string | null;
  documentClass?: string | null;
  issuerId?: string | null;
  issuerName?: string | null;
};

type StageName = 'paperless' | 'canonicalization' | 'proof';

/** POST JSON to an internal service; throw on non-2xx so the caller can map to 502. */
async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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

/** Build the §14.3 route table. No DB binding — reads upstream URLs from env. */
export function ingestionRoutes(): Route[] {
  return [
    ...operationalRoutes('document-ingestion-gateway'),

    {
      method: 'POST',
      path: '/internal/ingestion/documents',
      handler: async (_req, body) => {
        const input = body as IngestionInput;
        if (!input.contentBase64) return result(400, { error: 'missing_content' });

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
            originalMime: paperless.originalMime,
            originalBytes: paperless.originalBytes,
            contentVisibility: 'public',
            proofVisibility: 'public',
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
