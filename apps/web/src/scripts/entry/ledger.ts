// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * S3 behaviour: read the place's public cases one page at a time and draw one
 * row per case in the order the API returns (newest activity first, entry-flow
 * R8). The counts above the list come from the summary, which counts every case
 * of the municipality, so a number here is never a number about one page.
 *
 * A stage chip is a request: the API filters by state and the reader gets that
 * stage from the first case to the last, not the part of it that happened to be
 * in the first page. "Prikaži još" asks for the next page behind the cursor.
 *
 * The shells are public by design, so nothing here needs a session. The search
 * field only navigates: a case number is a route, not a query.
 */

import { getPilotConfig } from '../../lib/pilot/vrsar/api';
import {
  getPublicSummary,
  listPublicCasesPage,
  type PublicSummary,
} from '../../lib/entry/ledger-api';
import {
  entityName,
  type PilotConfig,
  type PublicCaseShell,
  type PublicTextMode,
} from '../../lib/pilot/vrsar/model';
import {
  caseStateTone,
  caseNumberRegExp,
  textExcerpt,
  translatedCaseState,
} from '../../content/pilot/vrsar-public-case';
import type { PilotLang } from '../../content/pilot/vrsar';
import { createTextElement, formatPilotDate } from '../pilot/vrsar/shell';
import {
  isOverdue,
  ledgerFilterFromLocation,
  ledgerFilterHref,
  normalizeLedgerFilter,
  type LedgerFilter,
} from '../../lib/entry/ledger-stages';

/** One page. The API takes at most 100; 50 is a screenful of rows, not a wall. */
const LIST_LIMIT = 50;

type Strings = Record<string, string>;

const root = document.querySelector<HTMLElement>('[data-ledger]');
if (root) start(root);

