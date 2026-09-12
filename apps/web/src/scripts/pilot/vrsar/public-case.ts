// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { getPilotConfig, getPublicCase, PilotApiError, recordCaseAttention } from '../../../lib/pilot/vrsar/api';
import {
  entityName,
  safeStringList,
  type PilotConfig,
  type PublicCaseShell,
  type PublicTraceRecord,
} from '../../../lib/pilot/vrsar/model';
import { pilotCopy, statusTone, translatedStatus, type PilotLang } from '../../../content/pilot/vrsar';
import {
  caseStateTone,
  isCaseNumber,
  publicCaseCopy,
  publicCaseHref,
  translatedCaseState,
} from '../../../content/pilot/vrsar-public-case';
import {
  apiErrorMessage,
  clearState,
  createTextElement,
  currentPilotLang,
  formatPilotDate,
  setState,
} from './shell';

/* -------------------------------------------------------------------------- */
/* Case-number lookup                                                          */
/* -------------------------------------------------------------------------- */

let lookupStarted = false;

/**
 * The form only navigates: a case number is a route, not a query, so nothing is
 * fetched here and a wrong number fails on the case page with the same
 * not-found state an unknown number gets.
 */
export function initVrsarCaseLookup(): void {
  if (lookupStarted) return;
  lookupStarted = true;
  const lang = currentPilotLang();

  document.querySelectorAll<HTMLFormElement>('form[data-case-lookup]').forEach((form) => {
    const input = form.querySelector<HTMLInputElement>('input[name="caseNumber"]');
    const error = form.querySelector<HTMLElement>('[data-case-lookup-error]');
    if (!input) return;

    const normalize = (): string => {
      const value = input.value.trim().toUpperCase();
      input.value = value;
      return value;
    };

    input.addEventListener('change', () => {
      normalize();
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = normalize();
      if (!isCaseNumber(value)) {
        if (error) error.textContent = publicCaseCopy.lookup.invalid[lang];
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return;
      }
      if (error) error.textContent = '';
      input.removeAttribute('aria-invalid');
      location.assign(publicCaseHref(value, lang));
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Public case page                                                            */
/* -------------------------------------------------------------------------- */

const TRACE_STAGES = ['voice', 'responsibility', 'response', 'check', 'receipt'] as const;

/** Where a shell state sits on the five-stage path shown to the public. */
const ACTIVE_STAGE: Readonly<Record<string, string>> = Object.freeze({
  received: 'voice',
  assigned: 'responsibility',
  'in-review': 'check',
  published: 'receipt',
  resolved: 'receipt',
  closed: 'voice',
});

/** A Croatian reader reads a date as DD.MM.GGGG.; the other two keep DD/MM/YYYY. */
const DATE_SHAPE: Readonly<Record<PilotLang, { separator: string; suffix: string }>> = Object.freeze({
  hr: { separator: '.', suffix: '.' },
  it: { separator: '/', suffix: '' },
  en: { separator: '/', suffix: '' },
});

function formatCaseDate(value: unknown, lang: PilotLang): string {
  if (typeof value !== 'string' || !value) return pilotCopy.common.dateUnavailable[lang];
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  if (Number.isNaN(date.getTime())) return pilotCopy.common.dateUnavailable[lang];
  const pad = (part: number): string => String(part).padStart(2, '0');
  const { separator, suffix } = DATE_SHAPE[lang];
  return `${pad(date.getDate())}${separator}${pad(date.getMonth() + 1)}${separator}${date.getFullYear()}${suffix}`;
}

function daysSince(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  const filed = new Date(value);
  if (Number.isNaN(filed.getTime())) return null;
  const elapsed = Date.now() - filed.getTime();
  return elapsed > 0 ? Math.floor(elapsed / 86_400_000) : 0;
}

/** Croatian counts 1, 21, 31 as "dan" and everything else as "dana". */
function daysPhrase(count: number, lang: PilotLang): string {
  const singular = lang === 'hr' ? count % 10 === 1 && count % 100 !== 11 : count === 1;
  const word = (singular ? publicCaseCopy.shell.daysOne : publicCaseCopy.shell.daysMany)[lang];
  return `${count} ${word}`;
}

/* ---- attention marks kept in this browser -------------------------------- */

const ATTENTION_STORAGE_KEY = 'polis.pilot.attention';

interface AttentionStore {
  followerKey: string;
  marks: Record<string, boolean>;
}

let attentionStore: AttentionStore | null = null;
let attentionPersists = true;

function newFollowerKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function readAttentionStore(): AttentionStore {
  if (attentionStore) return attentionStore;
  let parsed: unknown = null;
  try {
    const raw = localStorage.getItem(ATTENTION_STORAGE_KEY);
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    // Private mode, blocked site data, or an unreadable value: the controls
    // still work, they just cannot remember this browser between visits.
    attentionPersists = false;
    parsed = null;
  }
  const shape = parsed && typeof parsed === 'object' ? (parsed as Partial<AttentionStore>) : null;
  const key = typeof shape?.followerKey === 'string' && /^[0-9a-f]{32}$/.test(shape.followerKey)
    ? shape.followerKey
    : newFollowerKey();
  const marks = shape?.marks && typeof shape.marks === 'object' ? { ...shape.marks } : {};
  // Nothing is written on a plain page view: the key reaches storage only once
  // the reader actually marks a case.
  attentionStore = { followerKey: key, marks };
  return attentionStore;
}

function writeAttentionStore(): void {
  if (!attentionStore || !attentionPersists) return;
  try {
    localStorage.setItem(ATTENTION_STORAGE_KEY, JSON.stringify(attentionStore));
  } catch {
    attentionPersists = false;
  }
}

function markKey(caseNumber: string, kind: string): string {
  return `${caseNumber}:${kind}`;
}

/* ---- the page ------------------------------------------------------------ */

let pageStarted = false;

export function initVrsarPublicCase(): void {
  if (pageStarted) return;
  pageStarted = true;
  const lang = currentPilotLang();
  const state = document.querySelector<HTMLElement>('[data-page-state]');
  const shellRoot = document.querySelector<HTMLElement>('[data-public-case]');
  const retry = document.querySelector<HTMLButtonElement>('[data-retry]');
  const receipt = document.querySelector<HTMLElement>('[data-public-receipt]');
  const pendingText = document.querySelector<HTMLElement>('[data-case-pending-text]');
  const attention = document.querySelector<HTMLElement>('[data-attention]');
  const attentionError = document.querySelector<HTMLElement>('[data-attention-error]');
  const caseNumber = caseNumberFromPath();

  function setText(selector: string, value: string, root: ParentNode = document): void {
    const element = root.querySelector<HTMLElement>(selector);
    if (element) element.textContent = value;
  }

  function renderShellTrace(state_: string): void {
    if (!shellRoot) return;
    const active = ACTIVE_STAGE[state_] ?? 'voice';
    const activeIndex = TRACE_STAGES.indexOf(active as (typeof TRACE_STAGES)[number]);
    shellRoot.querySelectorAll<HTMLElement>('[data-case-trace] [data-stage]').forEach((stage) => {
      const index = TRACE_STAGES.indexOf((stage.dataset.stage ?? '') as (typeof TRACE_STAGES)[number]);
      const reached = state_ === 'resolved' ? index <= activeIndex : index < activeIndex;
      stage.hidden = false;
      stage.dataset.state = reached ? 'appended' : index === activeIndex ? 'active' : 'ahead';
      stage.dataset.proposed = state_ === 'in-review' && stage.dataset.stage === 'check' ? 'true' : 'false';
      const note = stage.querySelector<HTMLElement>('[data-trace-note]');
      if (note) note.textContent = index === activeIndex ? translatedCaseState(state_, lang) : '';
    });
  }

  function renderShell(shell: PublicCaseShell, config: PilotConfig | null): void {
    setText('[data-case-number]', shell.caseNumber);
    const category = config && config.category && entityName(config.category, lang)
      ? entityName(config.category, lang)
      : String(shell.category ?? '');
    setText('[data-case-area]', String(shell.area ?? '') || pilotCopy.common.notAvailable[lang]);
    setText('[data-case-category]', category || pilotCopy.common.notAvailable[lang]);

    const days = daysSince(shell.filedAt);
    const time = [
      days === null ? pilotCopy.common.dateUnavailable[lang] : daysPhrase(days, lang),
      shell.clockDueAt ? `${publicCaseCopy.shell.due[lang]}: ${formatCaseDate(shell.clockDueAt, lang)}` : '',
    ].filter(Boolean);
    setText('[data-case-time]', time.join(' · '));

    const stamp = document.querySelector<HTMLElement>('[data-case-state]');
    if (stamp) {
      stamp.textContent = translatedCaseState(shell.state, lang);
      stamp.dataset.tone = caseStateTone(shell.state);
    }

    const closed = document.querySelector<HTMLElement>('[data-case-closed-reason]');
    if (closed) {
      const reason = typeof shell.closedPublicReason === 'string' ? shell.closedPublicReason.trim() : '';
      closed.textContent = reason;
      closed.hidden = !reason;
    }

    renderShellTrace(String(shell.state ?? ''));
  }

  /**
   * A shell is not a receipt. The approved public text exists only after a
   * reviewer cleared it, so anything short of that renders the waiting note.
   */
  function renderReceipt(record: PublicTraceRecord | null, config: PilotConfig | null): void {
    const approved =
      record !== null &&
      record.testEnvironment === true &&
      (record.status === 'published' || record.status === 'resolved') &&
      typeof record.receiptHash === 'string';

    if (!approved || !receipt) {
      if (receipt) receipt.hidden = true;
      if (pendingText) {
        pendingText.textContent = publicCaseCopy.shell.pendingPublicText[lang];
        pendingText.hidden = false;
      }
      return;
    }
    if (pendingText) {
      pendingText.textContent = '';
      pendingText.hidden = true;
    }

    setText('[data-receipt-id]', record.id, receipt);
    const status = receipt.querySelector<HTMLElement>('.pilot-receipt-header .status-label');
    if (status) {
      status.dataset.status = record.status;
      status.dataset.tone = statusTone(record.status);
      status.textContent = translatedStatus(record.status, lang);
    }
    setText(
      '[data-public-status-note]',
      record.status === 'resolved' ? pilotCopy.receipts.resolved[lang] : pilotCopy.receipts.publishedNotResolved[lang],
      receipt,
    );
    setText('[data-public-office]', entityName(config ? config.office : record.office, lang), receipt);
    setText('[data-public-category]', entityName(config ? config.category : record.category, lang), receipt);
    setText('[data-public-due-date]', formatPilotDate(record.dueDate, lang, true), receipt);
    setText('[data-public-published-at]', formatPilotDate(record.publishedAt, lang), receipt);
    setText('[data-public-hash]', record.receiptHash, receipt);
    setText('[data-public-summary]', record.publicSummary, receipt);
    setText('[data-public-commitment]', record.commitment, receipt);

    const resolvedRow = receipt.querySelector<HTMLElement>('[data-public-resolved-at-row]');
    if (record.status === 'resolved' && record.resolvedAt) {
      setText('[data-public-resolved-at]', formatPilotDate(record.resolvedAt, lang), receipt);
      if (resolvedRow) resolvedRow.hidden = false;
    } else if (resolvedRow) {
      resolvedRow.hidden = true;
    }

    const evidence = receipt.querySelector<HTMLElement>('[data-public-evidence-section]');
    if (record.status === 'resolved') {
      setText('[data-public-evidence-note]', record.evidenceNote ?? '', receipt);
      const links = receipt.querySelector<HTMLElement>('[data-public-evidence-links]');
      const rows = safeStringList(record.evidenceUrls).flatMap((value) => {
        let url: URL;
        try {
          url = new URL(value);
        } catch {
          return [];
        }
        if (url.protocol !== 'https:' || url.username || url.password) return [];
        const item = document.createElement('li');
        const link = createTextElement('a', url.toString());
        link.href = url.toString();
        link.rel = 'noreferrer';
        item.append(link);
        return [item];
      });
      links?.replaceChildren(...rows);
      if (evidence) evidence.hidden = false;
    } else if (evidence) {
      evidence.hidden = true;
    }

    renderReceiptTrace(receipt, record);
    receipt.hidden = false;
  }

  function renderReceiptTrace(root: ParentNode, record: PublicTraceRecord): void {
    const events = Array.isArray(record.events) ? record.events : [];
    const appended = new Set(events.map((event) => String(event?.stage ?? '')));
    root.querySelectorAll<HTMLElement>('[data-trace] [data-stage]').forEach((stage) => {
      const name = stage.dataset.stage ?? '';
      const seen = appended.has(name);
      stage.hidden = !seen;
      stage.dataset.state = seen ? 'appended' : 'ahead';
      stage.dataset.proposed = 'false';
    });
  }

  /* ---- attention --------------------------------------------------------- */

  function renderAttention(shell: PublicCaseShell): void {
    if (!attention) return;
    const store = readAttentionStore();
    const counts: Record<string, number> = {
      follow: Number(shell.followerCount) || 0,
      'also-affected': Number(shell.alsoAffectedCount) || 0,
    };

    attention.querySelectorAll<HTMLElement>('[data-attention-item]').forEach((item) => {
      const kind = item.dataset.attentionItem === 'follow' ? 'follow' : 'also-affected';
      const count = item.querySelector<HTMLElement>('[data-attention-count]');
      if (count) count.textContent = String(counts[kind] ?? 0);

      const button = item.querySelector<HTMLButtonElement>('[data-attention-button]');
      if (!button) return;
      const added = store.marks[markKey(shell.caseNumber, kind)] === true;
      button.textContent = added
        ? publicCaseCopy.attention.withdraw[lang]
        : kind === 'follow'
          ? publicCaseCopy.attention.followAdd[lang]
          : publicCaseCopy.attention.alsoAffectedAdd[lang];
      button.setAttribute('aria-pressed', added ? 'true' : 'false');
      button.disabled = false;
    });
  }

  function bindAttention(shell: PublicCaseShell): void {
    if (!attention) return;
    attention.querySelectorAll<HTMLElement>('[data-attention-item]').forEach((item) => {
      const kind = item.dataset.attentionItem === 'follow' ? 'follow' : 'also-affected';
      const button = item.querySelector<HTMLButtonElement>('[data-attention-button]');
      if (!button || button.dataset.bound === 'true') return;
      button.dataset.bound = 'true';
      button.addEventListener('click', () => {
        void toggleAttention(shell, kind, button);
      });
    });
  }

  async function toggleAttention(
    shell: PublicCaseShell,
    kind: 'follow' | 'also-affected',
    button: HTMLButtonElement,
  ): Promise<void> {
    const store = readAttentionStore();
    const key = markKey(shell.caseNumber, kind);
    const added = store.marks[key] === true;
    button.disabled = true;
    if (attentionError) attentionError.textContent = '';
    try {
      const counts = await recordCaseAttention(shell.caseNumber, {
        followerKey: store.followerKey,
        kind,
        action: added ? 'remove' : 'add',
      });
      if (added) delete store.marks[key];
      else store.marks[key] = true;
      writeAttentionStore();
      shell.followerCount = counts.followerCount;
      shell.alsoAffectedCount = counts.alsoAffectedCount;
      renderAttention(shell);
    } catch (error) {
      if (attentionError) {
        attentionError.textContent = `${publicCaseCopy.attention.failed[lang]} ${apiErrorMessage(error, lang)}`;
      }
      button.disabled = false;
    }
  }

  /* ---- load -------------------------------------------------------------- */

  function showNotFound(): void {
    if (shellRoot) shellRoot.hidden = true;
    if (retry) retry.hidden = true;
    setState(
      state,
      `${publicCaseCopy.shell.notFound[lang]} ${publicCaseCopy.shell.notFoundHint[lang]}`,
      'error',
    );
  }

  async function load(): Promise<void> {
    if (retry) retry.hidden = true;
    setState(state, pilotCopy.common.loading[lang]);
    // An unreadable number is not a different answer from an unknown one.
    if (!caseNumber) {
      showNotFound();
      return;
    }
    try {
      const [result, config] = await Promise.all([
        getPublicCase(caseNumber),
        getPilotConfig().catch(() => null),
      ]);
      const shell = result.case;
      if (!shell || typeof shell.caseNumber !== 'string') throw new Error('invalid_public_case_response');
      renderShell(shell, config);
      renderAttention(shell);
      bindAttention(shell);
      renderReceipt(result.record, config);
      if (shellRoot) shellRoot.hidden = false;
      clearState(state);
      document.title = `${shell.caseNumber} — ${publicCaseCopy.page.heading[lang]} — Polis`;
    } catch (error) {
      if (shellRoot) shellRoot.hidden = true;
      if (error instanceof PilotApiError && (error.status === 404 || error.code === 'case_not_found')) {
        showNotFound();
        return;
      }
      setState(state, apiErrorMessage(error, lang), 'error');
      if (retry) retry.hidden = false;
    }
  }

  retry?.addEventListener('click', () => void load());
  void load();
}

function caseNumberFromPath(): string {
  const parts = location.pathname.split('/').filter(Boolean);
  let raw = parts.at(-1) ?? '';
  try {
    raw = decodeURIComponent(raw);
  } catch {
    return '';
  }
  const value = raw.trim().toUpperCase();
  return isCaseNumber(value) ? value : '';
}
