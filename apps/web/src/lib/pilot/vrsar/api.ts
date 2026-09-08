import type {
  PilotConfig,
  PilotSession,
  PrivateTraceRecord,
  PublicTraceRecord,
} from './model.ts';
import {
  publicRecordFromEnvelope,
  recordFromEnvelope,
  recordsFromEnvelope,
} from './model.ts';

const API_ROOT = '/pilot/vrsar/api';
const MAX_PENDING_COMMANDS = 32;
const pendingCommandKeys = new Map<string, string>();

export class PilotApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'PilotApiError';
    this.code = code;
    this.status = status;
  }
}

interface RequestOptions<T = unknown> {
  method?: 'GET' | 'POST';
  body?: unknown;
  idempotent?: boolean;
  parse?: (payload: unknown) => T;
  signal?: AbortSignal;
}

function retainedCommandKey(fingerprint: string): string {
  const retained = pendingCommandKeys.get(fingerprint);
  if (retained) return retained;
  if (pendingCommandKeys.size >= MAX_PENDING_COMMANDS) {
    const oldest = pendingCommandKeys.keys().next().value;
    if (typeof oldest === 'string') pendingCommandKeys.delete(oldest);
  }
  const created = crypto.randomUUID();
  pendingCommandKeys.set(fingerprint, created);
  return created;
}

function confirmAttachment(payload: unknown): void {
  if (!payload || typeof payload !== 'object' || !('attachment' in payload)) {
    throw new Error('invalid_attachment_response');
  }
}

async function requestJson<T = unknown>(
  path: string,
  options: RequestOptions<T> = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  const serializedBody = options.body === undefined ? undefined : JSON.stringify(options.body);
  const fingerprint = options.idempotent
    ? `${method} ${path}\n${serializedBody ?? ''}`
    : null;
  const headers = new Headers({ accept: 'application/json' });
  if (serializedBody !== undefined) headers.set('content-type', 'application/json');
  if (fingerprint) headers.set('idempotency-key', retainedCommandKey(fingerprint));

  let response: Response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      method,
      credentials: 'same-origin',
      headers,
      body: serializedBody,
      signal: options.signal,
    });
  } catch {
    // A response can be lost after the server commits. Retain this exact command's key in memory.
    throw new PilotApiError('upstream_unavailable', 'Network request failed', 0);
  }

  let payload: unknown = null;
  let validJson = false;
  try {
    payload = await response.json();
    validJson = true;
  } catch {
    validJson = false;
  }

  if (!response.ok) {
    // A client/revision conflict is a known rejection. Server failures remain ambiguous and keep the key.
    if (fingerprint && response.status < 500) pendingCommandKeys.delete(fingerprint);
    const error = validJson && payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : {};
    const code = typeof error.error === 'string' ? error.error : `http_${response.status}`;
    const message = typeof error.message === 'string' ? error.message : 'Request failed';
    throw new PilotApiError(code, message, response.status);
  }

  if (!validJson) {
    // Do not complete an idempotency key when a successful server response cannot be interpreted.
    throw new PilotApiError('invalid_response', 'The server returned invalid JSON', response.status);
  }

  let parsed: T;
  try {
    parsed = options.parse ? options.parse(payload) : (payload as T);
  } catch {
    // Envelope failure is ambiguous: the server may have committed, so the next exact retry reuses the key.
    throw new PilotApiError('invalid_response', 'The server returned an invalid response', response.status);
  }
  if (fingerprint) pendingCommandKeys.delete(fingerprint);
  return parsed;
}

export async function getPilotConfig(signal?: AbortSignal): Promise<PilotConfig> {
  return requestJson<PilotConfig>('/config', { signal });
}

export async function getPilotSession(signal?: AbortSignal): Promise<PilotSession> {
  return requestJson<PilotSession>('/session', { signal });
}

export async function listPrivateRecords(signal?: AbortSignal): Promise<PrivateTraceRecord[]> {
  return requestJson<PrivateTraceRecord[]>('/records', {
    signal,
    parse: (payload) => recordsFromEnvelope<PrivateTraceRecord>(payload),
  });
}

export async function createPrivateRecord(input: {
  subject: string;
  narrative: string;
  location: string;
  contactEmail?: string;
}): Promise<PrivateTraceRecord> {
  return requestJson<PrivateTraceRecord>('/records', {
    method: 'POST',
    body: input,
    idempotent: true,
    parse: recordFromEnvelope,
  });
}

