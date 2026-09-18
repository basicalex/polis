// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  LEDGER_STAGES,
  LEDGER_STAGE_PARAM,
  countLedgerStages,
  countHeld,
  countPendingRelease,
  countRemoved,
  countOpenCases,
  countOverdueCases,
  filterLedgerCases,
  isOverdue,
  ledgerFilterFromLocation,
  ledgerFilterHref,
  normalizeLedgerFilter,
} from '../src/lib/entry/ledger-stages.ts';
import {
  getPublicSummary,
  listPublicCasesPage,
  publicSummaryFromResponse,
} from '../src/lib/entry/ledger-api.ts';

const webRoot = new URL('../', import.meta.url);

const NOW = Date.parse('2026-09-13T12:00:00Z');

function shell(
  state,
  clockDueAt = null,
  textStatus = 'public',
  holdReason = null,
  removedReason = null,
) {
  return { state, clockDueAt, textStatus, holdReason, removedReason };
}

const cases = [
  shell('received'),
  shell('received', '2026-09-01T00:00:00Z'),
  shell('assigned', '2026-09-30T00:00:00Z'),
  shell('answered', '2026-09-02T00:00:00Z', 'held'),
  shell('disputed', '2026-09-20T00:00:00Z'),
  shell('resolved', '2026-08-01T00:00:00Z'),
  shell('closed'),
  shell('closed'),
];

test('the chip row covers every public stage a case can stand in', () => {
  assert.deepEqual([...LEDGER_STAGES], [
    'received',
    'assigned',
    'answered',
    'resolved',
    'disputed',
    'closed',
  ]);
});

test('every stage keeps a count, including the stages nobody is in', () => {
  const counts = countLedgerStages(cases);
  assert.equal(counts.all, 8);
  assert.equal(counts.received, 2);
  assert.equal(counts.assigned, 1);
  assert.equal(counts.answered, 1);
  assert.equal(counts.resolved, 1);
  assert.equal(counts.disputed, 1);
  assert.equal(counts.closed, 2);

  const emptyPlace = countLedgerStages([shell('received')]);
  for (const stage of LEDGER_STAGES) {
    assert.equal(typeof emptyPlace[stage], 'number', `${stage} lost its count`);
  }
  assert.equal(emptyPlace.resolved, 0);
  assert.equal(emptyPlace.all, 1);
});
test('text visibility counts stay separate from process state', () => {
  const visibilityCases = [
    shell('received', null, 'held', 'pending-release'),
    shell('answered', null, 'held', 'personal-data'),
    shell('resolved', null, 'removed', null, 'filer'),
    shell('closed', null, 'removed', null, 'retention'),
    shell('assigned'),
  ];
  assert.equal(countHeld(visibilityCases), 2);
  assert.equal(countRemoved(visibilityCases), 2);
  assert.equal(countPendingRelease(visibilityCases), 1);
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
  assert.equal(filterLedgerCases(cases, 'answered').length, 1);
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
  assert.equal(normalizeLedgerFilter('answered'), 'answered');
  assert.equal(normalizeLedgerFilter('objavljeno'), 'all');
  assert.equal(normalizeLedgerFilter(null), 'all');
  assert.equal(normalizeLedgerFilter(undefined), 'all');
  assert.equal(filterLedgerCases(cases, normalizeLedgerFilter('nonsense')).length, cases.length);
});

