const AUTHORITY_FIELDS: Record<string, true> = {
  actor: true,
  actorId: true,
  citizenId: true,
  role: true,
  municipality: true,
  municipalityId: true,
  category: true,
  office: true,
  owner: true,
  ownerId: true,
};

export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
const MAX_ATTACHMENT_BASE64_BYTES = Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function hasControl(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}
const ALLOWED_UPLOAD_TYPES: Record<string, true> = {
  'application/pdf': true,
  'image/png': true,
  'image/jpeg': true,
  'text/plain': true,
};

function contentMismatch(): InputError {
  return new InputError(
    'attachment_content_mismatch',
    'Attachment bytes do not match the declared content type.',
  );
}

function startsWithBytes(bytes: Uint8Array, signature: readonly number[]): boolean {
  return (
    bytes.byteLength >= signature.length &&
    signature.every((value, index) => bytes[index] === value)
  );
}

function hasDisallowedTextControl(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
  });
}

function validateAttachmentContent(contentType: string, bytes: Uint8Array): void {
  if (contentType === 'application/pdf') {
    const data = Buffer.from(bytes);
    const eof = data.lastIndexOf(Buffer.from('%%EOF'));
    if (
      !startsWithBytes(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]) ||
      eof < Math.max(0, data.byteLength - 1_024)
    ) {
      throw contentMismatch();
    }
    return;
  }
  if (contentType === 'image/png') {
    if (
      !startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ||
      !startsWithBytes(bytes.subarray(12), [0x49, 0x48, 0x44, 0x52])
    ) {
      throw contentMismatch();
    }
    return;
  }
  if (contentType === 'image/jpeg') {
    if (
      !startsWithBytes(bytes, [0xff, 0xd8, 0xff]) ||
      bytes.byteLength < 4 ||
      bytes.at(-2) !== 0xff ||
      bytes.at(-1) !== 0xd9
    ) {
      throw contentMismatch();
    }
    return;
  }
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw contentMismatch();
  }
  const prefix = decoded.trimStart().slice(0, 256).toLowerCase();
  if (
    !decoded ||
    hasDisallowedTextControl(decoded) ||
    prefix.startsWith('#!') ||
    prefix.startsWith('<')
  ) {
    throw contentMismatch();
  }
}

export class InputError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'InputError';
  }
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InputError('invalid_request', 'A JSON object is required.');
  }
  return value as Record<string, unknown>;
}

function exactBody(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  const body = objectBody(value);
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(body)) {
    if (AUTHORITY_FIELDS[key]) {
      throw new InputError('authority_field_forbidden', 'Authority fields are server controlled.');
    }
    if (!allowedSet.has(key))
      throw new InputError('unknown_field', 'The request contains an unknown field.');
  }
  return body;
}

