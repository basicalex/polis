import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  operationalRoutes,
  validateRuntimeConfig,
} from '../../../packages/service-runtime/dist/index.js';
import { verifyIntakeClosed } from '../intake-closed-check.mjs';
import { decodedEmailBodies } from '../mail-codec.mjs';
import { createPilotReadiness, selectPilotPlatformRoutes } from '../pilot-platform-routes.mjs';
import { applyTraceIntakeOverride, traceServiceDefinition } from '../trace-intake-restart.mjs';
import {
  DATABASE_NAME,
  OWNER_KIND,
  ROOT,
  TEST_MARKER,
  assertOwnedRuntime,
  curatedEnvironment,
  portAvailable,
  pathsFor,
  serviceEnvironment,
  waitForManagedReadiness,
  writeJsonPrivate,
} from '../runtime-lib.mjs';

async function ownedRuntime(prefix = 'polis-vrsar-prepartner-test-') {
  const runtimePath = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const paths = pathsFor(runtimePath);
  await fs.mkdir(paths.mailDir, { recursive: true, mode: 0o700 });
  await writeJsonPrivate(paths.metadata, {
    kind: OWNER_KIND,
    runtimePath,
    repoRoot: ROOT,
    disposable: true,
    testMarker: TEST_MARKER,
    database: { name: DATABASE_NAME, host: '127.0.0.1', port: 55433 },
  });
  await writeJsonPrivate(paths.secrets, {});
  await writeJsonPrivate(paths.state, { phase: 'created', services: {} });
  return { runtimePath, paths };
}

test('ownership guard rejects repository and foreign runtime directories', async () => {
  await assert.rejects(assertOwnedRuntime(ROOT), /outside the repository/);
  const foreign = await fs.mkdtemp(path.join(os.tmpdir(), 'polis-vrsar-prepartner-foreign-'));
  await assert.rejects(assertOwnedRuntime(foreign), /ownership metadata is missing/);
  await fs.rm(foreign, { recursive: true, force: true });
});

test('runtime cleanup does not remove an unowned directory', async () => {
  const foreign = await fs.mkdtemp(path.join(os.tmpdir(), 'foreign-cleanup-'));
  const marker = path.join(foreign, 'keep.txt');
  await fs.writeFile(marker, 'keep');
  const runtimeScript = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../runtime.mjs',
  );
  const child = spawn(
    process.execPath,
    [runtimeScript, 'clean', '--runtime', foreign, '--confirm'],
    {
      env: curatedEnvironment(),
      stdio: 'ignore',
    },
  );
  const code = await new Promise((resolve) => child.once('exit', resolve));
  try {
    assert.notEqual(code, 0);
    assert.equal(await fs.readFile(marker, 'utf8'), 'keep');
  } finally {
    await fs.rm(foreign, { recursive: true, force: true });
  }
});

test('ownership guard accepts only its exact metadata path', async () => {
  const { runtimePath, paths } = await ownedRuntime();
  try {
    await assert.doesNotReject(assertOwnedRuntime(runtimePath));
    const metadata = JSON.parse(await fs.readFile(paths.metadata, 'utf8'));
    metadata.runtimePath = `${runtimePath}-other`;
    await writeJsonPrivate(paths.metadata, metadata);
    await assert.rejects(assertOwnedRuntime(runtimePath), /does not match/);
  } finally {
    await fs.rm(runtimePath, { recursive: true, force: true });
  }
});

