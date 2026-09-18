// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';

import { sha256 } from './canonical.js';
import { normalizedSha256 } from './compliance.js';
import { DomainError } from './domain.js';
import {
  buildPublicShellCursorPredicate,
  generateRandomCaseNumber,
  resolveAssignmentUnit,
  replacePlaceholderNarrative,
  signerForOfficial,
} from './repository.js';
import type { TraceConfig } from './types.js';

type CaseNumberTx = Parameters<typeof generateRandomCaseNumber>[0];

function fakeTx(collisions: boolean[], queried: string[]): CaseNumberTx {
  return (async (_parts: TemplateStringsArray, candidate: string) => {
    queried.push(candidate);
    return collisions.shift() ? [{ case_number: candidate }] : [];
  }) as unknown as CaseNumberTx;
}

test('random case numbers use the configured prefix and six nonzero-leading digits', async () => {
  const queried: string[] = [];
  let calls = 0;
  const caseNumber = await generateRandomCaseNumber(fakeTx([false], queried), 'ORS', (min, max) => {
    calls += 1;
    assert.equal(min, 100_000);
    assert.equal(max, 1_000_000);
    return 482_113;
  });

  assert.equal(caseNumber, 'ORS-482113');
  assert.match(caseNumber, /^ORS-[1-9][0-9]{5}$/);
  assert.deepEqual(queried, [caseNumber]);
  assert.equal(calls, 1);
});

test('random case numbers retry collisions', async () => {
  const queried: string[] = [];
  const candidates = [123_456, 654_321];
  const caseNumber = await generateRandomCaseNumber(fakeTx([true, false], queried), 'VRS', () =>
    candidates.shift()!,
  );

  assert.equal(caseNumber, 'VRS-654321');
  assert.deepEqual(queried, ['VRS-123456', 'VRS-654321']);
});

test('random case numbers fail with a typed error after eight collisions', async () => {
  const queried: string[] = [];
  let candidate = 100_000;

  await assert.rejects(
    () =>
      generateRandomCaseNumber(
        fakeTx(Array<boolean>(8).fill(true), queried),
        'VRS',
        () => candidate++,
      ),
    (error: unknown) =>
      error instanceof DomainError &&
      error.status === 503 &&
      error.code === 'case_number_exhausted',
  );
  assert.equal(queried.length, 8);
});

const traceConfig: TraceConfig = {
  internalApiToken: 'test',
  databaseUrl: 'postgres://unused.test/trace',
  intakeOpen: true,
  officialIds: new Set(['official-1']),
  gatewayIds: new Set(['gateway-1']),
  pilot: {
    id: 'vrsar-orsera',
    testEnvironment: true,
    publicTextMode: 'open',
    publicTextRetentionDays: 730,
    municipality: { id: 'vrsar-orsera', name: { hr: 'Vrsar', it: 'Orsera', en: 'Vrsar' } },
    category: { id: 'public-lighting', name: { hr: 'Rasvjeta', it: 'Luci', en: 'Lighting' } },
    office: {
      id: 'communal-system',
      name: { hr: 'Ured', it: 'Ufficio', en: 'Office' },
      routingStatus: 'inferred-test-only',
      units: [
        {
          id: 'communal-system',
          name: { hr: 'Komunalni', it: 'Comunale', en: 'Communal' },
        },
      ],
    },
    sources: [],
  },
};

test('public shell cursor predicate binds the mixed descending and ascending boundary', () => {
  const predicate = buildPublicShellCursorPredicate({
    limit: 25,
    state: 'assigned',
    cursor: {
      updatedAt: '2026-09-18T07:00:00.000Z',
      caseNumber: 'VRS-123456',
    },
  });
  assert.deepEqual(predicate.values, [
    'assigned',
    '2026-09-18T07:00:00.000Z',
    'VRS-123456',
  ]);
  assert.match(predicate.text, /updated_at < \$2::timestamptz/);
  assert.match(predicate.text, /updated_at = \$2::timestamptz AND case_number > \$3/);
});

