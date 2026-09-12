// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeEventHash,
  computeReceiptHash,
  verifyEventChain,
  verifyReceiptHash,
  type EventHashMaterial,
  type StoredEvent,
} from './canonical.js';
import { transitionAllowed } from './domain.js';
import type { PublicRecord, TraceStatus } from './types.js';

const statuses: TraceStatus[] = [
  'open',
  'assigned',
  'commitment-pending-review',
  'returned',
  'published',
  'resolution-pending-review',
  'resolved',
];

const expectedTransitions: Record<string, TraceStatus[]> = {
  assign: ['open'],
  commitment: ['assigned', 'returned'],
  'review-accept': ['commitment-pending-review'],
  'review-return': ['commitment-pending-review'],
  resolution: ['published'],
  'resolution-review-accept': ['resolution-pending-review'],
  'resolution-review-return': ['resolution-pending-review'],
};

test('transition matrix permits every exact source state and rejects every other state', () => {
  for (const [command, allowed] of Object.entries(expectedTransitions)) {
    for (const status of statuses) {
      assert.equal(
        transitionAllowed(command as Parameters<typeof transitionAllowed>[0], status),
        allowed.includes(status),
        `${command} from ${status}`,
      );
    }
  }
});

function event(overrides: Partial<EventHashMaterial> = {}): StoredEvent {
  const material: EventHashMaterial = {
    id: '10000000-0000-4000-8000-000000000001',
    recordId: '20000000-0000-4000-8000-000000000001',
    sequence: 1,
    previousHash: null,
    stage: 'voice',
    action: 'record-created',
    actorId: 'resident-private',
    actorRole: 'resident',
    note: null,
    payload: { subject: 'private' },
    resultingVersion: 0,
    resultingStatus: 'open',
    createdAt: '2026-09-05T00:00:00.000Z',
    ...overrides,
  };
  return { ...material, hash: computeEventHash(material) };
}

test('event verification detects payload, link, sequence, hash, omission, duplication, and record mismatch', () => {
  const first = event();
  const second = event({
    id: '10000000-0000-4000-8000-000000000002',
    sequence: 2,
    previousHash: first.hash,
    stage: 'responsibility',
    action: 'record-assigned',
    actorId: 'official-private',
    actorRole: 'official',
    payload: {},
    resultingVersion: 1,
    resultingStatus: 'assigned',
  });
  assert.deepEqual(verifyEventChain([first, second], { version: 1, status: 'assigned' }), {
    valid: true,
  });
  assert.equal(verifyEventChain([{ ...first, payload: { subject: 'changed' } }]).valid, false);
  assert.equal(verifyEventChain([first, { ...second, previousHash: '0'.repeat(64) }]).valid, false);
  assert.equal(verifyEventChain([{ ...first, sequence: 2 }]).valid, false);
  assert.equal(verifyEventChain([{ ...first, hash: '0'.repeat(64) }]).valid, false);
  assert.equal(verifyEventChain([second]).valid, false);
  assert.equal(verifyEventChain([first, first]).valid, false);
  assert.deepEqual(verifyEventChain([first, second], { version: 2, status: 'assigned' }), {
    valid: false,
    error: 'record_state_mismatch',
  });
});

test('receipt hash covers every public-safe field and excludes receiptHash itself', () => {
  const withoutHash: Omit<PublicRecord, 'receiptHash'> = {
    id: '20000000-0000-4000-8000-000000000001',
    municipalityId: 'vrsar-orsera',
    category: 'public-lighting',
    office: 'communal-system',
    status: 'published',
    publicSummary: 'Reviewed public summary',
    commitment: 'Replace one luminaire',
    dueDate: '2026-12-01',
    evidenceNote: null,
    evidenceUrls: [],
    publishedAt: '2026-09-05T00:00:00.000Z',
    resolvedAt: null,
    events: [
      {
        stage: 'voice',
        action: 'report-filed',
        actorRole: 'resident',
        createdAt: '2026-09-01T08:00:00.000Z',
      },
      {
        stage: 'responsibility',
        action: 'office-assigned',
        actorRole: 'official',
        createdAt: '2026-09-02T08:00:00.000Z',
      },
      {
        stage: 'response',
        action: 'commitment-filed',
        actorRole: 'official',
        createdAt: '2026-09-03T08:00:00.000Z',
      },
      {
        stage: 'check',
        action: 'commitment-accepted',
        actorRole: 'reviewer',
        createdAt: '2026-09-05T00:00:00.000Z',
      },
      {
        stage: 'receipt',
        action: 'published',
        actorRole: 'reviewer',
        createdAt: '2026-09-05T00:00:00.000Z',
      },
    ],
    testEnvironment: true,
  };
  const record: PublicRecord = { ...withoutHash, receiptHash: computeReceiptHash(withoutHash) };
  for (const event of record.events) {
    assert.deepEqual(Object.keys(event).sort(), ['action', 'actorRole', 'createdAt', 'stage']);
  }
  assert.equal(verifyReceiptHash(record), true);
  assert.equal(verifyReceiptHash({ ...record, publicSummary: 'Changed' }), false);
  assert.equal(
    verifyReceiptHash({
      ...record,
      events: record.events.map((event, index) =>
        index === 0 ? { ...event, createdAt: '2026-09-01T08:00:01.000Z' } : event,
      ),
    }),
    false,
  );
  assert.equal(verifyReceiptHash({ ...record, receiptHash: 'f'.repeat(64) }), false);
  assert.equal(JSON.stringify(record).includes('resident-private'), false);
});