export async function getPrivateRecord(id: string, signal?: AbortSignal): Promise<PrivateTraceRecord> {
  return requestJson<PrivateTraceRecord>(`/records/${encodeURIComponent(id)}`, {
    signal,
    parse: recordFromEnvelope,
  });
}

export async function assignRecord(id: string, expectedVersion: number): Promise<PrivateTraceRecord> {
  return requestJson<PrivateTraceRecord>(`/records/${encodeURIComponent(id)}/assign`, {
    method: 'POST',
    body: { expectedVersion },
    idempotent: true,
    parse: recordFromEnvelope,
  });
}

export async function submitCommitment(
  id: string,
  input: { expectedVersion: number; publicSummary: string; commitment: string; dueDate: string },
): Promise<PrivateTraceRecord> {
  return requestJson<PrivateTraceRecord>(`/records/${encodeURIComponent(id)}/commitment`, {
    method: 'POST',
    body: input,
    idempotent: true,
    parse: recordFromEnvelope,
  });
}

export async function reviewCommitment(
  id: string,
  input: { expectedVersion: number; decision: 'accept' | 'return'; note: string },
): Promise<PrivateTraceRecord> {
  return requestJson<PrivateTraceRecord>(`/records/${encodeURIComponent(id)}/review`, {
    method: 'POST',
    body: input,
    idempotent: true,
    parse: recordFromEnvelope,
  });
}

export async function submitResolution(
  id: string,
  input: { expectedVersion: number; evidenceNote: string; evidenceUrls: string[] },
): Promise<PrivateTraceRecord> {
  return requestJson<PrivateTraceRecord>(`/records/${encodeURIComponent(id)}/resolution`, {
    method: 'POST',
    body: input,
    idempotent: true,
    parse: recordFromEnvelope,
  });
}

export async function reviewResolution(
  id: string,
  input: { expectedVersion: number; decision: 'accept' | 'return'; note: string },
): Promise<PrivateTraceRecord> {
  return requestJson<PrivateTraceRecord>(`/records/${encodeURIComponent(id)}/resolution-review`, {
    method: 'POST',
    body: input,
    idempotent: true,
    parse: recordFromEnvelope,
  });
}

export async function uploadPrivateAttachment(
  id: string,
  input: {
    expectedVersion: number;
    filename: string;
    contentType: string;
    base64: string;
  },
): Promise<void> {
  await requestJson<void>(`/records/${encodeURIComponent(id)}/attachments`, {
    method: 'POST',
    body: input,
    idempotent: true,
    parse: confirmAttachment,
  });
}

export function privateAttachmentHref(recordId: string, attachmentId: string): string {
  return `${API_ROOT}/records/${encodeURIComponent(recordId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

export async function listPublicRecords(signal?: AbortSignal): Promise<PublicTraceRecord[]> {
  return requestJson<PublicTraceRecord[]>('/public/records', {
    signal,
    parse: (payload) => recordsFromEnvelope<PublicTraceRecord>(payload),
  });
}

export async function getPublicRecord(id: string, signal?: AbortSignal): Promise<PublicTraceRecord> {
  return requestJson<PublicTraceRecord>(`/public/records/${encodeURIComponent(id)}`, {
    signal,
    parse: publicRecordFromEnvelope,
  });
}

export async function requestMagicLink(email: string): Promise<void> {
  await requestJson('/identity/magic-link', { method: 'POST', body: { email } });
}

export async function exchangeMagicLink(email: string, token: string): Promise<void> {
  await requestJson('/identity/exchange', { method: 'POST', body: { email, token } });
}

export async function getOidcAuthorization(): Promise<string> {
  const payload = await requestJson<Record<string, unknown>>('/identity/authorize');
  const url = payload.authorizationUrl;
  if (typeof url !== 'string' || !url) {
    throw new PilotApiError('invalid_response', 'Authorization URL unavailable', 502);
  }
  return url;
}

export async function exchangeOidcCallback(code: string, state: string): Promise<void> {
  await requestJson('/identity/callback', { method: 'POST', body: { code, state } });
}

export async function logoutPilotSession(): Promise<void> {
  await requestJson('/identity/logout', { method: 'POST' });
}
