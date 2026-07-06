import test from 'node:test';
import assert from 'node:assert/strict';
import { timestampRoutes } from './index.js';
import {
  StubTimestampClient,
  Rfc3161TimestampClient,
  createTimestampClient,
} from './timestamp-client.js';

test('timestamp-service exposes §9.14 timestamp routes', () => {
  const paths = timestampRoutes({} as never, {} as never).map((r) => `${r.method} ${r.path}`);
  for (const p of [
    'POST /internal/timestamps',
    'GET /internal/timestamps/:proofId',
    'GET /healthz',
  ]) {
    assert.ok(paths.includes(p), `missing ${p}`);
  }
});

// ── createTimestampClient mode resolution ─────────────────────────────────
// Env is saved/restored around every case so the suite is order-independent.

test('createTimestampClient defaults to stub when TIMESTAMP_MODE is unset', () => {
  const savedMode = process.env.TIMESTAMP_MODE;
  delete process.env.TIMESTAMP_MODE;
  try {
    assert.ok(createTimestampClient() instanceof StubTimestampClient);
  } finally {
    if (savedMode !== undefined) process.env.TIMESTAMP_MODE = savedMode;
  }
});

test('createTimestampClient resolves TIMESTAMP_MODE=stub to StubTimestampClient', () => {
  const savedMode = process.env.TIMESTAMP_MODE;
  process.env.TIMESTAMP_MODE = 'stub';
  try {
    assert.ok(createTimestampClient() instanceof StubTimestampClient);
  } finally {
    if (savedMode !== undefined) process.env.TIMESTAMP_MODE = savedMode;
    else delete process.env.TIMESTAMP_MODE;
  }
});

test('Rfc3161TimestampClient ctor requires TSA_URL in real mode', () => {
  const savedMode = process.env.TIMESTAMP_MODE;
  const savedUrl = process.env.TSA_URL;
  process.env.TIMESTAMP_MODE = 'real';
  delete process.env.TSA_URL;
  try {
    // Env validated at construction — fails before any network call.
    assert.throws(() => createTimestampClient(), /TSA_URL/);
  } finally {
    if (savedMode !== undefined) process.env.TIMESTAMP_MODE = savedMode;
    else delete process.env.TIMESTAMP_MODE;
    if (savedUrl !== undefined) process.env.TSA_URL = savedUrl;
    else delete process.env.TSA_URL;
  }
});

test('createTimestampClient resolves TIMESTAMP_MODE=real to Rfc3161TimestampClient when TSA_URL is set', () => {
  const savedMode = process.env.TIMESTAMP_MODE;
  const savedUrl = process.env.TSA_URL;
  process.env.TIMESTAMP_MODE = 'real';
  process.env.TSA_URL = 'http://tsa:3000/api/v1/timestamp';
  try {
    // ctor validates env and stores fields — no network is touched.
    assert.ok(createTimestampClient() instanceof Rfc3161TimestampClient);
  } finally {
    if (savedMode !== undefined) process.env.TIMESTAMP_MODE = savedMode;
    else delete process.env.TIMESTAMP_MODE;
    if (savedUrl !== undefined) process.env.TSA_URL = savedUrl;
    else delete process.env.TSA_URL;
  }
});

test('createTimestampClient throws on an unsupported mode', () => {
  const savedMode = process.env.TIMESTAMP_MODE;
  process.env.TIMESTAMP_MODE = 'bad';
  try {
    assert.throws(() => createTimestampClient(), /not supported/);
  } finally {
    if (savedMode !== undefined) process.env.TIMESTAMP_MODE = savedMode;
    else delete process.env.TIMESTAMP_MODE;
  }
});
