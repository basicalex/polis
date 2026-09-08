import path from 'node:path';

import {
  PG_BIN,
  PilotError,
  curatedEnvironment,
  loadRuntime,
  parseArgs,
  runBounded,
  serviceEnvironment,
} from './runtime-lib.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const runtimeScript = path.join(ROOT, 'scripts/pilot/runtime.mjs');
const args = parseArgs(process.argv.slice(2));
const runtimePath = path.resolve(args.value('runtime') ?? process.env.PILOT_RUNTIME_DIR ?? '');
if (!runtimePath) throw new PilotError('use --runtime <printed-runtime-path>');
const runtime = await loadRuntime(runtimePath);
if (runtime.state.phase !== 'running') throw new PilotError('runtime is not running');
const launch = JSON.parse(
  await (await import('node:fs/promises')).readFile(runtime.paths.launch, 'utf8'),
);
const operationalLog = path.join(runtime.paths.serviceLogDir, 'operational-smoke.log');

async function runStage(stage, work) {
  try {
    return await work();
  } catch {
    throw new PilotError(`${stage} failed; inspect ${operationalLog}`);
  }
}

async function ready(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
  if (!response.ok) throw new PilotError('required service is not ready');
}

async function verifyIntakeReopened() {
  const response = await fetch('http://127.0.0.1:8980/internal/trace/config', {
    headers: { 'x-polis-internal-token': runtime.secrets.internalApiToken },
    signal: AbortSignal.timeout(5_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.intakeOpen !== true) {
    throw new PilotError('trace intake did not reopen');
  }
}

async function restartTrace(value) {
  await runBounded(
    'bun',
    [
      '--no-env-file',
      runtimeScript,
      'restart-service',
      '--runtime',
      runtimePath,
      '--service',
      'trace',
      '--set',
      `TRACE_INTAKE_OPEN=${value}`,
    ],
    {
      env: curatedEnvironment(),
      capture: true,
      logFile: operationalLog,
      timeoutMs: 45_000,
    },
  );
}

let runFailure;
let cleanupFailure;
let intakeReopened = false;
try {
  await runStage('database health check', () =>
    runBounded(
      path.join(PG_BIN, 'psql'),
      [
        '--no-password',
        '--set',
        'ON_ERROR_STOP=1',
        '--dbname',
        'polis_trace_test',
        '--command',
        'SELECT 1;',
      ],
      {
        env: curatedEnvironment({
          PGHOST: '127.0.0.1',
          PGPORT: String(runtime.metadata.database.port),
          PGUSER: runtime.secrets.postgres.appUser,
          PGPASSWORD: runtime.secrets.postgres.appPassword,
          PGDATABASE: 'polis_trace_test',
        }),
        capture: true,
        logFile: operationalLog,
        timeoutMs: 10_000,
      },
    ),
  );
  for (const url of [
    'http://127.0.0.1:8650/readyz',
    'http://127.0.0.1:8980/readyz',
    'http://127.0.0.1:3000/readyz',
    'http://127.0.0.1:4321/pilot/vrsar/',
  ]) {
    await runStage(`service readiness check at ${url}`, () => ready(url));
  }

  if (!launch.intakeClosedCheckCommand) {
    throw new PilotError('trace intake-closure verifier is unavailable; no result was recorded');
  }
  await runStage('trace restart with intake closed', () => restartTrace('false'));
  const [checker, ...checkerArgs] = launch.intakeClosedCheckCommand;
  await runStage('intake-closure verifier', () =>
    runBounded(checker, checkerArgs, {
      env: serviceEnvironment(runtime, {
        TRACE_INTAKE_OPEN: 'false',
        ...launch.traceExtraEnv,
      }),
      capture: true,
      logFile: operationalLog,
      timeoutMs: 30_000,
    }),
  );
} catch (error) {
  runFailure = error;
} finally {
  try {
    await runStage('trace reopen', async () => {
      if ((await loadRuntime(runtimePath)).state.phase !== 'running') {
        throw new PilotError('runtime is not running');
      }
      await restartTrace('true');
    });
    await runStage('trace reopen verification', verifyIntakeReopened);
    intakeReopened = true;
  } catch (error) {
    cleanupFailure = error;
  }
}

if (cleanupFailure) throw cleanupFailure;
if (runFailure) throw runFailure;
console.log(
  JSON.stringify(
    {
      runtimePath,
      databaseHealth: 'ok',
      intakeClosed: 'verified',
      intakeReopened,
      scope: 'local-only',
    },
    null,
    2,
  ),
);
