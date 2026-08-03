export type SigningProviderState =
  'draft' | 'pending' | 'completed' | 'rejected' | 'cancelled' | 'expired';

export type SigningRecipientState = 'pending' | 'completed' | 'rejected';

export interface SigningRecipientInput {
  readonly name: string;
  readonly email: string;
}

export interface SigningRecipient {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly state: SigningRecipientState;
}

export interface SigningFieldPlacement {
  readonly recipientIndex: number;
  readonly type: 'signature' | 'date';
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CreateSigningEnvelopeInput {
  readonly title: string;
  readonly fileName: string;
  readonly pdf: Uint8Array;
  readonly recipients: readonly SigningRecipientInput[];
  readonly fields: readonly SigningFieldPlacement[];
}

export interface SigningEnvelopeItem {
  readonly id: string;
  readonly fileName: string;
  readonly mimeType: 'application/pdf';
}

export interface SigningEnvelope {
  readonly id: string;
  readonly state: SigningProviderState;
  readonly recipients: readonly SigningRecipient[];
  readonly items: readonly SigningEnvelopeItem[];
}

export interface SigningProvider {
  createEnvelope(input: CreateSigningEnvelopeInput): Promise<SigningEnvelope>;
  distributeEnvelope(envelopeId: string): Promise<SigningEnvelope>;
  getEnvelope(envelopeId: string): Promise<SigningEnvelope>;
  downloadSignedItem(envelopeId: string, itemId: string): Promise<Uint8Array>;
}

export interface SigningProviderErrorOptions {
  readonly code?: string;
  readonly status?: number;
  readonly retryable?: boolean;
  readonly cause?: unknown;
}

export class SigningProviderError extends Error {
  readonly code?: string;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(message: string, options: SigningProviderErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = 'SigningProviderError';
    this.code = options.code;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}
