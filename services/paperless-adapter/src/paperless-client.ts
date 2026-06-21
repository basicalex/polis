/**
 * @polis/paperless-adapter — Paperless document node seam (spec §23.9).
 *
 * The only M3 implementation is {@link StubPaperlessClient}; a real Paperless-ngx
 * HTTP adapter lands when a Paperless instance is deployed. {@link createPaperlessClient}
 * is the single seam — PAPERLESS_MODE=http throws until that milestone so a
 * misconfigured deploy fails fast rather than silently falling back. No HTTP
 * client is shipped in M3 (mirrors the M2 Polis adapter rule).
 */
import { createHash } from 'node:crypto';

export type PaperlessConsumeInput = {
  contentBase64: string;
  filename: string | null;
  documentClass: string | null;
};

export type PaperlessDocument = {
  id: string;
  originalMime: string | null;
  originalBytes: number;
  archiveRef: string | null;
  ocrText: string;
  metadata: Record<string, unknown>;
};

export interface PaperlessClient {
  consume(input: PaperlessConsumeInput): Promise<PaperlessDocument>;
  fetchDocument(id: string): Promise<PaperlessDocument | null>;
}

const stubId = (contentBase64: string): string =>
  `paperless-stub-${createHash('sha256').update(contentBase64).digest('hex').slice(0, 16)}`;

const guessMime = (filename: string | null): string | null => {
  if (!filename) return null;
  const ext = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'txt') return 'text/plain';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  return 'application/octet-stream';
};

/**
 * Deterministic stub used in M3 (and in tests). No network. The document id is
 * derived from the SHA-256 of the base64 content so the same bytes always map
 * to the same node; ocrText is a stable placeholder; metadata carries the
 * consumed-at timestamp + a `source:'stub'` marker.
 */
export class StubPaperlessClient implements PaperlessClient {
  async consume(input: PaperlessConsumeInput): Promise<PaperlessDocument> {
    const bytes = Buffer.from(input.contentBase64, 'base64');
    const id = stubId(input.contentBase64);
    return {
      id,
      originalMime: guessMime(input.filename),
      originalBytes: bytes.byteLength,
      archiveRef: `stub-archive://${id}`,
      ocrText: `Stub OCR for ${input.filename ?? 'document'}`,
      metadata: {
        consumedAt: new Date().toISOString(),
        source: 'stub',
        documentClass: input.documentClass,
        originalFilename: input.filename,
      },
    };
  }

  async fetchDocument(id: string): Promise<PaperlessDocument | null> {
    if (!id.startsWith('paperless-stub-')) return null;
    return {
      id,
      originalMime: null,
      originalBytes: 0,
      archiveRef: `stub-archive://${id}`,
      ocrText: `Stub OCR for ${id}`,
      metadata: { source: 'stub', refetchedAt: new Date().toISOString() },
    };
  }
}

/**
 * Resolve the Paperless adapter from PAPERLESS_MODE. Only 'stub' (default) is
 * supported in M3; any other value throws a clear error naming the milestone
 * that ships the real adapter.
 */
export function createPaperlessClient(): PaperlessClient {
  const mode = process.env.PAPERLESS_MODE ?? 'stub';
  if (mode === 'stub') return new StubPaperlessClient();
  throw new Error(
    `PAPERLESS_MODE=${mode} is not supported in M3; lands when a Paperless-ngx instance is deployed`,
  );
}