function text(value: unknown, name: string, maximum: number): string {
  if (typeof value !== 'string') throw new InputError('invalid_request', `${name} must be text.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || hasControl(normalized)) {
    throw new InputError('invalid_request', `${name} is invalid.`);
  }
  return normalized;
}

function optionalText(value: unknown, name: string, maximum: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  return text(value, name, maximum);
}

function expectedVersion(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new InputError(
      'invalid_expected_version',
      'expectedVersion must be a nonnegative integer.',
    );
  }
  return value as number;
}

export function validateIdempotencyKey(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || !value) {
    throw new InputError('idempotency_key_required', 'A UUID Idempotency-Key header is required.');
  }
  if (!UUID.test(value)) {
    throw new InputError('invalid_idempotency_key', 'Idempotency-Key must be a UUID.');
  }
  return value.toLowerCase();
}

export function validateRecordId(value: string): string {
  if (!UUID.test(value)) throw new InputError('not_found', 'Record not found.', 404);
  return value.toLowerCase();
}

export function validateDateOnly(value: unknown): string {
  if (typeof value !== 'string')
    throw new InputError('invalid_due_date', 'dueDate must be YYYY-MM-DD.');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new InputError('invalid_due_date', 'dueDate must be YYYY-MM-DD.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new InputError('invalid_due_date', 'dueDate must be a real calendar date.');
  }
  return value;
}

function contactEmail(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const email = text(value, 'contactEmail', 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new InputError('invalid_request', 'contactEmail is invalid.');
  }
  return email;
}

export function normalizeCreate(value: unknown): Record<string, unknown> {
  const body = exactBody(value, ['subject', 'narrative', 'location', 'contactEmail']);
  return {
    subject: text(body.subject, 'subject', 200),
    narrative: text(body.narrative, 'narrative', 10_000),
    location: text(body.location, 'location', 1_000),
    contactEmail: contactEmail(body.contactEmail),
  };
}

export function normalizeAssign(value: unknown): Record<string, unknown> {
  const body = exactBody(value, ['expectedVersion']);
  return { expectedVersion: expectedVersion(body.expectedVersion) };
}

export function normalizeCommitment(value: unknown): Record<string, unknown> {
  const body = exactBody(value, ['expectedVersion', 'publicSummary', 'commitment', 'dueDate']);
  return {
    expectedVersion: expectedVersion(body.expectedVersion),
    publicSummary: text(body.publicSummary, 'publicSummary', 2_000),
    commitment: text(body.commitment, 'commitment', 2_000),
    dueDate: validateDateOnly(body.dueDate),
  };
}

export function normalizeReview(value: unknown): Record<string, unknown> {
  const body = exactBody(value, ['expectedVersion', 'decision', 'note']);
  if (body.decision !== 'accept' && body.decision !== 'return') {
    throw new InputError('invalid_decision', 'decision must be accept or return.');
  }
  const note = optionalText(body.note, 'note', 5_000);
  if (body.decision === 'return' && !note) {
    throw new InputError('review_note_required', 'A private note is required when returning work.');
  }
  return { expectedVersion: expectedVersion(body.expectedVersion), decision: body.decision, note };
}

function evidenceUrls(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) {
    throw new InputError(
      'invalid_evidence_urls',
      'evidenceUrls must contain between 1 and 10 URLs.',
    );
  }
  return value.map((raw) => {
    const urlText = text(raw, 'evidenceUrl', 2_048);
    let url: URL;
    try {
      url = new URL(urlText);
    } catch {
      throw new InputError('invalid_evidence_urls', 'Every evidence URL must be valid HTTPS.');
    }
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new InputError(
        'invalid_evidence_urls',
        'Every evidence URL must be HTTPS without credentials.',
      );
    }
    return url.href;
  });
}

export function normalizeResolution(value: unknown): Record<string, unknown> {
  const body = exactBody(value, ['expectedVersion', 'evidenceNote', 'evidenceUrls']);
  return {
    expectedVersion: expectedVersion(body.expectedVersion),
    evidenceNote: text(body.evidenceNote, 'evidenceNote', 5_000),
    evidenceUrls: evidenceUrls(body.evidenceUrls),
  };
}

function filename(value: unknown): string {
  const normalized = text(value, 'filename', 255);
  if (
    normalized === '.' ||
    normalized === '..' ||
    /[/\\"]/.test(normalized) ||
    /\.(?:html?|svg|js|mjs|cjs|sh|bash|zsh|cmd|bat|ps1|py|pyw|rb|pl|php|lua|vbs|wsf|exe|dll|com|scr|msi|jar|app|dmg|pkg)$/i.test(
      normalized,
    )
  ) {
    throw new InputError('invalid_filename', 'filename is unsafe.');
  }
  return normalized;
}

function canonicalBase64(value: unknown): { base64: string; bytes: Uint8Array } {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_ATTACHMENT_BASE64_BYTES
  ) {
    throw new InputError('invalid_attachment', 'Attachment data is invalid or too large.');
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new InputError('invalid_base64', 'base64 must use strict canonical encoding.');
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const decodedSize = (value.length / 4) * 3 - padding;
  if (decodedSize > MAX_ATTACHMENT_BYTES) {
    throw new InputError('invalid_attachment', 'Attachment data is invalid or too large.');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.byteLength !== decodedSize || bytes.toString('base64') !== value) {
    throw new InputError('invalid_attachment', 'Attachment data is invalid or too large.');
  }
  return { base64: value, bytes: Uint8Array.from(bytes) };
}

export function normalizeAttachment(value: unknown): Record<string, unknown> {
  const body = exactBody(value, ['expectedVersion', 'filename', 'contentType', 'base64']);
  const contentType = text(body.contentType, 'contentType', 100).toLowerCase();
  if (!ALLOWED_UPLOAD_TYPES[contentType]) {
    throw new InputError('unsupported_attachment_type', 'Attachment content type is not allowed.');
  }
  const safeFilename = filename(body.filename);
  const decoded = canonicalBase64(body.base64);
  validateAttachmentContent(contentType, decoded.bytes);
  return {
    expectedVersion: expectedVersion(body.expectedVersion),
    filename: safeFilename,
    contentType,
    base64: decoded.base64,
  };
}

export function parseListLimit(urlText: string | undefined): number {
  const url = new URL(urlText ?? '/', 'http://localhost');
  const raw = url.searchParams.get('limit');
  if (raw === null) return 50;
  if (!/^[1-9]\d*$/.test(raw))
    throw new InputError('invalid_limit', 'limit must be an integer from 1 to 100.');
  const limit = Number(raw);
  if (limit > 100) throw new InputError('invalid_limit', 'limit must be an integer from 1 to 100.');
  return limit;
}
