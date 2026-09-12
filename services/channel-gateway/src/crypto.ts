// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createPublicKey,
  randomBytes,
  verify,
} from 'node:crypto';

export type VaultAad = 'phone' | 'sms-body' | 'reopen-key' | 'outbox-body';

export interface SealedString {
  ciphertext: Buffer;
  nonce: Buffer;
  tag: Buffer;
}

export interface TelnyxSignatureInput {
  publicKey: string;
  signature: string | undefined;
  timestamp: string | undefined;
  rawBody: Uint8Array;
  toleranceSeconds: number;
  now?: number | Date;
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

export function verifyTelnyxSignature(input: TelnyxSignatureInput): boolean {
  try {
    if (!input.signature || !input.timestamp || !/^-?\d+$/.test(input.timestamp)) return false;
    if (!Number.isFinite(input.toleranceSeconds) || input.toleranceSeconds < 0) return false;
    const timestamp = Number(input.timestamp);
    if (!Number.isSafeInteger(timestamp)) return false;
    const rawNow = input.now instanceof Date ? input.now.getTime() / 1_000 : input.now;
    const nowSeconds = rawNow === undefined ? Date.now() / 1_000 : rawNow > 1e12 ? rawNow / 1_000 : rawNow;
    if (Math.abs(nowSeconds - timestamp) > input.toleranceSeconds) return false;

    const signature = strictBase64(input.signature);
    if (!signature || signature.byteLength !== 64) return false;
    const publicKey = input.publicKey.trim();
    const key = publicKey.startsWith('-----BEGIN')
      ? createPublicKey(publicKey)
      : (() => {
          const raw = strictBase64(publicKey);
          if (!raw || raw.byteLength !== 32) throw new Error('invalid Telnyx public key');
          const prefix = Buffer.from('302a300506032b6570032100', 'hex');
          return createPublicKey({ key: Buffer.concat([prefix, raw]), format: 'der', type: 'spki' });
        })();
    const message = Buffer.concat([
      Buffer.from(input.timestamp, 'utf8'),
      Buffer.from('|', 'utf8'),
      Buffer.from(input.rawBody),
    ]);
    return verify(null, message, key, signature);
  } catch {
    return false;
  }
}