test('service environment is explicit and does not inherit caller database settings', () => {
  const prior = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://outside.example/production';
  try {
    const environment = serviceEnvironment({
      metadata: {
        runtimePath: '/private/tmp/pilot',
        database: { port: 55433 },
        ports: { smtp: 1025 },
      },
      secrets: {
        postgres: {
          appUser: 'app',
          appPassword: 'app-secret',
          superuser: 'owner',
          superuserPassword: 'owner-secret',
        },
        internalApiToken: 'internal',
        identityHmacKey: 'identity',
        smtp: { user: 'smtp', password: 'smtp-secret' },
      },
    });
    assert.equal(
      environment.DATABASE_URL,
      'postgresql://app:app-secret@127.0.0.1:55433/polis_trace_test',
    );
    assert.notEqual(environment.DATABASE_URL, process.env.DATABASE_URL);
    assert.equal(environment.SERVICE_HOST, '127.0.0.1');
    assert.equal(environment.PUBLIC_RELEASE, '0');
    assert.equal(environment.IDENTITY_DEV_TOKENS, 'false');
    const basicRuntimeConfig = validateRuntimeConfig(environment);
    assert.deepEqual(Object.keys(basicRuntimeConfig).sort(), [
      'corsAllowedOrigins',
      'deploymentProfile',
      'internalApiToken',
    ]);
    assert.deepEqual(basicRuntimeConfig, {
      deploymentProfile: 'dev',
      internalApiToken: 'internal',
      corsAllowedOrigins: ['http://127.0.0.1:4321'],
    });
  } finally {
    if (prior === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prior;
  }
});

test('trace intake restart persists false through reload into its spawned service definition', async () => {
  const { runtimePath, paths } = await ownedRuntime();
  const launch = {
    traceStartCommand: ['bun', '--no-env-file', 'run', '--filter', '@polis/trace-service', 'start'],
    traceExtraEnv: {},
  };
  try {
    await writeJsonPrivate(paths.launch, launch);
    await writeJsonPrivate(paths.launch, applyTraceIntakeOverride(launch, 'false'));
    const reloaded = JSON.parse(await fs.readFile(paths.launch, 'utf8'));
    const definition = traceServiceDefinition(
      {
        metadata: {
          runtimePath,
          repoRoot: ROOT,
          database: { port: 55433 },
          ports: { smtp: 1025 },
        },
        secrets: {
          postgres: {
            appUser: 'app',
            appPassword: 'app-secret',
            superuser: 'owner',
            superuserPassword: 'owner-secret',
          },
          internalApiToken: 'internal',
          identityHmacKey: 'identity',
          smtp: { user: 'smtp', password: 'smtp-secret' },
        },
      },
      reloaded,
      serviceEnvironment,
    );
    assert.equal(reloaded.traceExtraEnv.TRACE_INTAKE_OPEN, 'false');
    assert.equal(definition.env.TRACE_INTAKE_OPEN, 'false');
    assert.deepEqual(definition.command, launch.traceStartCommand);
    assert.throws(() => applyTraceIntakeOverride(launch, 'unexpected'), /TRACE_INTAKE_OPEN/);
  } finally {
    await fs.rm(runtimePath, { recursive: true, force: true });
  }
});

test('intake verifier posts the exact trusted synthetic request', async () => {
  let received;
  await verifyIntakeClosed({
    base: 'http://127.0.0.1:8980/',
    token: 'private-test-token',
    testMarker: TEST_MARKER,
    fetchImpl: async (url, init) => {
      received = { url, init };
      return { status: 503, json: async () => ({ error: 'intake_closed' }) };
    },
  });
  assert.equal(received.url, 'http://127.0.0.1:8980/internal/trace/records');
  assert.deepEqual(received.init.headers, {
    'content-type': 'application/json',
    'x-polis-internal-token': 'private-test-token',
    'x-polis-citizen': 'trace-resident-test',
    'x-polis-identity-level': 'verified',
    'idempotency-key': '10000000-0000-4000-8000-000000000002',
  });
  assert.deepEqual(JSON.parse(received.init.body), {
    subject: 'closed intake check',
    narrative: 'synthetic only',
    location: 'synthetic only',
  });
  await assert.rejects(
    verifyIntakeClosed({
      base: 'http://127.0.0.1:8980',
      token: 'private-test-token',
      testMarker: TEST_MARKER,
      fetchImpl: async () => ({ status: 201, json: async () => ({}) }),
    }),
    /expected 503 intake_closed; got 201/,
  );
});

test('inbox decoder joins quoted-printable wrapped fragment links', () => {
  const message = [
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    'http://127.0.0.1:4321/pilot/vrsar/login#email=3Dresident=40vrsar.example.te=',
    'st&token=3Done-time-token',
  ].join('\r\n');
  assert.deepEqual(decodedEmailBodies(message), [
    'http://127.0.0.1:4321/pilot/vrsar/login#email=resident@vrsar.example.test&token=one-time-token',
  ]);
});

test('curated environment excludes arbitrary inherited variables', () => {
  process.env.PILOT_SHOULD_NOT_LEAK = 'no';
  try {
    assert.equal(curatedEnvironment().PILOT_SHOULD_NOT_LEAK, undefined);
  } finally {
    delete process.env.PILOT_SHOULD_NOT_LEAK;
  }
});

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server.address();
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

test('port probe reports an owned free port and an occupied port', async () => {
  const server = net.createServer();
  await new Promise((resolve, reject) =>
    server.listen({ host: '127.0.0.1', port: 0 }, (error) => (error ? reject(error) : resolve())),
  );
  const address = server.address();
  try {
    assert.equal(await portAvailable(address.port), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  assert.equal(await portAvailable(address.port), true);
});

test('readiness names a managed child that exits before becoming ready', async () => {
  await assert.rejects(
    waitForManagedReadiness({
      name: 'web',
      url: 'http://127.0.0.1:4321/',
      isManagedChildRunning: async () => false,
      fetchImpl: async () => {
        throw new Error('must not fetch after exit');
      },
      timeoutMs: 1_000,
    }),
    /web exited before readiness/,
  );
});

function smtpConversation(port, lines) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    let buffer = '';
    const transcript = [];
    let index = 0;
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('SMTP test timed out'));
    }, 5_000);
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      while (buffer.includes('\r\n')) {
        const ending = buffer.indexOf('\r\n');
        const line = buffer.slice(0, ending);
        buffer = buffer.slice(ending + 2);
        transcript.push(line);
        if (
          line.startsWith('220') ||
          line.startsWith('250 ') ||
          line.startsWith('235') ||
          line.startsWith('550')
        ) {
          const next = lines[index++];
          if (next) socket.write(`${next}\r\n`);
          else if (line.startsWith('550')) {
            clearTimeout(timer);
            socket.end();
            resolve(transcript);
          }
        }
      }
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