test('a filtered view has its own address, and a shared address opens filtered', () => {
  assert.equal(ledgerFilterHref('/vrsar/zapis', 'answered'), `/vrsar/zapis?${LEDGER_STAGE_PARAM}=answered`);
  assert.equal(ledgerFilterHref(`/vrsar/zapis?${LEDGER_STAGE_PARAM}=answered`, 'all'), '/vrsar/zapis');
  assert.equal(
    ledgerFilterHref(`/vrsar/zapis?${LEDGER_STAGE_PARAM}=answered`, 'closed'),
    `/vrsar/zapis?${LEDGER_STAGE_PARAM}=closed`,
  );
  assert.equal(ledgerFilterFromLocation(`?${LEDGER_STAGE_PARAM}=disputed`), 'disputed');
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
  // The API filters and pages: the browser no longer holds the whole ledger.
  assert.doesNotMatch(ledgerScript, /\blistPublicCases\(/);
  assert.doesNotMatch(ledgerScript, /filterLedgerCases/);
  assert.match(ledgerScript, /state: stage === 'all' \? null : stage/);

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
  for (const key of [
    'voiceDone',
    'responsibilityNext',
    'checkNow',
    'checkDisputed',
    'receiptResolved',
    'closedAhead',
  ]) {
    assert.ok(copy.includes(`${key}: localized(`), `the stage story is missing ${key}`);
  }
  for (const state of LEDGER_STAGES) {
    assert.ok(copy.includes(`${state}: localized(`), `no waiting line for ${state}`);
  }

  // There is no reviewer, so no resident surface may promise one.
  for (const [name, source] of [
    ['copy', copy],
    ['case page', shellMarkup],
    ['case script', caseScript],
    ['ledger', ledgerMarkup],
  ]) {
    assert.doesNotMatch(source, /neovisn/i, name);
    assert.doesNotMatch(source, /independent review/i, name);
  }
});

/* ---- the API the ledger reads ------------------------------------------- */

function stubFetch(pages) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    const body = pages.shift() ?? {};
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test('a stage is a request: the page carries the state, and only when one is chosen', async () => {
  const stub = stubFetch([
    { cases: [shell('answered')], nextCursor: null },
    { cases: [shell('received')], nextCursor: null },
  ]);
  try {
    await listPublicCasesPage({ limit: 50, state: 'answered' });
    await listPublicCasesPage({ limit: 50, state: null });
    assert.equal(stub.calls[0], '/pilot/vrsar/api/public/cases?limit=50&state=answered');
    assert.equal(stub.calls[1], '/pilot/vrsar/api/public/cases?limit=50');
  } finally {
    stub.restore();
  }
});

test('the next page is the cursor the last one returned, and null ends the paging', async () => {
  const stub = stubFetch([
    { cases: [shell('received'), shell('assigned')], nextCursor: 'cur-1' },
    { cases: [shell('closed')], nextCursor: null },
  ]);
  try {
    const first = await listPublicCasesPage({ limit: 50 });
    assert.equal(first.cases.length, 2);
    assert.equal(first.nextCursor, 'cur-1');

    const second = await listPublicCasesPage({ limit: 50, cursor: first.nextCursor });
    assert.equal(stub.calls[1], '/pilot/vrsar/api/public/cases?limit=50&cursor=cur-1');
    // What the reader ends up with is one list, in the order the pages arrived.
    assert.deepEqual(
      [...first.cases, ...second.cases].map((item) => item.state),
      ['received', 'assigned', 'closed'],
    );
    // No next cursor is what takes the button off the page.
    assert.equal(second.nextCursor, null);
  } finally {
    stub.restore();
  }
});

test('an empty or missing nextCursor is the end, not a cursor', async () => {
  const stub = stubFetch([{ cases: [] }, { cases: [], nextCursor: '' }]);
  try {
    assert.equal((await listPublicCasesPage({})).nextCursor, null);
    assert.equal((await listPublicCasesPage({})).nextCursor, null);
    assert.equal(stub.calls[0], '/pilot/vrsar/api/public/cases');
  } finally {
    stub.restore();
  }
});

test('the summary counts the whole place and keeps every stage key', async () => {
  const stub = stubFetch([
    {
      total: 137,
      byState: { received: 20, assigned: 30, answered: 40, resolved: 25, disputed: 2, closed: 20 },
      open: 92,
      overdue: 7,
      held: 3,
      pendingRelease: 1,
      removed: 2,
      computedAt: '2026-09-18T09:00:00Z',
    },
  ]);
  try {
    const summary = await getPublicSummary();
    assert.equal(stub.calls[0], '/pilot/vrsar/api/public/summary');
    assert.equal(summary.total, 137);
    assert.equal(summary.byState.answered, 40);
    assert.equal(summary.open, 92);
    assert.equal(summary.overdue, 7);
    assert.equal(summary.pendingRelease, 1);
    // The chips read the same numbers the summary strip reads.
    assert.equal(
      LEDGER_STAGES.reduce((sum, stage) => sum + summary.byState[stage], 0),
      summary.total,
    );
  } finally {
    stub.restore();
  }
});

test('a summary missing a number reads as zero, never as a blank', () => {
  const summary = publicSummaryFromResponse({ total: 4, byState: { received: 4 } });
  for (const stage of LEDGER_STAGES) {
    assert.equal(typeof summary.byState[stage], 'number', `${stage} lost its count`);
  }
  assert.equal(summary.byState.closed, 0);
  assert.equal(summary.open, 0);
  assert.equal(summary.computedAt, '');
  assert.equal(publicSummaryFromResponse({ total: -3 }).total, 0);
});

test('the ledger counts the municipality and pages the list, and no longer says "the latest 100"', async () => {
  const [markup, script, copy, styles] = await Promise.all([
    readFile(new URL('src/components/entry/PlaceLedger.astro', webRoot), 'utf8'),
    readFile(new URL('src/scripts/entry/ledger.ts', webRoot), 'utf8'),
    readFile(new URL('src/content/entry.ts', webRoot), 'utf8'),
    readFile(new URL('src/styles/entry.css', webRoot), 'utf8'),
  ]);

  // The cap is gone from the page, the script and the copy.
  for (const [name, source] of [['ledger', markup], ['script', script], ['copy', copy]]) {
    assert.doesNotMatch(source, /capped|ledgerCapped/i, name);
  }

  // The counts come from the summary, not from the rows in the browser.
  assert.match(script, /getPublicSummary\(/);
  assert.doesNotMatch(script, /countLedgerStages|countOpenCases|countOverdueCases/);
  assert.match(script, /totals\.byState\[key\]/);

  // One more page is one button, and it goes when there is no next cursor.
  assert.match(markup, /data-paging/);
  assert.match(markup, /data-more/);
  assert.match(markup, /data-shown/);
  assert.match(markup, /data-variant="secondary"[^>]*data-more/);
  assert.match(script, /paging\.hidden = nextCursor === null/);
  assert.match(script, /loaded = \[\.\.\.loaded, \.\.\.page\.cases\]/);
  assert.match(script, /const LIST_LIMIT = 50;/);
  assert.match(styles, /\.ledger-paging \{/);

  for (const key of ['ledgerMore', 'ledgerMoreLoading', 'ledgerShown']) {
    assert.ok(copy.includes(`${key}: {`), `the paging copy is missing ${key}`);
  }
  assert.match(copy, /ledgerShown: \{ hr: 'Prikazano \{n\} od \{total\}'/);
});
