import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  DATABASE_NAME,
  PG_BIN,
  PilotError,
  TEST_MARKER,
  curatedEnvironment,
  databaseUrl,
  loadRuntime,
  parseArgs,
  runBounded,
  serviceEnvironment,
  writeJsonPrivate,
  writeTextPrivate,
} from './runtime-lib.mjs';

const args = parseArgs(process.argv.slice(2));
const action = args.positional[0] ?? 'run';
const runtimePath = path.resolve(args.value('runtime') ?? process.env.PILOT_RUNTIME_DIR ?? '');
if (!runtimePath) throw new PilotError('use --runtime <printed-runtime-path>');
const runtime = await loadRuntime(runtimePath);
if (runtime.state.phase !== 'running') throw new PilotError('runtime is not running');
const launch = JSON.parse(await fs.readFile(runtime.paths.launch, 'utf8'));

function pgEnv(database) {
  return curatedEnvironment({
    PGHOST: '127.0.0.1',
    PGPORT: String(runtime.metadata.database.port),
    PGUSER: runtime.secrets.postgres.superuser,
    PGPASSWORD: runtime.secrets.postgres.superuserPassword,
    PGDATABASE: database,
  });
}

function validateTables() {
  const tables = launch.traceTables;
  if (
    !Array.isArray(tables) ||
    tables.length === 0 ||
    !tables.every((name) => /^[a-z][a-z0-9_]*$/.test(name))
  ) {
    throw new PilotError('trace table comparison contract is unavailable; no result was recorded');
  }
  return tables;
}

async function psql(database, query) {
  return runBounded(
    path.join(PG_BIN, 'psql'),
    [
      '--no-password',
      '--set',
      'ON_ERROR_STOP=1',
      '--tuples-only',
      '--no-align',
      '--dbname',
      database,
      '--command',
      query,
    ],
    { env: pgEnv(database), capture: true, timeoutMs: 30_000 },
  );
}

async function canonicalSnapshot(database, tables) {
  const digest = createHash('sha256');
  const tableCounts = {};
  for (const table of tables) {
    const count = (await psql(database, `SELECT count(*) FROM public."${table}";`)).stdout.trim();
    const rows = (
      await psql(
        database,
        `SELECT row_to_json(row)::text FROM (SELECT * FROM public."${table}") AS row ORDER BY row_to_json(row)::text;`,
      )
    ).stdout;
    digest.update(`${table}\0${count}\0`, 'utf8');
    digest.update(rows, 'utf8');
    digest.update('\0', 'utf8');
    tableCounts[table] = Number(count);
  }
  return { tableCounts, canonicalDigest: digest.digest('hex') };
}

function encrypt(plain, key) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([
    Buffer.from('POLIS-PILOT-BACKUP-v1\n'),
    nonce,
    cipher.getAuthTag(),
    ciphertext,
  ]);
}