test('pilot platform composition excludes legacy and dev-token routes', () => {
  const routes = selectPilotPlatformRoutes(
    [
      { method: 'POST', path: '/api/v1/identity/magic-link' },
      { method: 'POST', path: '/api/v1/identity/exchange' },
      { method: 'POST', path: '/api/v1/identity/logout' },
      { method: 'GET', path: '/api/v1/identity/authorize' },
      { method: 'POST', path: '/api/v1/identity/callback' },
      { method: 'GET', path: '/api/v1/identity/dev-tokens' },
      { method: 'GET', path: '/api/v1/complaints' },
    ],
    [{ method: 'GET', path: '/api/trace/config' }],
    [
      { method: 'GET', path: '/healthz' },
      { method: 'GET', path: '/readyz' },
    ],
  );
  const keys = new Set(routes.map((route) => `${route.method} ${route.path}`));
  assert.equal(keys.has('GET /api/v1/identity/dev-tokens'), false);
  assert.equal(keys.has('GET /api/v1/complaints'), false);
  assert.equal(keys.has('GET /api/trace/config'), true);
  assert.equal(keys.has('POST /api/v1/identity/logout'), true);
});

test('pilot platform readiness reports 503 dependency state when trace is down', async () => {
  const readiness = createPilotReadiness({
    databaseCheck: async () => undefined,
    fetchReady: async (url) => ({ ok: !url.includes('trace') }),
    databaseUrl: 'postgresql://app@127.0.0.1/polis_trace_test',
    identityUrl: 'http://identity',
    traceUrl: 'http://trace',
  });
  assert.deepEqual(await readiness(), { ready: false, dependency: 'trace' });
  const readyRoute = operationalRoutes('pilot-platform', readiness).find(
    (route) => route.path === '/readyz',
  );
  const response = await readyRoute.handler({}, undefined, {});
  assert.equal(response.status, 503);
});

test('SMTP capture rejects an unauthorized recipient', async () => {
  const port = await availablePort();
  const mailDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pilot-smtp-'));
  const smtpScript = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../smtp-capture.mjs',
  );
  const child = spawn(
    process.execPath,
    [
      smtpScript,
      '--port',
      String(port),
      '--mail-dir',
      mailDir,
      '--allowed-recipients',
      JSON.stringify(['resident@vrsar.example.test']),
    ],
    {
      env: curatedEnvironment({
        PILOT_SMTP_CAPTURE_USER: 'test-user',
        PILOT_SMTP_CAPTURE_PASSWORD: 'test-password',
      }),
      stdio: 'ignore',
    },
  );
  try {
    await new Promise((resolve) => setTimeout(resolve, 150));
    const auth = Buffer.from('\0test-user\0test-password').toString('base64');
    const transcript = await smtpConversation(port, [
      'EHLO test',
      `AUTH PLAIN ${auth}`,
      'MAIL FROM:<noreply@vrsar.example.test>',
      'RCPT TO:<outside@example.test>',
    ]);
    assert.ok(transcript.some((line) => line.startsWith('550 recipient rejected')));
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    await fs.rm(mailDir, { recursive: true, force: true });
  }
});
