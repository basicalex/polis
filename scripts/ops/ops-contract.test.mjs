import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const opsDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(opsDirectory, '../..');
const verifierPath = join(opsDirectory, 'verify-audit-chain.mjs');
const backupPath = join(opsDirectory, 'backup.sh');
const restorePath = join(opsDirectory, 'restore-verify.sh');
const cleanDbDrillPath = join(opsDirectory, 'clean-db-drill.sh');
const wrapperPath = join(opsDirectory, 'test-backup-restore.sh');
const canonicalFields = [
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

function withHash(record, previousHash) {
  const canonical = {};
  for (const field of canonicalFields) canonical[field] = record[field];
  const hash = createHash('sha256')
    .update(`${previousHash ?? ''}${JSON.stringify(stableValue(canonical))}`)
    .digest('hex');
  return { ...record, hash, previousHash };
}

function auditRecord(id, createdAt, overrides = {}) {
  return {
    id,
    eventType: 'pilot.record.changed',
    actorType: 'service',
    actorId: 'ops-contract-test',
    targetType: 'record',
    targetId: id,
    action: 'verify',
    reason: null,
    correlationId: 'ops-contract',
    visibility: 'restricted',
    data: { nested: { beta: true, alpha: 1 }, z: id },
    redactedData: null,
    createdAt,
    ...overrides,
  };
}

function validChain() {
  const first = withHash(auditRecord('audit-001', '2026-08-03T12:00:00.000Z'), null);
  const second = withHash(auditRecord('audit-002', '2026-08-03T12:00:01.000Z'), first.hash);
  return [first, second];
}

function runVerifier(contents, arguments_ = []) {
  const directory = mkdtempSync(join(tmpdir(), 'polis-audit-contract-'));
  const fixturePath = join(directory, 'audit-input');
  writeFileSync(fixturePath, contents, { mode: 0o600 });
  try {
    return spawnSync(process.execPath, [verifierPath, ...arguments_, fixturePath], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      timeout: 10_000,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function assertVerifierFailure(result, messagePattern) {
  assert.notEqual(result.status, 0, `verifier unexpectedly passed: ${result.stdout}`);
  assert.match(result.stderr, messagePattern);
}

function writeExecutable(path, contents) {
  writeFileSync(path, contents, { mode: 0o700 });
  chmodSync(path, 0o700);
}

function makeRestoreStubDirectory(markerDirectory) {
  const binDirectory = join(markerDirectory, 'bin');
  mkdirSync(binDirectory, { recursive: true });
  for (const name of ['psql', 'restic', 'pg_restore']) {
    writeExecutable(
      join(binDirectory, name),
      `#!/usr/bin/env bash\nprintf '%s\\n' reached >${JSON.stringify(join(markerDirectory, `${name}.marker`))}\nexit 42\n`,
    );
  }
  return binDirectory;
}
function makeBackupStubDirectory(markerDirectory) {
  const binDirectory = join(markerDirectory, 'bin');
  mkdirSync(binDirectory, { recursive: true });
  for (const name of ['pg_dump', 'pg_restore', 'psql', 'restic']) {
    writeExecutable(
      join(binDirectory, name),
      `#!/usr/bin/env bash\nprintf '%s\\n' reached >${JSON.stringify(join(markerDirectory, `${name}.marker`))}\nexit 42\n`,
    );
  }
  return binDirectory;
}

function runBackupRefusal(environment, passwordMode = 0o600) {
  const directory = mkdtempSync(join(tmpdir(), 'polis-backup-refusal-'));
  const passwordFile = join(directory, 'restic-password');
  writeFileSync(passwordFile, 'not-secret\n', { mode: passwordMode });
  chmodSync(passwordFile, passwordMode);
  const stubPath = makeBackupStubDirectory(directory);
  try {
    const result = spawnSync('bash', [backupPath], {
      env: {
        PATH: `${stubPath}:${process.env.PATH ?? ''}`,
        DEPLOYMENT_PROFILE: 'pilot',
        BACKUP_ENABLED: 'true',
        DATABASE_URL: 'postgresql://127.0.0.1:5432/polis',
        RESTIC_REPOSITORY: 's3:s3.example.invalid/polis-backups',
        RESTIC_PASSWORD_FILE: passwordFile,
        ...environment,
      },
      cwd: repositoryRoot,
      encoding: 'utf8',
      timeout: 10_000,
    });
    return {
      ...result,
      psqlReached: statExists(join(directory, 'psql.marker')),
      resticReached: statExists(join(directory, 'restic.marker')),
      passwordFile,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function runRestoreRefusal(environment, passwordMode = 0o600) {
  const directory = mkdtempSync(join(tmpdir(), 'polis-restore-refusal-'));
  const passwordFile = join(directory, 'restic-password');
  writeFileSync(passwordFile, 'not-secret\n', { mode: passwordMode });
  chmodSync(passwordFile, passwordMode);
  const stubPath = makeRestoreStubDirectory(directory);
  try {
    const result = spawnSync('bash', [restorePath], {
      env: {
        PATH: `${stubPath}:${process.env.PATH ?? ''}`,
        DEPLOYMENT_PROFILE: 'pilot',
        RESTORE_TARGET_IS_DISPOSABLE: 'true',
        RESTORE_DRILL_CONFIRMATION: 'DESTROY_ONLY_POLIS_DISPOSABLE_RESTORE_TARGET',
        DATABASE_URL: 'postgresql://127.0.0.1:5432/polis_restore_drill_contract',
        SOURCE_DATABASE_URL: 'postgresql://127.0.0.1:5432/polis_source_contract',
        PRODUCTION_DATABASE_URL: 'postgresql://127.0.0.1:5432/polis_production_contract',
        RESTIC_REPOSITORY: 's3:s3.example.invalid/polis-backups',
        RESTIC_PASSWORD_FILE: passwordFile,
        RESTIC_SNAPSHOT: '1234abcd',
        ...environment,
      },
      cwd: repositoryRoot,
      encoding: 'utf8',
      timeout: 10_000,
    });
    return {
      ...result,
      resticReached: statExists(join(directory, 'restic.marker')),
      psqlReached: statExists(join(directory, 'psql.marker')),
      pgRestoreReached: statExists(join(directory, 'pg_restore.marker')),
      passwordFile,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
function assertBackupRefusal(environment, messagePattern, passwordMode) {
  const result = runBackupRefusal(environment, passwordMode);
  assert.notEqual(result.status, 0, `backup unexpectedly passed: ${result.stdout}`);
  assert.match(result.stderr, messagePattern);
  assert.equal(result.psqlReached, false, 'psql must not be reached');
  assert.equal(result.resticReached, false, 'restic must not be reached');
  assert.doesNotMatch(
    result.stderr,
    new RegExp(result.passwordFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
}

function statExists(path) {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function assertRestoreRefusal(environment, messagePattern, passwordMode) {
  const result = runRestoreRefusal(environment, passwordMode);
  assert.notEqual(result.status, 0, `restore unexpectedly passed: ${result.stdout}`);
  assert.match(result.stderr, messagePattern);
  assert.equal(result.resticReached, false, 'restic restore must not be reached');
  assert.equal(result.psqlReached, false, 'psql must not be reached');
  assert.equal(result.pgRestoreReached, false, 'pg_restore must not be reached');
  assert.doesNotMatch(
    result.stderr,
    new RegExp(result.passwordFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
}

function validRestoreManifest(overrides = {}) {
  return {
    formatVersion: 3,
    repositoryClass: 'off-host',
    productionEligible: true,
    deploymentProfile: 'pilot',
    createdAt: '2026-08-03T12:00:00Z',
    gitSha: 'a'.repeat(40),
    postgresMajor: 16,
    dumpFile: 'polis.dump',
    dumpSha256: 'b'.repeat(64),
    restoreListSha256: 'c'.repeat(64),
    publicTableCount: 1,
    migrationCount: 1,
    latestMigrationHash: 'd'.repeat(64),
    auditEventCount: 1,
    auditHeadHash: 'e'.repeat(64),
    ...overrides,
  };
}

function runRestoreManifestRefusal(manifest, environment = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'polis-restore-manifest-contract-'));
  const passwordFile = join(directory, 'restic-password');
  const binDirectory = join(directory, 'bin');
  const manifestFixture = join(directory, 'manifest.fixture.json');
  const dumpFixture = join(directory, 'polis.dump.fixture');
  mkdirSync(binDirectory, { recursive: true });
  writeFileSync(passwordFile, 'not-secret\n', { mode: 0o600 });
  writeFileSync(manifestFixture, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(dumpFixture, 'not-a-real-dump\n', { mode: 0o600 });
  writeExecutable(
    join(binDirectory, 'restic'),
    `#!/usr/bin/env bash
printf '%s\\n' reached >${JSON.stringify(join(directory, 'restic.marker'))}
target=''
while [[ $# -gt 0 ]]; do
  if [[ $1 == --target ]]; then
    target=$2
    shift 2
  else
    shift
  fi
done
[[ -n $target ]] || exit 43
cp ${JSON.stringify(manifestFixture)} "$target/manifest.json"
cp ${JSON.stringify(dumpFixture)} "$target/polis.dump"
exit 0
`,
  );
  for (const name of ['psql', 'pg_restore']) {
    writeExecutable(
      join(binDirectory, name),
      `#!/usr/bin/env bash\nprintf '%s\\n' reached >${JSON.stringify(join(directory, `${name}.marker`))}\nexit 42\n`,
    );
  }
  try {
    const result = spawnSync('bash', [restorePath], {
      env: {
        PATH: `${binDirectory}:${process.env.PATH ?? ''}`,
        DEPLOYMENT_PROFILE: 'pilot',
        RESTORE_TARGET_IS_DISPOSABLE: 'true',
        RESTORE_DRILL_CONFIRMATION: 'DESTROY_ONLY_POLIS_DISPOSABLE_RESTORE_TARGET',
        DATABASE_URL: 'postgresql://127.0.0.1:5432/polis_restore_drill_contract',
        SOURCE_DATABASE_URL: 'postgresql://127.0.0.1:5432/polis_source_contract',
        PRODUCTION_DATABASE_URL: 'postgresql://127.0.0.1:5432/polis_production_contract',
        RESTIC_REPOSITORY: 's3:s3.example.invalid/polis-backups',
        RESTIC_PASSWORD_FILE: passwordFile,
        RESTIC_SNAPSHOT: '1234abcd',
        ...environment,
      },
      cwd: repositoryRoot,
      encoding: 'utf8',
      timeout: 10_000,
    });
    return {
      ...result,
      resticReached: statExists(join(directory, 'restic.marker')),
      psqlReached: statExists(join(directory, 'psql.marker')),
      pgRestoreReached: statExists(join(directory, 'pg_restore.marker')),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function assertRestoreManifestRefusal(manifest, messagePattern, environment) {
  const result = runRestoreManifestRefusal(manifest, environment);
  assert.notEqual(result.status, 0, `restore unexpectedly passed: ${result.stdout}`);
  assert.match(result.stderr, messagePattern);
  assert.equal(result.resticReached, true, 'restic restore must materialize the manifest fixture');
  assert.equal(result.psqlReached, false, 'psql must not be reached after manifest refusal');
  assert.equal(
    result.pgRestoreReached,
    false,
    'pg_restore must not be reached after manifest refusal',
  );
}

test('audit verifier accepts valid JSON and NDJSON chains', () => {
  const chain = validChain();
  const jsonResult = runVerifier(JSON.stringify(chain));
  assert.equal(jsonResult.status, 0, jsonResult.stderr);
  assert.deepEqual(JSON.parse(jsonResult.stdout), {
    ok: true,
    records: 2,
    headHash: chain[1].hash,
  });

  const ndjsonResult = runVerifier(chain.map((record) => JSON.stringify(record)).join('\n'));
  assert.equal(ndjsonResult.status, 0, ndjsonResult.stderr);
});

test('audit verifier rejects recomputed hash tampering', () => {
  const chain = validChain();
  chain[1].data = { altered: true };
  assertVerifierFailure(runVerifier(JSON.stringify(chain)), /recomputed hash mismatch at record 2/);
});

test('audit verifier rejects previous-hash gaps', () => {
  const chain = validChain();
  chain[1].previousHash = '0'.repeat(64);
  assertVerifierFailure(runVerifier(JSON.stringify(chain)), /previous-hash mismatch at record 2/);
});

test('audit verifier rejects out-of-order records', () => {
  const first = withHash(auditRecord('audit-002', '2026-08-03T12:00:01.000Z'), null);
  const second = withHash(auditRecord('audit-001', '2026-08-03T12:00:00.000Z'), first.hash);
  assertVerifierFailure(
    runVerifier(JSON.stringify([first, second])),
    /order gap or out-of-order record at record 2/,
  );
});

test('audit verifier rejects malformed and empty input unless explicitly allowed', () => {
  assertVerifierFailure(runVerifier('{not-json}\n'), /malformed input/);
  assertVerifierFailure(runVerifier(''), /audit sequence is empty/);

  const allowed = runVerifier('', ['--allow-empty']);
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.deepEqual(JSON.parse(allowed.stdout), { ok: true, records: 0, headHash: null });
});

test('backup script is fail-closed and archives only named non-secret artifacts', () => {
  const source = readFileSync(backupPath, 'utf8');
  assert.match(source, /DEPLOYMENT_PROFILE.*pilot/);
  assert.match(source, /BACKUP_ENABLED.*true/);
  assert.match(source, /OPS_ALLOW_LOCAL_RESTIC_REPOSITORY_FOR_TESTS/);
  assert.match(source, /RESTIC_PASSWORD_FILE is not usable/);
  assert.match(source, /stat -Lc/);
  assert.match(source, /\(16#\$mode_hex & 077\) == 0/);
  assert.match(source, /repository_class=\$\(classify_restic_repository\)/);
  assert.match(source, /production_eligible=true/);
  assert.match(source, /rev-parse --show-toplevel/);
  assert.match(source, /worktree_status=\$\(git -C "\$repo_root" status/);
  assert.match(source, /could not verify clean working tree/);
  assert.match(source, /working tree must be clean before a release backup/);
  assert.match(source, /mktemp -d/);
  assert.match(source, /trap cleanup EXIT/);
  assert.match(source, /trap 'exit 130' INT/);
  assert.match(source, /readonly dump_name='polis\.dump'/);
  assert.match(source, /readonly manifest_name='manifest\.json'/);
  assert.match(source, /pg_dump[\s\S]*--format=custom[\s\S]*--no-owner[\s\S]*--no-privileges/);
  assert.match(source, /SELECT pg_export_snapshot\(\)/);
  assert.match(source, /SET TRANSACTION SNAPSHOT :'snapshot_id'/);
  assert.match(source, /formatVersion: 3/);
  assert.match(source, /pg_restore --list/);
  assert.doesNotMatch(source, /formatVersion: 2/);
  assert.match(source, /postgresMajor/);
  assert.match(source, /pg_dump major/);
  assert.match(source, /source PostgreSQL major/);
  assert.match(source, /dumpSha256/);
  assert.match(source, /restoreListSha256/);
  assert.match(source, /migrationCount/);
  assert.match(source, /latestMigrationHash/);
  assert.match(source, /auditEventCount/);
  assert.match(source, /auditHeadHash/);
  assert.match(source, /FROM public\.audit_events/);
  assert.match(source, /ORDER BY created_at, id/);
  assert.match(source, /verify-audit-chain\.mjs/);
  assert.match(source, /source audit chain verification failed/);
  assert.match(source, /drizzle\.__drizzle_migrations/);
  assert.match(source, /migration count is invalid/);
  assert.match(source, /latest migration hash is invalid/);
  assert.doesNotMatch(source, /RESTORE_ALLOW_EMPTY_AUDIT_CHAIN/);
  assert.match(source, /repositoryClass: process\.argv\[12\]/);
  assert.match(source, /productionEligible: process\.argv\[13\] === "true"/);
  assert.match(source, /snapshotId: process\.argv\[1\]/);
  assert.match(
    source,
    /restic backup --json --tag "\$backup_tag" -- "\$dump_name" "\$manifest_name"/,
  );
  assert.doesNotMatch(source, /restic backup[^\n]*"\$staging_dir"/);
  assert.doesNotMatch(source, /\.env/);
  assert.match(source, /restic check --read-data-subset=1\/20 >&2/);
  assert.match(source, /timeout "\$\{RESTIC_CHECK_TIMEOUT_SECONDS\}s"/);
  assert.match(source, /--prune >&2/);
  assert.match(source, /--keep-daily/);
  assert.match(source, /--keep-weekly/);
  assert.match(source, /--keep-monthly/);
  assert.match(source, /--prune/);

  const rejected = spawnSync('bash', [backupPath], {
    env: { PATH: process.env.PATH ?? '' },
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /DEPLOYMENT_PROFILE must be pilot/);

  const localRepository = spawnSync('bash', [backupPath], {
    env: {
      PATH: process.env.PATH ?? '',
      DEPLOYMENT_PROFILE: 'pilot',
      BACKUP_ENABLED: 'true',
      DATABASE_URL: 'postgresql://localhost/polis',
      RESTIC_REPOSITORY: 'rest:http://localhost:8000',
      RESTIC_PASSWORD_FILE: '/nonexistent',
    },
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.notEqual(localRepository.status, 0);
  assert.match(
    localRepository.stderr,
    /loopback\/local endpoints are local-test only|RESTIC_REPOSITORY must be off-host/,
  );
});

test('backup script classifies repositories and refuses unsafe inputs before PostgreSQL/restic', () => {
  assertBackupRefusal(
    { RESTIC_REPOSITORY: 'rest:http://backup.example.invalid/polis' },
    /rest:http and s3:http repositories are local-test only/,
  );
  assertBackupRefusal(
    { RESTIC_REPOSITORY: 's3:http://backup.example.invalid/polis' },
    /rest:http and s3:http repositories are local-test only/,
  );
  assertBackupRefusal(
    { RESTIC_REPOSITORY: 'rclone:remote:polis' },
    /rclone repositories are local-test only/,
  );
  assertBackupRefusal(
    { RESTIC_REPOSITORY: '/var/tmp/polis-restic' },
    /supported off-host repository scheme/,
  );
  for (const repository of [
    'sftp:127.1:/repo',
    'rest:https://2130706433/repo',
    'rest:https://[0:0:0:0:0:0:0:1]/repo',
    's3:https://127.2/repo',
  ]) {
    assertBackupRefusal(
      { RESTIC_REPOSITORY: repository },
      /loopback\/local endpoints are local-test only/,
    );
  }
  assertBackupRefusal(
    {
      RESTIC_REPOSITORY: 'rclone:remote:polis',
      OPS_ALLOW_LOCAL_RESTIC_REPOSITORY_FOR_TESTS: '1',
    },
    /rclone repositories are local-test only/,
  );
  assertBackupRefusal(
    {
      RESTIC_REPOSITORY: 'rclone:remote:polis',
      OPS_ALLOW_LOCAL_RESTIC_REPOSITORY_FOR_TESTS: 'true',
    },
    /RESTIC_PASSWORD_FILE is not usable/,
    0o640,
  );
  assertBackupRefusal({}, /RESTIC_PASSWORD_FILE is not usable/, 0o640);

  const source = readFileSync(backupPath, 'utf8');
  assert.match(source, /s3:\*\|sftp:\*\|rest:https:\/\/\*\|azure:\*\|gs:\*\|b2:\*\|swift:\*/);
  assert.match(source, /\[\[ \$override == true \]\]/);
  assert.match(source, /class='local-test'/);
});

test('backup script refuses a dirty release checkout before connecting to PostgreSQL', () => {
  const directory = mkdtempSync(join(tmpdir(), 'polis-dirty-backup-contract-'));
  const scriptDirectory = join(directory, 'scripts', 'ops');
  const binDirectory = join(directory, 'bin');
  const passwordFile = join(directory, 'restic-password');
  mkdirSync(scriptDirectory, { recursive: true });
  mkdirSync(binDirectory, { recursive: true });
  const copiedBackup = join(scriptDirectory, 'backup.sh');
  writeFileSync(copiedBackup, readFileSync(backupPath), { mode: 0o700 });
  chmodSync(copiedBackup, 0o700);
  const databaseMarker = join(directory, 'psql.marker');
  writeExecutable(join(binDirectory, 'restic'), '#!/usr/bin/env bash\nexit 99\n');
  writeExecutable(
    join(binDirectory, 'psql'),
    `#!/usr/bin/env bash\nprintf reached >${JSON.stringify(databaseMarker)}\nexit 99\n`,
  );
  writeFileSync(passwordFile, 'not-secret\n', { mode: 0o600 });

  try {
    for (const arguments_ of [
      ['init', '--quiet'],
      ['config', 'user.email', 'ops-contract@example.invalid'],
      ['config', 'user.name', 'Ops Contract'],
      ['add', 'scripts/ops/backup.sh'],
      ['commit', '--quiet', '-m', 'fixture'],
    ]) {
      const gitResult = spawnSync('git', arguments_, { cwd: directory, encoding: 'utf8' });
      assert.equal(gitResult.status, 0, gitResult.stderr);
    }
    writeFileSync(join(directory, 'untracked-release-change'), 'dirty\n');

    const result = spawnSync('bash', [copiedBackup], {
      cwd: directory,
      env: {
        PATH: `${binDirectory}:${process.env.PATH ?? ''}`,
        DEPLOYMENT_PROFILE: 'pilot',
        BACKUP_ENABLED: 'true',
        DATABASE_URL: 'postgresql://127.0.0.1:1/polis',
        RESTIC_REPOSITORY: 's3:s3.example.invalid/polis-backups',
        RESTIC_PASSWORD_FILE: passwordFile,
        GIT_DIR: join(directory, 'attacker-selected.git'),
        GIT_WORK_TREE: directory,
        GIT_INDEX_FILE: join(directory, 'attacker-selected.index'),
      },
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /working tree must be clean before a release backup/);
    assert.equal(statExists(databaseMarker), false, 'PostgreSQL must not be reached');
    assert.doesNotMatch(result.stderr, /connection refused|could not connect/i);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('backup script fails closed when Git cannot verify worktree status', () => {
  const directory = mkdtempSync(join(tmpdir(), 'polis-broken-index-backup-contract-'));
  const scriptDirectory = join(directory, 'scripts', 'ops');
  const binDirectory = join(directory, 'bin');
  const passwordFile = join(directory, 'restic-password');
  const databaseMarker = join(directory, 'psql.marker');
  mkdirSync(scriptDirectory, { recursive: true });
  mkdirSync(binDirectory, { recursive: true });
  const copiedBackup = join(scriptDirectory, 'backup.sh');
  writeFileSync(copiedBackup, readFileSync(backupPath), { mode: 0o700 });
  chmodSync(copiedBackup, 0o700);
  writeExecutable(join(binDirectory, 'restic'), '#!/usr/bin/env bash\nexit 99\n');
  writeExecutable(
    join(binDirectory, 'psql'),
    `#!/usr/bin/env bash\nprintf reached >${JSON.stringify(databaseMarker)}\nexit 99\n`,
  );
  writeFileSync(passwordFile, 'not-secret\n', { mode: 0o600 });

  try {
    for (const arguments_ of [
      ['init', '--quiet'],
      ['config', 'user.email', 'ops-contract@example.invalid'],
      ['config', 'user.name', 'Ops Contract'],
      ['add', 'scripts/ops/backup.sh'],
      ['commit', '--quiet', '-m', 'fixture'],
    ]) {
      const gitResult = spawnSync('git', arguments_, { cwd: directory, encoding: 'utf8' });
      assert.equal(gitResult.status, 0, gitResult.stderr);
    }
    writeFileSync(join(directory, '.git', 'index'), 'corrupt-index\n');

    const result = spawnSync('bash', [copiedBackup], {
      cwd: directory,
      env: {
        PATH: `${binDirectory}:${process.env.PATH ?? ''}`,
        DEPLOYMENT_PROFILE: 'pilot',
        BACKUP_ENABLED: 'true',
        DATABASE_URL: 'postgresql://127.0.0.1:1/polis',
        RESTIC_REPOSITORY: 's3:s3.example.invalid/polis-backups',
        RESTIC_PASSWORD_FILE: passwordFile,
      },
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /could not verify clean working tree/);
    assert.equal(statExists(databaseMarker), false, 'PostgreSQL must not be reached');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('restore script gates destructive restore and verifies manifest, schema, counts, migrations, and audit', () => {
  const source = readFileSync(restorePath, 'utf8');
  assert.match(source, /DEPLOYMENT_PROFILE.*pilot/);
  assert.match(source, /RESTORE_TARGET_IS_DISPOSABLE.*true/);
  assert.match(source, /DESTROY_ONLY_POLIS_DISPOSABLE_RESTORE_TARGET/);
  assert.match(source, /SOURCE_DATABASE_URL/);
  assert.match(source, /require_env PRODUCTION_DATABASE_URL/);
  assert.match(source, /target database name must contain restore_drill or disposable/);
  assert.match(source, /must not override its destination with/);
  assert.match(source, /must name exactly one PostgreSQL host/);
  assert.match(source, /system databases cannot be restore targets/);
  assert.match(source, /RESTIC_SNAPSHOT.*nominated hexadecimal snapshot ID, not latest/);
  assert.match(source, /trap cleanup EXIT/);
  assert.match(source, /trap 'exit 130' INT/);
  assert.match(source, /restic restore "\$RESTIC_SNAPSHOT" --target "\$restore_dir" >&2/);
  assert.match(source, /snapshot must contain exactly manifest\.json and polis\.dump/);
  assert.match(source, /RESTIC_PASSWORD_FILE is not usable/);
  assert.match(source, /stat -Lc/);
  assert.match(source, /repository_class=\$\(classify_restic_repository\)/);
  assert.match(source, /production_eligible=true/);
  assert.match(source, /restic restore "\$RESTIC_SNAPSHOT" --target "\$restore_dir" >&2/);
  assert.match(source, /pg_restore major/);
  assert.match(source, /manifest\.formatVersion !== 3/);
  assert.match(source, /manifest\.repositoryClass !== "off-host"/);
  assert.match(
    source,
    /manifest\.productionEligible !== \(manifest\.repositoryClass === "off-host"\)/,
  );
  assert.match(source, /RESTIC_REPOSITORY class does not match manifest/);
  assert.match(source, /positiveInteger\("postgresMajor"\)/);
  assert.match(source, /target PostgreSQL major/);
  assert.match(source, /FROM pg_control_system\(\)/);
  assert.match(source, /must not resolve to the source database/);
  assert.match(source, /must not resolve to the production database/);
  assert.match(source, /manifest\.dumpFile !== "polis\.dump"/);
  assert.match(source, /dump SHA-256 mismatch/);
  assert.match(source, /pg_restore list digest mismatch/);
  assert.match(source, /to_regclass\('public\.app_meta'\)/);
  assert.match(source, /to_regclass\('drizzle\.__drizzle_migrations'\)/);
  assert.match(source, /restored public-table count mismatch/);
  assert.match(source, /restored migration count mismatch/);
  assert.match(source, /ORDER BY created_at DESC, id DESC/);
  assert.match(source, /restored latest migration hash mismatch/);
  assert.match(source, /restored audit-event count mismatch/);
  assert.match(source, /restored audit head hash mismatch/);
  assert.match(source, /ORDER BY created_at, id/);
  assert.match(source, /verify-audit-chain\.mjs/);
  assert.doesNotMatch(source, /RESTORE_ALLOW_EMPTY_AUDIT_CHAIN/);
  assert.match(source, /createdAt:/);
  assert.match(source, /verifiedAt:/);
  assert.match(source, /gitSha:/);
  assert.match(source, /postgresMajor:/);
  assert.match(source, /dumpSha256:/);
  assert.match(source, /repositoryClass:/);
  assert.match(source, /productionEligible:/);
  assert.match(source, /restoreListSha256:/);
  assert.match(source, /disposableDbName:/);
  assert.match(source, /migrationCount:/);
  assert.match(source, /latestMigrationHash:/);
  assert.match(source, /auditHeadHash:/);

  const guardCall = source.indexOf('\ndisposable_database=$(assert_disposable_target)\n');
  const physicalGuard = source.indexOf('\ntarget_physical_identity=$(database_physical_identity');
  const cleanFlag = source.indexOf('\n  --clean \\');
  assert.ok(guardCall >= 0 && cleanFlag > guardCall, '--clean must follow disposable checks');
  assert.ok(
    physicalGuard >= 0 && cleanFlag > physicalGuard,
    '--clean must follow physical database identity checks',
  );
});

test('restore script refuses destructive inputs before restic restore and pg_restore', () => {
  const cases = [
    {
      name: 'missing confirmation',
      env: { RESTORE_DRILL_CONFIRMATION: '' },
      message: /RESTORE_DRILL_CONFIRMATION must exactly confirm the disposable target/,
    },
    {
      name: 'wrong confirmation',
      env: { RESTORE_DRILL_CONFIRMATION: 'DESTROY_PRODUCTION' },
      message: /RESTORE_DRILL_CONFIRMATION must exactly confirm the disposable target/,
    },
    {
      name: 'missing production URL',
      env: { PRODUCTION_DATABASE_URL: '' },
      message: /PRODUCTION_DATABASE_URL is required/,
    },
    {
      name: 'target equal to source',
      env: { SOURCE_DATABASE_URL: 'postgresql://127.0.0.1:5432/polis_restore_drill_contract' },
      message: /must not target the source database|disposable target checks failed/,
    },
    {
      name: 'target equal to production',
      env: { PRODUCTION_DATABASE_URL: 'postgresql://127.0.0.1:5432/polis_restore_drill_contract' },
      message: /must not target the production database|disposable target checks failed/,
    },
    {
      name: 'system database',
      env: { DATABASE_URL: 'postgresql://127.0.0.1:5432/postgres' },
      message:
        /system databases cannot be restore targets|target database name must contain restore_drill or disposable|disposable target checks failed/,
    },
    {
      name: 'missing disposable marker',
      env: { DATABASE_URL: 'postgresql://127.0.0.1:5432/polis_contract' },
      message:
        /target database name must contain restore_drill or disposable|disposable target checks failed/,
    },
    {
      name: 'latest snapshot',
      env: { RESTIC_SNAPSHOT: 'latest' },
      message: /RESTIC_SNAPSHOT must be a nominated hexadecimal snapshot ID, not latest/,
    },
    {
      name: 'malformed snapshot',
      env: { RESTIC_SNAPSHOT: 'zzzzzzzz' },
      message: /RESTIC_SNAPSHOT must be a nominated hexadecimal snapshot ID, not latest/,
    },
    {
      name: 'malformed URL',
      env: { DATABASE_URL: 'not a url' },
      message: /DATABASE_URL must be a valid PostgreSQL URL|disposable target checks failed/,
    },
    {
      name: 'non-Postgres URL',
      env: { DATABASE_URL: 'mysql://127.0.0.1/polis_restore_drill_contract' },
      message: /DATABASE_URL must use postgres: or postgresql:|disposable target checks failed/,
    },
    {
      name: 'query host override',
      env: {
        DATABASE_URL:
          'postgresql://safe.invalid/polis_restore_drill_contract?host=production.invalid&dbname=polis',
      },
      message:
        /DATABASE_URL must not override its destination with host|disposable target checks failed/,
    },
    {
      name: 'query service override',
      env: {
        DATABASE_URL: 'postgresql://safe.invalid/polis_restore_drill_contract?service=production',
      },
      message:
        /DATABASE_URL must not override its destination with service|disposable target checks failed/,
    },
    {
      name: 'multiple PostgreSQL hosts',
      env: {
        DATABASE_URL: 'postgresql://safe.invalid,production.invalid/polis_restore_drill_contract',
      },
      message: /DATABASE_URL must name exactly one PostgreSQL host|disposable target checks failed/,
    },
  ];

  for (const { name, env, message } of cases) {
    assert.doesNotThrow(() => assertRestoreRefusal(env, message), name);
  }

  assertRestoreRefusal(
    { RESTIC_REPOSITORY: 'rest:http://backup.example.invalid/polis' },
    /rest:http and s3:http repositories are local-test only/,
  );
  assertRestoreRefusal(
    { RESTIC_REPOSITORY: 's3:http://backup.example.invalid/polis' },
    /rest:http and s3:http repositories are local-test only/,
  );
  assertRestoreRefusal(
    { RESTIC_REPOSITORY: 'rclone:remote:polis' },
    /rclone repositories are local-test only/,
  );
  assertRestoreRefusal(
    { RESTIC_REPOSITORY: '/var/tmp/polis-restic' },
    /supported off-host repository scheme/,
  );
  for (const repository of [
    'sftp:127.1:/repo',
    'rest:https://2130706433/repo',
    'rest:https://[0:0:0:0:0:0:0:1]/repo',
    's3:https://127.2/repo',
  ]) {
    assertRestoreRefusal(
      { RESTIC_REPOSITORY: repository },
      /loopback\/local endpoints are local-test only/,
    );
  }
  assertRestoreRefusal(
    {
      RESTIC_REPOSITORY: 'rclone:remote:polis',
      OPS_ALLOW_LOCAL_RESTIC_REPOSITORY_FOR_TESTS: '1',
    },
    /rclone repositories are local-test only/,
  );
  assertRestoreRefusal(
    {
      RESTIC_REPOSITORY: 'rclone:remote:polis',
      OPS_ALLOW_LOCAL_RESTIC_REPOSITORY_FOR_TESTS: 'true',
    },
    /RESTIC_PASSWORD_FILE is not usable/,
    0o644,
  );
  assertRestoreRefusal({}, /RESTIC_PASSWORD_FILE is not usable/, 0o644);
});

test('restore script validates manifest v3 repository class before database actions', () => {
  assertRestoreManifestRefusal(
    validRestoreManifest({ formatVersion: 2 }),
    /unsupported or non-pilot manifest|manifest validation failed/,
  );
  assertRestoreManifestRefusal(
    validRestoreManifest({ repositoryClass: 'remote', productionEligible: true }),
    /invalid manifest repositoryClass|manifest validation failed/,
  );
  assertRestoreManifestRefusal(
    validRestoreManifest({ repositoryClass: 'local-test', productionEligible: true }),
    /manifest repositoryClass productionEligible invariant failed|manifest validation failed/,
  );
  assertRestoreManifestRefusal(
    validRestoreManifest({ repositoryClass: 'local-test', productionEligible: false }),
    /RESTIC_REPOSITORY class does not match manifest|manifest validation failed/,
  );

  const secureRemoteWithOverride = runRestoreManifestRefusal(validRestoreManifest(), {
    OPS_ALLOW_LOCAL_RESTIC_REPOSITORY_FOR_TESTS: 'true',
  });
  assert.notEqual(secureRemoteWithOverride.status, 0);
  assert.match(secureRemoteWithOverride.stderr, /dump SHA-256 mismatch/);
  assert.equal(secureRemoteWithOverride.resticReached, true);
  assert.equal(secureRemoteWithOverride.psqlReached, false);
  assert.equal(secureRemoteWithOverride.pgRestoreReached, false);

  const localOverride = runRestoreManifestRefusal(
    validRestoreManifest({ repositoryClass: 'local-test', productionEligible: false }),
    {
      RESTIC_REPOSITORY: 'sftp:127.1:/repo',
      OPS_ALLOW_LOCAL_RESTIC_REPOSITORY_FOR_TESTS: 'true',
    },
  );
  assert.notEqual(localOverride.status, 0);
  assert.match(localOverride.stderr, /dump SHA-256 mismatch/);
  assert.equal(localOverride.resticReached, true);
  assert.equal(localOverride.psqlReached, false);
  assert.equal(localOverride.pgRestoreReached, false);
});

test('clean DB drill script is source-hardened and explicit-Docker only', () => {
  const source = readFileSync(cleanDbDrillPath, 'utf8');
  assert.match(source, /pgvector\/pgvector:pg16/);
  assert.match(source, /task11/i);
  assert.match(source, /disposable/i);
  assert.match(source, /crypto\.randomUUID\(\)|mktemp|date \+%s|openssl rand|uuidgen/);
  assert.match(source, /127\.0\.0\.1/);
  assert.match(source, /-p 127\.0\.0\.1:0:5432|--publish 127\.0\.0\.1:0:5432|127\.0\.0\.1::5432/);
  assert.match(source, /POSTGRES_PASSWORD/);
  assert.match(source, /openssl rand|dd if=\/dev\/urandom|node -e .*crypto/);
  assert.doesNotMatch(source, /echo .*POSTGRES_PASSWORD|printf .*POSTGRES_PASSWORD/);
  assert.match(source, /timeout|SECONDS|sleep 1/);
  assert.match(source, /bun run --filter @polis\/db build/);
  assert.match(source, /bun run --filter @polis\/db seed[\s\S]*bun run --filter @polis\/db seed/);
  assert.match(source, /drizzle\.__drizzle_migrations/);
  assert.match(source, /sha256sum|digest\(|createHash\('sha256'\)/);
  assert.match(source, /latest migration hash/i);
  assert.match(source, /required_tables=\([\s\S]*\n {2}app_meta\n/);
  assert.match(source, /required_tables=\([\s\S]*\n {2}audit_events\n/);
  assert.match(source, /to_regclass\(`public\.\$\{table\}`\)|to_regclass\('public\.\$\{table\}'\)/);
  assert.match(source, /public-table count changed after second seed|public table count/i);
  assert.match(source, /owner_label_value='task11-clean-db-drill'/);
  assert.match(
    source,
    /docker inspect[\s\S]*\[\[ \$actual_label == "\$owner_label_value" \]\][\s\S]*docker rm/,
  );
  assert.match(source, /trap cleanup EXIT/);
  assert.match(source, /trap 'exit 130' INT/);
});

test('operator scripts contain no hard-coded credentials and are executable', () => {
  for (const path of [backupPath, restorePath, cleanDbDrillPath, wrapperPath, verifierPath]) {
    const source = readFileSync(path, 'utf8');
    assert.doesNotMatch(source, /postgres(?:ql)?:\/\/[^\s$"']+:[^\s$"']+@/i);
    assert.ok(statSync(path).mode & 0o100, `${path} must be executable`);
  }

  const wrapper = readFileSync(wrapperPath, 'utf8');
  assert.match(wrapper, /bun test scripts\/ops\/ops-contract\.test\.mjs/);
  assert.match(wrapper, /OPS_RUN_TOOL_FIXTURES/);
  assert.doesNotMatch(wrapper, /(?:backup|restore-verify)\.sh/);
});

test('root package exposes all operator commands without replacing existing commands', () => {
  const packageJson = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts['ops:backup'], 'bash scripts/ops/backup.sh');
  assert.equal(packageJson.scripts['ops:restore-verify'], 'bash scripts/ops/restore-verify.sh');
  assert.equal(packageJson.scripts['ops:verify-audit'], 'node scripts/ops/verify-audit-chain.mjs');
  assert.equal(packageJson.scripts['ops:clean-db-drill'], 'bash scripts/ops/clean-db-drill.sh');
  assert.equal(packageJson.scripts['ops:test'], 'bash scripts/ops/test-backup-restore.sh');
  for (const existing of ['build', 'test', 'typecheck', 'lint', 'format', 'verify', 'db:seed']) {
    assert.equal(typeof packageJson.scripts[existing], 'string');
  }
});