function decrypt(encoded, key) {
  const header = Buffer.from('POLIS-PILOT-BACKUP-v1\n');
  if (encoded.length < header.length + 28 || !encoded.subarray(0, header.length).equals(header)) {
    throw new PilotError('backup artifact format is invalid');
  }
  const nonce = encoded.subarray(header.length, header.length + 12);
  const tag = encoded.subarray(header.length + 12, header.length + 28);
  const ciphertext = encoded.subarray(header.length + 28);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

async function createDatabase(database) {
  await runBounded(
    path.join(PG_BIN, 'createdb'),
    ['--no-password', '--maintenance-db', 'postgres', database],
    {
      env: pgEnv('postgres'),
      timeoutMs: 30_000,
    },
  );
}

async function assertRestoreOwnership(database, restoreId) {
  const marker = (
    await psql(database, 'SELECT marker FROM public.pilot_restore_owner_marker LIMIT 1;')
  ).stdout.trim();
  if (marker !== restoreId)
    throw new PilotError('restore database ownership marker does not match');
}

async function dropRestore(metadata) {
  await assertRestoreOwnership(metadata.database, metadata.id);
  await runBounded(
    path.join(PG_BIN, 'dropdb'),
    ['--no-password', '--force', '--maintenance-db', 'postgres', metadata.database],
    {
      env: pgEnv('postgres'),
      timeoutMs: 30_000,
    },
  );
}

async function cleanup() {
  if (!args.has('confirm')) throw new PilotError('restore cleanup requires --confirm');
  const id = args.value('restore-id');
  if (!id || !/^[a-z0-9-]+$/.test(id)) throw new PilotError('use a valid --restore-id');
  const metadataPath = path.join(runtime.paths.restoreDir, `${id}.json`);
  const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
  if (
    metadata.kind !== 'polis-prepartner-local-restore-v1' ||
    metadata.runtimePath !== runtimePath ||
    metadata.testMarker !== TEST_MARKER ||
    !metadata.database.endsWith('_test')
  ) {
    throw new PilotError('restore metadata does not identify an owned disposable target');
  }
  await dropRestore(metadata);
  await fs.rm(metadataPath, { force: true });
  console.log(JSON.stringify({ runtimePath, restoreId: id, cleaned: true }, null, 2));
}

async function run() {
  const tables = validateTables();
  if (!launch.traceChainCheckCommand) {
    throw new PilotError('trace chain verifier is unavailable; no result was recorded');
  }
  const id = `restore-${randomBytes(8).toString('hex')}`;
  const restoreDatabase = `polis_trace_${id.replace('-', '_')}_test`;
  const dumpPath = path.join(runtime.paths.backupDir, `${id}.dump`);
  const artifactPath = path.join(runtime.paths.backupDir, `${id}.dump.enc`);
  const keyPath = path.join(runtime.paths.backupDir, `${id}.key`);
  const restoreDumpPath = path.join(runtime.paths.restoreDir, `${id}.restore.dump`);
  const metadataPath = path.join(runtime.paths.restoreDir, `${id}.json`);
  try {
    const before = await canonicalSnapshot(DATABASE_NAME, tables);
    await runBounded(
      path.join(PG_BIN, 'pg_dump'),
      [
        '--no-password',
        '--format=custom',
        '--no-owner',
        '--no-privileges',
        '--file',
        dumpPath,
        '--dbname',
        DATABASE_NAME,
      ],
      { env: pgEnv(DATABASE_NAME), timeoutMs: 120_000 },
    );
    await fs.chmod(dumpPath, 0o600);
    const key = randomBytes(32);
    await writeTextPrivate(keyPath, `${key.toString('base64')}\n`);
    const encoded = encrypt(await fs.readFile(dumpPath), key);
    await fs.writeFile(artifactPath, encoded, { mode: 0o600 });
    await fs.chmod(artifactPath, 0o600);
    const tampered = Buffer.from(encoded);
    tampered[tampered.length - 1] ^= 1;
    let tamperDetected = false;
    try {
      decrypt(tampered, key);
    } catch {
      tamperDetected = true;
    }
    if (!tamperDetected) throw new PilotError('backup ciphertext tamper detection failed');
    await fs.writeFile(restoreDumpPath, decrypt(encoded, key), { mode: 0o600 });
    await fs.chmod(restoreDumpPath, 0o600);
    await createDatabase(restoreDatabase);
    await psql(
      restoreDatabase,
      `CREATE TABLE public.pilot_restore_owner_marker (marker text PRIMARY KEY NOT NULL); INSERT INTO public.pilot_restore_owner_marker (marker) VALUES ('${id}');`,
    );
    await writeJsonPrivate(metadataPath, {
      kind: 'polis-prepartner-local-restore-v1',
      id,
      runtimePath,
      testMarker: TEST_MARKER,
      database: restoreDatabase,
      createdAt: new Date().toISOString(),
      status: 'restoring',
    });
    await runBounded(
      path.join(PG_BIN, 'pg_restore'),
      [
        '--no-password',
        '--exit-on-error',
        '--no-owner',
        '--no-privileges',
        '--dbname',
        restoreDatabase,
        restoreDumpPath,
      ],
      { env: pgEnv(restoreDatabase), timeoutMs: 120_000 },
    );
    const after = await canonicalSnapshot(restoreDatabase, tables);
    if (
      JSON.stringify(before.tableCounts) !== JSON.stringify(after.tableCounts) ||
      before.canonicalDigest !== after.canonicalDigest
    ) {
      throw new PilotError('local restore data comparison failed');
    }
    const [checker, ...checkerArgs] = launch.traceChainCheckCommand;
    for (const database of [DATABASE_NAME, restoreDatabase]) {
      await runBounded(checker, checkerArgs, {
        env: serviceEnvironment(runtime, {
          DATABASE_URL: databaseUrl(runtime.metadata, runtime.secrets, 'superuser').replace(
            `/${DATABASE_NAME}`,
            `/${database}`,
          ),
          PILOT_TRACE_CHECK_DATABASE: database,
          PILOT_TEST_DATABASE_MARKER: TEST_MARKER,
          ...launch.traceExtraEnv,
        }),
        timeoutMs: 60_000,
      });
    }
    const metadata = {
      kind: 'polis-prepartner-local-restore-v1',
      id,
      runtimePath,
      testMarker: TEST_MARKER,
      database: restoreDatabase,
      createdAt: new Date().toISOString(),
      artifactPath,
      keyPath,
      comparison: before,
      tamperDetected: true,
      chainVerified: true,
    };
    await writeJsonPrivate(metadataPath, metadata);
    console.log(
      JSON.stringify(
        {
          runtimePath,
          restoreId: id,
          localRestore: 'verified',
          tamperDetected: true,
          scope: 'local-only',
        },
        null,
        2,
      ),
    );
    if (args.has('cleanup')) {
      await dropRestore(metadata);
      await fs.rm(metadataPath, { force: true });
      console.log(JSON.stringify({ runtimePath, restoreId: id, cleaned: true }, null, 2));
    }
  } finally {
    await fs.rm(dumpPath, { force: true });
    await fs.rm(restoreDumpPath, { force: true });
  }
}

if (action === 'run') await run();
else if (action === 'clean') await cleanup();
else throw new PilotError('recovery action must be run or clean');
