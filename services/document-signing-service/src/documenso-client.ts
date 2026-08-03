import {
  SigningProviderError,
  type CreateSigningEnvelopeInput,
  type SigningEnvelope,
  type SigningEnvelopeItem,
  type SigningProvider,
  type SigningProviderState,
  type SigningRecipient,
  type SigningRecipientState,
} from './signing-provider.js';

const DEFAULT_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const STATE_BY_DOCUMENSO_STATE: Readonly<Record<string, SigningProviderState>> = {
  DRAFT: 'draft',
  CREATED: 'draft',
  PENDING: 'pending',
  DISTRIBUTED: 'pending',
  OPENED: 'pending',
  SIGNING: 'pending',
  COMPLETED: 'completed',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
};
const RECIPIENT_STATE_BY_DOCUMENSO_STATE: Readonly<Record<string, SigningRecipientState>> = {
  PENDING: 'pending',
  SENT: 'pending',
  OPENED: 'pending',
  SIGNING: 'pending',
  COMPLETED: 'completed',
  SIGNED: 'completed',
  REJECTED: 'rejected',
};

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface DocumensoClientConfig {
  readonly baseUrl: string;
  readonly apiToken: string;
  readonly maxDownloadBytes?: number;
  readonly fetch?: FetchImplementation;
}

function recordValue(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new SigningProviderError('Documenso returned an invalid response', {
      code: 'invalid_response',
    });
  }
  return value as Record<string, unknown>;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new SigningProviderError('Documenso returned an invalid response', {
      code: 'invalid_response',
    });
  }
  return value;
}

function normalizedState(value: unknown): SigningProviderState {
  if (typeof value !== 'string') {
    throw new SigningProviderError('Documenso returned an invalid envelope state', {
      code: 'invalid_response',
    });
  }
  const state = STATE_BY_DOCUMENSO_STATE[value.toUpperCase()];
  if (state === undefined) {
    throw new SigningProviderError('Documenso returned an unsupported envelope state', {
      code: 'unsupported_state',
    });
  }
  return state;
}

function normalizedRecipientState(value: unknown): SigningRecipientState {
  if (typeof value !== 'string') return 'pending';
  return RECIPIENT_STATE_BY_DOCUMENSO_STATE[value.toUpperCase()] ?? 'pending';
}

function parseEnvelope(value: unknown): SigningEnvelope {
  const record = recordValue(value);
  if (!Array.isArray(record.recipients) || !Array.isArray(record.items)) {
    throw new SigningProviderError('Documenso returned an invalid response', {
      code: 'invalid_response',
    });
  }

  const recipients: SigningRecipient[] = record.recipients.map((entry) => {
    const recipient = recordValue(entry);
    return {
      id: requiredString(recipient, 'id'),
      name: requiredString(recipient, 'name'),
      email: requiredString(recipient, 'email'),
      state: normalizedRecipientState(recipient.status),
    };
  });
  const items: SigningEnvelopeItem[] = record.items.map((entry) => {
    const item = recordValue(entry);
    return {
      id: requiredString(item, 'id'),
      fileName: requiredString(item, 'fileName'),
      mimeType: 'application/pdf',
    };
  });

  return {
    id: requiredString(record, 'id'),
    state: normalizedState(record.status),
    recipients,
    items,
  };
}

export class DocumensoClient implements SigningProvider {
  readonly #baseUrl: string;
  readonly #apiToken: string;
  readonly #maxDownloadBytes: number;
  readonly #fetch: FetchImplementation;

  constructor(config: DocumensoClientConfig) {
    let url: URL;
    try {
      url = new URL(config.baseUrl);
    } catch {
      throw new SigningProviderError('Documenso base URL is invalid', { code: 'invalid_config' });
    }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || config.apiToken.trim() === '') {
      throw new SigningProviderError('Documenso configuration is incomplete', {
        code: 'invalid_config',
      });
    }
    const maxDownloadBytes = config.maxDownloadBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES;
    if (!Number.isSafeInteger(maxDownloadBytes) || maxDownloadBytes <= 0) {
      throw new SigningProviderError('Documenso download limit is invalid', {
        code: 'invalid_config',
      });
    }

