// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import {
  openString,
  parseVaultKeys,
  phoneHash,
  sealString,
  verifyInfobipSignature,
} from './crypto.js';

test('AES-256-GCM round trips each AAD context and rejects mismatches', () => {
  const key = Buffer.alloc(32, 7);
  for (const aad of ['phone', 'sms-body', 'reopen-key', 'outbox-body'] as const) {
    const sealed = sealString(key, `private-${aad}`, aad);
    assert.equal(sealed.nonce.byteLength, 12);
    assert.equal(sealed.tag.byteLength, 16);
    assert.equal(openString(key, sealed, aad), `private-${aad}`);
  }
  const sealed = sealString(key, 'private', 'phone');
  assert.throws(() => openString(key, sealed, 'sms-body'));
});

test('versioned vault keys preserve old reads and select the highest version for writes', () => {
  const first = Buffer.alloc(32, 1);
  const second = Buffer.alloc(32, 2);
  const keys = parseVaultKeys(`v2:${second.toString('base64')},v1:${first.toString('base64')}`);
  const oldValue = sealString(keys.get(1)!, 'old', 'phone');
  const activeVersion = Math.max(...keys.keys());
  assert.equal(activeVersion, 2);
  assert.equal(openString(keys.get(1)!, oldValue, 'phone'), 'old');
  assert.equal(
    openString(
      keys.get(activeVersion)!,
      sealString(keys.get(activeVersion)!, 'new', 'phone'),
      'phone',
    ),
    'new',
  );
  assert.throws(
    () => parseVaultKeys(`v1:${Buffer.alloc(31).toString('base64')}`),
    /PHONE_VAULT_KEY/,
  );
});

test('phone hashes are municipality-bound HMAC-SHA256 values', () => {
  const first = phoneHash('+385911234567', 'pepper-value', 'vrsar-orsera');
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, phoneHash('+385911234567', 'pepper-value', 'other'));
});

test('Infobip HMAC signatures accept documented encodings and never throw', () => {
  const secret = 'a-real-webhook-secret-at-least-32-characters';
  const rawBody = Buffer.from('{"results":[{"messageId":"message-1"}]}');
  const digest = createHmac('sha256', secret).update(rawBody).digest();
  for (const header of [
    `sha256=${digest.toString('hex')}`,
    digest.toString('hex'),
    digest.toString('base64'),
  ]) {
    assert.equal(verifyInfobipSignature({ secret, header, rawBody }), true);
  }
  assert.equal(
    verifyInfobipSignature({ secret: `${secret}-wrong`, header: digest.toString('hex'), rawBody }),
    false,
  );
  assert.equal(verifyInfobipSignature({ secret, header: undefined, rawBody }), false);
  for (const header of ['sha256=not-hex', '%%%', '00', '']) {
    assert.doesNotThrow(() => verifyInfobipSignature({ secret, header, rawBody }));
    assert.equal(verifyInfobipSignature({ secret, header, rawBody }), false);
  }
});
