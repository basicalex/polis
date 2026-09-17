// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { listPrivateRecords, listPublicCases } from '../../../lib/pilot/vrsar/api';
import type { PrivateTraceRecord, PublicCaseShell } from '../../../lib/pilot/vrsar/model';
import {
  pilotCopy,
  pilotHref,
  translatedHoldReason,
  translatedOrigin,
  type PilotLang,
} from '../../../content/pilot/vrsar';
import { worklistCopy, worklistText } from '../../../content/pilot/vrsar-worklist';
import {
  apiErrorMessage,
  clearState,
  createStatus,
  createTextElement,
  currentPilotLang,
  formatPilotDate,
  requirePilotRole,
  setState,
} from './shell';

/** The seven buckets of the queue, in the order the office works them. */
export type WorklistGroupKey =
  'toAssign' | 'needsCommitment' | 'overdue' | 'onTime' | 'disputed' | 'resolved' | 'closed';

/** What the overview strip filters the queue down to. */
export type WorklistFilter = 'none' | 'open' | 'overdue' | 'held' | 'disputed';

export interface WorklistGroup {
  key: WorklistGroupKey;
  records: PrivateTraceRecord[];
}

export interface WorklistCounts {
  open: number;
  overdue: number;
  held: number;
  disputed: number;
  closed: number;
}

export const WORKLIST_GROUP_ORDER: readonly WorklistGroupKey[] = [
  'toAssign',
  'needsCommitment',
  'overdue',
  'onTime',
  'disputed',
  'resolved',
  'closed',
];

/** Statuses the office still owes something on. */
const OPEN_STATUSES = new Set(['open', 'assigned', 'answered', 'disputed']);

/** The views the overview strip offers, and that a link may ask for. */
export const WORKLIST_FILTERS: readonly Exclude<WorklistFilter, 'none'>[] = [
  'open',
  'overdue',
  'held',
  'disputed',
];

/**
 * `?filter=` lets another page link straight into one view. Anything the strip
 * does not offer is not an error: the queue opens on its usual view.
 */
export function parseWorklistFilter(
  value: string | null | undefined,
  fallback: WorklistFilter = 'open',
): WorklistFilter {
  return WORKLIST_FILTERS.some((key) => key === value) ? (value as WorklistFilter) : fallback;
}

let started = false;

/** Dates arrive as `YYYY-MM-DD` or as a timestamp; only the day matters here. */
function dayKey(value: unknown): string {
  return typeof value === 'string' && value.length >= 10 ? value.slice(0, 10) : '';
}

export function todayKey(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Overdue is a promise the office has not kept yet, so only answers count. */
export function isOverdue(record: PrivateTraceRecord, today: string): boolean {
  if (record.status !== 'answered' && record.status !== 'disputed') return false;
  const due = dayKey(record.dueDate);
  return Boolean(due) && due < dayKey(today);
}

function heldCaseNumbers(shells: readonly PublicCaseShell[]): Set<string> {
  const held = new Set<string>();
  for (const shell of shells) {
    if (shell && shell.textStatus === 'held' && shell.caseNumber) held.add(shell.caseNumber);
  }
  return held;
}

function groupKeyFor(record: PrivateTraceRecord, today: string): WorklistGroupKey {
  switch (record.status) {
    case 'assigned':
      return 'needsCommitment';
    case 'answered':
      return isOverdue(record, today) ? 'overdue' : 'onTime';
    case 'disputed':
      return isOverdue(record, today) ? 'overdue' : 'disputed';
    case 'resolved':
      return 'resolved';
    case 'closed':
      return 'closed';
    default:
      // `open`, and anything the backend adds later: it needs a person first.
      return 'toAssign';
  }
}

function keepsRecord(
  record: PrivateTraceRecord,
  filter: WorklistFilter,
  held: Set<string>,
  today: string,
): boolean {
  switch (filter) {
    case 'open':
      return OPEN_STATUSES.has(record.status);
    case 'overdue':
      return isOverdue(record, today);
    case 'held':
      return Boolean(record.caseNumber) && held.has(record.caseNumber as string);
    case 'disputed':
      return record.status === 'disputed';
    default:
      return true;
  }
}

/** A due date is the pressure, so dated rows lead; the rest by last change. */
function compareRecords(a: PrivateTraceRecord, b: PrivateTraceRecord): number {
  const dueA = dayKey(a.dueDate);
  const dueB = dayKey(b.dueDate);
  if (dueA && dueB && dueA !== dueB) return dueA < dueB ? -1 : 1;
  if (dueA && !dueB) return -1;
  if (!dueA && dueB) return 1;
  return String(b.updatedAt).localeCompare(String(a.updatedAt));
}

/**
 * Group the queue by what the office must do next. Empty groups drop out and
 * closed cases stay out until the office asks for them.
 */
export function groupRecords(
  records: readonly PrivateTraceRecord[],
  shells: readonly PublicCaseShell[],
  today: string,
  options: { filter?: WorklistFilter; includeClosed?: boolean } = {},
): WorklistGroup[] {
  const filter = options.filter ?? 'none';
  const includeClosed = options.includeClosed ?? false;
  const held = heldCaseNumbers(shells);
  const buckets = new Map<WorklistGroupKey, PrivateTraceRecord[]>();
  for (const record of records) {
    if (!record) continue;
    if (!keepsRecord(record, filter, held, today)) continue;
    const key = groupKeyFor(record, today);
    if (key === 'closed' && !includeClosed) continue;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(record);
    else buckets.set(key, [record]);
  }
  return WORKLIST_GROUP_ORDER.filter((key) => buckets.has(key)).map((key) => ({
    key,
    records: [...(buckets.get(key) as PrivateTraceRecord[])].sort(compareRecords),
  }));
}

export function worklistCounts(
  records: readonly PrivateTraceRecord[],
  shells: readonly PublicCaseShell[],
  today: string,
): WorklistCounts {
  const held = heldCaseNumbers(shells);
  const counts: WorklistCounts = { open: 0, overdue: 0, held: 0, disputed: 0, closed: 0 };
  for (const record of records) {
    if (!record) continue;
    if (OPEN_STATUSES.has(record.status)) counts.open += 1;
    if (isOverdue(record, today)) counts.overdue += 1;
    if (record.caseNumber && held.has(record.caseNumber)) counts.held += 1;
    if (record.status === 'disputed') counts.disputed += 1;
    if (record.status === 'closed') counts.closed += 1;
  }
  return counts;
}

export function shellIndex(shells: readonly PublicCaseShell[]): Map<string, PublicCaseShell> {
  const index = new Map<string, PublicCaseShell>();
  for (const shell of shells) {
    if (shell && shell.caseNumber) index.set(shell.caseNumber, shell);
  }
  return index;
}

/** A missed due date gets a glyph as well as the colour and the word. */
function clockIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const dial = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  dial.setAttribute('cx', '8');
  dial.setAttribute('cy', '8');
  dial.setAttribute('r', '6.25');
  dial.setAttribute('fill', 'none');
  dial.setAttribute('stroke', 'currentColor');
  dial.setAttribute('stroke-width', '1.5');
  const hands = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  hands.setAttribute('d', 'M8 4.25V8.25l2.75 1.6');
  hands.setAttribute('fill', 'none');
  hands.setAttribute('stroke', 'currentColor');
  hands.setAttribute('stroke-width', '1.5');
  hands.setAttribute('stroke-linecap', 'round');
  hands.setAttribute('stroke-linejoin', 'round');
  svg.append(dial, hands);
  return svg;
}

