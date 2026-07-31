import assert from 'node:assert/strict';
import test from 'node:test';
import { renderCharterPdf } from './charter-pdf.js';
import type { CreateSigningEnvelopeInput, SigningProvider } from './signing-provider.js';
import { SigningProviderError } from './signing-provider.js';
import { StubSigningProvider } from './stub-provider.js';

function input(): CreateSigningEnvelopeInput {
  const rendered = renderCharterPdf({ title: 'Deterministic charter' }, [
    { displayName: 'Ada Chair' },
  ]);
  return {
    title: 'Polis Charter',
    fileName: 'charter.pdf',
    pdf: rendered.pdf,
    recipients: [{ name: 'Ada Chair', email: 'ada@example.test' }],
    fields: rendered.fields,
  };
}

test('stub provider implements deterministic draft and distribution lifecycle', async () => {
  const provider: SigningProvider = new StubSigningProvider();
  const created = await provider.createEnvelope(input());
  assert.equal(created.id, 'stub-envelope-0001');
  assert.equal(created.items[0]?.id, 'stub-envelope-0001-item-1');
  assert.equal(created.state, 'draft');
  assert.equal(created.recipients[0]?.state, 'pending');

  const distributed = await provider.distributeEnvelope(created.id);
  assert.equal(distributed.state, 'pending');
  assert.deepEqual(await provider.getEnvelope(created.id), distributed);

  const secondProvider = new StubSigningProvider();
  assert.equal((await secondProvider.createEnvelope(input())).id, created.id);
});

test('stub completion produces a distinct parseable PDF derivative', async () => {
  const provider = new StubSigningProvider();
  const source = input();
  const sourceBefore = Uint8Array.from(source.pdf);
  const created = await provider.createEnvelope(source);
  await provider.distributeEnvelope(created.id);

  await assert.rejects(
    provider.downloadSignedItem(created.id, created.items[0]!.id),
    (error: unknown) => error instanceof SigningProviderError && error.code === 'not_completed',
  );

  const completed = provider.completeForTest(created.id);
  assert.equal(completed.state, 'completed');
  assert.ok(completed.recipients.every((recipient) => recipient.state === 'completed'));
  const signed = await provider.downloadSignedItem(created.id, created.items[0]!.id);
  assert.notDeepEqual(signed, source.pdf);
  assert.deepEqual(source.pdf, sourceBefore);
  assert.ok(Buffer.from(signed).subarray(0, source.pdf.byteLength).equals(Buffer.from(source.pdf)));
  assert.match(Buffer.from(signed).toString('ascii'), /^%PDF-1\.4/);
  assert.match(Buffer.from(signed).toString('ascii'), /%%EOF\n+% Polis stub completion/);
  assert.match(Buffer.from(signed).toString('ascii'), /no legal validity/);
});

test('stub provider rejects invalid lifecycle operations and unknown items', async () => {
  const provider = new StubSigningProvider();
  const created = await provider.createEnvelope(input());
  assert.throws(
    () => provider.completeForTest(created.id),
    (error: unknown) => error instanceof SigningProviderError && error.code === 'invalid_state',
  );
  await provider.distributeEnvelope(created.id);
  provider.completeForTest(created.id);
  await assert.rejects(
    provider.downloadSignedItem(created.id, 'missing-item'),
    (error: unknown) => error instanceof SigningProviderError && error.code === 'item_not_found',
  );
  await assert.rejects(
    provider.getEnvelope('missing-envelope'),
    (error: unknown) =>
      error instanceof SigningProviderError &&
      error.code === 'envelope_not_found' &&
      error.status === 404,
  );
});