type OfficialTx = Parameters<typeof resolveAssignmentUnit>[0];

function officialTx(rows: unknown[], calls: string[]): OfficialTx {
  return (async (parts: TemplateStringsArray, actorId: string) => {
    calls.push(`${parts.join('?')}:${actorId}`);
    return rows;
  }) as unknown as OfficialTx;
}

test('assignment units prefer an explicit configured unit and otherwise use the official profile', async () => {
  const explicitCalls: string[] = [];
  const explicit = await resolveAssignmentUnit(
    officialTx([], explicitCalls),
    traceConfig,
    'official-1',
    'communal-system',
  );
  assert.equal(explicit.id, 'communal-system');
  assert.deepEqual(explicitCalls, []);

  const profileCalls: string[] = [];
  const profile = await resolveAssignmentUnit(
    officialTx([{ unit_id: 'communal-system' }], profileCalls),
    traceConfig,
    'official-1',
    null,
  );
  assert.equal(profile.id, 'communal-system');
  assert.equal(profileCalls.length, 1);
});

test('assignment, commitment, and resolution profile failures keep stable conflict codes', async () => {
  await assert.rejects(
    () => resolveAssignmentUnit(officialTx([], []), traceConfig, 'official-1', null),
    (error: unknown) =>
      error instanceof DomainError && error.status === 409 && error.code === 'unit_required',
  );
  await assert.rejects(
    () => resolveAssignmentUnit(officialTx([], []), traceConfig, 'official-1', 'unknown-unit'),
    (error: unknown) =>
      error instanceof DomainError && error.status === 400 && error.code === 'invalid_unit',
  );
  await assert.rejects(
    () => signerForOfficial(officialTx([], []), 'official-1'),
    (error: unknown) =>
      error instanceof DomainError &&
      error.status === 409 &&
      error.code === 'official_profile_missing',
  );
  assert.deepEqual(
    await signerForOfficial(
      officialTx([{ name: 'Ivana Testić', title: 'Viša stručna suradnica' }], []),
      'official-1',
    ),
    { name: 'Ivana Testić', title: 'Viša stručna suradnica' },
  );
});

type ReplacementTx = Parameters<typeof replacePlaceholderNarrative>[0];

function replacementTx(
  responses: unknown[][],
  calls: Array<{ sql: string; values: unknown[] }>,
): ReplacementTx {
  return (async (parts: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ sql: parts.join('?'), values });
    return responses.shift() ?? [];
  }) as unknown as ReplacementTx;
}

test('placeholder transcript replacement updates raw and normalized hashes atomically', async () => {
  const narrative = '  A SECOND Lamp is dark.  ';
  const rawHash = sha256(narrative);
  const normalizedHash = normalizedSha256(narrative);
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const updated = await replacePlaceholderNarrative(
    replacementTx(
      [
        [{ record_id: 'record-1' }],
        [
          {
            id: 'record-1',
            text_sha256: rawHash,
            text_normalized_sha256: normalizedHash,
            text_hash_kind: 'raw',
          },
        ],
      ],
      calls,
    ),
    'record-1',
    narrative,
  );
  assert.equal(updated?.text_sha256, rawHash);
  assert.equal(updated?.text_normalized_sha256, normalizedHash);
  assert.equal(updated?.text_hash_kind, 'raw');
  assert.deepEqual(calls.map((call) => call.values), [
    [narrative, 'record-1'],
    [rawHash, normalizedHash, 'record-1'],
  ]);

  const untouchedCalls: Array<{ sql: string; values: unknown[] }> = [];
  assert.equal(
    await replacePlaceholderNarrative(
      replacementTx([[]], untouchedCalls),
      'record-2',
      narrative,
    ),
    null,
  );
  assert.equal(untouchedCalls.length, 1);
});
