// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';

import { DomainError } from './domain.js';
import { generateRandomCaseNumber } from './repository.js';

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
