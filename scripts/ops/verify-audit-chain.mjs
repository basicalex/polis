#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const CANONICAL_FIELDS = [
  'eventType',
  'actorType',
  'actorId',
  'targetType',
  'targetId',
  'action',
  'reason',
  'correlationId',
  'visibility',
  'data',
  'redactedData',
  'createdAt',
];
const RECORD_FIELDS = new Set(['id', ...CANONICAL_FIELDS, 'hash', 'previousHash']);
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function stableValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = stableValue(value[key]);
    return out;
  }
  return null;
}

function canonicalAuditJson(record) {
  const canonical = {};
  for (const field of CANONICAL_FIELDS) canonical[field] = record[field];
  return JSON.stringify(stableValue(canonical));
}

function computeAuditHash(previousHash, record) {
  return createHash('sha256')
    .update(`${previousHash ?? ''}${canonicalAuditJson(record)}`)
    .digest('hex');
}

function malformed(message, index) {
  const location = index === undefined ? '' : ` at record ${index + 1}`;
  throw new Error(`malformed input${location}: ${message}`);
}

function validateRecord(record, index) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    malformed('record must be an object', index);
  }

  for (const field of RECORD_FIELDS) {
    if (!Object.hasOwn(record, field)) malformed(`missing ${field}`, index);
  }
  for (const field of Object.keys(record)) {
    if (!RECORD_FIELDS.has(field)) malformed(`unexpected field ${field}`, index);
  }

  for (const field of ['id', 'eventType', 'actorType', 'actorId', 'action', 'visibility']) {
    if (typeof record[field] !== 'string' || !record[field].trim()) {
      malformed(`${field} must be a non-empty string`, index);
    }
  }
  for (const field of ['targetType', 'targetId', 'reason', 'correlationId']) {
    if (record[field] !== null && typeof record[field] !== 'string') {
      malformed(`${field} must be a string or null`, index);
    }
  }
  if (
    typeof record.createdAt !== 'string' ||
    !ISO_TIMESTAMP_PATTERN.test(record.createdAt) ||
    Number.isNaN(Date.parse(record.createdAt))
  ) {
    malformed('createdAt must be an ISO UTC timestamp with milliseconds', index);
  }
  if (typeof record.hash !== 'string' || !HASH_PATTERN.test(record.hash)) {
    malformed('hash must be a lowercase SHA-256 digest', index);
  }
  if (
    record.previousHash !== null &&
    (typeof record.previousHash !== 'string' || !HASH_PATTERN.test(record.previousHash))
  ) {
    malformed('previousHash must be a lowercase SHA-256 digest or null', index);
  }
}

function parseSequence(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      malformed(`invalid JSON: ${error.message}`);
    }
    if (!Array.isArray(parsed)) malformed('JSON input must be an array');
    return parsed;
  }

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed.items)) return parsed.items;
      return [parsed];
    } catch {
      // A multi-record NDJSON stream also begins with "{".
    }
  }

  return trimmed.split(/\r?\n/).map((line, index) => {
    if (!line.trim()) malformed(`blank NDJSON line ${index + 1}`);
    try {
      return JSON.parse(line);
    } catch (error) {
      malformed(`invalid NDJSON line ${index + 1}: ${error.message}`);
    }
  });
}

function verifySequence(records, allowEmpty) {
  if (records.length === 0 && !allowEmpty) throw new Error('audit sequence is empty');

  let previousRecord = null;
  for (const [index, record] of records.entries()) {
    validateRecord(record, index);

    if (previousRecord === null) {
      if (record.previousHash !== null) {
        throw new Error('previous-hash mismatch at record 1: chain must start with null');
      }
    } else {
      const previousOrderKey = `${previousRecord.createdAt}\u0000${previousRecord.id}`;
      const orderKey = `${record.createdAt}\u0000${record.id}`;
      if (orderKey <= previousOrderKey) {
        throw new Error(`order gap or out-of-order record at record ${index + 1}`);
      }
      if (record.previousHash !== previousRecord.hash) {
        throw new Error(`previous-hash mismatch at record ${index + 1}`);
      }
    }

    const recomputedHash = computeAuditHash(record.previousHash, record);
    if (record.hash !== recomputedHash) {
      throw new Error(`recomputed hash mismatch at record ${index + 1}`);
    }
    previousRecord = record;
  }

  return {
    ok: true,
    records: records.length,
    headHash: previousRecord?.hash ?? null,
  };
}

async function readStdin() {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

async function main() {
  let allowEmpty = false;
  let inputPath;

  for (const argument of process.argv.slice(2)) {
    if (argument === '--allow-empty') allowEmpty = true;
    else if (argument === '--help') {
      process.stdout.write(
        'Usage: verify-audit-chain.mjs [--allow-empty] [audit.json|audit.ndjson|-]\n',
      );
      return;
    } else if (argument.startsWith('-') && argument !== '-') {
      throw new Error(`unknown option: ${argument}`);
    } else if (inputPath !== undefined) {
      throw new Error('only one input path is allowed');
    } else inputPath = argument;
  }

  const text =
    inputPath && inputPath !== '-' ? await readFile(inputPath, 'utf8') : await readStdin();
  const result = verifySequence(parseSequence(text), allowEmpty);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
  process.exitCode = 1;
});
