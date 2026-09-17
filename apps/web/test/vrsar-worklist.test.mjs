// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { worklistCopy, worklistText } from '../src/content/pilot/vrsar-worklist.ts';

/*
 * The browser modules import each other without a file extension, which the
 * bundler resolves and Node does not. One resolve hook adds the extension so
 * the pure queue functions can be tested where they live.
 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.startsWith('.') && !specifier.endsWith('.ts')) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});

const {
  groupRecords,
  isOverdue,
  parseWorklistFilter,
  worklistCounts,
  WORKLIST_FILTERS,
  WORKLIST_GROUP_ORDER,
} = await import('../src/scripts/pilot/vrsar/staff.ts');

const webRoot = new URL('../', import.meta.url);
const TODAY = '2026-09-17';

function record(id, status, extra = {}) {
  return {
    id: `1a2b3c4d-0000-4000-8000-00000000${id}`,
    caseNumber: `VRS-1000${id}`,
    status,
    subject: `Prijava ${id}`,
    narrative: '',
    location: 'Ulica primjer 1',
    municipalityId: 'vrsar',
    category: 'javna-rasvjeta',
    office: 'komunalni',
    version: 1,
    createdAt: '2026-09-01T08:00:00.000Z',
    updatedAt: '2026-09-10T08:00:00.000Z',
    events: [],
    attachments: [],
    origin: 'web',
    ...extra,
  };
}

function shell(caseNumber, extra = {}) {
  return {
    caseNumber,
    state: 'received',
    textStatus: 'public',
    holdReason: null,
    removedReason: null,
    noticeCount: 0,
    labels: [],
    filedAt: '2026-09-01T08:00:00.000Z',
    clockDueAt: null,
    followerCount: 0,
    notFixedCount: 0,
    disputeCount: 0,
    ...extra,
  };
}

test('the queue groups every status by what the office must do next', () => {
  const records = [
    record('01', 'open'),
    record('02', 'assigned'),
    record('03', 'answered', { dueDate: '2026-09-10' }),
    record('04', 'answered', { dueDate: '2026-09-30' }),
    record('05', 'answered'),
    record('06', 'disputed', { dueDate: '2026-08-20' }),
    record('07', 'disputed', { dueDate: '2026-10-01' }),
    record('08', 'resolved'),
    record('09', 'closed'),
  ];

  const groups = groupRecords(records, [], TODAY);
  assert.deepEqual(
    groups.map((group) => group.key),
    ['toAssign', 'needsCommitment', 'overdue', 'onTime', 'disputed', 'resolved'],
  );
  const byKey = Object.fromEntries(
    groups.map((group) => [group.key, group.records.map((item) => item.caseNumber)]),
  );
  // Overdue collects answered and disputed alike, oldest due date first.
  assert.deepEqual(byKey.overdue, ['VRS-100006', 'VRS-100003']);
  // In time: the dated row leads, the undated one follows.
  assert.deepEqual(byKey.onTime, ['VRS-100004', 'VRS-100005']);
  assert.deepEqual(byKey.disputed, ['VRS-100007']);
  assert.deepEqual(byKey.toAssign, ['VRS-100001']);
  assert.deepEqual(byKey.needsCommitment, ['VRS-100002']);
  assert.deepEqual(byKey.resolved, ['VRS-100008']);

  // Closed stays out until the office asks for it, and then it comes last.
  const withClosed = groupRecords(records, [], TODAY, { includeClosed: true });
  assert.equal(withClosed.at(-1).key, 'closed');
  assert.deepEqual(withClosed.at(-1).records.map((item) => item.caseNumber), ['VRS-100009']);
  assert.deepEqual([...WORKLIST_GROUP_ORDER].at(-1), 'closed');
});

test('a due date only counts as missed while the office still owes an answer', () => {
  assert.equal(isOverdue(record('01', 'answered', { dueDate: '2026-09-16' }), TODAY), true);
  assert.equal(isOverdue(record('01', 'answered', { dueDate: TODAY }), TODAY), false);
  assert.equal(isOverdue(record('01', 'answered', { dueDate: '2026-09-18' }), TODAY), false);
  assert.equal(isOverdue(record('01', 'answered'), TODAY), false);
  assert.equal(isOverdue(record('01', 'disputed', { dueDate: '2026-09-16' }), TODAY), true);
  // A completed or closed case is not late any more.
  assert.equal(isOverdue(record('01', 'resolved', { dueDate: '2026-09-16' }), TODAY), false);
  assert.equal(isOverdue(record('01', 'closed', { dueDate: '2026-09-16' }), TODAY), false);
});

test('the overview counts and its filters read the same rows', () => {
  const records = [
    record('01', 'open'),
    record('02', 'assigned'),
    record('03', 'answered', { dueDate: '2026-09-10' }),
    record('04', 'disputed'),
    record('05', 'resolved'),
    record('06', 'closed'),
  ];
  const shells = [
    shell('VRS-100002', { textStatus: 'held', holdReason: 'personal-data' }),
    shell('VRS-100005', { textStatus: 'removed', removedReason: 'filer' }),
  ];

  assert.deepEqual(worklistCounts(records, shells, TODAY), {
    open: 4,
    overdue: 1,
    held: 1,
    disputed: 1,
    closed: 1,
  });

  const keys = (filter) =>
    groupRecords(records, shells, TODAY, { filter }).flatMap((group) =>
      group.records.map((item) => item.caseNumber),
    );
  assert.deepEqual(keys('open'), ['VRS-100001', 'VRS-100002', 'VRS-100003', 'VRS-100004']);
  assert.deepEqual(keys('overdue'), ['VRS-100003']);
  assert.deepEqual(keys('held'), ['VRS-100002']);
  assert.deepEqual(keys('disputed'), ['VRS-100004']);
  // A case with no public shell keeps its place and loses only the text marks.
  assert.equal(keys('none').includes('VRS-100001'), true);
});

test('a row shows the case number and keeps the record UUID in the address', async () => {
  const source = await readFile(new URL('src/scripts/pilot/vrsar/staff.ts', webRoot), 'utf8');
  assert.match(source, /record\.caseNumber \|\| record\.id, 'worklist-case'/);
  assert.match(source, /pilotHref\(`\/pilot\/vrsar\/cases\/\$\{encodeURIComponent\(record\.id\)\}`/);
  // Every other mention of the UUID is the address or the selected-row check.
  const allowed = [
    /encodeURIComponent\(record\.id\)/,
    /record\.id === selectedId/,
    /record\.caseNumber \|\| record\.id/,
  ];
  for (const line of source.split('\n')) {
    if (!line.includes('record.id')) continue;
    assert.ok(
      allowed.some((pattern) => pattern.test(line)),
      `unexpected record.id use: ${line.trim()}`,
    );
  }
  // The subject is truncated in CSS, so the full text stays in the title.
  assert.match(source, /subject\.title = record\.subject/);
  const styles = await readFile(new URL('src/styles/pilot/vrsar-worklist.css', webRoot), 'utf8');
  assert.match(styles, /\.worklist-subject[\s\S]*?text-overflow: ellipsis;/);
});

test('the worklist copy carries Croatian, Italian and English for every string', () => {
  const walk = (value, path) => {
    if (typeof value === 'string') return;
    assert.ok(value && typeof value === 'object', `${path} is not copy`);
    const keys = Object.keys(value);
    if (keys.length === 3 && keys.every((key) => ['hr', 'it', 'en'].includes(key))) {
      for (const lang of ['hr', 'it', 'en']) {
        assert.equal(typeof value[lang], 'string', `${path}.${lang}`);
        assert.ok(value[lang].length > 0, `${path}.${lang} is empty`);
      }
      return;
    }
    for (const key of keys) walk(value[key], `${path}.${key}`);
  };
  walk(worklistCopy, 'worklistCopy');
  assert.equal(worklistText(worklistCopy.showClosed.hr, 3), 'Prikaži zatvorene (3)');
  assert.equal(worklistCopy.groups.toAssign.hr, 'Za preuzimanje');
  assert.equal(worklistCopy.counts.open.hr, 'Otvoreno');
});

test('the worklist page no longer carries the office forms', async () => {
  const source = await readFile(new URL('src/scripts/pilot/vrsar/staff.ts', webRoot), 'utf8');
  for (const gone of [
    'commitmentForm',
    'resolutionForm',
    'submitCommitment',
    'submitResolution',
    'uploadPrivateAttachment',
    'data-record-detail',
    'reopenForm',
    'renderPrivateDetail',
    'localStorage',
  ]) {
    assert.equal(source.includes(gone), false, gone);
  }
  const page = await readFile(new URL('src/pages/pilot/vrsar/staff/index.astro', webRoot), 'utf8');
  // No case panel, and no repeated privacy banner on the queue.
  assert.equal(page.includes('VrsarPrivateBoundary'), false);
  assert.equal(page.includes('data-record-detail'), false);
  assert.match(page, /data-worklist-groups/);
  assert.match(page, /styles\/pilot\/vrsar-worklist\.css/);
});

test('a link can open the queue on one view and a bad view costs nothing', async () => {
  assert.deepEqual([...WORKLIST_FILTERS], ['open', 'overdue', 'held', 'disputed']);
  for (const key of WORKLIST_FILTERS) assert.equal(parseWorklistFilter(key), key);
  // Anything the strip does not offer, including nothing at all, opens the
  // queue on the view the office sees every day.
  assert.equal(parseWorklistFilter(null), 'open');
  assert.equal(parseWorklistFilter(''), 'open');
  assert.equal(parseWorklistFilter('none'), 'open');
  assert.equal(parseWorklistFilter('closed'), 'open');
  assert.equal(parseWorklistFilter('OVERDUE'), 'open');
  assert.equal(parseWorklistFilter('held', 'none'), 'held');
  assert.equal(parseWorklistFilter('nonsense', 'none'), 'none');

  const source = await readFile(new URL('src/scripts/pilot/vrsar/staff.ts', webRoot), 'utf8');
  // The queue reads the view and the selected case from the same query.
  assert.match(source, /parseWorklistFilter\(params\.get\('filter'\)\)/);
  assert.match(source, /params\.get\('case'\)/);
});

test('the overview strip is styled once, in the sheet every pilot page loads', async () => {
  const worklist = await readFile(new URL('src/styles/pilot/vrsar-worklist.css', webRoot), 'utf8');
  assert.equal(worklist.includes('.worklist-stat '), false);
  assert.equal(worklist.includes('.worklist-stat-value'), false);
  const styles = await readFile(new URL('src/styles/pilot/vrsar.css', webRoot), 'utf8');
  // The worklist container keeps its class, so the shared rule names both.
  assert.match(styles, /\.pilot-stats,\n\.worklist-stats \{/);
  assert.match(styles, /\.pilot-stat \{[\s\S]*?min-height: var\(--tap-target\);/);
  assert.match(styles, /\.pilot-stat-value \{[\s\S]*?font-family: var\(--display\);/);
  const staff = await readFile(new URL('src/scripts/pilot/vrsar/staff.ts', webRoot), 'utf8');
  assert.match(staff, /button\.className = 'pilot-stat';/);
});
