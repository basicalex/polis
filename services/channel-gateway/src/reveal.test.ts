// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';

import { parseRevealArgs, REVEAL_USAGE } from './reveal.js';

test('reveal requires case, written-request reference, and actor', () => {
  assert.deepEqual(
    parseRevealArgs([
      '--case',
      'VRS-123456',
      '--request-ref',
      'court-request-2026-17',
      '--actor',
      'operator@example.test',
    ]),
    {
      caseNumber: 'VRS-123456',
      requestRef: 'court-request-2026-17',
      actor: 'operator@example.test',
    },
  );
  for (const argv of [
    [],
    ['--case', 'VRS-123456', '--request-ref', 'court-request-2026-17'],
    ['--case', 'VRS-123456', '--actor', 'operator@example.test'],
    ['--request-ref', 'court-request-2026-17', '--actor', 'operator@example.test'],
    ['--case', '', '--request-ref', 'court-request-2026-17', '--actor', 'operator@example.test'],
    ['--case', 'VRS-123456', '--unknown', 'value', '--actor', 'operator@example.test'],
  ]) {
    assert.equal(parseRevealArgs(argv), null);
  }
  assert.equal(
    REVEAL_USAGE,
    'Usage: bun run reveal --case <caseNumber> --request-ref <text> --actor <text>',
  );
});
