// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../src/lib/demo-store.mjs';
import { seedRecords } from '../src/content/demo-fixtures.mjs';

const {
  DEMO_CATEGORIES,
  DEMO_STATUSES,
  STORAGE_KEY,
  assignResponsibility,
  fileCommitment,
  fileVoice,
  getRecord,
  getState,
  resetDemo,
  reviewCommitment,
  setLang,
  subscribe,
} = store;

const office = { en: 'Grad Primjer — water supply office (fictional)', hr: 'Grad Primjer — ured za vodoopskrbu (izmišljen)' };
const role = { en: 'Head of water supply (fictional)', hr: 'Pročelnik vodoopskrbe (izmišljen)' };
const reviewer = { en: 'Independent reviewer (fictional)', hr: 'Neovisni provjeritelj (izmišljen)' };

function freshVoice(overrides = {}) {
  return fileVoice({
    subject: 'Broken kerb on Ulica Primjera',
    narrative: 'The kerb by the crossing is broken and the ramp is unusable.',
    category: 'roads',
    origin: 'app',
    ...overrides,
  });
}

function assigned() {
  const record = freshVoice();
  return assignResponsibility(record.id, { office, role });
}

function pendingReview() {
  const record = assigned();
  return fileCommitment(record.id, {
    text: 'Rebuild the kerb ramp and publish the completion date.',
    due: '2026-09-30',
    filedBy: role,
  });
}

test.beforeEach(() => {
  resetDemo();
});

test('the store seeds from the committed fixtures', () => {
  const state = getState();
  assert.equal(state.version, 1);
  assert.equal(state.lang, 'hr');
  assert.equal(STORAGE_KEY, 'polis-demo-v1');
  assert.deepEqual(
    state.records.map((record) => record.id),
    seedRecords.map((record) => record.id),
  );
  assert.deepEqual(
    state.records.map((record) => record.status),
    ['published', 'commitment-pending-review', 'open'],
  );
  assert.ok(state.records.every((record) => record.origin === 'seed'));
});

test('getState returns a deep-frozen snapshot', () => {
  const state = getState();
  assert.ok(Object.isFrozen(state));
  assert.ok(Object.isFrozen(state.records));
  assert.ok(Object.isFrozen(state.records[0]));
  assert.ok(Object.isFrozen(state.records[0].events[0]));
  assert.throws(() => {
    state.records[0].status = 'published';
  }, TypeError);
  assert.equal(getState().records[0].status, 'published');
});

test('fileVoice starts a record at voice/open with one appended event', () => {
  let notified = 0;
  const unsubscribe = subscribe(() => {
    notified += 1;
  });

  const record = freshVoice();
  unsubscribe();

  assert.equal(notified, 1);
  assert.equal(record.id, 'POLIS-D-0004');
  assert.equal(record.origin, 'app');
  assert.equal(record.stage, 'voice');
  assert.equal(record.status, 'open');
  assert.equal(record.category, 'roads');
  assert.equal(record.responsibility, null);
  assert.equal(record.commitment, null);
  assert.equal(record.review, null);
  assert.equal(record.events.length, 1);
  assert.equal(record.events[0].seq, 1);
  assert.equal(record.events[0].stage, 'voice');
  assert.equal(record.events[0].kind, 'appended');
  assert.equal(getState().records.length, 4);

  const embedded = fileVoice({
    subject: 'Filed from the embedded widget',
    category: 'other',
    origin: 'embed',
  });
  assert.equal(embedded.origin, 'embed');
  assert.equal(embedded.id, 'POLIS-D-0005');
});

test('assignResponsibility names the office and appends the responsibility event', () => {
  const record = assigned();
  assert.equal(record.stage, 'responsibility');
  assert.equal(record.status, 'assigned');
  assert.deepEqual(record.responsibility, { office, role });
  assert.equal(record.events.length, 2);
  assert.equal(record.events[1].stage, 'responsibility');
  assert.equal(record.events[1].kind, 'appended');
});

