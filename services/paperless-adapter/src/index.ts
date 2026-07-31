/**
 * @polis/paperless-adapter — §23.9 internal document-node API.
 *
 * Restricted service (not proxied through the public BFF). Owns the document
 * ingest/archive/metadata surface that the ingestion gateway orchestrates.
 * Routes are bound to a {@link PaperlessClient} so the stub and the future HTTP
 * adapter share one contract.
 */
import {
  binaryResult,
  operationalRoutes,
  result,
  startService,
  type HttpResult,
  type Route,
} from '@polis/service-runtime';

import {
  createPaperlessClient,
  type PaperlessClient,
  type PaperlessDocument,
} from './paperless-client.js';

/** Stable 404 contract for detail endpoints. */
const notFound = (id: string): HttpResult => result(404, { error: 'not_found', id });

const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Build the §23.9 route table bound to a Paperless adapter. */
export function paperlessRoutes(client: PaperlessClient): Route[] {
  const configuredMax = Number(
    process.env.DOCUMENT_MAX_UPLOAD_BYTES ?? DEFAULT_MAX_UPLOAD_BYTES,
  );
  const maxUploadBytes =
    Number.isSafeInteger(configuredMax) && configuredMax > 0
      ? configuredMax
      : DEFAULT_MAX_UPLOAD_BYTES;
  const maxBodyBytes = Math.ceil(maxUploadBytes / 3) * 4 + 16 * 1024;

  return [
    ...operationalRoutes('paperless-adapter'),

    {
      method: 'POST',
      path: '/internal/paperless/consume',
      maxBodyBytes,
      handler: async (_req, body) => {
        const input = body as {
          contentBase64?: string;
          filename?: string | null;
          documentClass?: string | null;
        };
        if (!input.contentBase64) return result(400, { error: 'missing_content' });
        const doc = await client.consume({
          contentBase64: input.contentBase64,
          filename: input.filename ?? null,
          documentClass: input.documentClass ?? null,
        });
        return result(201, doc);
      },
    },

    {
      method: 'GET',
      path: '/internal/paperless/documents/:id',
      handler: async (_req, _body, params) => {
        const doc = await client.fetchDocument(params.id);
        if (!doc) return notFound(params.id);
        return doc;
      },
    },

    {
      method: 'GET',
      path: '/internal/paperless/documents/:id/original',
      handler: async (_req, _body, params) => {
        const doc = await client.fetchDocument(params.id);
        if (!doc) return notFound(params.id);
        return {
          documentId: params.id,
          originalRef: doc.originalMime ? `paperless-original://${params.id}` : null,
        };
      },
    },

    {
      method: 'GET',
      path: '/internal/paperless/documents/:id/archive',
      handler: async (_req, _body, params) => {
        const archive = await client.fetchArchive(params.id);
        if (!archive) return notFound(params.id);
        return binaryResult(200, archive.bytes, archive.mime);
      },
    },

    {
      method: 'GET',
      path: '/internal/paperless/documents/:id/metadata',
      handler: async (_req, _body, params) => {
        const doc = await client.fetchDocument(params.id);
        if (!doc) return notFound(params.id);
        return { documentId: params.id, metadata: doc.metadata };
      },
    },

    {
      method: 'POST',
      path: '/internal/paperless/documents/:id/reprocess',
      handler: async (_req, _body, params) => {
        const doc = await client.fetchDocument(params.id);
        if (!doc) return notFound(params.id);
        return result(201, doc satisfies PaperlessDocument);
      },
    },
  ];
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? process.env.PAPERLESS_ADAPTER_PORT ?? 8300);
  const client = createPaperlessClient();
  startService('paperless-adapter', port, paperlessRoutes(client));
  console.log(JSON.stringify({ service: 'paperless-adapter', port, status: 'listening' }));
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) void main();
