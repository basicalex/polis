import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { applyTraceIntakeOverride, traceServiceDefinition } from './trace-intake-restart.mjs';

import {
  DATABASE_NAME,
  PG_BIN,
  ROOT,
  TEST_EMAILS,
  TEST_MARKER,
  PilotError,
  assertOwnedRuntime,
  createRuntime,
  curatedEnvironment,
  databaseUrl,
  exists,
  initializeRuntime,
  loadRuntime,
  parseArgs,
  pidHasRuntimeMarker,
  publicRuntimeStatus,
  requireAvailablePorts,
  runBounded,
  runtimePathFrom,
  serviceEnvironment,
  terminateManagedGroup,
  updateState,
  waitForManagedReadiness,
  writeJsonPrivate,
  writeTextPrivate,
} from './runtime-lib.mjs';

const args = parseArgs(process.argv.slice(2));
const command = args.positional[0] ?? 'help';
const runtimeScript = path.join(ROOT, 'scripts/pilot/runtime.mjs');
const wrapperScript = path.join(ROOT, 'scripts/pilot/service-wrapper.mjs');
const smtpScript = path.join(ROOT, 'scripts/pilot/smtp-capture.mjs');
const seedScript = path.join(ROOT, 'scripts/pilot/seed-identities.mjs');
const coreMigrationScript = path.join(ROOT, 'scripts/pilot/run-core-migrations.mjs');
const pilotPlatformScript = path.join(ROOT, 'scripts/pilot/pilot-platform.mjs');

function integerOption(value, fallback, label) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535)
    throw new PilotError(`${label} must be a valid port`);
  return parsed;
}

function postgresEnvironment(runtime, database = DATABASE_NAME) {
  return curatedEnvironment({
    PGHOST: '127.0.0.1',
    PGPORT: String(runtime.metadata.database.port),
    PGUSER: runtime.secrets.postgres.superuser,
    PGPASSWORD: runtime.secrets.postgres.superuserPassword,
    PGDATABASE: database,
  });
}

function defaultLaunchConfiguration() {
  return {
    traceStartCommand: ['bun', '--no-env-file', 'run', '--filter', '@polis/trace-service', 'start'],
    traceMigrateCommand: [
      'bun',
      '--no-env-file',
      'run',
      '--filter',
      '@polis/trace-service',
      'migrate',
    ],
    traceBuildCommand: ['bun', '--no-env-file', 'run', '--filter', '@polis/trace-service', 'build'],
    traceExtraEnv: {},
    platformExtraEnv: {},
    intakeClosedCheckCommand: [
      'bun',
      '--no-env-file',
      path.join(ROOT, 'scripts/pilot/verify-intake-closed.mjs'),
    ],
    traceChainCheckCommand: [
      'bun',
      '--no-env-file',
      path.join(ROOT, 'scripts/pilot/verify-trace-chain.mjs'),
    ],
    traceTables: [
      'trace_schema_migrations',
      'trace_records',
      'trace_report_private',
      'trace_record_participants',
      'trace_events',
      'trace_command_idempotency',
      'trace_attachments',
      'trace_public_snapshots',
    ],
  };
}

function validateLaunchConfiguration(config) {
  if (
    config.traceTables !== null &&
    (!Array.isArray(config.traceTables) ||
      config.traceTables.length === 0 ||
      !config.traceTables.every((name) => /^[a-z][a-z0-9_]*$/.test(name)))
  ) {
    throw new PilotError('trace table contract must be a non-empty list of lowercase table names');
  }
}

async function writeLaunchConfiguration(runtimePath, config) {
  const { paths } = await assertOwnedRuntime(runtimePath);
  await writeJsonPrivate(paths.launch, config);
}

async function readLaunchConfiguration(runtime) {
  try {
    return JSON.parse(await fs.readFile(runtime.paths.launch, 'utf8'));
  } catch {
    throw new PilotError('runtime launch configuration is missing');
  }
}

function supervisorSpawn(runtimePath, build) {
  return spawn(
    'bun',
    [
      '--no-env-file',
      runtimeScript,
      'supervise',
      '--runtime',
      runtimePath,
      ...(build ? ['--build'] : []),
    ],
    {
      cwd: ROOT,
      detached: true,
      stdio: 'ignore',
      env: curatedEnvironment(),
    },
  );
}

