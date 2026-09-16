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
import {
  canCloseCase,
  canReleaseText,
  canReadPrivate,
  holdReasonAtFiling,
  isAssessmentHoldReason,
  parseCaseNumberTarget,
  reopenKeyHash,
  shellStateFor,
  transitionAllowed,
} from './domain.js';
import type { Actor, PublicRecord, TraceStatus } from './types.js';

const statuses: TraceStatus[] = ['open', 'assigned', 'answered', 'resolved', 'disputed', 'closed'];

const expectedTransitions: Record<string, TraceStatus[]> = {
  assign: ['open'],
  commitment: ['assigned'],
  resolution: ['answered', 'disputed'],
  reopen: ['disputed'],
  dispute: ['resolved'],
  close: ['open', 'assigned'],
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

test('private reads honor record scopes and gateway ownership before existing role access', () => {
  const record = {
    id: 'record-one',
    owner_actor_id: 'resident-one',
    gateway_actor_id: 'gateway-one',
  };
  const actor = (id: string, role: Actor['role'], recordScope?: string): Actor => ({
    id,
    email: null,
    role,
    ...(recordScope === undefined ? {} : { recordScope }),
  });

  assert.equal(canReadPrivate(actor('resident-one', 'resident'), record), true);
  assert.equal(canReadPrivate(actor('resident-two', 'resident'), record), false);
  assert.equal(canReadPrivate(actor('official-one', 'official'), record), true);
  assert.equal(canReadPrivate(actor('gateway-one', 'gateway'), record), true);
  assert.equal(canReadPrivate(actor('gateway-two', 'gateway'), record), false);
  assert.equal(canReadPrivate(actor('official-one', 'official', 'record-one'), record), true);
  assert.equal(canReadPrivate(actor('official-one', 'official', 'record-two'), record), false);
});

test('close eligibility and shell state mapping cover every trace status', () => {
  assert.deepEqual(statuses.filter(canCloseCase), ['open', 'assigned']);
  assert.deepEqual(
    statuses.map((status) => shellStateFor(status)),
    ['received', 'assigned', 'answered', 'resolved', 'disputed', 'closed'],
  );
});

test('reopen keys hash deterministically and case targets must start the message', () => {
  assert.equal(
    reopenKeyHash('correct horse battery staple'),
    'c4bbcb1fbec99d65bf59d85c8cb62ee2db963f0fe106f483d9afa73bd4e39a8a',
  );
  assert.equal(parseCaseNumberTarget('vrs-1842 please add this'), 'VRS-1842');
  assert.equal(parseCaseNumberTarget('VRS-0001'), 'VRS-0001');
  assert.equal(parseCaseNumberTarget('VRS-482113 by phone'), 'VRS-482113');
  assert.equal(parseCaseNumberTarget('VRS-18421'), 'VRS-18421');
  assert.equal(parseCaseNumberTarget('please update VRS-1842'), null);
  assert.equal(parseCaseNumberTarget('VRS-123456789'), null);
});

test('filing hold reasons follow publicity mode and assessment precedence', () => {
  assert.equal(holdReasonAtFiling('open', null), null);
  assert.equal(holdReasonAtFiling('open', 'personal-data'), 'personal-data');
  assert.equal(holdReasonAtFiling('open', 'abuse'), 'abuse');
  assert.equal(holdReasonAtFiling('open', 'off-topic'), 'off-topic');
  assert.equal(holdReasonAtFiling('release', null), 'pending-release');
  assert.equal(holdReasonAtFiling('release', 'personal-data'), 'personal-data');
  assert.equal(holdReasonAtFiling('release', 'abuse'), 'abuse');
  assert.equal(holdReasonAtFiling('shell', 'personal-data'), 'policy');
  assert.equal(holdReasonAtFiling('shell', 'confidential'), 'confidential');
  assert.equal(holdReasonAtFiling('release', 'confidential'), 'confidential');
});

test('release checks removed text before shell policy and assessment reasons stay bounded', () => {
  assert.equal(canReleaseText('shell', 'removed'), 'text_removed');
  assert.equal(canReleaseText('shell', 'held'), 'release_not_permitted');
  assert.equal(canReleaseText('open', 'held'), null);
  assert.equal(isAssessmentHoldReason('personal-data'), true);
  assert.equal(isAssessmentHoldReason('confidential'), false);
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
    status: 'answered',
    commitment: 'Replace one luminaire',
    dueDate: '2026-12-01',
    signedBy: { name: 'Ana Anić', title: 'Head of public works' },
    evidenceNote: null,
    evidenceUrls: [],
    publishedAt: '2026-09-05T00:00:00.000Z',
    resolvedAt: null,
    disputes: [],
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
        action: 'commitment-published',
        actorRole: 'official',
        signedBy: 'Ana Anić',
        createdAt: '2026-09-03T08:00:00.000Z',
      },
    ],
    testEnvironment: true,
  };
  const record: PublicRecord = { ...withoutHash, receiptHash: computeReceiptHash(withoutHash) };
  assert.equal(verifyReceiptHash(record), true);
  assert.equal(verifyReceiptHash({ ...record, commitment: 'Changed' }), false);
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
