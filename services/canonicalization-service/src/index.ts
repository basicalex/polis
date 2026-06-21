/**
 * @polis/canonicalization-service — §9.11 canonicalization pipeline step.
 *
 * Stateless hashing service. Computes the four canonical hashes plus a
 * manifest hash from a base64-encoded original. In v0 the canonical PDF hash
 * equals the original-file hash (no real PDF/A normalization — that lands with
 * a real Paperless deploy). Hashing reuses @polis/domain's sha256Hex so the
 * verifier can recompute the original-file hash without depending on this
 * service being up.
 */
import { sha256Hex } from '@polis/domain';
import { operationalRoutes, result, startService, type Route } from '@polis/service-runtime';

type CanonicalizeInput = { contentBase64?: string; metadata?: Record<string, unknown> | null };

export type CanonicalizeResult = {
  originalFileHash: string;
  canonicalPdfHash: string;
  ocrTextHash: string;
  metadataHash: string;
  manifestHash: string;
  algorithm: 'sha256';
};

/** Compute the §9.11 canonical hash bundle from decoded bytes + metadata. */
export async function canonicalize(
  contentBase64: string,
  metadata: Record<string, unknown> | null,
): Promise<CanonicalizeResult> {
  const bytes = new Uint8Array(Buffer.from(contentBase64, 'base64'));
  const originalFileHash = await sha256Hex(bytes);
  // v0: canonical == original for non-PDF inputs. Real PDF/A canonicalization
  // ships when a Paperless-ngx deploy normalizes uploads.
  const canonicalPdfHash = originalFileHash;
  const ocrTextHash = await sha256Hex('stub-ocr:' + originalFileHash);
  const metadataHash = await sha256Hex(JSON.stringify(metadata ?? {}));
  const manifestHash = await sha256Hex(
    [originalFileHash, canonicalPdfHash, ocrTextHash, metadataHash].join('|'),
  );
  return {
    originalFileHash,
    canonicalPdfHash,
    ocrTextHash,
    metadataHash,
    manifestHash,
    algorithm: 'sha256',
  };
}

/** Build the §9.11 route table. Stateless — no DB or adapter binding. */
export function canonicalizationRoutes(): Route[] {
  return [
    ...operationalRoutes('canonicalization-service'),

    {
      method: 'POST',
      path: '/internal/canonicalization/canonicalize',
      handler: async (_req, body) => {
        const input = body as CanonicalizeInput;
        if (!input.contentBase64) return result(400, { error: 'missing_content' });
        return await canonicalize(input.contentBase64, input.metadata ?? null);
      },
    },
  ];
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? process.env.CANONICALIZATION_SERVICE_PORT ?? 8500);
  startService('canonicalization-service', port, canonicalizationRoutes());
  console.log(JSON.stringify({ service: 'canonicalization-service', port, status: 'listening' }));
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) void main();