test('fileCommitment produces PENDING REVIEW with a proposed event', () => {
  const record = pendingReview();
  assert.equal(record.stage, 'response');
  assert.equal(record.status, 'commitment-pending-review');
  assert.equal(record.commitment.reviewStatus, 'pending');
  assert.equal(record.commitment.due, '2026-09-30');
  assert.equal(record.review, null);

  const last = record.events[record.events.length - 1];
  assert.equal(last.stage, 'response');
  assert.equal(last.kind, 'proposed');
  assert.equal(record.events.filter((event) => event.kind === 'proposed').length, 1);
});

test('reviewCommitment accepted flips the proposal and appends check and receipt', () => {
  const filed = pendingReview();
  const record = reviewCommitment(filed.id, {
    decision: 'accepted',
    note: 'Work order checked against the fixture registry.',
    reviewer,
  });

  assert.equal(record.stage, 'receipt');
  assert.equal(record.status, 'published');
  assert.equal(record.commitment.reviewStatus, 'accepted');
  assert.equal(record.review.decision, 'accepted');
  assert.deepEqual(record.review.reviewer, reviewer);
  assert.equal(
    record.events.filter((event) => event.kind === 'proposed').length,
    0,
    'the proposed event becomes appended history',
  );
  assert.deepEqual(
    record.events.map((event) => event.stage),
    ['voice', 'responsibility', 'response', 'check', 'receipt'],
  );
  assert.deepEqual(
    record.events.map((event) => event.seq),
    [1, 2, 3, 4, 5],
  );
  assert.deepEqual(record.events[3].actor, reviewer);
});

test('reviewCommitment returned keeps the proposal proposed and blocks publication', () => {
  const filed = pendingReview();
  const record = reviewCommitment(filed.id, {
    decision: 'returned',
    note: 'The commitment names no measurable public result.',
    reviewer,
  });

  assert.equal(record.stage, 'response');
  assert.equal(record.status, 'returned');
  assert.equal(record.commitment.reviewStatus, 'returned');
  assert.equal(record.review.decision, 'returned');
  assert.equal(record.events.length, 3);

  const proposal = record.events[2];
  assert.equal(proposal.kind, 'proposed');
  assert.equal(proposal.note, 'The commitment names no measurable public result.');

  const refiled = fileCommitment(record.id, {
    text: 'Rebuild the kerb ramp by 30 September and publish the completion date.',
    due: '2026-09-30',
    filedBy: role,
  });
  assert.equal(refiled.status, 'commitment-pending-review');
  assert.equal(refiled.commitment.reviewStatus, 'pending');
  assert.equal(refiled.events[2].kind, 'proposed');
});

test('invalid transitions throw a plain message', () => {
  const seeded = getState().records;
  const open = seeded[2];
  const alreadyPending = seeded[1];
  const published = seeded[0];

  assert.throws(() => reviewCommitment(open.id, { decision: 'accepted', reviewer }), {
    message: `${open.id} has no commitment pending review.`,
  });
  assert.throws(() => reviewCommitment(published.id, { decision: 'accepted', reviewer }), {
    message: `${published.id} has no commitment pending review.`,
  });
  assert.throws(() => fileCommitment(open.id, { text: 'x', due: '2026-09-30', filedBy: role }), {
    message: /assign a responsible office first/,
  });
  assert.throws(() => assignResponsibility(alreadyPending.id, { office, role }), {
    message: /already has a responsible office/,
  });
  assert.throws(() => reviewCommitment(alreadyPending.id, { decision: 'published', reviewer }), {
    message: 'A review decision is either "accepted" or "returned".',
  });
  assert.throws(() => reviewCommitment('POLIS-D-9999', { decision: 'accepted', reviewer }), {
    message: 'Unknown demo record: POLIS-D-9999.',
  });
  assert.throws(() => fileVoice({ subject: '', category: 'roads' }), {
    message: 'A report subject is required.',
  });
  assert.throws(() => fileVoice({ subject: 'x', category: 'sewers' }), {
    message: `Choose one of these categories: ${DEMO_CATEGORIES.join(', ')}.`,
  });
  assert.throws(() => fileVoice({ subject: 'x', category: 'roads', origin: 'seed' }), {
    message: /origin "app" or "embed"/,
  });
  assert.throws(
    () => fileCommitment(assigned().id, { text: 'x', due: 'soon', filedBy: role }),
    { message: 'A commitment due date must be a YYYY-MM-DD date.' },
  );
  assert.throws(() => setLang('de'), { message: 'Unknown demo language: de.' });
});

