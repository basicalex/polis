import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const PG_BIN = '/opt/homebrew/opt/postgresql@17/bin';
export const OWNER_KIND = 'polis-prepartner-runtime-v1';
export const TEST_MARKER = 'polis-prepartner-test-v1';
export const DATABASE_NAME = 'polis_trace_test';
export const TEST_EMAILS = Object.freeze([
  'resident@vrsar.example.test',
  'other@vrsar.example.test',
  'official@vrsar.example.test',
  'reviewer@vrsar.example.test',
]);

export class PilotError extends Error {}

export function fail(message) {
  throw new PilotError(message);
}

export function randomSecret(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function randomIdentifier(prefix) {
  return `${prefix}_${randomBytes(6).toString('hex')}`;
}

export function parseArgs(argv) {
  const positional = [];
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) {
      positional.push(value);
      continue;
    }
    const [key, inline] = value.slice(2).split('=', 2);
    if (!key) fail('invalid argument');
    if (inline !== undefined) {
      values.set(key, inline);
    } else if (argv[index + 1] && !argv[index + 1].startsWith('--')) {
      values.set(key, argv[index + 1]);
      index += 1;
    } else {
      flags.add(key);
    }
  }
  return {
    positional,
    flags,
    value(name, fallback) {
      return values.get(name) ?? fallback;
    },
    has(name) {
      return flags.has(name) || values.has(name);
    },
  };
}

export function runtimePathFrom(args) {
  const supplied = args.value('runtime') ?? process.env.PILOT_RUNTIME_DIR;
  if (!supplied) fail('a runtime path is required; use --runtime <printed-runtime-path>');
  return path.resolve(supplied);
}

export async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(target) {
  return JSON.parse(await fs.readFile(target, 'utf8'));
}