async function waitForPhase(runtimePath, accepted, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const runtime = await loadRuntime(runtimePath);
    if (accepted.includes(runtime.state.phase)) return runtime;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new PilotError('runtime did not reach its expected state before timeout');
}

async function start() {
  const supplied = args.value('runtime') ?? process.env.PILOT_RUNTIME_DIR;
  let runtimePath;
  if (supplied) {
    runtimePath = path.resolve(supplied);
    await assertOwnedRuntime(runtimePath);
  } else {
    ({ runtimePath } = await createRuntime());
    const ports = {
      postgres: integerOption(process.env.PILOT_PG_PORT, 55433, 'PILOT_PG_PORT'),
      smtp: integerOption(process.env.PILOT_SMTP_PORT, 1025, 'PILOT_SMTP_PORT'),
      identity: 8650,
      trace: 8980,
      platform: 3000,
      web: 4321,
    };
    await requireAvailablePorts(ports);
    await initializeRuntime(runtimePath, ports);
  }
  const runtime = await loadRuntime(runtimePath);
  if (runtime.state.phase === 'running' || runtime.state.phase === 'starting') {
    throw new PilotError('runtime is already running or starting');
  }
  const config = defaultLaunchConfiguration();
  validateLaunchConfiguration(config);
  await writeLaunchConfiguration(runtimePath, config);
  await updateState(runtimePath, { phase: 'starting', managerPid: null, services: {} });
  const supervisor = supervisorSpawn(runtimePath, args.has('build'));
  supervisor.unref();
  await updateState(runtimePath, { phase: 'starting', managerPid: supervisor.pid, services: {} });
  const ready = await waitForPhase(runtimePath, ['running', 'failed', 'stopped']);
  if (ready.state.phase !== 'running') {
    throw new PilotError(
      `runtime failed to start; inspect ${path.join(runtimePath, 'logs/services/runtime-failure.log')}`,
    );
  }
  console.log(JSON.stringify(publicRuntimeStatus(ready), null, 2));
}

async function bootstrapPostgres(runtime) {
  const { metadata, paths, secrets } = runtime;
  if (!(await exists(path.join(paths.pgData, 'PG_VERSION')))) {
    await fs.mkdir(paths.pgData, { recursive: true, mode: 0o700 });
    await fs.chmod(paths.pgData, 0o700);
    const passwordFile = path.join(runtime.metadata.runtimePath, '.initdb-password');
    await writeTextPrivate(passwordFile, `${secrets.postgres.superuserPassword}\n`);
    try {
      await runBounded(
        path.join(PG_BIN, 'initdb'),
        [
          '--pgdata',
          paths.pgData,
          '--encoding',
          'UTF8',
          '--locale',
          'C',
          '--auth-host',
          'scram-sha-256',
          '--auth-local',
          'trust',
          '--username',
          secrets.postgres.superuser,
          '--pwfile',
          passwordFile,
        ],
        {
          capture: true,
          logFile: path.join(paths.serviceLogDir, 'runtime-failure.log'),
          timeoutMs: 60_000,
        },
      );
    } finally {
      await fs.rm(passwordFile, { force: true });
    }
    const postgresConf = path.join(paths.pgData, 'postgresql.conf');
    await fs.appendFile(
      postgresConf,
      [
        '',
        "listen_addresses = '127.0.0.1'",
        `port = ${metadata.database.port}`,
        "password_encryption = 'scram-sha-256'",
        'log_connections = off',
        'log_disconnections = off',
        "log_statement = 'none'",
        '',
      ].join('\n'),
      { mode: 0o600 },
    );
    await fs.chmod(postgresConf, 0o600);
  }
  await fs.mkdir(path.dirname(paths.pgLog), { recursive: true, mode: 0o700 });
  await runBounded(
    path.join(PG_BIN, 'pg_ctl'),
    ['start', '--wait', '--timeout', '20', '--pgdata', paths.pgData, '--log', paths.pgLog],
    {
      env: postgresEnvironment(runtime),
      timeoutMs: 30_000,
    },
  );
  await runBounded(
    path.join(PG_BIN, 'createdb'),
    ['--no-password', '--maintenance-db', 'postgres', DATABASE_NAME],
    {
      env: postgresEnvironment(runtime, 'postgres'),
      timeoutMs: 20_000,
    },
  ).catch(async (error) => {
    const existsQuery = `SELECT 1 FROM pg_database WHERE datname = '${DATABASE_NAME}'`;
    const response = await runBounded(
      path.join(PG_BIN, 'psql'),
      [
        '--no-password',
        '--tuples-only',
        '--no-align',
        '--dbname',
        'postgres',
        '--command',
        existsQuery,
      ],
      { env: postgresEnvironment(runtime, 'postgres'), capture: true, timeoutMs: 10_000 },
    );
    if (response.stdout.trim() !== '1') throw error;
  });
  await runBounded(
    path.join(PG_BIN, 'psql'),
    [
      '--no-password',
      '--set',
      'ON_ERROR_STOP=1',
      '--dbname',
      DATABASE_NAME,
      '--command',
      'CREATE EXTENSION IF NOT EXISTS vector;',
    ],
    { env: postgresEnvironment(runtime), timeoutMs: 20_000 },
  );
}

