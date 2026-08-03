import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
  assert.match(source, /RESTIC_PASSWORD_FILE.*readable, non-empty/);
  assert.match(source, /mktemp -d/);
  assert.match(source, /trap cleanup EXIT HUP INT TERM/);
  assert.match(source, /pg_dump[\s\S]*--format=custom[\s\S]*--no-owner[\s\S]*--no-privileges/);
  assert.match(source, /pg_restore --list/);
  assert.match(source, /dumpSha256/);
  assert.match(source, /restoreListSha256/);
  assert.match(
    source,
    /restic backup --json --tag "\$backup_tag" -- "\$dump_name" "\$manifest_name"/,
  );
  assert.doesNotMatch(source, /restic backup[^\n]*"\$staging_dir"/);
  assert.doesNotMatch(source, /\.env/);
  assert.match(source, /restic check --read-data-subset=1\/20/);
  assert.match(source, /timeout "\$\{RESTIC_CHECK_TIMEOUT_SECONDS\}s"/);
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
  assert.match(localRepository.stderr, /RESTIC_REPOSITORY must be off-host/);
});

test('restore script gates destructive restore and verifies schema, counts, and audit', () => {
  const source = readFileSync(restorePath, 'utf8');
  assert.match(source, /DEPLOYMENT_PROFILE.*pilot/);
  assert.match(source, /RESTORE_TARGET_IS_DISPOSABLE.*true/);
  assert.match(source, /DESTROY_ONLY_POLIS_DISPOSABLE_RESTORE_TARGET/);
  assert.match(source, /SOURCE_DATABASE_URL/);
  assert.match(source, /PRODUCTION_DATABASE_URL/);
  assert.match(source, /target database name must contain restore_drill or disposable/);
  assert.match(source, /RESTIC_SNAPSHOT.*nominated hexadecimal snapshot ID/);
  assert.match(source, /trap cleanup EXIT HUP INT TERM/);
  assert.match(source, /restic restore "\$RESTIC_SNAPSHOT"/);
  assert.match(source, /dump SHA-256 mismatch/);
  assert.match(source, /pg_restore list digest mismatch/);
  assert.match(source, /to_regclass\('public\.app_meta'\)/);
  assert.match(source, /restored public-table count mismatch/);
  assert.match(source, /restored audit-event count mismatch/);
  assert.match(source, /ORDER BY created_at, id/);
  assert.match(source, /verify-audit-chain\.mjs/);
  assert.match(source, /RESTORE_ALLOW_EMPTY_AUDIT_CHAIN/);

  const guardCall = source.indexOf('\nassert_disposable_target\n');
  const cleanFlag = source.indexOf('\n  --clean \\');
  assert.ok(guardCall >= 0 && cleanFlag > guardCall, '--clean must follow disposable checks');

  const rejected = spawnSync('bash', [restorePath], {
    env: {
      PATH: process.env.PATH ?? '',
      DEPLOYMENT_PROFILE: 'pilot',
      RESTORE_TARGET_IS_DISPOSABLE: 'true',
      RESTORE_DRILL_CONFIRMATION: 'DESTROY_ONLY_POLIS_DISPOSABLE_RESTORE_TARGET',
      DATABASE_URL: 'postgresql://localhost/polis_restore_drill_contract',
      SOURCE_DATABASE_URL: 'postgresql://localhost/polis_restore_drill_contract',
    },
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.notEqual(rejected.status, 0);
  assert.match(
    rejected.stderr,
    /must not target the source database|disposable target checks failed/,
  );
});

test('operator scripts contain no hard-coded credentials and are executable', () => {
  for (const path of [backupPath, restorePath, wrapperPath, verifierPath]) {
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
  assert.equal(packageJson.scripts['ops:test'], 'bash scripts/ops/test-backup-restore.sh');
  for (const existing of ['build', 'test', 'typecheck', 'lint', 'format', 'verify', 'db:seed']) {
    assert.equal(typeof packageJson.scripts[existing], 'string');
  }
});
