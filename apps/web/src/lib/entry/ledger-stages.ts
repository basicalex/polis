// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * The stages a case can stand in on the place ledger (S3), and the counting and
 * filtering that go with them.
 *
 * Nothing here touches the DOM or the network: the ledger fetches the newest
 * hundred shells once and this module decides what the reader sees. Keeping it
 * pure is what makes the chip counts testable without a browser.
 */
import type { HoldReason, RemovedReason, TextStatus } from '../pilot/vrsar/model.ts';


/** The six public states a case shell can carry, in the order a case walks them. */
export const LEDGER_STAGES = [
  'received',
  'assigned',
  'answered',
  'resolved',
  'disputed',
  'closed',
] as const;

export type LedgerStage = (typeof LEDGER_STAGES)[number];

/** A stage, or "all" — what the chip row selects. */
export type LedgerFilter = 'all' | LedgerStage;

/** The query parameter that carries the selected stage, so a link can share it. */
export const LEDGER_STAGE_PARAM = 'stage';

/** Everything this module reads off a case. The shell carries much more. */
export interface LedgerCaseLike {
  state?: unknown;
  clockDueAt?: unknown;
  textStatus?: TextStatus;
  holdReason?: HoldReason | null;
  removedReason?: RemovedReason | null;
}

export function isLedgerStage(value: unknown): value is LedgerStage {
  return typeof value === 'string' && (LEDGER_STAGES as readonly string[]).includes(value);
}

/** An unknown, missing or misspelled stage is not an error: it is "all". */
export function normalizeLedgerFilter(value: unknown): LedgerFilter {
  return isLedgerStage(value) ? value : 'all';
}

/** The filter a shared link asks for. Accepts a full URL or a bare query string. */
export function ledgerFilterFromLocation(href: string): LedgerFilter {
  const query = href.includes('?') ? href.slice(href.indexOf('?') + 1) : href;
  const params = new URLSearchParams(query.split('#')[0] ?? '');
  return normalizeLedgerFilter(params.get(LEDGER_STAGE_PARAM));
}

/** The address of the same ledger with one stage selected; "all" drops the parameter. */
export function ledgerFilterHref(href: string, filter: LedgerFilter, origin = 'http://ledger.invalid'): string {
  const url = new URL(href, origin);
  if (filter === 'all') url.searchParams.delete(LEDGER_STAGE_PARAM);
  else url.searchParams.set(LEDGER_STAGE_PARAM, filter);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** One count per chip, including "all". A stage nobody is in counts zero, not nothing. */
export function countLedgerStages(cases: readonly LedgerCaseLike[]): Record<LedgerFilter, number> {
  const counts = { all: cases.length } as Record<LedgerFilter, number>;
  for (const stage of LEDGER_STAGES) counts[stage] = 0;
  for (const item of cases) {
    const state = item?.state;
    if (isLedgerStage(state)) counts[state] += 1;
  }
  return counts;
}
/** All held text counts, including pending-release; removed text does not. */
export function countHeld(cases: readonly LedgerCaseLike[]): number {
  let held = 0;
  for (const item of cases) {
    if (item?.textStatus === 'held') held += 1;
  }
  return held;
}

export function countRemoved(cases: readonly LedgerCaseLike[]): number {
  let removed = 0;
  for (const item of cases) {
    if (item?.textStatus === 'removed') removed += 1;
  }
  return removed;
}

export function countPendingRelease(cases: readonly LedgerCaseLike[]): number {
  let pending = 0;
  for (const item of cases) {
    if (item?.textStatus === 'held' && item.holdReason === 'pending-release') pending += 1;
  }
  return pending;
}


/** Cases still with the office: anything that has not been resolved or closed. */
export function countOpenCases(cases: readonly LedgerCaseLike[]): number {
  let open = 0;
  for (const item of cases) {
    const state = String(item?.state ?? '');
    if (state !== 'resolved' && state !== 'closed') open += 1;
  }
  return open;
}

/** Open cases whose clock has run out. A finished case is never overdue. */
export function countOverdueCases(cases: readonly LedgerCaseLike[], now: number = Date.now()): number {
  let overdue = 0;
  for (const item of cases) {
    const state = String(item?.state ?? '');
    if (state === 'resolved' || state === 'closed') continue;
    if (isOverdue(item, now)) overdue += 1;
  }
  return overdue;
}

/** Whether this case's clock has already run out. */
export function isOverdue(item: LedgerCaseLike, now: number = Date.now()): boolean {
  const due = typeof item?.clockDueAt === 'string' ? Date.parse(item.clockDueAt) : Number.NaN;
  return Number.isFinite(due) && due < now;
}

/** The rows one chip shows. "all" keeps the order the API returned. */
export function filterLedgerCases<T extends LedgerCaseLike>(
  cases: readonly T[],
  filter: LedgerFilter,
): T[] {
  if (filter === 'all') return [...cases];
  return cases.filter((item) => item?.state === filter);
}