test('setLang keeps the record set and notifies subscribers', () => {
  // Croatian is the seeded default, so English is the change that notifies.
  const seen = [];
  const unsubscribe = subscribe((state) => seen.push(state.lang));
  setLang('en');
  setLang('en');
  unsubscribe();

  assert.deepEqual(seen, ['en']);
  assert.equal(getState().lang, 'en');
  assert.equal(getState().records.length, 3);
  setLang('hr');
});

test('resetDemo restores the seed and drops filed records', () => {
  const filed = freshVoice();
  assert.equal(getState().records.length, 4);
  assert.ok(getRecord(filed.id));

  let notified = 0;
  const unsubscribe = subscribe(() => {
    notified += 1;
  });
  resetDemo();
  unsubscribe();

  assert.equal(notified, 1);
  assert.equal(getRecord(filed.id), null);
  assert.deepEqual(
    getState().records.map((record) => record.id),
    seedRecords.map((record) => record.id),
  );
  assert.deepEqual(getState().records, structuredClone(seedRecords));
  assert.equal(fileVoice({ subject: 'next', category: 'other' }).id, 'POLIS-D-0004');
});

test('no exported API reaches published except reviewCommitment', () => {
  const exported = Object.keys(store)
    .filter((name) => typeof store[name] === 'function')
    .sort();
  assert.deepEqual(exported, [
    'assignResponsibility',
    'fileCommitment',
    'fileVoice',
    'getRecord',
    'getState',
    'resetDemo',
    'reviewCommitment',
    'setLang',
    'subscribe',
  ]);
  assert.ok(DEMO_STATUSES.includes('published'));

  const injected = fileVoice({
    subject: 'Injection attempt',
    category: 'other',
    stage: 'receipt',
    status: 'published',
    events: [{ seq: 99, stage: 'receipt', actor: 'x', action: 'x', at: 'x', kind: 'appended' }],
    review: { decision: 'accepted', note: 'x', reviewer },
  });
  assert.equal(injected.stage, 'voice');
  assert.equal(injected.status, 'open');
  assert.equal(injected.review, null);
  assert.equal(injected.events.length, 1);

  const withOffice = assignResponsibility(injected.id, {
    office,
    role,
    status: 'published',
    stage: 'receipt',
  });
  assert.equal(withOffice.status, 'assigned');

  const withCommitment = fileCommitment(injected.id, {
    text: 'An official cannot publish this.',
    due: '2026-12-31',
    filedBy: role,
    status: 'published',
    reviewStatus: 'accepted',
  });
  assert.equal(withCommitment.status, 'commitment-pending-review');
  assert.equal(withCommitment.commitment.reviewStatus, 'pending');

  // Only the review gate publishes, and only on an accepted decision.
  // A return without a note is refused: the office must be told what to correct.
  assert.throws(
    () => reviewCommitment(injected.id, { decision: 'returned', reviewer }),
    { message: 'A review note is required.' },
  );
  const returned = reviewCommitment(injected.id, {
    decision: 'returned',
    note: 'The commitment names no measurable public result.',
    reviewer,
  });
  assert.notEqual(returned.status, 'published');

  const published = getState().records.filter((record) => record.status === 'published');
  assert.deepEqual(
    published.map((record) => record.id),
    ['POLIS-D-0001'],
    'no visitor-filed record reached published without an accepted review',
  );
});
