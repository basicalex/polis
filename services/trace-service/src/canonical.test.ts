// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CASE_SHELL_HASH_FIELDS,
  RECEIPT_HASH_FIELDS,
  buildShellHashMaterial,
  computeShellHash,
  verifyShellHash,
} from './canonical.js';
import type { CaseShell } from './types.js';

test('receipt hash fields remain the public receipt contract', () => {
  assert.deepEqual(RECEIPT_HASH_FIELDS, [
    'id',
    'municipalityId',
    'category',
    'office',
    'status',
    'commitment',
    'dueDate',
    'signedBy',
    'evidenceNote',
    'evidenceUrls',
    'publishedAt',
    'resolvedAt',
    'disputes',
    'events',
    'testEnvironment',
  ]);
});

test('case shell hash covers every public shell field and excludes shellHash', () => {
  assert.deepEqual(CASE_SHELL_HASH_FIELDS, [
    'caseNumber',
    'municipalityId',
    'area',
    'category',
    'track',
    'state',
    'text',
    'location',
    'textStatus',
    'holdReason',
    'textSha256',
    'labels',
    'closedPublicReason',
    'filedAt',
    'clockDueAt',
    'followerCount',
    'alsoAffectedCount',
    'notFixedCount',
    'disputeCount',
    'testEnvironment',
  ]);

  const withoutHash: Omit<CaseShell, 'shellHash'> = {
    caseNumber: 'VRS-1842',
    municipalityId: 'vrsar-orsera',
    area: 'vrsar-orsera',
    category: 'public-lighting',
    track: 'standard',
    state: 'received',
    text: 'Lamp is dark.',
    location: 'Riva',
    textStatus: 'public',
    holdReason: null,
    textSha256: 'a'.repeat(64),
    labels: ['form-letter'],
    closedPublicReason: null,
    filedAt: '2026-09-12T12:00:00.000Z',
    clockDueAt: null,
    followerCount: 0,
    alsoAffectedCount: 0,
    notFixedCount: 0,
    disputeCount: 0,
    updatedAt: '2026-09-12T12:00:00.000Z',
    testEnvironment: true,
  };
  const hash = computeShellHash(withoutHash);
  const shell: CaseShell = { ...withoutHash, shellHash: hash };

  assert.equal(hash, computeShellHash({ ...withoutHash }));
  assert.equal(verifyShellHash(shell), true);
  assert.equal(computeShellHash({ ...shell, shellHash: 'f'.repeat(64) }), hash);
  assert.equal(computeShellHash({ ...shell, followerCount: 1 }) === hash, false);
  assert.equal(
    computeShellHash({ ...shell, labels: ['z', 'a'] }) ===
      computeShellHash({ ...shell, labels: ['a', 'z'] }),
    true,
  );
  assert.deepEqual(Object.keys(buildShellHashMaterial(shell)), [...CASE_SHELL_HASH_FIELDS]);
});