function start(ledger: HTMLElement): void {
  const list = ledger.querySelector<HTMLElement>('[data-list]');
  const loading = ledger.querySelector<HTMLElement>('[data-loading]');
  const summary = ledger.querySelector<HTMLElement>('[data-summary]');
  const paging = ledger.querySelector<HTMLElement>('[data-paging]');
  const more = ledger.querySelector<HTMLButtonElement>('[data-more]');
  const shownLine = ledger.querySelector<HTMLElement>('[data-shown]');
  const empty = ledger.querySelector<HTMLElement>('[data-empty]');
  const failure = ledger.querySelector<HTMLElement>('[data-failure]');
  const retry = ledger.querySelector<HTMLButtonElement>('[data-retry]');
  const form = ledger.querySelector<HTMLFormElement>('[data-ledger-search]');
  const input = ledger.querySelector<HTMLInputElement>('[data-case-input]');
  const searchError = ledger.querySelector<HTMLElement>('[data-search-error]');
  if (!list) return;

  const stageChips = ledger.querySelectorAll<HTMLAnchorElement>('[data-stage-chip]');
  const stageEmpty = ledger.querySelector<HTMLElement>('[data-stage-empty]');
  const stageClear = ledger.querySelector<HTMLAnchorElement>('[data-stage-clear]');

  const strings = readStrings();
  const lang = documentLang();
  let loaded: PublicCaseShell[] = [];
  let pilot: PilotConfig | null = null;
  let totals: PublicSummary | null = null;
  let nextCursor: string | null = null;
  // Every request carries the number of the view that asked for it; a reply for
  // an older view is dropped rather than drawn under the wrong chip.
  let sequence = 0;
  let fetchingMore = false;
  let stage: LedgerFilter = ledgerFilterFromLocation(location.search);
  const base = ledger.dataset.base === '/en/' ? '/en/' : '/';
  const place = ledger.dataset.place ?? '';
  // The build-time mode from places.ts, until the pilot config says otherwise.
  let textMode: PublicTextMode = readTextMode(ledger.dataset.publicTextMode);
  const caseHref = (caseNumber: string) => `${base}${place}/zapis/${encodeURIComponent(caseNumber)}`;

  // ---- the search field ---------------------------------------------------

  // What the person typed becomes what is submitted, so the two never differ.
  input?.addEventListener('change', () => {
    input.value = input.value.trim().toUpperCase();
  });

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!input) return;
    const value = input.value.trim().toUpperCase();
    input.value = value;
    if (!caseNumberRegExp.test(value)) {
      if (searchError) searchError.textContent = strings.searchInvalid ?? '';
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    if (searchError) searchError.textContent = '';
    input.removeAttribute('aria-invalid');
    location.assign(caseHref(value));
  });

  // ---- one row ------------------------------------------------------------

  function categoryLabel(shell: PublicCaseShell, config: PilotConfig | null): string {
    const configured = config?.category;
    const id = typeof configured?.id === 'string' ? configured.id : '';
    if (configured && id && id === shell.category) return entityName(configured, lang);
    return String(shell.category ?? '');
  }

  function row(shell: PublicCaseShell, config: PilotConfig | null): HTMLLIElement {
    const item = document.createElement('li');
    item.className = 'ledger-row';

    const link = document.createElement('a');
    link.className = 'ledger-link';
    link.href = caseHref(shell.caseNumber);

    const head = document.createElement('span');
    head.className = 'ledger-row-head';
    head.append(createTextElement('span', shell.caseNumber, 'ledger-row-id'));
    const stamp = createTextElement('span', translatedCaseState(shell.state, lang), 'status-label');
    stamp.dataset.style = 'stamp';
    stamp.dataset.tone = caseStateTone(shell.state);
    head.append(stamp);

    // The clock moves down into the answer line once there is one, so a row
    // never prints the same date twice.
    const hint = answerHint(shell);
    const meta = document.createElement('span');
    meta.className = 'ledger-row-meta';
    const parts = [
      categoryLabel(shell, config),
      `${strings.filed ?? ''} ${formatPilotDate(shell.filedAt, lang, true)}`.trim(),
      shell.clockDueAt && !hint ? `${strings.due ?? ''} ${formatPilotDate(shell.clockDueAt, lang, true)}`.trim() : '',
    ].filter(Boolean);
    meta.textContent = parts.join(' · ');

    const marks = [
      `${strings.followers ?? ''} ${Number(shell.followerCount) || 0}`,
      `${strings.alsoAffected ?? ''} ${Number(shell.alsoAffectedCount) || 0}`,
      Number(shell.notFixedCount) > 0 ? `${strings.notFixed ?? ''} ${Number(shell.notFixedCount)}` : '',
    ].filter(Boolean);
    const attention = createTextElement('span', marks.join(' · '), 'ledger-row-attention');

    link.append(head, meta);

    // The report itself, in the first line or two of it. A text the office is
    // holding, waiting to publish or has removed says so here rather than
    // leaving the row looking empty.
    //
    // A shell-mode place never publishes report text, so a row carries no text
    // element at all: a sentence about a held text would promise a text that is
    // never coming.
    if (textMode !== 'shell') {
      const excerpt =
        shell.textStatus === 'removed'
          ? removedSentence(shell)
          : shell.textStatus === 'held'
            ? (shell.holdReason === 'pending-release' ? strings.textPending : strings.textHeld) ?? ''
            : textExcerpt(shell.text);
      if (excerpt) {
        const line = createTextElement('span', excerpt, 'ledger-row-text');
        if (shell.textStatus === 'held') line.dataset.held = 'true';
        if (shell.textStatus === 'removed') line.dataset.removed = 'true';
        link.append(line);
      }
    }

    if (hint) {
      const line = createTextElement('span', hint, 'ledger-row-hint');
      line.dataset.tone =
        shell.state === 'resolved'
          ? 'valid'
          : shell.state === 'disputed' || isOverdue(shell)
            ? 'warning'
            : 'trace';
      link.append(line);
    }

    link.append(attention);

    const reason = typeof shell.closedPublicReason === 'string' ? shell.closedPublicReason.trim() : '';
    if (reason) link.append(createTextElement('span', reason, 'ledger-row-reason'));

    item.append(link);
    return item;
  }

  /** Why the text is gone. The filer asked, or the retention period ran out. */
  function removedSentence(shell: PublicCaseShell): string {
    return (
      (shell.removedReason === 'retention' ? strings.textRemovedRetention : strings.textRemovedFiler) ?? ''
    );
  }

  /*
   * The one line a reader wants on a case that has reached an answer: when the
   * office promised it, or when it was done. The shell carries no resolution
   * date of its own, so a resolved case is dated by its last public change.
   */
  function answerHint(shell: PublicCaseShell): string {
    if (shell.state === 'resolved') {
      return `${strings.hintResolved ?? ''} ${formatPilotDate(shell.updatedAt, lang, true)}`.trim();
    }
    if (shell.state === 'disputed') return strings.hintDisputed ?? '';
    if (shell.state !== 'answered') return '';
    const due = typeof shell.clockDueAt === 'string' ? shell.clockDueAt : '';
    if (!due) return strings.hintAnswered ?? '';
    const clock = isOverdue(shell)
      ? `${strings.hintOverdue ?? ''} ${formatPilotDate(due, lang, true)}`
      : `${strings.due ?? ''} ${formatPilotDate(due, lang, true)}`;
    return `${strings.hintAnswered ?? ''} ${clock.trim()}`.trim();
  }

  // ---- counts and chips ---------------------------------------------------

  /*
   * Every number on this page is a number about the whole municipality, which
   * is why they come from the summary and not from the rows in the browser. The
   * summary can fail on its own: then the chips carry no number at all rather
   * than a number about one page, and the list goes on working.
   */
  function countAndShow(): void {
    const values: Record<string, number> = totals
      ? {
          open: totals.open,
          overdue: totals.overdue,
          // Held, pending, removed and closed are how a text that is not on the
          // page stays visible: as a number.
          held: totals.held,
          pendingRelease: totals.pendingRelease,
          removed: totals.removed,
          closed: totals.byState.closed ?? 0,
        }
      : {};
    for (const element of summary?.querySelectorAll<HTMLElement>('[data-count]') ?? []) {
      const key = element.dataset.count ?? '';
      element.textContent = totals ? String(values[key] ?? 0) : '—';
    }
    showSummaryItems(values);

    // A stage nobody is in keeps its chip: the reader should see the whole path,
    // not only the parts of it this place happens to be standing in today.
    stageChips.forEach((chip) => {
      const key = normalizeLedgerFilter(chip.dataset.stageChip);
      const count = stageTotal(key);
      const value = chip.querySelector<HTMLElement>('[data-stage-count]');
      if (value) value.textContent = totals ? String(count) : '';
      chip.dataset.empty = totals && count === 0 && key !== 'all' ? 'true' : 'false';
    });
  }

  /** How many cases the place has in one stage, or in all of them. */
  function stageTotal(key: LedgerFilter): number {
    if (!totals) return 0;
    return key === 'all' ? totals.total : totals.byState[key] ?? 0;
  }

  /*
   * Which of the summary items this mode keeps. The items are all in the page;
   * the mode decides which stand, and the fifth one waits for a count above
   * zero, so a place that has never removed a text never carries the word.
   */
  function showSummaryItems(counts: Record<string, number>): void {
    for (const item of summary?.querySelectorAll<HTMLElement>('[data-summary-modes]') ?? []) {
      const modes = (item.dataset.summaryModes ?? '').split(' ');
      const key = item.querySelector<HTMLElement>('[data-count]')?.dataset.count ?? '';
      const counted = item.dataset.summaryWhenCounted !== 'true' || (counts[key] ?? 0) > 0;
      item.hidden = !modes.includes(textMode) || !counted;
    }
  }

  function markSelected(): void {
    stageChips.forEach((chip) => {
      const selected = normalizeLedgerFilter(chip.dataset.stageChip) === stage;
      if (selected) chip.setAttribute('aria-current', 'true');
      else chip.removeAttribute('aria-current');
    });
  }

  /*
   * Draw the pages fetched so far. The API already returned the selected stage
   * and nothing else, so there is nothing left to filter here.
   */
  function draw(): void {
    list!.replaceChildren(...loaded.map((shell) => row(shell, pilot)));
    list!.hidden = loaded.length === 0;
    // An empty place and an empty stage are two different sentences, and the
    // summary is what tells them apart.
    const placeEmpty = totals ? totals.total === 0 : stage === 'all' && loaded.length === 0;
    if (empty) empty.hidden = !placeEmpty;
    if (stageEmpty) stageEmpty.hidden = loaded.length > 0 || placeEmpty;
    markSelected();
    showPaging();
  }

  /** Append one more page without redrawing the rows already on screen. */
  function append(shells: PublicCaseShell[]): void {
    list!.append(...shells.map((shell) => row(shell, pilot)));
    list!.hidden = loaded.length === 0;
    showPaging();
  }

  /*
   * The button is the only thing that says there is more. It goes when the API
   * says there is no next page, and the line beside it counts the rows on
   * screen against every case in this stage.
   */
  function showPaging(): void {
    if (more) more.textContent = strings.more ?? '';
    if (shownLine) {
      shownLine.textContent = totals
        ? (strings.shown ?? '')
            .replace('{n}', String(loaded.length))
            .replace('{total}', String(stageTotal(stage)))
        : '';
    }
    if (paging) paging.hidden = nextCursor === null;
  }

  function select(next: LedgerFilter, push: boolean): void {
    stage = next;
    if (push) {
      const href = ledgerFilterHref(`${location.pathname}${location.search}`, next, location.origin);
      history.pushState({ stage: next }, '', href);
    }
    markSelected();
    void loadPage();
  }

  stageChips.forEach((chip) => {
    chip.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      select(normalizeLedgerFilter(chip.dataset.stageChip), true);
    });
  });

  stageClear?.addEventListener('click', (event) => {
    event.preventDefault();
    select('all', true);
  });

  // Back and forward move between stages, because each stage has its own address.
  window.addEventListener('popstate', () => {
    select(ledgerFilterFromLocation(location.search), false);
  });

  // ---- load ---------------------------------------------------------------

  /*
   * The first page of the selected stage. The summary and the pilot config are
   * fetched beside it on the first load and whenever one of them is still
   * missing; a chip change asks only for the list, because the counts of the
   * place do not change with the stage the reader is looking at.
   */
  async function loadPage(): Promise<void> {
    const token = ++sequence;
    nextCursor = null;
    if (failure) failure.hidden = true;
    if (empty) empty.hidden = true;
    if (stageEmpty) stageEmpty.hidden = true;
    if (paging) paging.hidden = true;
    if (loading) loading.hidden = false;
    list!.setAttribute('aria-busy', 'true');
    try {
      const [page, total, config] = await Promise.all([
        listPublicCasesPage({ limit: LIST_LIMIT, state: stage === 'all' ? null : stage }),
        totals ? Promise.resolve(totals) : getPublicSummary().catch(() => null),
        pilot ? Promise.resolve(pilot) : getPilotConfig().catch(() => null),
      ]);
      if (token !== sequence) return;
      loaded = page.cases;
      nextCursor = page.nextCursor;
      totals = total;
      pilot = config;
      // The municipality's own setting wins over the one built into the page.
      if (config) {
        textMode = readTextMode(config.publicTextMode);
        ledger.dataset.publicTextMode = textMode;
      }
      if (summary) summary.hidden = false;
      countAndShow();
      draw();
    } catch {
      if (token !== sequence) return;
      loaded = [];
      list!.replaceChildren();
      list!.hidden = true;
      if (summary) summary.hidden = true;
      if (paging) paging.hidden = true;
      if (stageEmpty) stageEmpty.hidden = true;
      if (failure) failure.hidden = false;
    } finally {
      if (token === sequence) {
        list!.removeAttribute('aria-busy');
        if (loading) loading.hidden = true;
      }
    }
  }

  /*
   * One more page, appended. A failed page leaves the rows that are already
   * there alone and puts the button back, so pressing it again is the whole
   * recovery.
   */
  async function loadMore(): Promise<void> {
    if (!nextCursor || fetchingMore) return;
    const token = sequence;
    const cursor = nextCursor;
    fetchingMore = true;
    if (more) {
      more.disabled = true;
      more.textContent = strings.moreLoading ?? strings.more ?? '';
    }
    try {
      const page = await listPublicCasesPage({
        limit: LIST_LIMIT,
        state: stage === 'all' ? null : stage,
        cursor,
      });
      if (token !== sequence) return;
      loaded = [...loaded, ...page.cases];
      nextCursor = page.nextCursor;
      append(page.cases);
    } catch {
      // The page the reader already has stays on screen; the button comes back.
    } finally {
      fetchingMore = false;
      if (more) {
        more.disabled = false;
        more.textContent = strings.more ?? '';
      }
      if (token === sequence) showPaging();
    }
  }

  more?.addEventListener('click', () => {
    void loadMore();
  });

  retry?.addEventListener('click', () => {
    if (summary) summary.hidden = false;
    void loadPage();
  });
  void loadPage();
}

/** An unknown mode is the open one: the page shows the text it has. */
function readTextMode(value: unknown): PublicTextMode {
  return value === 'release' || value === 'shell' ? value : 'open';
}

function documentLang(): PilotLang {
  return document.documentElement.lang === 'en' ? 'en' : 'hr';
}

function readStrings(): Strings {
  const source = document.getElementById('ledger-strings');
  if (!source?.textContent) return {};
  try {
    return JSON.parse(source.textContent) as Strings;
  } catch {
    return {};
  }
}
