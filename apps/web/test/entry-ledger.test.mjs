// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  LEDGER_STAGES,
  LEDGER_STAGE_PARAM,
  countLedgerStages,
  countOpenCases,
  countOverdueCases,
  filterLedgerCases,
  isOverdue,
  ledgerFilterFromLocation,
  ledgerFilterHref,
  normalizeLedgerFilter,
} from '../src/lib/entry/ledger-stages.ts';

const webRoot = new URL('../', import.meta.url);

const NOW = Date.parse('2026-09-13T12:00:00Z');

function shell(state, clockDueAt = null) {
  return { state, clockDueAt };
}

const cases = [
  shell('received'),
  shell('received', '2026-09-01T00:00:00Z'),
  shell('assigned', '2026-09-30T00:00:00Z'),
  shell('in-review', '2026-09-02T00:00:00Z'),
  shell('published', '2026-09-20T00:00:00Z'),
  shell('resolved', '2026-08-01T00:00:00Z'),
  shell('closed'),
  shell('closed'),
];

test('the chip row covers every public stage a case can stand in', () => {
  assert.deepEqual([...LEDGER_STAGES], [
    'received',
    'assigned',
    'in-review',
    'published',
    'resolved',
    'closed',
  ]);
});

test('every stage keeps a count, including the stages nobody is in', () => {
  const counts = countLedgerStages(cases);
  assert.equal(counts.all, 8);
  assert.equal(counts.received, 2);
  assert.equal(counts.assigned, 1);
  assert.equal(counts['in-review'], 1);
  assert.equal(counts.published, 1);
  assert.equal(counts.resolved, 1);
  assert.equal(counts.closed, 2);

  const emptyPlace = countLedgerStages([shell('received')]);
  for (const stage of LEDGER_STAGES) {
    assert.equal(typeof emptyPlace[stage], 'number', `${stage} lost its count`);
  }
  assert.equal(emptyPlace.resolved, 0);
  assert.equal(emptyPlace.all, 1);
});

test('an unknown state is counted in the total but in no stage', () => {
  const counts = countLedgerStages([shell('received'), shell('parked'), shell(undefined)]);
  assert.equal(counts.all, 3);
  assert.equal(counts.received, 1);
  assert.equal(counts.closed, 0);
});

test('selecting a stage shows that stage and nothing else', () => {
  assert.equal(filterLedgerCases(cases, 'all').length, cases.length);
  assert.deepEqual(
    filterLedgerCases(cases, 'closed').map((item) => item.state),
    ['closed', 'closed'],
  );
  assert.equal(filterLedgerCases(cases, 'published').length, 1);
  assert.equal(filterLedgerCases(cases, 'resolved')[0].clockDueAt, '2026-08-01T00:00:00Z');
});

test('"all" keeps the order the API returned', () => {
  const shown = filterLedgerCases(cases, 'all');
  assert.deepEqual(shown.map((item) => item.state), cases.map((item) => item.state));
  assert.notEqual(shown, cases);
});

test('open and overdue count the clock, never a finished case', () => {
  assert.equal(countOpenCases(cases), 5);
  // Two open cases ran out of time; the resolved one is past its date and is not counted.
  assert.equal(countOverdueCases(cases, NOW), 2);
  assert.equal(isOverdue(shell('received', '2026-08-01T00:00:00Z'), NOW), true);
  assert.equal(isOverdue(shell('received', '2026-10-01T00:00:00Z'), NOW), false);
  assert.equal(isOverdue(shell('received', null), NOW), false);
  assert.equal(isOverdue(shell('received', 'not a date'), NOW), false);
});

test('a misspelled or missing stage falls back to all rather than an empty list', () => {
  assert.equal(normalizeLedgerFilter('published'), 'published');
  assert.equal(normalizeLedgerFilter('objavljeno'), 'all');
  assert.equal(normalizeLedgerFilter(null), 'all');
  assert.equal(normalizeLedgerFilter(undefined), 'all');
  assert.equal(filterLedgerCases(cases, normalizeLedgerFilter('nonsense')).length, cases.length);
});