    this.#baseUrl = url.toString().replace(/\/$/, '');
    this.#apiToken = config.apiToken;
    this.#maxDownloadBytes = maxDownloadBytes;
    this.#fetch = config.fetch ?? globalThis.fetch;
  }

  async createEnvelope(input: CreateSigningEnvelopeInput): Promise<SigningEnvelope> {
    const payload = {
      title: input.title,
      recipients: input.recipients.map((recipient, index) => ({
        id: index + 1,
        name: recipient.name,
        email: recipient.email,
        role: 'SIGNER',
      })),
      fields: input.fields.map((field) => ({
        recipientId: field.recipientIndex + 1,
        type: field.type === 'signature' ? 'SIGNATURE' : 'DATE',
        page: field.page,
        x: field.x,
        y: field.y,
        width: field.width,
        height: field.height,
      })),
    };
    const pdfBytes = new Uint8Array(input.pdf.byteLength);
    pdfBytes.set(input.pdf);
    const form = new FormData();
    form.append('payload', new Blob([JSON.stringify(payload)], { type: 'application/json' }));
    form.append('files', new Blob([pdfBytes], { type: 'application/pdf' }), input.fileName);

    const response = await this.#request('/envelope/create', {
      method: 'POST',
      body: form,
    });
    return parseEnvelope(await this.#safeJson(response));
  }

  async distributeEnvelope(envelopeId: string): Promise<SigningEnvelope> {
    await this.#request('/envelope/distribute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ envelopeId }),
    });
    return this.getEnvelope(envelopeId);
  }

  async getEnvelope(envelopeId: string): Promise<SigningEnvelope> {
    const response = await this.#request(`/envelope/${encodeURIComponent(envelopeId)}`);
    return parseEnvelope(await this.#safeJson(response));
  }

  async downloadSignedItem(envelopeId: string, itemId: string): Promise<Uint8Array> {
    const envelope = await this.getEnvelope(envelopeId);
    if (envelope.state !== 'completed') {
      throw new SigningProviderError('Documenso signed item is not available before completion', {
        code: 'not_completed',
      });
    }
    if (!envelope.items.some((item) => item.id === itemId)) {
      throw new SigningProviderError('Documenso signing item was not found', {
        code: 'item_not_found',
      });
    }

    const response = await this.#request(
      `/envelope/item/${encodeURIComponent(itemId)}/download?version=signed`,
    );
    if (
      response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !==
      'application/pdf'
    ) {
      throw new SigningProviderError('Documenso signed item was not a PDF', {
        code: 'invalid_content_type',
        status: response.status,
      });
    }
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > this.#maxDownloadBytes) {
      await response.body?.cancel();
      throw new SigningProviderError('Documenso signed item exceeded the download limit', {
        code: 'download_too_large',
        status: response.status,
      });
    }

    if (response.body === null) return new Uint8Array();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > this.#maxDownloadBytes) {
        await reader.cancel();
        throw new SigningProviderError('Documenso signed item exceeded the download limit', {
          code: 'download_too_large',
          status: response.status,
        });
      }
      chunks.push(result.value);
    }

    const pdf = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      pdf.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return pdf;
  }

  async #request(path: string, init: RequestInit = {}): Promise<Response> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        ...init,
        headers: {
          ...init.headers,
          Authorization: this.#apiToken,
        },
      });
    } catch {
      throw new SigningProviderError('Documenso request failed', {
        code: 'network_error',
        retryable: true,
      });
    }
    if (response.ok) return response;

    let code = 'http_error';
    try {
      const body = recordValue(await response.json());
      if (typeof body.code === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(body.code)) {
        code = body.code;
      }
    } catch {
      // Deliberately discard provider bodies: they may contain personal or signed-link data.
    }
    throw new SigningProviderError('Documenso request was rejected', {
      code,
      status: response.status,
      retryable: response.status === 429 || response.status >= 500,
    });
  }

  async #safeJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new SigningProviderError('Documenso returned an invalid response', {
        code: 'invalid_response',
        status: response.status,
      });
    }
  }
}
