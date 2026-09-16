// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * S3 behaviour: read the place's public cases, count them by stage, and draw one
 * row per case in the order the API returns (newest activity first, entry-flow
 * R8). The stage chips filter the hundred shells already in the browser, so
 * switching stage costs no request.
 *
 * The shells are public by design, so nothing here needs a session. The search
 * field only navigates: a case number is a route, not a query.
 */

import { getPilotConfig, listPublicCases } from '../../lib/pilot/vrsar/api';
import { entityName, type PilotConfig, type PublicCaseShell } from '../../lib/pilot/vrsar/model';
import {
  caseStateTone,
  caseNumberRegExp,
  textExcerpt,
  translatedCaseState,
} from '../../content/pilot/vrsar-public-case';
import type { PilotLang } from '../../content/pilot/vrsar';
import { createTextElement, formatPilotDate } from '../pilot/vrsar/shell';
import {
  countHeld,
  countLedgerStages,
  countOpenCases,
  countOverdueCases,
  filterLedgerCases,
  isOverdue,
  ledgerFilterFromLocation,
  ledgerFilterHref,
  normalizeLedgerFilter,
  type LedgerFilter,
} from '../../lib/entry/ledger-stages';

const LIST_LIMIT = 100;

type Strings = Record<string, string>;

const root = document.querySelector<HTMLElement>('[data-ledger]');
if (root) start(root);

function start(ledger: HTMLElement): void {
  const list = ledger.querySelector<HTMLElement>('[data-list]');
  const loading = ledger.querySelector<HTMLElement>('[data-loading]');
  const summary = ledger.querySelector<HTMLElement>('[data-summary]');
  const capped = ledger.querySelector<HTMLElement>('[data-capped]');
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
  let stage: LedgerFilter = ledgerFilterFromLocation(location.search);
  const base = ledger.dataset.base === '/en/' ? '/en/' : '/';
  const place = ledger.dataset.place ?? '';
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

    // The report itself, in the first line or two of it. A held text says so
    // here rather than leaving the row looking empty.
    const excerpt = shell.textStatus === 'held' ? (strings.textHeld ?? '') : textExcerpt(shell.text);
    if (excerpt) {
      const line = createTextElement('span', excerpt, 'ledger-row-text');
      if (shell.textStatus === 'held') line.dataset.held = 'true';
      link.append(line);
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

  function countAndShow(shells: PublicCaseShell[]): void {
    const byStage = countLedgerStages(shells);
    const counts: Record<string, number> = {
      open: countOpenCases(shells),
      overdue: countOverdueCases(shells),
      // Held and closed are how a removal stays visible: as a number.
      held: countHeld(shells),
      closed: byStage.closed ?? 0,
    };
    for (const element of summary?.querySelectorAll<HTMLElement>('[data-count]') ?? []) {
      element.textContent = String(counts[element.dataset.count ?? ''] ?? 0);
    }

    // A stage nobody is in keeps its chip: the reader should see the whole path,
    // not only the parts of it this place happens to be standing in today.
    stageChips.forEach((chip) => {
      const key = normalizeLedgerFilter(chip.dataset.stageChip);
      const count = byStage[key] ?? 0;
      const value = chip.querySelector<HTMLElement>('[data-stage-count]');
      if (value) value.textContent = String(count);
      chip.dataset.empty = count === 0 && key !== 'all' ? 'true' : 'false';
    });
    if (capped) capped.hidden = shells.length < LIST_LIMIT;
  }

  function markSelected(): void {
    stageChips.forEach((chip) => {
      const selected = normalizeLedgerFilter(chip.dataset.stageChip) === stage;
      if (selected) chip.setAttribute('aria-current', 'true');
      else chip.removeAttribute('aria-current');
    });
  }

  /** Redraw the rows for the selected stage. Nothing is refetched. */
  function draw(): void {
    const shown = filterLedgerCases(loaded, stage);
    list!.replaceChildren(...shown.map((shell) => row(shell, pilot)));
    list!.hidden = shown.length === 0;
    if (empty) empty.hidden = loaded.length > 0;
    if (stageEmpty) stageEmpty.hidden = shown.length > 0 || loaded.length === 0;
    markSelected();
  }

  function select(next: LedgerFilter, push: boolean): void {
    stage = next;
    if (push) {
      const href = ledgerFilterHref(`${location.pathname}${location.search}`, next, location.origin);
      history.pushState({ stage: next }, '', href);
    }
    draw();
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
    stage = ledgerFilterFromLocation(location.search);
    draw();
  });

  // ---- load ---------------------------------------------------------------

  async function load(): Promise<void> {
    if (failure) failure.hidden = true;
    if (empty) empty.hidden = true;
    if (stageEmpty) stageEmpty.hidden = true;
    if (loading) loading.hidden = false;
    list!.setAttribute('aria-busy', 'true');
    try {
      const [shells, config] = await Promise.all([
        listPublicCases(LIST_LIMIT),
        getPilotConfig().catch(() => null),
      ]);
      loaded = shells;
      pilot = config;
      countAndShow(shells);
      draw();
    } catch {
      loaded = [];
      list!.replaceChildren();
      list!.hidden = true;
      if (summary) summary.hidden = true;
      if (stageEmpty) stageEmpty.hidden = true;
      if (failure) failure.hidden = false;
    } finally {
      list!.removeAttribute('aria-busy');
      if (loading) loading.hidden = true;
    }
  }

  retry?.addEventListener('click', () => {
    if (summary) summary.hidden = false;
    void load();
  });
  void load();
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