test('a filtered view has its own address, and a shared address opens filtered', () => {
  assert.equal(ledgerFilterHref('/vrsar/zapis', 'published'), `/vrsar/zapis?${LEDGER_STAGE_PARAM}=published`);
  assert.equal(ledgerFilterHref(`/vrsar/zapis?${LEDGER_STAGE_PARAM}=published`, 'all'), '/vrsar/zapis');
  assert.equal(
    ledgerFilterHref(`/vrsar/zapis?${LEDGER_STAGE_PARAM}=published`, 'closed'),
    `/vrsar/zapis?${LEDGER_STAGE_PARAM}=closed`,
  );
  assert.equal(ledgerFilterFromLocation(`?${LEDGER_STAGE_PARAM}=in-review`), 'in-review');
  assert.equal(ledgerFilterFromLocation(`https://polis.test/vrsar/zapis?${LEDGER_STAGE_PARAM}=resolved`), 'resolved');
  assert.equal(ledgerFilterFromLocation(''), 'all');
  assert.equal(ledgerFilterFromLocation('?lang=en'), 'all');
});

test('the ledger renders a chip per stage and the case page tells each stage as a sentence', async () => {
  const [ledgerMarkup, ledgerScript, shellMarkup, caseScript, copy] = await Promise.all([
    readFile(new URL('src/components/entry/PlaceLedger.astro', webRoot), 'utf8'),
    readFile(new URL('src/scripts/entry/ledger.ts', webRoot), 'utf8'),
    readFile(new URL('src/components/pilot/vrsar/VrsarPublicShell.astro', webRoot), 'utf8'),
    readFile(new URL('src/scripts/pilot/vrsar/public-case.ts', webRoot), 'utf8'),
    readFile(new URL('src/content/pilot/vrsar-public-case.ts', webRoot), 'utf8'),
  ]);

  assert.match(ledgerMarkup, /data-stage-chip=\{stage\.key\}/);
  assert.match(ledgerMarkup, /data-stage-count/);
  for (const key of ['all', ...LEDGER_STAGES]) {
    assert.ok(ledgerMarkup.includes(`key: '${key}'`), `the chip row is missing ${key}`);
  }
  // Filtering happens in the browser: the chips must not send the reader back to the API.
  assert.equal((ledgerScript.match(/listPublicCases\(/g) ?? []).length, 1);
  assert.match(ledgerScript, /filterLedgerCases\(loaded, stage\)/);

  // The approved answer is read before the path and before the verification block.
  const answerIndex = shellMarkup.indexOf('data-public-receipt');
  const traceIndex = shellMarkup.indexOf('data-case-trace');
  const verifyIndex = shellMarkup.indexOf('data-public-verification');
  assert.ok(answerIndex > 0 && answerIndex < traceIndex && traceIndex < verifyIndex);
  assert.ok(shellMarkup.indexOf('data-public-hash') > verifyIndex);
  assert.match(shellMarkup, /data-case-pending-text/);

  // Every stage carries a sentence, and the waiting note names the stage.
  assert.match(caseScript, /function stageSentence\(/);
  assert.match(caseScript, /function showPending\(/);
  assert.doesNotMatch(caseScript, /publicCaseCopy\.shell\.pendingPublicText/);
  for (const key of ['voiceDone', 'responsibilityNext', 'checkNow', 'receiptResolved', 'closedAhead']) {
    assert.ok(copy.includes(`${key}: localized(`), `the stage story is missing ${key}`);
  }
  for (const state of ['received', 'assigned', 'in-review', 'closed']) {
    assert.ok(copy.includes(`${state.includes('-') ? `'${state}'` : state}: localized(`), `no waiting line for ${state}`);
  }
});
