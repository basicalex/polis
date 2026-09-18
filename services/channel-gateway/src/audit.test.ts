// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';

import { HttpAuditClient } from './audit.js';
import type { ChannelConfig } from './config.js';

const config = { auditInternalUrl: 'http://audit.internal/' } as ChannelConfig;

test('phone-decrypted uses the restricted contract payload', async () => {
  const previousToken = process.env.INTERNAL_API_TOKEN;
  process.env.INTERNAL_API_TOKEN = 'audit-test-token';
  try {
    let requestUrl: string | undefined;
    let requestBody: unknown;
    const client = new HttpAuditClient(config, async (input, init) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body));
      return new Response(null, { status: 204 });
    });

    await client.emit({
      eventType: 'channel.phone.decrypted',
      code: 'phone-decrypted',
      phoneHashPrefix: 'abcdef12',
      caseNumber: 'VRS-123456',
      recordId: '11111111-1111-4111-8111-111111111111',
      reason: 'reveal',
      requestRef: 'court-request-2026-17',
    });

    assert.equal(requestUrl, 'http://audit.internal/internal/audit/events');
    assert.deepEqual(requestBody, {
      eventType: 'channel.phone.decrypted',
      action: 'phone-decrypted',
      visibility: 'restricted',
      actor: { type: 'service', id: 'channel-gateway' },
      target: { type: 'channel_gateway', id: '11111111-1111-4111-8111-111111111111' },
      data: {
        reason: 'reveal',
        caseNumber: 'VRS-123456',
        recordId: '11111111-1111-4111-8111-111111111111',
        phoneHashPrefix: 'abcdef12',
        requestRef: 'court-request-2026-17',
      },
    });
  } finally {
    if (previousToken === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = previousToken;
  }
});
