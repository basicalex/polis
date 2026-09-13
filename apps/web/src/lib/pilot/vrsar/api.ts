// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  AiProposal,
  CaseMessage,
  PilotConfig,
  PilotSession,
  PrivateTraceRecord,
  PublicCaseShell,
  PublicTraceRecord,
} from './model.ts';
import {
  anonymousCaseFromEnvelope,
  attentionCountsFromEnvelope,
  closeResultFromEnvelope,
  messageResultFromEnvelope,
  messagesFromEnvelope,
  proposalDecisionFromEnvelope,
  publicCaseFromEnvelope,
  publicCasesFromEnvelope,
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

export async function listCaseMessages(
  id: string,
  signal?: AbortSignal,
): Promise<CaseMessage[]> {
  return requestJson<CaseMessage[]>(`/records/${encodeURIComponent(id)}/messages`, {
    signal,
    parse: messagesFromEnvelope,
  });
}

export async function sendCaseMessage(
  id: string,
  input: { expectedVersion: number; kind: 'question' | 'answer' | 'status-update'; body: string },
): Promise<{ message: CaseMessage; record: PrivateTraceRecord }> {
  return requestJson(`/records/${encodeURIComponent(id)}/messages`, {
    method: 'POST',
    body: input,
    idempotent: true,
    parse: messageResultFromEnvelope,
  });
}

export async function decideAiProposal(
  id: string,
  proposalId: string,
  input: { expectedVersion: number; decision: 'accepted' | 'rejected'; note?: string },
): Promise<{ proposal: AiProposal; record: PrivateTraceRecord }> {
  return requestJson(
    `/records/${encodeURIComponent(id)}/ai-proposals/${encodeURIComponent(proposalId)}/decision`,
    {
      method: 'POST',
      body: input,
      idempotent: true,
      parse: proposalDecisionFromEnvelope,
    },
  );
}

export async function closeCase(
  id: string,
  input: { expectedVersion: number; reason: string; publicReason: string; note?: string },
): Promise<{ record: PrivateTraceRecord; shell: PublicCaseShell }> {
  return requestJson(`/records/${encodeURIComponent(id)}/close`, {
    method: 'POST',
    body: input,
    idempotent: true,
    parse: closeResultFromEnvelope,
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

/**
 * The photo is a restricted attachment: the office and the reopen-key holder
 * see it, the ledger and the public case never do. It travels inside the filing
 * request, so a filed case either carries its photo or was never filed.
 */
export interface AnonymousCasePhoto {
  contentType: 'image/jpeg' | 'image/png';
  /** Standard base64, no `data:` prefix. At most 2 MiB once decoded. */
  base64: string;
}

export async function fileAnonymousCase(input: {
  text: string;
  location?: string;
  photo?: AnonymousCasePhoto;
}): Promise<{ caseNumber: string; reopenKey: string; state: string }> {
  return requestJson('/public/cases', {
    method: 'POST',
    body: input,
    idempotent: true,
    parse: anonymousCaseFromEnvelope,
  });
}

export async function listPublicCases(
  limit?: number,
  signal?: AbortSignal,
): Promise<PublicCaseShell[]> {
  const query = Number.isInteger(limit) && limit ? `?limit=${limit}` : '';
  return requestJson<PublicCaseShell[]>(`/public/cases${query}`, {
    signal,
    parse: publicCasesFromEnvelope,
  });
}

export async function getPublicCase(
  caseNumber: string,
  signal?: AbortSignal,
): Promise<{ case: PublicCaseShell; record: PublicTraceRecord | null }> {
  return requestJson(`/public/cases/${encodeURIComponent(caseNumber)}`, {
    signal,
    parse: publicCaseFromEnvelope,
  });
}

export async function recordCaseAttention(
  caseNumber: string,
  input: { followerKey: string; kind: 'follow' | 'also-affected'; action: 'add' | 'remove' },
): Promise<{ followerCount: number; alsoAffectedCount: number }> {
  return requestJson(`/public/cases/${encodeURIComponent(caseNumber)}/attention`, {
    method: 'POST',
    body: input,
    idempotent: true,
    parse: attentionCountsFromEnvelope,
  });
}

export async function requestMagicLink(email: string): Promise<void> {
  await requestJson('/identity/magic-link', { method: 'POST', body: { email } });
}

export async function exchangeMagicLink(email: string, token: string): Promise<void> {
  await requestJson('/identity/exchange', { method: 'POST', body: { email, token } });
}

/**
 * Hosted test instance only: the server holds the passcode of the synthetic
 * staff accounts, so the browser names a role and nothing else. The route is
 * absent on any other build.
 */
export async function demoStaffLogin(role: 'official' | 'reviewer'): Promise<void> {
  await requestJson('/identity/demo-login', { method: 'POST', body: { role } });
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
