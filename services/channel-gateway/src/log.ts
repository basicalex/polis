// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

export interface LogFields {
  service: string;
  stage: string;
  code: string;
  eventId?: string;
  phoneHashPrefix?: string;
  recordId?: string;
  caseNumber?: string;
  attempts?: number;
  error?: string;
}

const PHONE_LIKE = /\+?\d{8,}/g;

function safeText(value: string): string {
  return value.replace(PHONE_LIKE, '[redacted]').slice(0, 1_000);
}

export function phoneHashPrefix(hash: string): string {
  if (!/^[a-f0-9]{64}$/i.test(hash)) throw new Error('phone hash must be 64 hexadecimal characters');
  return hash.slice(0, 8).toLowerCase();
}

export function logEvent(fields: LogFields): void {
  const output: Record<string, string | number> = {
    service: safeText(fields.service),
    stage: safeText(fields.stage),
    code: safeText(fields.code),
  };
  for (const key of ['eventId', 'phoneHashPrefix', 'recordId', 'caseNumber', 'error'] as const) {
    const value = fields[key];
    if (typeof value === 'string') output[key] = safeText(value);
  }
  if (typeof fields.attempts === 'number' && Number.isSafeInteger(fields.attempts)) {
    output.attempts = fields.attempts;
  }
  console.log(JSON.stringify(output));
}