export async function writeJsonPrivate(target, value) {
  await fs.writeFile(target, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.chmod(target, 0o600);
}

export async function writeTextPrivate(target, value) {
  await fs.writeFile(target, value, { mode: 0o600 });
  await fs.chmod(target, 0o600);
}

export function pathsFor(runtimePath) {
  return {
    metadata: path.join(runtimePath, 'metadata.json'),
    secrets: path.join(runtimePath, 'private-secrets.json'),
    state: path.join(runtimePath, 'state.json'),
    launch: path.join(runtimePath, 'launch.json'),
    pgData: path.join(runtimePath, 'postgres'),
    pgLog: path.join(runtimePath, 'logs', 'postgres.log'),
    serviceLogDir: path.join(runtimePath, 'logs', 'services'),
    mailDir: path.join(runtimePath, 'mail'),
    serviceDir: path.join(runtimePath, 'services'),
    backupDir: path.join(runtimePath, 'backups'),
    restoreDir: path.join(runtimePath, 'restores'),
  };
}

function isOutsideRoot(runtimePath) {
  const relative = path.relative(ROOT, runtimePath);
  return (
    relative !== '' &&
    (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
  );
}

export async function assertOwnedRuntime(runtimePath) {
  const resolved = path.resolve(runtimePath);
  if (!isOutsideRoot(resolved)) fail('runtime path must be outside the repository');
  if (
    path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
    !path.basename(resolved).startsWith('polis-vrsar-prepartner-')
  ) {
    fail('runtime path is not an owned disposable mkdtemp target');
  }
  const paths = pathsFor(resolved);
  let metadata;
  try {
    metadata = await readJson(paths.metadata);
  } catch {
    fail('runtime ownership metadata is missing');
  }
  if (
    metadata?.kind !== OWNER_KIND ||
    metadata?.runtimePath !== resolved ||
    metadata?.repoRoot !== ROOT ||
    metadata?.testMarker !== TEST_MARKER ||
    metadata?.database?.name !== DATABASE_NAME ||
    metadata?.disposable !== true
  ) {
    fail('runtime ownership metadata does not match this launcher');
  }
  return { metadata, paths };
}

export async function createRuntime() {
  const runtimePath = await fs.mkdtemp(path.join(os.tmpdir(), 'polis-vrsar-prepartner-'));
  await fs.chmod(runtimePath, 0o700);
  const paths = pathsFor(runtimePath);
  await Promise.all([
    fs.mkdir(paths.serviceLogDir, { recursive: true, mode: 0o700 }),
    fs.mkdir(paths.mailDir, { recursive: true, mode: 0o700 }),
    fs.mkdir(paths.serviceDir, { recursive: true, mode: 0o700 }),
    fs.mkdir(paths.backupDir, { recursive: true, mode: 0o700 }),
    fs.mkdir(paths.restoreDir, { recursive: true, mode: 0o700 }),
  ]);
  return { runtimePath, paths };
}

export async function initializeRuntime(runtimePath, ports) {
  const { paths } = await assertOwnedRuntime(runtimePath).catch(async () => {
    const derived = pathsFor(runtimePath);
    return { paths: derived };
  });
  const existing = await exists(paths.metadata);
  if (existing) return assertOwnedRuntime(runtimePath);
  const metadata = {
    schemaVersion: 1,
    kind: OWNER_KIND,
    createdAt: new Date().toISOString(),
    runtimePath,
    repoRoot: ROOT,
    disposable: true,
    testMarker: TEST_MARKER,
    database: { name: DATABASE_NAME, host: '127.0.0.1', port: ports.postgres },
    ports,
  };
  const secrets = {
    postgres: {
      superuser: randomIdentifier('polis_pilot_owner'),
      superuserPassword: randomSecret(),
      appUser: randomIdentifier('polis_trace_app'),
      appPassword: randomSecret(),
    },
    internalApiToken: randomSecret(),
    identityHmacKey: randomSecret(48),
    smtp: { user: randomIdentifier('pilot_smtp'), password: randomSecret() },
  };
  await writeJsonPrivate(paths.metadata, metadata);
  await writeJsonPrivate(paths.secrets, secrets);
  await writeJsonPrivate(paths.state, {
    phase: 'created',
    updatedAt: new Date().toISOString(),
    managerPid: null,
    services: {},
  });
  return { metadata, paths, secrets };
}

export async function loadRuntime(runtimePath) {
  const { metadata, paths } = await assertOwnedRuntime(runtimePath);
  const secrets = await readJson(paths.secrets).catch(() =>
    fail('runtime private credentials are missing'),
  );
  const state = await readJson(paths.state).catch(() => ({ phase: 'unknown', services: {} }));
  return { metadata, paths, secrets, state };
}

export async function updateState(runtimePath, patch) {
  const { paths } = await assertOwnedRuntime(runtimePath);
  const current = await readJson(paths.state).catch(() => ({ services: {} }));
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await writeJsonPrivate(paths.state, next);
  return next;
}

export function databaseUrl(metadata, secrets, role = 'app') {
  const user = role === 'superuser' ? secrets.postgres.superuser : secrets.postgres.appUser;
  const password =
    role === 'superuser' ? secrets.postgres.superuserPassword : secrets.postgres.appPassword;
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${metadata.database.port}/${DATABASE_NAME}`;
}

export function postgresAdminUrl(metadata, secrets) {
  const url = new URL(databaseUrl(metadata, secrets, 'superuser'));
  url.pathname = '/postgres';
  return url.toString();
}

export function curatedEnvironment(extra = {}) {
  const base = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL']) {
    if (typeof process.env[key] === 'string' && process.env[key] !== '')
      base[key] = process.env[key];
  }
  return { ...base, ...extra };
}

export function serviceEnvironment(runtime, extra = {}) {
  const database = databaseUrl(runtime.metadata, runtime.secrets);
  return curatedEnvironment({
    NODE_ENV: 'development',
    DEPLOYMENT_PROFILE: 'dev',
    SERVICE_HOST: '127.0.0.1',
    DATABASE_URL: database,
    POSTGRES_HOST: '127.0.0.1',
    POSTGRES_PORT: String(runtime.metadata.database.port),
    POSTGRES_USER: runtime.secrets.postgres.appUser,
    POSTGRES_PASSWORD: runtime.secrets.postgres.appPassword,
    POSTGRES_SSL: 'false',
    INTERNAL_API_TOKEN: runtime.secrets.internalApiToken,
    CORS_ALLOWED_ORIGINS: 'http://127.0.0.1:4321',
    CORS_ORIGINS: 'http://127.0.0.1:4321',
    IDENTITY_MODE: 'stub',
    IDENTITY_HMAC_KEY: runtime.secrets.identityHmacKey,
    IDENTITY_DEV_TOKENS: 'false',
    IDENTITY_MAGIC_LINK_DELIVERY: 'smtp',
    PUBLIC_APP_URL: 'http://127.0.0.1:4321',
    IDENTITY_ALLOW_HTTP_LOCALHOST: 'true',
    OIDC_REDIRECT_URIS: 'http://127.0.0.1:4321/pilot/vrsar/login',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(runtime.metadata.ports.smtp),
    SMTP_USER: runtime.secrets.smtp.user,
    SMTP_PASSWORD: runtime.secrets.smtp.password,
    SMTP_FROM: 'Polis Trace Test <noreply@vrsar.example.test>',
    SMTP_USE_TLS: 'false',
    SMTP_USE_SSL: 'false',
    IDENTITY_INTERNAL_URL: 'http://127.0.0.1:8650',
    TRACE_INTERNAL_URL: 'http://127.0.0.1:8980',
    TRACE_ENABLED: 'true',
    TRACE_OFFICIAL_CITIZEN_IDS: 'trace-official-test',
    TRACE_REVIEWER_CITIZEN_IDS: 'trace-reviewer-test',
    TRACE_INTAKE_OPEN: 'true',
    PILOT_CONFIG_PATH: path.join(ROOT, 'config/pilots/vrsar-orsera.json'),
    TRACE_PILOT_CONFIG_PATH: path.join(ROOT, 'config/pilots/vrsar-orsera.json'),
    PILOT_API_BASE: 'http://127.0.0.1:3000',
    PUBLIC_RELEASE: '0',
    PUBLIC_SITE_URL: 'http://127.0.0.1:4321',
    PILOT_RUNTIME_DIR: runtime.metadata.runtimePath,
    PILOT_TEST_DATABASE_MARKER: TEST_MARKER,
    ...extra,
  });
}

export function parseCommandJson(value, label) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    fail(`${label} must be a JSON command array`);
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    !parsed.every((entry) => typeof entry === 'string' && entry.length > 0)
  ) {
    fail(`${label} must be a non-empty JSON array of strings`);
  }
  return parsed;
}

const protectedExtraKeys = new Set([
  'PATH',
  'HOME',
  'TMPDIR',
  'DATABASE_URL',
  'POSTGRES_PASSWORD',
  'POSTGRES_USER',
  'INTERNAL_API_TOKEN',
  'IDENTITY_HMAC_KEY',
  'SMTP_PASSWORD',
  'SMTP_USER',
]);

export function parseExtraEnv(value, label) {
  if (!value) return {};
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    fail(`${label} must be a JSON object`);
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object')
    fail(`${label} must be a JSON object`);
  const output = {};
  for (const [key, entry] of Object.entries(parsed)) {
    if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(key) || protectedExtraKeys.has(key)) {
      fail(`${label} contains a protected or invalid variable`);
    }
    if (typeof entry !== 'string' || entry.length > 4096)
      fail(`${label} values must be bounded strings`);
    output[key] = entry;
  }
  return output;
}

export async function portAvailable(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    fail('port must be an integer from 1 to 65535');
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

export async function requireAvailablePorts(ports) {
  for (const [name, port] of Object.entries(ports)) {
    if (!(await portAvailable(port))) fail(`${name} port is not available`);
  }
}

export async function waitForManagedReadiness({
  name,
  url,
  isManagedChildRunning,
  fetchImpl = fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  timeoutMs = 30_000,
}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isManagedChildRunning())) {
      throw new PilotError(`${name} exited before readiness`);
    }
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // The managed service is still starting.
    }
    await sleep(200);
  }
  throw new PilotError(`${name} did not become ready before timeout`);
}

export async function runBounded(command, args, options = {}) {
  const {
    cwd = ROOT,
    env = curatedEnvironment(),
    timeoutMs = 60_000,
    input,
    capture = false,
    logFile,
  } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      detached: true,
      stdio: capture ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'ignore', 'ignore'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killTimer;
    if (capture) {
      child.stdout?.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr?.on('data', (chunk) => {
        stderr += chunk;
      });
    }
    if (input !== undefined) child.stdin?.end(input);
    else child.stdin?.end();
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
      killTimer = setTimeout(() => {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      }, 5_000);
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      reject(new PilotError(`could not start ${path.basename(command)}: ${error.message}`));
    });
    child.once('exit', async (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      if (logFile && capture && (stdout || stderr)) {
        await fs.appendFile(logFile, stdout + stderr, { mode: 0o600 }).catch(() => undefined);
        await fs.chmod(logFile, 0o600).catch(() => undefined);
      }
      if (timedOut) reject(new PilotError(`command timed out: ${path.basename(command)}`));
      else if (code === 0) resolve({ stdout, stderr });
      else
        reject(new PilotError(`${path.basename(command)} exited with code ${code ?? 'unknown'}`));
    });
  });
}

export async function psCommand(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return null;
  try {
    const { stdout } = await runBounded('/bin/ps', ['-p', String(pid), '-o', 'command='], {
      timeoutMs: 2_000,
      capture: true,
    });
    const command = stdout.trim();
    return command || null;
  } catch {
    return null;
  }
}

export async function pidHasRuntimeMarker(pid, runtimePath) {
  const command = await psCommand(pid);
  return command !== null && command.includes(runtimePath) && command.includes('scripts/pilot/');
}

export async function terminateManagedGroup(pid, runtimePath, timeoutMs = 10_000) {
  if (!(await pidHasRuntimeMarker(pid, runtimePath))) return false;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    return false;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await psCommand(pid))) return true;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  if (await pidHasRuntimeMarker(pid, runtimePath)) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      return false;
    }
  }
  return true;
}

export function safeEqualString(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function publicRuntimeStatus(runtime) {
  return {
    runtimePath: runtime.metadata.runtimePath,
    phase: runtime.state.phase ?? 'unknown',
    postgres: {
      host: '127.0.0.1',
      port: runtime.metadata.database.port,
      database: DATABASE_NAME,
    },
    urls: {
      identity: 'http://127.0.0.1:8650',
      trace: 'http://127.0.0.1:8980',
      platform: 'http://127.0.0.1:3000',
      web: 'http://127.0.0.1:4321',
      smtp: `smtp://127.0.0.1:${runtime.metadata.ports.smtp}`,
    },
    inboxPath: path.join(runtime.paths.mailDir, 'messages.ndjson'),
    inboxCommand: `bun --no-env-file ${path.join(ROOT, 'scripts/pilot/inbox.mjs')} list --runtime ${runtime.metadata.runtimePath}`,
  };
}
