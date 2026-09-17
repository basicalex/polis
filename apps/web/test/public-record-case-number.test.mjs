// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';

import { publicRecordFromEnvelope } from '../src/lib/pilot/vrsar/model.ts';

function parsedCaseNumber(caseNumber) {
  return publicRecordFromEnvelope({ record: { caseNumber } }).caseNumber;
}

test('public record envelopes keep only non-empty string case numbers', () => {
  assert.equal(parsedCaseNumber('VRS-482113'), 'VRS-482113');
  assert.equal(parsedCaseNumber(''), undefined);
  assert.equal(parsedCaseNumber('   '), undefined);
  assert.equal(parsedCaseNumber(482113), undefined);
  assert.equal(publicRecordFromEnvelope({ record: {} }).caseNumber, undefined);
});