async function migrateCoreAndSeed(runtime) {
  const superEnv = serviceEnvironment(runtime, {
    DATABASE_URL: databaseUrl(runtime.metadata, runtime.secrets, 'superuser'),
    POSTGRES_USER: runtime.secrets.postgres.superuser,
    POSTGRES_PASSWORD: runtime.secrets.postgres.superuserPassword,
    PILOT_TEST_DATABASE_MARKER: TEST_MARKER,
  });
  const failureLog = path.join(runtime.paths.serviceLogDir, 'runtime-failure.log');
  await runBounded('bun', ['--no-env-file', coreMigrationScript], {
    env: superEnv,
    capture: true,
    logFile: failureLog,
    timeoutMs: 120_000,
  });
  await runBounded(
    'bun',
    ['--no-env-file', seedScript, '--runtime', runtime.metadata.runtimePath],
    {
      env: superEnv,
      capture: true,
      logFile: failureLog,
      timeoutMs: 30_000,
    },
  );
}

async function runTraceMigration(runtime, launch) {
  const superEnv = serviceEnvironment(runtime, {
    DATABASE_URL: databaseUrl(runtime.metadata, runtime.secrets, 'superuser'),
    POSTGRES_USER: runtime.secrets.postgres.superuser,
    POSTGRES_PASSWORD: runtime.secrets.postgres.superuserPassword,
    PILOT_TEST_DATABASE_MARKER: TEST_MARKER,
    ...launch.traceExtraEnv,
  });
  const [traceCommand, ...traceArgs] = launch.traceMigrateCommand;
  await runBounded(traceCommand, traceArgs, {
    env: superEnv,
    capture: true,
    logFile: path.join(runtime.paths.serviceLogDir, 'runtime-failure.log'),
    timeoutMs: 120_000,
  });
}

