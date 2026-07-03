/**
 * @polis/paperless-adapter — Paperless document node seam (spec §23.9).
 *
 * Two implementations: {@link StubPaperlessClient} (M3, frozen dev path, no
 * network — default) and {@link HttpPaperlessClient} (M11, real Paperless-ngx
 * HTTP adapter — PAPERLESS_MODE=http). {@link createPaperlessClient} is the
 * single seam; any unknown mode throws so a misconfigured deploy fails fast
 * rather than silently falling back.
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
 * Deterministic Archive Serial Number for a content blob: a stable positive
 * 31-bit int keyed on the SHA-256 of the base64 content. ASN is unique in
 * Paperless, so this makes a consume idempotent (preflight hit → no re-upload)
 * and lets the async poll resolve the created doc by content alone.
 */
const deterministicAsn = (contentBase64: string): number =>
  parseInt(createHash('sha256').update(contentBase64).digest('hex').slice(0, 8), 16) & 0x7fffffff;

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
 * Real Paperless-ngx HTTP adapter (M11). Activated by PAPERLESS_MODE=http.
 *
 * Paperless consumption is asynchronous: `POST /api/documents/post_document/`
 * queues a celery task and returns before the document exists in
 * `/api/documents/`. This adapter makes the upload idempotent + resolvable via
 * the deterministic ASN — it is unique in Paperless, so a preflight
 * `GET ?archive_serial_number=<asn>` returns an already-consumed doc instead of
 * re-uploading, and the same query resolves the created doc once the worker
 * finishes.
 *
 * Auth: a DRF Token on every call (`Authorization: Token <PAPERLESS_API_TOKEN>`),
 * provisioned deterministically by infra/paperless/init-token.sh so dev has a
 * known shared secret (M10 shared-secret pattern). No new dependency — Node
 * fetch/FormData/Blob globals.
 */
export class HttpPaperlessClient implements PaperlessClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly pollIntervalMs: number;
  private readonly pollTimeoutMs: number;

  constructor() {
    const baseUrl = process.env.PAPERLESS_BASE_URL ?? 'http://paperless:8000';
    const token = process.env.PAPERLESS_API_TOKEN;
    if (!token) {
      throw new Error('PAPERLESS_API_TOKEN is required when PAPERLESS_MODE=http');
    }
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
    this.pollIntervalMs = Number(process.env.PAPERLESS_POLL_INTERVAL_MS ?? 2000);
    this.pollTimeoutMs = Number(process.env.PAPERLESS_POLL_TIMEOUT_MS ?? 60000);
  }

  private authHeaders(): Record<string, string> {
    return { authorization: `Token ${this.token}` };
  }

  async consume(input: PaperlessConsumeInput): Promise<PaperlessDocument> {
    const bytes = Buffer.from(input.contentBase64, 'base64');
    const asn = deterministicAsn(input.contentBase64);

    // 1. Idempotency preflight — ASN is unique, so an existing match means a
    //    prior consume already landed; return it instead of re-uploading.
    const existing = await this.findByAsn(asn);
    if (existing) return this.mapConsumedDoc(existing, input, asn, bytes.byteLength);

    // 2. Queue the async consume task (multipart — no new dependency).
    const form = new FormData();
    form.append('document', new Blob([bytes]), input.filename ?? 'polis-upload');
    form.append('title', input.filename ?? 'polis-upload');
    if (input.filename) form.append('original_filename', input.filename);
    form.append('archive_serial_number', String(asn));
    const uploadRes = await fetch(`${this.baseUrl}/api/documents/post_document/`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: form,
    });
    if (!uploadRes.ok) throw new Error(`paperless_upload_${uploadRes.status}`);

    // 3. Poll until the worker materialises the document (resolve by ASN).
    const deadline = Date.now() + this.pollTimeoutMs;
    for (;;) {
      const raw = await this.findByAsn(asn);
      if (raw) return this.mapConsumedDoc(raw, input, asn, bytes.byteLength);
      if (Date.now() >= deadline) throw new Error('consume_timeout');
      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
    }
  }

  async fetchDocument(id: string): Promise<PaperlessDocument | null> {
    const res = await fetch(
      `${this.baseUrl}/api/documents/${encodeURIComponent(id)}/`,
      { headers: this.authHeaders() },
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`paperless_fetch_${res.status}`);
    return this.mapFetchedDoc((await res.json()) as Record<string, unknown>);
  }

  /** Resolve a raw doc by ASN, or null. Paperless returns results in `results[]`. */
  private async findByAsn(asn: number): Promise<Record<string, unknown> | null> {
    const res = await fetch(
      `${this.baseUrl}/api/documents/?archive_serial_number=${asn}&page_size=1`,
      { headers: this.authHeaders() },
    );
    if (!res.ok) throw new Error(`paperless_lookup_${res.status}`);
    const body = (await res.json()) as { results?: Array<Record<string, unknown>> };
    return body.results?.[0] ?? null;
  }

  private mapConsumedDoc(
    doc: Record<string, unknown>,
    input: PaperlessConsumeInput,
    asn: number,
    fallbackBytes: number,
  ): PaperlessDocument {
    const id = String(doc.id);
    const archiveFileSize = typeof doc.archive_file_size === 'number' ? doc.archive_file_size : undefined;
    const originalFileSize = typeof doc.original_file_size === 'number' ? doc.original_file_size : undefined;
    return {
      id,
      originalMime: typeof doc.mime_type === 'string' ? doc.mime_type : guessMime(input.filename),
      originalBytes: archiveFileSize ?? originalFileSize ?? fallbackBytes,
      archiveRef: typeof doc.archive_file === 'string' ? `paperless-archive://${id}` : null,
      ocrText: typeof doc.content === 'string' ? doc.content : '',
      metadata: {
        paperlessDocumentId: id,
        archiveSerialNumber: asn,
        source: 'paperless-ngx',
        originalFilename: input.filename,
        documentClass: input.documentClass,
        consumedAt: new Date().toISOString(),
      },
    };
  }

  private mapFetchedDoc(doc: Record<string, unknown>): PaperlessDocument {
    const id = String(doc.id);
    const archiveFileSize = typeof doc.archive_file_size === 'number' ? doc.archive_file_size : undefined;
    const originalFileSize = typeof doc.original_file_size === 'number' ? doc.original_file_size : undefined;
    return {
      id,
      originalMime: typeof doc.mime_type === 'string' ? doc.mime_type : null,
      originalBytes: archiveFileSize ?? originalFileSize ?? 0,
      archiveRef: typeof doc.archive_file === 'string' ? `paperless-archive://${id}` : null,
      ocrText: typeof doc.content === 'string' ? doc.content : '',
      metadata: { paperlessDocumentId: id, source: 'paperless-ngx' },
    };
  }
}

/**
 * Resolve the Paperless adapter from PAPERLESS_MODE. 'stub' (default) is the
 * frozen dev path; 'http' (M11) is the real Paperless-ngx adapter; anything
 * else throws a clear error so a misconfigured deploy fails fast rather than
 * silently falling back.
 */
export function createPaperlessClient(): PaperlessClient {
  const mode = process.env.PAPERLESS_MODE ?? 'stub';
  if (mode === 'stub') return new StubPaperlessClient();
  if (mode === 'http') return new HttpPaperlessClient();
  throw new Error(
    `PAPERLESS_MODE=${mode} is not supported; use 'stub' or 'http'`,
  );
}