function mark(text: string, tone?: 'danger' | 'warning'): HTMLSpanElement {
  const element = createTextElement('span', text, 'worklist-mark');
  if (tone) element.dataset.tone = tone;
  return element;
}

function overdueMark(text: string, lang: PilotLang): HTMLSpanElement {
  const element = mark('', 'danger');
  const label = createTextElement('span', text);
  label.title = worklistCopy.overdueMark[lang];
  element.append(clockIcon(), label);
  return element;
}

/**
 * The second line of a row: where, when, what is due, and what the public
 * record says about the text. Nothing private leaves the private rail.
 */
function metaLine(
  record: PrivateTraceRecord,
  shell: PublicCaseShell | undefined,
  today: string,
  lang: PilotLang,
): HTMLElement {
  const line = document.createElement('span');
  line.className = 'worklist-row-meta';
  const parts: HTMLElement[] = [];
  if (record.location) parts.push(mark(record.location));
  parts.push(mark(formatPilotDate(record.createdAt, lang, true)));
  if (record.dueDate) {
    const due = `${pilotCopy.staff.dueDate[lang]}: ${formatPilotDate(record.dueDate, lang, true)}`;
    parts.push(isOverdue(record, today) ? overdueMark(due, lang) : mark(due));
  }
  if (shell?.textStatus === 'held') {
    const reason = translatedHoldReason(shell.holdReason, lang);
    parts.push(mark(`${worklistCopy.textHeld[lang]}: ${reason}`, 'warning'));
  } else if (shell?.textStatus === 'removed') {
    parts.push(mark(worklistCopy.textRemoved[lang]));
  }
  if (shell && shell.noticeCount > 0) {
    parts.push(mark(`${worklistCopy.notices[lang]}: ${shell.noticeCount}`, 'warning'));
  }
  if (record.origin && record.origin !== 'web') {
    parts.push(mark(translatedOrigin(record.origin, lang)));
  }
  parts.forEach((part, index) => {
    if (index > 0) {
      const separator = createTextElement('span', '·', 'worklist-sep');
      separator.setAttribute('aria-hidden', 'true');
      line.append(separator);
    }
    line.append(part);
  });
  return line;
}

