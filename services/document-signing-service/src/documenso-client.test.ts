import assert from 'node:assert/strict';
import test from 'node:test';
import { DocumensoClient } from './documenso-client.js';
import { SigningProviderError, type CreateSigningEnvelopeInput } from './signing-provider.js';

const pdf = new TextEncoder().encode('%PDF-1.4\n%%EOF\n');

function envelope(status = 'COMPLETED'): Record<string, unknown> {
  return {
    id: 'env-1',
    status,
    recipients: [
      { id: 'recipient-1', name: 'Ada Chair', email: 'ada@example.test', status: 'SIGNED' },
    ],
    items: [{ id: 'item-1', fileName: 'charter.pdf' }],
  };
}

function signingInput(): CreateSigningEnvelopeInput {
  return {
    title: 'Polis Charter',
    fileName: 'charter.pdf',
    pdf,
    recipients: [{ name: 'Ada Chair', email: 'ada@example.test' }],
    fields: [
      {
        recipientIndex: 0,
        type: 'signature',
        page: 2,
        x: 10,
        y: 20,
        width: 30,
        height: 10,
      },
    ],
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('create uses raw authorization and multipart payload/files on the v2 endpoint', async () => {
  let called = false;
  const client = new DocumensoClient({
    baseUrl: 'https://documenso.test/api/v2/',
    apiToken: 'raw-secret-token',
    fetch: async (request, init) => {
      called = true;
      assert.equal(String(request), 'https://documenso.test/api/v2/envelope/create');
      assert.equal(init?.method, 'POST');
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('Authorization'), 'raw-secret-token');
      assert.equal(headers.get('Content-Type'), null);
      assert.ok(!headers.get('Authorization')?.startsWith('Bearer '));

      assert.ok(init?.body instanceof FormData);
      const payloadPart = init.body.get('payload');
      const filePart = init.body.get('files');
      assert.ok(payloadPart instanceof Blob);
      assert.equal(payloadPart.type, 'application/json');
      assert.deepEqual(JSON.parse(await payloadPart.text()), {
        title: 'Polis Charter',
        recipients: [{ id: 1, name: 'Ada Chair', email: 'ada@example.test', role: 'SIGNER' }],
        fields: [
          {
            recipientId: 1,
            type: 'SIGNATURE',
            page: 2,
            x: 10,
            y: 20,
            width: 30,
            height: 10,
          },
        ],
      });
      assert.ok(filePart instanceof Blob);
      assert.equal(filePart.type, 'application/pdf');
      assert.deepEqual(new Uint8Array(await filePart.arrayBuffer()), pdf);
      return jsonResponse(envelope('DRAFT'));
    },
  });

  const created = await client.createEnvelope(signingInput());
  assert.ok(called);
  assert.equal(created.state, 'draft');
  assert.equal(created.recipients[0]?.state, 'completed');
});

test('distribute posts the envelope id then reads authoritative envelope state', async () => {
  const calls: string[] = [];
  const client = new DocumensoClient({
    baseUrl: 'https://documenso.test/api/v2',
    apiToken: 'token',
    fetch: async (request, init) => {
      const url = String(request);
      calls.push(url);
      assert.equal(new Headers(init?.headers).get('Authorization'), 'token');
      if (url.endsWith('/envelope/distribute')) {
        assert.equal(init?.method, 'POST');
        assert.equal(new Headers(init.headers).get('Content-Type'), 'application/json');
        assert.equal(init.body, JSON.stringify({ envelopeId: 'env/one' }));
        return new Response(null, { status: 204 });
      }
      assert.equal(url, 'https://documenso.test/api/v2/envelope/env%2Fone');
      assert.equal(init?.method, undefined);
      return jsonResponse(envelope('DISTRIBUTED'));
    },
  });

  assert.equal((await client.distributeEnvelope('env/one')).state, 'pending');
  assert.deepEqual(calls, [
    'https://documenso.test/api/v2/envelope/distribute',
    'https://documenso.test/api/v2/envelope/env%2Fone',
  ]);
});

test('getEnvelope maps Documenso terminal and active states', async () => {
  const expected = {
    DRAFT: 'draft',
    PENDING: 'pending',
    COMPLETED: 'completed',
    REJECTED: 'rejected',
    CANCELLED: 'cancelled',
    EXPIRED: 'expired',
  } as const;

  for (const [providerState, internalState] of Object.entries(expected)) {
    const client = new DocumensoClient({
      baseUrl: 'https://documenso.test/api/v2',
      apiToken: 'token',
      fetch: async () => jsonResponse(envelope(providerState)),
    });
    assert.equal((await client.getEnvelope('env-1')).state, internalState);
  }
});

test('signed download uses exact endpoint and returns PDF bytes only after completion', async () => {
  const calls: string[] = [];
  const client = new DocumensoClient({
    baseUrl: 'https://documenso.test/api/v2',
    apiToken: 'token',
    fetch: async (request) => {
      const url = String(request);
      calls.push(url);
      if (url.endsWith('/envelope/env-1')) return jsonResponse(envelope());
      assert.equal(
        url,
        'https://documenso.test/api/v2/envelope/item/item-1/download?version=signed',
      );
      return new Response(pdf, { headers: { 'Content-Type': 'application/pdf; charset=binary' } });
    },
  });

  assert.deepEqual(await client.downloadSignedItem('env-1', 'item-1'), pdf);
  assert.equal(calls.length, 2);

  const pendingClient = new DocumensoClient({
    baseUrl: 'https://documenso.test/api/v2',
    apiToken: 'token',
    fetch: async () => jsonResponse(envelope('PENDING')),
  });
  await assert.rejects(
    pendingClient.downloadSignedItem('env-1', 'item-1'),
    (error: unknown) => error instanceof SigningProviderError && error.code === 'not_completed',
  );
});

test('signed download rejects wrong MIME and declared or streamed oversize bodies', async () => {
  const makeClient = (downloadResponse: Response, maxDownloadBytes = 16) =>
    new DocumensoClient({
      baseUrl: 'https://documenso.test/api/v2',
      apiToken: 'token',
      maxDownloadBytes,
      fetch: async (request) =>
        String(request).endsWith('/envelope/env-1') ? jsonResponse(envelope()) : downloadResponse,
    });

  await assert.rejects(
    makeClient(
      new Response('not pdf', { headers: { 'Content-Type': 'text/plain' } }),
    ).downloadSignedItem('env-1', 'item-1'),
    (error: unknown) =>
      error instanceof SigningProviderError && error.code === 'invalid_content_type',
  );
  await assert.rejects(
    makeClient(
      new Response(pdf, {
        headers: { 'Content-Type': 'application/pdf', 'Content-Length': '17' },
      }),
    ).downloadSignedItem('env-1', 'item-1'),
    (error: unknown) =>
      error instanceof SigningProviderError && error.code === 'download_too_large',
  );
  await assert.rejects(
    makeClient(
      new Response(new Uint8Array(17), { headers: { 'Content-Type': 'application/pdf' } }),
    ).downloadSignedItem('env-1', 'item-1'),
    (error: unknown) =>
      error instanceof SigningProviderError && error.code === 'download_too_large',
  );
});

test('non-2xx errors expose safe status/code and redact response secrets', async () => {
  const client = new DocumensoClient({
    baseUrl: 'https://documenso.test/api/v2',
    apiToken: 'top-secret-token',
    fetch: async () =>
      jsonResponse(
        {
          code: 'rate_limited',
          email: 'private@example.test',
          signedUrl: 'https://private.test/signed-secret',
          token: 'top-secret-token',
        },
        429,
      ),
  });

  await assert.rejects(client.getEnvelope('env-1'), (error: unknown) => {
    assert.ok(error instanceof SigningProviderError);
    assert.equal(error.status, 429);
    assert.equal(error.code, 'rate_limited');
    assert.equal(error.retryable, true);
    const exposed = JSON.stringify({
      message: error.message,
      code: error.code,
      status: error.status,
      cause: error.cause,
    });
    assert.doesNotMatch(exposed, /top-secret-token|private@example|signed-secret/);
    return true;
  });
});

test('constructor rejects missing or invalid Documenso configuration', () => {
  assert.throws(
    () => new DocumensoClient({ baseUrl: '', apiToken: 'token' }),
    (error: unknown) => error instanceof SigningProviderError && error.code === 'invalid_config',
  );
  assert.throws(
    () => new DocumensoClient({ baseUrl: 'https://documenso.test', apiToken: '   ' }),
    (error: unknown) => error instanceof SigningProviderError && error.code === 'invalid_config',
  );
  assert.throws(
    () =>
      new DocumensoClient({
        baseUrl: 'https://documenso.test',
        apiToken: 'token',
        maxDownloadBytes: 0,
      }),
    (error: unknown) => error instanceof SigningProviderError && error.code === 'invalid_config',
  );
});
