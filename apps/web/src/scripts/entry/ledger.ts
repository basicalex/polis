// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * S3 behaviour: read the place's public cases, count them, and draw one row per
 * case in the order the API returns (newest activity first, entry-flow R8).
 *
 * The shells are public by design, so nothing here needs a session. The search
 * field only navigates: a case number is a route, not a query.
 */

import { getPilotConfig, listPublicCases } from '../../lib/pilot/vrsar/api';
import { entityName, type PilotConfig, type PublicCaseShell } from '../../lib/pilot/vrsar/model';
import {
  caseStateTone,
  caseNumberRegExp,
  translatedCaseState,
} from '../../content/pilot/vrsar-public-case';
import type { PilotLang } from '../../content/pilot/vrsar';
import { createTextElement, formatPilotDate } from '../pilot/vrsar/shell';

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

  const strings = readStrings();
  const lang = documentLang();
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

    const meta = document.createElement('span');
    meta.className = 'ledger-row-meta';
    const parts = [
      categoryLabel(shell, config),
      `${strings.filed ?? ''} ${formatPilotDate(shell.filedAt, lang, true)}`.trim(),
      shell.clockDueAt ? `${strings.due ?? ''} ${formatPilotDate(shell.clockDueAt, lang, true)}`.trim() : '',
    ].filter(Boolean);
    meta.textContent = parts.join(' · ');

    const attention = createTextElement(
      'span',
      `${strings.followers ?? ''} ${Number(shell.followerCount) || 0} · ${strings.alsoAffected ?? ''} ${
        Number(shell.alsoAffectedCount) || 0
      }`,
      'ledger-row-attention',
    );

    link.append(head, meta, attention);

    const reason = typeof shell.closedPublicReason === 'string' ? shell.closedPublicReason.trim() : '';
    if (reason) link.append(createTextElement('span', reason, 'ledger-row-reason'));

    item.append(link);
    return item;
  }

  // ---- counts -------------------------------------------------------------

  function countAndShow(shells: PublicCaseShell[]): void {
    const now = Date.now();
    let open = 0;
    let overdue = 0;
    let closed = 0;
    for (const shell of shells) {
      const state = String(shell.state ?? '');
      const done = state === 'closed' || state === 'resolved';
      if (done) {
        closed += 1;
        continue;
      }
      open += 1;
      const due = typeof shell.clockDueAt === 'string' ? Date.parse(shell.clockDueAt) : Number.NaN;
      if (Number.isFinite(due) && due < now) overdue += 1;
    }
    const counts: Record<string, number> = { open, overdue, closed };
    for (const element of summary?.querySelectorAll<HTMLElement>('[data-count]') ?? []) {
      element.textContent = String(counts[element.dataset.count ?? ''] ?? 0);
    }
    if (capped) capped.hidden = shells.length < LIST_LIMIT;
  }

  // ---- load ---------------------------------------------------------------

  async function load(): Promise<void> {
    if (failure) failure.hidden = true;
    if (empty) empty.hidden = true;
    if (loading) loading.hidden = false;
    list!.setAttribute('aria-busy', 'true');
    try {
      const [shells, config] = await Promise.all([
        listPublicCases(LIST_LIMIT),
        getPilotConfig().catch(() => null),
      ]);
      countAndShow(shells);
      list!.replaceChildren(...shells.map((shell) => row(shell, config)));
      list!.hidden = shells.length === 0;
      if (empty) empty.hidden = shells.length > 0;
    } catch {
      list!.replaceChildren();
      list!.hidden = true;
      if (summary) summary.hidden = true;
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
