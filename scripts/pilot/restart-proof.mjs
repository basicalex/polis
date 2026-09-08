import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { decodedEmailBodies } from './mail-codec.mjs';
import {
  PilotError,
  ROOT,
  assertOwnedRuntime,
  parseArgs,
  readJson,
  runBounded,
  runtimePathFrom,
  writeJsonPrivate,
} from './runtime-lib.mjs';

const BASE = 'http://127.0.0.1:4321';
const API = `${BASE}/pilot/vrsar/api`;
const EMAIL = 'resident@vrsar.example.test';
const HTTP_TIMEOUT_MS = 10_000;
const MAIL_TIMEOUT_MS = 15_000;
const RESTART_TIMEOUT_MS = 120_000;

function help() {
  console.log(`Usage:
  node scripts/pilot/restart-proof.mjs --runtime <printed-runtime-path>

Authenticates the controlled resident through the local web proxy, restarts the
owned local test stack, and writes a safe restart proof to the runtime logs.`);
}

const args = parseArgs(process.argv.slice(2));
if (args.has('help')) {
  help();
} else {
  if (args.positional.length > 0)
    throw new PilotError('restart proof takes no positional arguments');

  const runtimePath = runtimePathFrom(args);
  const { paths } = await assertOwnedRuntime(runtimePath);
  const state = await readJson(paths.state).catch(() => {
    throw new PilotError('runtime state is missing');
  });
  if (state.phase !== 'running') throw new PilotError('runtime is not running');

  const mailbox = path.join(paths.mailDir, 'messages.ndjson');
  const runtimeScript = path.join(ROOT, 'scripts/pilot/runtime.mjs');
  let sessionCookie;

  async function messages() {
    const content = await readFile(mailbox, 'utf8').catch(() => '');
    return content.split('\n').flatMap((line) => {
      try {
        return line ? [JSON.parse(line)] : [];
      } catch {
        return [];
      }
    });
  }

  async function request(route, body, authenticated = false) {
    const headers = { accept: 'application/json', connection: 'close' };
    if (body !== undefined) {
      headers.origin = BASE;
      headers['content-type'] = 'application/json';
    }
    if (authenticated && sessionCookie) headers.cookie = sessionCookie;
    return fetch(`${API}${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  }

  async function snapshot() {
    const session = await request('/session', undefined, true);
    assert.equal(session.status === 200, true, 'the existing session must remain valid');
    const identity = await session.json();
    assert.equal(
      identity?.actorId === 'trace-resident-test',
      true,
      'unexpected controlled identity',
    );

    const privateResponse = await request('/records', undefined, true);
    const publicResponse = await request('/public/records');
    assert.equal(privateResponse.status === 200, true, 'private records are unavailable');
    assert.equal(publicResponse.status === 200, true, 'public records are unavailable');

    const privateRecords = (await privateResponse.json())?.records;
    const publicRecords = (await publicResponse.json())?.records;
    assert.equal(Array.isArray(privateRecords), true, 'private record response is invalid');
    assert.equal(Array.isArray(publicRecords), true, 'public record response is invalid');
    privateRecords.sort((left, right) => left.id.localeCompare(right.id));
    publicRecords.sort((left, right) => left.id.localeCompare(right.id));
    assert.equal(
      privateRecords.length > 0 && publicRecords.length > 0,
      true,
      'restart proof needs populated private and public records',
    );
    return { privateRecords, publicRecords };
  }

  const seen = new Set((await messages()).map((message) => message.id));
  const magicLink = await request('/identity/magic-link', { email: EMAIL });
  assert.equal(magicLink.status === 200, true, 'controlled magic-link request failed');

  let link;
  const mailDeadline = Date.now() + MAIL_TIMEOUT_MS;
  while (!link && Date.now() < mailDeadline) {
    for (const message of await messages()) {
      if (seen.has(message.id) || !JSON.stringify(message.to ?? []).includes(EMAIL)) continue;
      for (const text of decodedEmailBodies(String(message.data ?? ''))) {
        for (const raw of text.match(/https?:\/\/[^\s<>"']+/g) ?? []) {
          try {
            const candidate = new URL(raw);
            const params = new URLSearchParams(candidate.hash.slice(1));
            if (
              candidate.origin === BASE &&
              candidate.pathname === '/pilot/vrsar/login' &&
              params.get('email') === EMAIL &&
              params.get('token')
            ) {
              link = candidate;
            }
          } catch {
            // Wait for a complete locally captured login link.
          }
        }
      }
    }
    if (!link) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(Boolean(link), true, 'controlled SMTP delivery did not arrive');

  const token = new URLSearchParams(link.hash.slice(1)).get('token');
  const exchange = await request('/identity/exchange', { email: EMAIL, token });
  assert.equal(exchange.status === 200, true, 'controlled magic-link exchange failed');
  const setCookie = exchange.headers.get('set-cookie');
  sessionCookie = setCookie?.split(';', 1)[0];
  assert.equal(
    Boolean(sessionCookie?.startsWith('polis_pilot_session=')),
    true,
    'session cookie was not issued',
  );
  assert.equal(
    Boolean(setCookie?.toLowerCase().includes('httponly')),
    true,
    'session is not HttpOnly',
  );

  try {
    const before = await snapshot();
    await runBounded('bun', ['--no-env-file', runtimeScript, 'restart', '--runtime', runtimePath], {
      cwd: ROOT,
      timeoutMs: RESTART_TIMEOUT_MS,
    });
    const after = await snapshot();
    const privateRecordsUnchanged =
      JSON.stringify(before.privateRecords) === JSON.stringify(after.privateRecords);
    const publicReceiptsUnchanged =
      JSON.stringify(before.publicRecords) === JSON.stringify(after.publicRecords);
    assert.equal(privateRecordsUnchanged, true, 'private record state changed across restart');
    assert.equal(publicReceiptsUnchanged, true, 'public receipts changed across restart');

    const logout = await request('/identity/logout', {}, true);
    assert.equal(logout.status === 200, true, 'logout failed');
    const revokedSession = await request('/session', undefined, true);
    assert.equal(revokedSession.status === 401, true, 'logout must revoke the pre-restart session');

    const proof = {
      testedAt: new Date().toISOString(),
      scope: 'controlled-local-only',
      sessionSurvivedRestart: true,
      privateRecordsUnchanged,
      publicReceiptsUnchanged,
      logoutRevokedOldSession: true,
      privateRecordCount: after.privateRecords.length,
      publicRecordCount: after.publicRecords.length,
    };
    await writeJsonPrivate(path.join(runtimePath, 'logs', 'restart-proof.json'), proof);
    console.log(JSON.stringify(proof, null, 2));
  } finally {
    if (sessionCookie) await request('/identity/logout', {}, true).catch(() => undefined);
  }
}
