import {
  SigningProviderError,
  type CreateSigningEnvelopeInput,
  type SigningEnvelope,
  type SigningProvider,
} from './signing-provider.js';

interface StubEnvelopeRecord {
  envelope: SigningEnvelope;
  sourcePdf: Uint8Array;
  signedPdf?: Uint8Array;
}

const completionMarker = new TextEncoder().encode(
  '\n% Polis stub completion; test output only, no legal validity.\n',
);

function copyEnvelope(envelope: SigningEnvelope): SigningEnvelope {
  return {
    id: envelope.id,
    state: envelope.state,
    recipients: envelope.recipients.map((recipient) => ({ ...recipient })),
    items: envelope.items.map((item) => ({ ...item })),
  };
}

export class StubSigningProvider implements SigningProvider {
  readonly #records = new Map<string, StubEnvelopeRecord>();
  #nextId = 1;

  async createEnvelope(input: CreateSigningEnvelopeInput): Promise<SigningEnvelope> {
    const serial = String(this.#nextId).padStart(4, '0');
    this.#nextId += 1;
    const id = `stub-envelope-${serial}`;
    const envelope: SigningEnvelope = {
      id,
      state: 'draft',
      recipients: input.recipients.map((recipient, index) => ({
        id: `${id}-recipient-${index + 1}`,
        name: recipient.name,
        email: recipient.email,
        state: 'pending',
      })),
      items: [
        {
          id: `${id}-item-1`,
          fileName: input.fileName,
          mimeType: 'application/pdf',
        },
      ],
    };
    this.#records.set(id, { envelope, sourcePdf: Uint8Array.from(input.pdf) });
    return copyEnvelope(envelope);
  }

  async distributeEnvelope(envelopeId: string): Promise<SigningEnvelope> {
    const record = this.#record(envelopeId);
    if (record.envelope.state !== 'draft') {
      throw new SigningProviderError('Stub envelope cannot be distributed from its current state', {
        code: 'invalid_state',
      });
    }
    record.envelope = { ...record.envelope, state: 'pending' };
    return copyEnvelope(record.envelope);
  }

  async getEnvelope(envelopeId: string): Promise<SigningEnvelope> {
    return copyEnvelope(this.#record(envelopeId).envelope);
  }

  async downloadSignedItem(envelopeId: string, itemId: string): Promise<Uint8Array> {
    const record = this.#record(envelopeId);
    if (record.envelope.state !== 'completed' || record.signedPdf === undefined) {
      throw new SigningProviderError('Stub signed item is not available before completion', {
        code: 'not_completed',
      });
    }
    if (!record.envelope.items.some((item) => item.id === itemId)) {
      throw new SigningProviderError('Stub signing item was not found', {
        code: 'item_not_found',
        status: 404,
      });
    }
    return Uint8Array.from(record.signedPdf);
  }

  /** Test seam: simulates all recipients completing without claiming a legal signature. */
  completeForTest(envelopeId: string): SigningEnvelope {
    const record = this.#record(envelopeId);
    // Re-completing an already-completed envelope is a no-op so a retried
    // stub completion behaves like a duplicate provider signal, not an error.
    if (record.envelope.state === 'completed') return copyEnvelope(record.envelope);
    if (record.envelope.state !== 'pending') {
      throw new SigningProviderError('Stub envelope cannot complete from its current state', {
        code: 'invalid_state',
      });
    }

    const signedPdf = new Uint8Array(record.sourcePdf.byteLength + completionMarker.byteLength);
    signedPdf.set(record.sourcePdf);
    signedPdf.set(completionMarker, record.sourcePdf.byteLength);
    record.signedPdf = signedPdf;
    record.envelope = {
      ...record.envelope,
      state: 'completed',
      recipients: record.envelope.recipients.map((recipient) => ({
        ...recipient,
        state: 'completed',
      })),
    };
    return copyEnvelope(record.envelope);
  }

  #record(envelopeId: string): StubEnvelopeRecord {
    const record = this.#records.get(envelopeId);
    if (record === undefined) {
      throw new SigningProviderError('Stub signing envelope was not found', {
        code: 'envelope_not_found',
        status: 404,
      });
    }
    return record;
  }
}
