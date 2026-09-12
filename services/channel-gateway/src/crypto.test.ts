// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';

import {
  openString,
  parseVaultKeys,
  phoneHash,
  sealString,
  verifyTelnyxSignature,
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
  assert.equal(openString(keys.get(activeVersion)!, sealString(keys.get(activeVersion)!, 'new', 'phone'), 'phone'), 'new');
  assert.throws(() => parseVaultKeys(`v1:${Buffer.alloc(31).toString('base64')}`), /PHONE_VAULT_KEY/);
});

test('phone hashes are municipality-bound HMAC-SHA256 values', () => {
  const first = phoneHash('+385911234567', 'pepper-value', 'vrsar-orsera');
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, phoneHash('+385911234567', 'pepper-value', 'other'));
});

test('Telnyx Ed25519 signatures verify in PEM and raw-base64 forms without throwing', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const rawBody = Buffer.from('{"data":{"event_type":"message.received"}}');
  const timestamp = '1789230000';
  const message = Buffer.concat([Buffer.from(timestamp), Buffer.from('|'), rawBody]);
  const signature = sign(null, message, privateKey).toString('base64');
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const der = publicKey.export({ type: 'spki', format: 'der' });
  const raw = der.subarray(der.length - 32).toString('base64');
  const valid = {
    publicKey: pem,
    signature,
    timestamp,
    rawBody,
    toleranceSeconds: 300,
    now: Number(timestamp),
  };
  assert.equal(verifyTelnyxSignature(valid), true);
  assert.equal(verifyTelnyxSignature({ ...valid, publicKey: raw }), true);
  assert.equal(verifyTelnyxSignature({ ...valid, rawBody: Buffer.from('wrong') }), false);
  assert.equal(verifyTelnyxSignature({ ...valid, now: Number(timestamp) + 301 }), false);
  assert.equal(verifyTelnyxSignature({ ...valid, now: Number(timestamp) - 301 }), false);
  assert.equal(verifyTelnyxSignature({ ...valid, signature: undefined }), false);
  assert.equal(verifyTelnyxSignature({ ...valid, timestamp: undefined }), false);
  assert.equal(verifyTelnyxSignature({ ...valid, publicKey: 'not-a-key' }), false);
});