async function grantApplicationAccess(runtime) {
  const { secrets } = runtime;
  const quote = (identifier) => `"${identifier.replaceAll('"', '""')}"`;
  const app = quote(secrets.postgres.appUser);
  const owner = quote(secrets.postgres.superuser);
  const appPassword = secrets.postgres.appPassword.replaceAll("'", "''");
  const query = [
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${secrets.postgres.appUser}') THEN CREATE ROLE ${app} LOGIN PASSWORD '${appPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT; END IF; END $$;`,
    `GRANT CONNECT ON DATABASE ${quote(DATABASE_NAME)} TO ${app};`,
    `GRANT USAGE ON SCHEMA public TO ${app};`,
    `GRANT USAGE ON SCHEMA drizzle TO ${app};`,
    `GRANT SELECT ON TABLE drizzle.__drizzle_migrations TO ${app};`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${app};`,
    `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${app};`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${app};`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${app};`,
  ].join('\n');
  await runBounded(
    path.join(PG_BIN, 'psql'),
    ['--no-password', '--set', 'ON_ERROR_STOP=1', '--dbname', DATABASE_NAME, '--command', query],
    { env: postgresEnvironment(runtime), timeoutMs: 30_000 },
  );
}

async function buildDependencies(runtime, launch) {
  const builds = [
    ['bun', ['--no-env-file', 'run', '--filter', '@polis/domain', 'build']],
    ['bun', ['--no-env-file', 'run', '--filter', '@polis/db', 'build']],
    ['bun', ['--no-env-file', 'run', '--filter', '@polis/service-runtime', 'build']],
    ['bun', ['--no-env-file', 'run', '--filter', '@polis/citizen-identity-service', 'build']],
    ['bun', ['--no-env-file', 'run', '--filter', '@polis/platform-api', 'build']],
    [launch.traceBuildCommand[0], launch.traceBuildCommand.slice(1)],
  ];
  const buildLog = path.join(runtime.paths.serviceLogDir, 'build.log');
  for (const [executable, buildArgs] of builds) {
    await runBounded(executable, buildArgs, {
      env: curatedEnvironment(),
      capture: true,
      logFile: buildLog,
      timeoutMs: 120_000,
    });
  }
}

async function requireBuiltArtifacts() {
  const required = [
    path.join(ROOT, 'packages/db/dist/index.js'),
    path.join(ROOT, 'packages/service-runtime/dist/index.js'),
    path.join(ROOT, 'services/citizen-identity-service/dist/index.js'),
    path.join(ROOT, 'services/trace-service/dist/index.js'),
    path.join(ROOT, 'services/platform-api/dist/index.js'),
    path.join(ROOT, 'services/platform-api/dist/routes.js'),
    path.join(ROOT, 'services/platform-api/dist/trace-routes.js'),
    path.join(ROOT, 'node_modules/astro/bin/astro.mjs'),
  ];
  for (const artifact of required) {
    if (!(await exists(artifact)))
      throw new PilotError(
        'required local build artifact is absent; retry with runtime start --build (dependencies are not installed by this launcher)',
      );
  }
}

function serviceDefinition(runtime, launch, name) {
  if (name === 'smtp') {
    return {
      command: [
        'bun',
        '--no-env-file',
        smtpScript,
        '--port',
        String(runtime.metadata.ports.smtp),
        '--mail-dir',
        runtime.paths.mailDir,
        '--allowed-recipients',
        JSON.stringify(TEST_EMAILS),
      ],
      env: curatedEnvironment({
        PILOT_SMTP_CAPTURE_USER: runtime.secrets.smtp.user,
        PILOT_SMTP_CAPTURE_PASSWORD: runtime.secrets.smtp.password,
      }),
      healthUrl: null,
      cwd: ROOT,
    };
  }
  if (name === 'identity') {
    return {
      command: [
        'bun',
        '--no-env-file',
        'run',
        '--filter',
        '@polis/citizen-identity-service',
        'start',
      ],
      env: serviceEnvironment(runtime, { PORT: '8650' }),
      healthUrl: 'http://127.0.0.1:8650/readyz',
      cwd: ROOT,
    };
  }
  if (name === 'trace') {
    return traceServiceDefinition(runtime, launch, serviceEnvironment);
  }
  if (name === 'platform') {
    return {
      command: ['bun', '--no-env-file', pilotPlatformScript],
      env: serviceEnvironment(runtime, { PORT: '3000', ...launch.platformExtraEnv }),
      healthUrl: 'http://127.0.0.1:3000/readyz',
      cwd: ROOT,
    };
  }
  if (name === 'web') {
    return {
      command: [
        'node',
        path.join(ROOT, 'node_modules/astro/bin/astro.mjs'),
        'dev',
        '--host',
        '127.0.0.1',
        '--port',
        '4321',
      ],
      env: serviceEnvironment(runtime),
      healthUrl: 'http://127.0.0.1:4321/pilot/vrsar/',
      cwd: path.join(ROOT, 'apps/web'),
    };
  }
  throw new PilotError('unknown managed service');
}

async function spawnService(runtime, launch, name) {
  const definition = serviceDefinition(runtime, launch, name);
  await writeJsonPrivate(path.join(runtime.paths.serviceDir, `${name}.json`), definition);
  const wrapperLog = await fs.open(
    path.join(runtime.paths.serviceLogDir, `${name}.log`),
    'a',
    0o600,
  );
  const child = spawn(
    'bun',
    ['--no-env-file', wrapperScript, '--runtime', runtime.metadata.runtimePath, '--name', name],
    {
      cwd: ROOT,
      detached: true,
      stdio: ['ignore', wrapperLog.fd, wrapperLog.fd],
      env: curatedEnvironment(),
    },
  );
  await wrapperLog.close();
  child.unref();
  const state = await loadRuntime(runtime.metadata.runtimePath);
  const services = {
    ...(state.state.services ?? {}),
    [name]: { pid: child.pid, healthUrl: definition.healthUrl },
  };
  await updateState(runtime.metadata.runtimePath, { services });
  if (definition.healthUrl) {
    await waitForManagedReadiness({
      name,
      url: definition.healthUrl,
      isManagedChildRunning: () => pidHasRuntimeMarker(child.pid, runtime.metadata.runtimePath),
    });
  }
}

async function stopService(runtime, name) {
  const pid = runtime.state.services?.[name]?.pid;
  if (pid) await terminateManagedGroup(pid, runtime.metadata.runtimePath);
}

async function stopServices(runtime) {
  const names = Object.keys(runtime.state.services ?? {}).reverse();
  for (const name of names) await stopService(runtime, name);
}

async function stopPostgres(runtime) {
  if (!(await exists(path.join(runtime.paths.pgData, 'PG_VERSION')))) return;
  await runBounded(
    path.join(PG_BIN, 'pg_ctl'),
    ['stop', '--wait', '--timeout', '15', '--pgdata', runtime.paths.pgData, '--mode', 'fast'],
    { env: curatedEnvironment(), timeoutMs: 25_000 },
  ).catch(() => undefined);
}

async function supervise() {
  const runtimePath = runtimePathFrom(args);
  let runtime = await loadRuntime(runtimePath);
  let shutdown;
  let shutdownResolve;
  shutdown = new Promise((resolve) => {
    shutdownResolve = resolve;
  });
  const requestShutdown = () => shutdownResolve();
  process.once('SIGINT', requestShutdown);
  process.once('SIGTERM', requestShutdown);
  await updateState(runtimePath, { phase: 'starting', managerPid: process.pid, services: {} });
  try {
    const launch = await readLaunchConfiguration(runtime);
    validateLaunchConfiguration(launch);
    if (args.has('build')) await buildDependencies(runtime, launch);
    await requireBuiltArtifacts();
    await bootstrapPostgres(runtime);
    await migrateCoreAndSeed(runtime);
    await runTraceMigration(runtime, launch);
    await grantApplicationAccess(runtime);
    runtime = await loadRuntime(runtimePath);
    for (const name of ['smtp', 'identity', 'trace', 'platform', 'web']) {
      await spawnService(runtime, launch, name);
      runtime = await loadRuntime(runtimePath);
    }
    await updateState(runtimePath, { phase: 'running', managerPid: process.pid });
    await shutdown;
  } catch (error) {
    await fs
      .appendFile(
        path.join(runtime.paths.serviceLogDir, 'runtime-failure.log'),
        `${new Date().toISOString()} ${error instanceof Error ? (error.stack ?? error.message) : 'unknown failure'}\n`,
        { mode: 0o600 },
      )
      .catch(() => undefined);
    await updateState(runtimePath, { phase: 'failed', managerPid: process.pid });
  } finally {
    runtime = await loadRuntime(runtimePath);
    await stopServices(runtime);
    await stopPostgres(runtime);
    const failed = runtime.state.phase === 'failed';
    await updateState(runtimePath, {
      phase: failed ? 'failed' : 'stopped',
      managerPid: null,
      services: {},
    });
  }
}

async function status() {
  const runtime = await loadRuntime(runtimePathFrom(args));
  console.log(JSON.stringify(publicRuntimeStatus(runtime), null, 2));
}

async function stop() {
  const runtimePath = runtimePathFrom(args);
  let runtime = await loadRuntime(runtimePath);
  const managerPid = runtime.state.managerPid;
  if (managerPid && (await pidHasRuntimeMarker(managerPid, runtimePath))) {
    await terminateManagedGroup(managerPid, runtimePath);
    await waitForPhase(runtimePath, ['stopped', 'failed'], 25_000).catch(() => undefined);
  }
  runtime = await loadRuntime(runtimePath);
  if (runtime.state.phase !== 'stopped') {
    await stopServices(runtime);
    await stopPostgres(runtime);
    await updateState(runtimePath, { phase: 'stopped', managerPid: null, services: {} });
  }
  console.log(JSON.stringify(publicRuntimeStatus(await loadRuntime(runtimePath)), null, 2));
}

async function restart() {
  const runtimePath = runtimePathFrom(args);
  await stop();
  const supervisor = supervisorSpawn(runtimePath, args.has('build'));
  supervisor.unref();
  await updateState(runtimePath, { phase: 'starting', managerPid: supervisor.pid, services: {} });
  const ready = await waitForPhase(runtimePath, ['running', 'failed', 'stopped']);
  if (ready.state.phase !== 'running') {
    throw new PilotError(
      `runtime failed to restart; inspect ${path.join(runtimePath, 'logs/services/runtime-failure.log')}`,
    );
  }
  console.log(JSON.stringify(publicRuntimeStatus(ready), null, 2));
}

async function restartService() {
  const runtimePath = runtimePathFrom(args);
  if (args.value('service') !== 'trace') {
    throw new PilotError('restart-service supports only trace intake configuration');
  }
  const assignment = args.value('set');
  const match = assignment?.match(/^TRACE_INTAKE_OPEN=(true|false)$/);
  if (!match) {
    throw new PilotError('restart-service requires --set TRACE_INTAKE_OPEN=true|false');
  }
  const runtime = await loadRuntime(runtimePath);
  if (runtime.state.phase !== 'running') throw new PilotError('runtime is not running');
  const launch = applyTraceIntakeOverride(await readLaunchConfiguration(runtime), match[1]);
  await writeLaunchConfiguration(runtimePath, launch);
  await stopService(runtime, 'trace');
  await spawnService(await loadRuntime(runtimePath), launch, 'trace');
  console.log(JSON.stringify({ runtimePath, service: 'trace', restarted: true }, null, 2));
}

async function clean() {
  const runtimePath = runtimePathFrom(args);
  if (!args.has('confirm'))
    throw new PilotError(
      'cleanup requires --confirm and only removes this owned disposable runtime',
    );
  const runtime = await loadRuntime(runtimePath);
  if (runtime.state.phase === 'running' || runtime.state.phase === 'starting')
    throw new PilotError('stop the runtime before cleanup');
  await assertOwnedRuntime(runtimePath);
  await fs.rm(runtimePath, { recursive: true, force: false, maxRetries: 2 });
  console.log(JSON.stringify({ runtimePath, cleaned: true }, null, 2));
}

function help() {
  console.log(`Usage:
  bun --no-env-file scripts/pilot/runtime.mjs start [--build]
  bun --no-env-file scripts/pilot/runtime.mjs status --runtime <path>
  bun --no-env-file scripts/pilot/runtime.mjs stop --runtime <path>
  bun --no-env-file scripts/pilot/runtime.mjs restart --runtime <path> [--build]
  bun --no-env-file scripts/pilot/runtime.mjs clean --runtime <path> --confirm

A fresh start creates an owned mkdtemp runtime outside this repository. It prints its path and local URLs. Stop preserves state; clean is explicit and ownership-checked.`);
}

try {
  if (command === 'start') await start();
  else if (command === 'supervise') await supervise();
  else if (command === 'status') await status();
  else if (command === 'stop') await stop();
  else if (command === 'restart') await restart();
  else if (command === 'restart-service') await restartService();
  else if (command === 'clean') await clean();
  else if (command === 'help') help();
  else throw new PilotError('unknown runtime command');
} catch (error) {
  // Runtime logs and private service output stay in the mode-0600 runtime directory.
  console.error(error instanceof PilotError ? error.message : 'pilot runtime command failed');
  process.exitCode = 1;
}