/** One case, one line: the number, the subject, the stamp, then the facts. */
function renderRow(
  record: PrivateTraceRecord,
  shell: PublicCaseShell | undefined,
  today: string,
  lang: PilotLang,
  selectedId: string,
): HTMLLIElement {
  const item = document.createElement('li');
  const link = document.createElement('a');
  link.className = 'worklist-row';
  link.href = pilotHref(`/pilot/vrsar/cases/${encodeURIComponent(record.id)}`, lang);
  if (record.id === selectedId) link.setAttribute('aria-current', 'true');
  const head = document.createElement('span');
  head.className = 'worklist-row-head';
  // The case number is the identifier the filer and the public quote; the
  // UUID stays in the address, never on screen.
  head.append(createTextElement('span', record.caseNumber || record.id, 'worklist-case'));
  const subject = createTextElement('span', record.subject, 'worklist-subject');
  if (record.subject) subject.title = record.subject;
  head.append(subject, createStatus(record.status, lang));
  link.append(head, metaLine(record, shell, today, lang));
  item.append(link);
  return item;
}

export function initVrsarStaff(): void {
  if (started) return;
  started = true;
  const lang = currentPilotLang();
  const state = document.querySelector<HTMLElement>('[data-page-state]');
  const workspace = document.querySelector<HTMLElement>('[data-staff-workspace]');
  const stats = document.querySelector<HTMLElement>('[data-worklist-stats]');
  const groupsRoot = document.querySelector<HTMLElement>('[data-worklist-groups]');
  const empty = document.querySelector<HTMLElement>('[data-worklist-empty]');
  const closedToggle = document.querySelector<HTMLButtonElement>('[data-closed-toggle]');
  const retry = document.querySelector<HTMLButtonElement>('[data-retry]');

  let records: PrivateTraceRecord[] = [];
  let shells: PublicCaseShell[] = [];
  const params = new URL(location.href).searchParams;
  let filter: WorklistFilter = parseWorklistFilter(params.get('filter'));
  let showClosed = false;
  const today = todayKey();
  const selectedId = params.get('case') ?? '';

  const cells: { key: Exclude<WorklistFilter, 'none'>; label: string }[] = WORKLIST_FILTERS.map(
    (key) => ({ key, label: worklistCopy.counts[key][lang] }),
  );

  function renderOverview(): void {
    if (!stats) return;
    const counts = worklistCounts(records, shells, today);
    stats.replaceChildren(
      ...cells.map((cell) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pilot-stat';
        button.dataset.filter = cell.key;
        button.setAttribute('aria-pressed', String(filter === cell.key));
        if (cell.key === 'overdue' && counts.overdue > 0) button.dataset.tone = 'danger';
        button.append(
          createTextElement('span', counts[cell.key], 'pilot-stat-value'),
          createTextElement('span', cell.label, 'pilot-stat-label'),
        );
        button.addEventListener('click', () => {
          filter = filter === cell.key ? 'none' : cell.key;
          renderOverview();
          renderQueue();
        });
        return button;
      }),
    );
    if (closedToggle) {
      closedToggle.textContent = showClosed
        ? worklistCopy.hideClosed[lang]
        : worklistText(worklistCopy.showClosed[lang], counts.closed);
      closedToggle.setAttribute('aria-pressed', String(showClosed));
      closedToggle.hidden = counts.closed === 0 && !showClosed;
    }
  }

  function renderQueue(): void {
    if (!groupsRoot) return;
    const index = shellIndex(shells);
    const groups = groupRecords(records, shells, today, { filter, includeClosed: showClosed });
    groupsRoot.replaceChildren(
      ...groups.map((group) => {
        const section = document.createElement('section');
        section.className = 'worklist-group';
        section.dataset.group = group.key;
        const head = createTextElement('h3', '', 'worklist-group-head');
        head.append(
          createTextElement('span', worklistCopy.groups[group.key][lang], 'worklist-group-name'),
          createTextElement('span', group.records.length, 'worklist-group-count'),
        );
        const rows = document.createElement('ul');
        rows.className = 'worklist-rows';
        rows.append(
          ...group.records.map((record) =>
            renderRow(record, index.get(record.caseNumber ?? ''), today, lang, selectedId),
          ),
        );
        section.append(head, rows);
        return section;
      }),
    );
    if (empty) {
      const message = records.length === 0 ? worklistCopy.emptyQueue : worklistCopy.emptyFilter;
      empty.textContent = groups.length === 0 ? message[lang] : '';
      empty.hidden = groups.length > 0;
    }
  }

  async function load(): Promise<void> {
    if (retry) retry.hidden = true;
    setState(state, pilotCopy.common.loading[lang]);
    const session = await requirePilotRole(['official']);
    if (!session) return;
    try {
      // The public shell carries the text status, the reader reports, and the
      // public clock. A missing shell only costs the row those marks.
      const [privateRecords, publicCases] = await Promise.all([
        listPrivateRecords(),
        listPublicCases(100).catch(() => [] as PublicCaseShell[]),
      ]);
      records = privateRecords;
      shells = publicCases;
      if (workspace) workspace.hidden = false;
      clearState(state);
      renderOverview();
      renderQueue();
    } catch (error) {
      setState(state, apiErrorMessage(error, lang), 'error');
      if (retry) retry.hidden = false;
    }
  }

  closedToggle?.addEventListener('click', () => {
    showClosed = !showClosed;
    renderOverview();
    renderQueue();
  });
  retry?.addEventListener('click', () => void load());
  void load();
}
