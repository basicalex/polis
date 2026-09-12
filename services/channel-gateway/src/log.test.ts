// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';

import { logEvent, phoneHashPrefix } from './log.js';

test('phoneHashPrefix returns only eight lowercase hexadecimal characters', () => {
  assert.equal(phoneHashPrefix('ABCDEF12'.padEnd(64, '0')), 'abcdef12');
  assert.throws(() => phoneHashPrefix('+385911234567'));
});

test('structured logs allowlist fields and redact phone-like values', () => {
  const lines: string[] = [];
  const original = console.log;
  console.log = (line?: unknown) => lines.push(String(line));
  try {
    logEvent({
      service: 'channel-gateway',
      stage: 'receive',
      code: 'accepted',
      eventId: 'evt-1',
      phoneHashPrefix: 'abcdef12',
      error: 'provider rejected +385911234567',
      ...({ phone: '+385911234567', rawBody: '00385911234567' } as Record<string, string>),
    });
    logEvent({
      service: 'channel-gateway',
      stage: 'relay',
      code: 'failed',
      caseNumber: 'CASE-123456789',
      attempts: 2,
    });
  } finally {
    console.log = original;
  }
  assert.equal(lines.length, 2);
  assert.equal(
    lines.some((line) => /\+?\d{8,}/.test(line)),
    false,
  );
  assert.equal(
    lines.some((line) => line.includes('"phone"') || line.includes('rawBody')),
    false,
  );
  assert.deepEqual(Object.keys(JSON.parse(lines[0]!) as object), [
    'service',
    'stage',
    'code',
    'eventId',
    'phoneHashPrefix',
    'error',
  ]);
});
