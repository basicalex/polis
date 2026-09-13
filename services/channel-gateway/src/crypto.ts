// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export type VaultAad = 'phone' | 'sms-body' | 'reopen-key' | 'outbox-body';

export interface SealedString {
  ciphertext: Buffer;
  nonce: Buffer;
  tag: Buffer;
}

export interface InfobipSignatureInput {
  secret: string;
  header: string | undefined;
  rawBody: Uint8Array;
}

function strictBase64(value: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return null;
  const decoded = Buffer.from(value, 'base64');
  return decoded.toString('base64') === value ? decoded : null;
}

function assertVaultKey(key: Uint8Array): Buffer {
  const bytes = Buffer.from(key);
  if (bytes.byteLength !== 32) throw new Error('PHONE_VAULT_KEY must contain 32-byte keys');
  return bytes;
}

export function parseVaultKeys(raw: string): Map<number, Buffer> {
  if (!raw || raw.trim() !== raw) {
    throw new Error('PHONE_VAULT_KEY must be a versioned key list');
  }
  const keys = new Map<number, Buffer>();
  for (const entry of raw.split(',')) {
    const match = /^v([1-9]\d*):(.+)$/.exec(entry);
    if (!match) throw new Error('PHONE_VAULT_KEY must use vN:<base64> entries');
    const version = Number(match[1]);
    if (!Number.isSafeInteger(version) || version > 32_767 || keys.has(version)) {
      throw new Error('PHONE_VAULT_KEY contains an invalid or duplicate version');
    }
    const key = strictBase64(match[2]!);
    if (!key || key.byteLength !== 32) {
      throw new Error('PHONE_VAULT_KEY must contain 32-byte base64 keys');
    }
    keys.set(version, key);
  }
  if (keys.size === 0) throw new Error('PHONE_VAULT_KEY must contain at least one key');
  return keys;
}

export function sealString(key: Uint8Array, plaintext: string, aad: VaultAad): SealedString {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', assertVaultKey(key), nonce);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { ciphertext, nonce, tag: cipher.getAuthTag() };
}

export function openString(key: Uint8Array, sealed: SealedString, aad: VaultAad): string {
  if (sealed.nonce.byteLength !== 12 || sealed.tag.byteLength !== 16) {
    throw new Error('invalid AES-GCM sealed value');
  }
  const decipher = createDecipheriv('aes-256-gcm', assertVaultKey(key), sealed.nonce);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(sealed.tag);
  return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString('utf8');
}

export function phoneHash(e164: string, pepper: string, municipalityId: string): string {
  return createHmac('sha256', pepper).update(`${municipalityId}\0${e164}`, 'utf8').digest('hex');
}

export function verifyInfobipSignature(input: InfobipSignatureInput): boolean {
  try {
    if (!input.secret || !input.header) return false;
    const expected = createHmac('sha256', input.secret).update(input.rawBody).digest();
    const raw = input.header.startsWith('sha256=') ? input.header.slice(7) : input.header;
    let actual: Buffer | null = null;
    if (/^[a-fA-F0-9]{64}$/.test(raw)) {
      actual = Buffer.from(raw, 'hex');
    } else {
      actual = strictBase64(raw);
    }
    return actual?.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
