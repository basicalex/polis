// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  disputeCase,
  eraseText,
  getPilotConfig,
  getPublicCase,
  noticeCase,
  PilotApiError,
  recordCaseAttention,
} from '../../../lib/pilot/vrsar/api';
import {
  ASSESSMENT_HOLD_REASONS,
  entityName,
  safeStringList,
  type AssessmentHoldReason,
  type PilotConfig,
  type PublicCaseShell,
  type PublicDispute,
  type PublicEvent,
  type PublicTraceRecord,
} from '../../../lib/pilot/vrsar/model';
import {
  pilotCopy,
  translatedAction,
  translatedRole,
  type PilotLang,
} from '../../../content/pilot/vrsar';
import {
  caseStateTone,
  confidentialContactLine,
  isCaseNumber,
  publicCaseCopy,
  publicCaseHref,
  translatedCaseState,
  translatedHoldReason,
  translatedRemovedReason,
  translatedTextRemoved,
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

/** At most three disputes ride on one case; the fourth is refused upstream. */
const MAX_DISPUTES = 3;

/**
 * The line of the ledger: four states a case walks in order. Osporeno and
 * Zatvoreno leave that line, so they are not on it.
 */
const MAIN_STATES = ['received', 'assigned', 'answered', 'resolved'] as const;
type MainState = (typeof MAIN_STATES)[number];

/** Where a state stands relative to the case: walked, standing in, or not yet. */
type StatePosition = 'done' | 'active' | 'ahead';

/** What already happened in a state the case has walked. */
const STATE_DONE: Readonly<Record<string, { hr: string; it: string; en: string }>> = Object.freeze({
  received: publicCaseCopy.stageStory.voiceDone,
  assigned: publicCaseCopy.stageStory.responsibilityDone,
  answered: publicCaseCopy.stageStory.responseDone,
  resolved: publicCaseCopy.stageStory.receiptDone,
  disputed: publicCaseCopy.stateStrip.disputedNow,
  closed: publicCaseCopy.stateStrip.closedNow,
});

/** What still has to happen in a state the case has not reached. */
const STATE_NEXT: Readonly<Record<string, { hr: string; it: string; en: string }>> = Object.freeze({
  received: publicCaseCopy.stageStory.voiceNext,
  assigned: publicCaseCopy.stageStory.responsibilityNext,
  answered: publicCaseCopy.stageStory.responseNext,
  resolved: publicCaseCopy.stageStory.receiptNext,
  disputed: publicCaseCopy.stateStrip.disputedNext,
  closed: publicCaseCopy.stateStrip.closedNext,
});

/**
 * Where the case stands in each of the six states. A closed case is the one
 * that left the line early: it is marked closed, it keeps the states it walked,
 * and everything beyond them stays ahead of it, unreached.
 */
/** Closing is allowed from the two states before the office answers, and no later. */
function canStillClose(state: string): boolean {
  return state === 'received' || state === 'assigned';
}

function stripPositions(state: string, assigned: boolean): Record<string, StatePosition> {
  const walked = MAIN_STATES.indexOf(state as MainState);
  const positions: Record<string, StatePosition> = {
    received: 'ahead',
    assigned: 'ahead',
    answered: 'ahead',
    resolved: 'ahead',
    disputed: 'ahead',
    closed: 'ahead',
  };
  if (state === 'closed') {
    positions.received = 'done';
    // Only the assignment is knowable from the shell itself: a unit holds it.
    if (assigned) positions.assigned = 'done';
    positions.closed = 'active';
    return positions;
  }
  // A dispute happens after a completion, so the whole line stands behind it.
  const reached = state === 'disputed' ? MAIN_STATES.length - 1 : walked;
  for (const [index, name] of MAIN_STATES.entries()) {
    if (index < reached) positions[name] = 'done';
    else if (index === reached) positions[name] = state === 'disputed' ? 'done' : 'active';
  }
  if (state === 'disputed') positions.disputed = 'active';
  return positions;
}

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

/**
 * The key the filer carries in the fragment of their own link. A fragment is
 * never part of a request, so it is read here and kept in memory only: nothing
 * writes it to storage, to a query, or to the address bar.
 */
function reopenKeyFromFragment(): string {
  const fragment = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
  if (!fragment) return '';
  const value = new URLSearchParams(fragment).get('k') ?? '';
  return value.length <= 256 ? value : '';
}

/* ---- attention marks kept in this browser -------------------------------- */

const ATTENTION_STORAGE_KEY = 'polis.pilot.attention';
type AttentionKind = 'follow' | 'also-affected' | 'not-fixed';
const ATTENTION_KINDS: readonly AttentionKind[] = ['follow', 'also-affected', 'not-fixed'];

function attentionKind(value: unknown): AttentionKind {
  return ATTENTION_KINDS.includes(value as AttentionKind) ? (value as AttentionKind) : 'also-affected';
}

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
  const verification = document.querySelector<HTMLElement>('[data-public-verification]');
  const pending = document.querySelector<HTMLElement>('[data-case-pending]');
  const pendingText = document.querySelector<HTMLElement>('[data-case-pending-text]');
  const checkSection = document.querySelector<HTMLElement>('[data-case-check]');
  const attention = document.querySelector<HTMLElement>('[data-attention]');
  const attentionError = document.querySelector<HTMLElement>('[data-attention-error]');
  const caseNumber = caseNumberFromPath();
  // The filer is whoever arrived on their own link. The key stays in memory.
  const reopenKey = reopenKeyFromFragment();
  const isFiler = reopenKey !== '';
  /** The date the office released a redacted text, read off the public trail. */
  let releasedAtFromEvents = '';
  /** The pilot config of the last load, for the renders an action triggers. */
  let loadedConfig: PilotConfig | null = null;

  function setText(selector: string, value: string, root: ParentNode = document): void {
    const element = root.querySelector<HTMLElement>(selector);
    if (element) element.textContent = value;
  }

  function show(element: Element | null, visible: boolean): void {
    if (element instanceof HTMLElement) element.hidden = !visible;
  }

  /**
   * One plain sentence per state — the ledger calls these six the stages of the
   * process — saying what happened there, or what would happen if the case
   * reached it. The state right after the one the case stands in says so,
   * because that is the only thing a reader can wait for.
   */
  function stageSentence(
    name: string,
    position: StatePosition,
    caseState: string,
    isNext: boolean,
  ): string {
    const story = publicCaseCopy.stageStory;
    if (position === 'done') {
      if (name === 'resolved' && caseState === 'disputed') return story.receiptDone[lang];
      return STATE_DONE[name]?.[lang] ?? '';
    }
    if (position === 'active') {
      if (name === 'resolved') return story.receiptResolved[lang];
      return STATE_DONE[name]?.[lang] ?? '';
    }
    // A closed case says once that it stopped, not once per state it never reached.
    if (caseState === 'closed') return isNext ? story.closedAhead[lang] : '';
    // Closing is an early exit: once the office has answered it is off the table.
    if (name === 'closed' && !canStillClose(caseState)) return '';
    const ahead = STATE_NEXT[name]?.[lang] ?? '';
    if (!ahead) return '';
    if (isNext) return `${story.nextPrefix[lang]}: ${ahead}`;
    return ahead.charAt(0).toLocaleUpperCase(lang) + ahead.slice(1);
  }

  /**
   * The six states of the ledger, in the ledger's own words, with the stamp on
   * the one the case stands in.
   */
  function renderStateStrip(shell: PublicCaseShell): void {
    if (!shellRoot) return;
    const caseState = String(shell.state ?? '');
    const positions = stripPositions(caseState, Boolean(shell.unitId));
    // The next state is the first one the case has not walked; at the end of the
    // line the only thing still open is the dispute.
    const next = MAIN_STATES.find((name) => positions[name] === 'ahead')
      ?? (caseState === 'resolved' ? 'disputed' : undefined);
    shellRoot.querySelectorAll<HTMLElement>('[data-state-strip] [data-state-step]').forEach((step) => {
      const name = step.dataset.stateStep ?? '';
      const position = positions[name] ?? 'ahead';
      step.dataset.state = position === 'done' ? 'appended' : position;
      const here = step.querySelector<HTMLElement>('[data-state-here]');
      if (here) {
        here.textContent = position === 'active' ? translatedCaseState(caseState, lang) : '';
        here.hidden = position !== 'active';
        here.dataset.tone = caseStateTone(caseState);
      }
      const note = step.querySelector<HTMLElement>('[data-state-note]');
      if (note) note.textContent = stageSentence(name, position, caseState, name === next);
    });
  }

  /**
   * The report as it was filed, or the notice that says why it is not on the
   * page. Either way the hash of the original text is published, so a held text
   * can still be checked against a copy once it is released.
   */
  function renderText(shell: PublicCaseShell): void {
    const status = typeof shell.textStatus === 'string' ? shell.textStatus : 'public';
    const body = typeof shell.text === 'string' ? shell.text.trim() : '';
    // A removed text is not a held one: the office has nothing left to decide.
    const gone = status === 'removed';
    const held = !gone && (status === 'held' || !body);

    const narrative = document.querySelector<HTMLElement>('[data-case-narrative]');
    if (narrative) {
      narrative.textContent = held || gone ? '' : body;
      narrative.hidden = held || gone;
    }

    const hold = document.querySelector<HTMLElement>('[data-case-hold]');
    show(hold, held);
    if (held) {
      setText('[data-case-hold-reason]', translatedHoldReason(shell.holdReason, lang));
      renderConfidential(shell.holdReason);
    }

    const removed = document.querySelector<HTMLElement>('[data-case-removed]');
    show(removed, gone);
    if (gone) setText('[data-case-removed-reason]', translatedRemovedReason(shell.removedReason, lang));

    renderTextControls(held, gone);

    const stamp = document.querySelector<HTMLElement>('[data-text-state]');
    if (stamp) {
      const word = publicCaseCopy.textState[held ? 'held' : status === 'redacted' ? 'redacted' : '']?.[lang] ?? '';
      stamp.textContent = word;
      stamp.hidden = !word;
    }

    const redacted = document.querySelector<HTMLElement>('[data-case-redacted]');
    if (redacted) {
      const releasedAt = releasedAtFromEvents;
      redacted.textContent =
        status === 'redacted'
          ? [publicCaseCopy.text.redacted[lang], releasedAt ? `${publicCaseCopy.text.redactedOn[lang]}: ${releasedAt}` : '']
              .filter(Boolean)
              .join(' ')
          : '';
      redacted.hidden = status !== 'redacted';
    }

    show(document.querySelector('[data-case-as-filed]'), !held && !gone && status !== 'redacted');

    const location_ = typeof shell.location === 'string' ? shell.location.trim() : '';
    setText(
      '[data-case-location]',
      held || gone || !location_ ? publicCaseCopy.text.locationMissing[lang] : location_,
    );

    renderLabel(shell);
  }

  /**
   * A text held as confidential goes to one named person, so the page names
   * them. The contact is the municipality's, written onto the shell root at
   * build time; without it the line simply stays away.
   */
  function renderConfidential(reason: unknown): void {
    const line = document.querySelector<HTMLElement>('[data-case-confidential]');
    if (!line) return;
    const data = shellRoot?.dataset;
    const name = data?.confidentialName ?? '';
    const email = data?.confidentialEmail ?? '';
    const phone = data?.confidentialPhone ?? '';
    const named = reason === 'confidential' && Boolean(name && email && phone);
    line.textContent = named ? confidentialContactLine({ name, email, phone }, lang) : '';
    line.hidden = !named;
  }

  /**
   * The two controls on the text. Anyone may report a text that stands; only
   * the filer may take their own off the record, and only while it is there.
   */
  function renderTextControls(held: boolean, gone: boolean): void {
    const notice = document.querySelector<HTMLElement>('[data-case-notice]');
    if (notice) {
      // Nothing to report about a text nobody can read.
      notice.hidden = held || gone;
      if (notice.hidden && notice instanceof HTMLDetailsElement) notice.open = false;
    }

    const erase = document.querySelector<HTMLElement>('[data-case-erase]');
    if (!erase) return;
    erase.hidden = !isFiler;
    show(erase.querySelector('[data-erase-open]'), !gone);
    if (gone) {
      show(erase.querySelector('[data-erase-confirm]'), false);
      setText('[data-erase-state]', publicCaseCopy.erase.done[lang], erase);
    } else {
      setText('[data-erase-state]', '', erase);
    }
  }

  /**
   * One soft label, one explanation, and — for the filer — a short form that
   * sends the office a private objection. The label blocks nothing either way.
   */
  function renderLabel(shell: PublicCaseShell): void {
    const box = document.querySelector<HTMLElement>('[data-case-label]');
    if (!box) return;
    const labels = safeStringList(shell.labels);
    const labelled = labels.includes('form-letter');
    box.hidden = !labelled;
    const form = box.querySelector<HTMLFormElement>('[data-label-appeal]');
    if (form) form.hidden = !labelled || !isFiler;
  }

  function renderShell(shell: PublicCaseShell, config: PilotConfig | null): void {
    setText('[data-case-number]', shell.caseNumber);
    const category = config && config.category && entityName(config.category, lang)
      ? entityName(config.category, lang)
      : String(shell.category ?? '');
    const area =
      config && config.municipality && shell.area === config.municipality.id
        ? entityName(config.municipality, lang)
        : String(shell.area ?? '');
    setText('[data-case-area]', area || pilotCopy.common.notAvailable[lang]);
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

    renderText(shell);
    renderStateStrip(shell);
  }

  /**
   * The office's answer. It exists from the moment the responsible official
   * published it, under their own name: there is nothing else to wait for.
   */
  function renderAnswer(
    shell: PublicCaseShell,
    record: PublicTraceRecord | null,
    config: PilotConfig | null,
  ): void {
    const answered =
      record !== null &&
      record.testEnvironment === true &&
      (record.status === 'answered' || record.status === 'resolved' || record.status === 'disputed') &&
      typeof record.receiptHash === 'string';

    renderNoContact(shell, record);

    if (!answered || !receipt) {
      if (receipt) receipt.hidden = true;
      renderCheck(shell, null);
      showPending(String(shell.state ?? ''));
      // The text hash is public from filing, so the verification block is too.
      renderVerification(shell, null);
      return;
    }
    if (pending) pending.hidden = true;
    if (pendingText) pendingText.textContent = '';

    setText('[data-receipt-id]', record.id, verification ?? receipt);
    const stamp = receipt.querySelector<HTMLElement>('[data-public-state]');
    if (stamp) {
      stamp.dataset.status = record.status;
      stamp.dataset.tone = caseStateTone(record.status);
      stamp.textContent = translatedCaseState(record.status, lang);
    }
    setText('[data-public-office]', entityName(config ? config.office : record.office, lang), receipt);

    // The section of the office that holds the case, where the record names one.
    const unitRow = receipt.querySelector<HTMLElement>('[data-public-unit-row]');
    const unitName = record.unit ? entityName(record.unit, lang) : '';
    if (unitRow) unitRow.hidden = !unitName;
    if (unitName) setText('[data-public-unit]', unitName, receipt);

    setText('[data-public-signed-by]', signature(record), receipt);
    setText('[data-public-due-date]', formatPilotDate(record.dueDate, lang, true), receipt);
    setText('[data-public-published-at]', formatPilotDate(record.publishedAt, lang), receipt);
    setText('[data-public-commitment]', record.commitment, receipt);

    const resolvedRow = receipt.querySelector<HTMLElement>('[data-public-resolved-at-row]');
    if (record.resolvedAt) {
      setText('[data-public-resolved-at]', formatPilotDate(record.resolvedAt, lang), receipt);
      if (resolvedRow) resolvedRow.hidden = false;
    } else if (resolvedRow) {
      resolvedRow.hidden = true;
    }

    const evidence = receipt.querySelector<HTMLElement>('[data-public-evidence-section]');
    if (record.status === 'resolved' || record.status === 'disputed') {
      setText('[data-public-evidence-note]', record.evidenceNote ?? '', receipt);
      const links = receipt.querySelector<HTMLElement>('[data-public-evidence-links]');
      links?.replaceChildren(...evidenceRows(record.evidenceUrls));
      if (evidence) evidence.hidden = false;
    } else if (evidence) {
      evidence.hidden = true;
    }

    receipt.hidden = false;
    renderCheck(shell, record);
    showPending(String(shell.state ?? ''));
    renderVerification(shell, record);
  }

  /**
   * A report filed on the web carries no phone number and no address, so the
   * office has nowhere to send anything. The page says so rather than leaving a
   * filer waiting for a message that will never come (contract I).
   */
  function renderNoContact(shell: PublicCaseShell, record: PublicTraceRecord | null): void {
    const line = document.querySelector<HTMLElement>('[data-web-no-contact]');
    if (!line) return;
    const origin = typeof shell.origin === 'string' ? shell.origin : record?.origin;
    line.hidden = origin !== 'web';
  }

  /** Only https links, and only the ones the browser can parse. */
  function evidenceRows(urls: unknown): HTMLLIElement[] {
    return safeStringList(urls).flatMap((value) => {
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
  }

  function signature(record: PublicTraceRecord): string {
    const name = typeof record.signedBy?.name === 'string' ? record.signedBy.name.trim() : '';
    const title = typeof record.signedBy?.title === 'string' ? record.signedBy.title.trim() : '';
    if (!name) return pilotCopy.common.notAvailable[lang];
    return title ? `${name}, ${title}` : name;
  }

  /**
   * The public half of the completion check: how many people say it is not
   * fixed, what the disputes say, and — for the filer — the form that files one.
   */
  function renderCheck(shell: PublicCaseShell, record: PublicTraceRecord | null): void {
    if (!checkSection) return;
    const state_ = String(shell.state ?? '');
    const open = state_ === 'resolved' || state_ === 'disputed';
    checkSection.hidden = !open;
    if (!open) return;

    setText('[data-not-fixed-count]', String(Number(shell.notFixedCount) || 0), checkSection);

    const disputes = Array.isArray(record?.disputes) ? (record?.disputes as PublicDispute[]) : [];
    const box = checkSection.querySelector<HTMLElement>('[data-case-disputes]');
    const list = checkSection.querySelector<HTMLElement>('[data-dispute-list]');
    if (list) list.replaceChildren(...disputes.map((dispute) => disputeRow(dispute)));
    show(box, disputes.length > 0);

    const form = checkSection.querySelector<HTMLFormElement>('[data-dispute-form]');
    if (!form) return;
    const used = Number(shell.disputeCount) || disputes.length;
    const allowed = isFiler && state_ === 'resolved';
    form.hidden = !allowed;
    const submit = form.querySelector<HTMLButtonElement>('[data-dispute-submit]');
    const field = form.querySelector<HTMLTextAreaElement>('[data-dispute-text]');
    if (used >= MAX_DISPUTES) {
      if (submit) submit.disabled = true;
      if (field) field.disabled = true;
      setText('[data-dispute-state]', publicCaseCopy.check.disputeLimit[lang], form);
    } else if (submit) {
      submit.disabled = false;
      if (field) field.disabled = false;
    }
  }

  /** One dispute, as written, or the notice that its text is held. */
  function disputeRow(dispute: PublicDispute): HTMLLIElement {
    const item = document.createElement('li');
    item.className = 'pilot-dispute-item';
    const held = dispute?.textStatus === 'held' || typeof dispute?.text !== 'string';
    const body = createTextElement(
      'p',
      held ? publicCaseCopy.check.disputeHeld[lang] : String(dispute.text),
      'pilot-dispute-text',
    );
    item.append(body, createTextElement('span', formatPilotDate(dispute?.createdAt, lang), 'pilot-dispute-date'));
    return item;
  }

  function pendingKey(state_: string): keyof typeof publicCaseCopy.pending {
    const copy = publicCaseCopy.pending;
    return state_ in copy && state_ !== 'heading'
      ? (state_ as keyof typeof copy)
      : 'fallback';
  }

  /** What the case waits for, said in the words of the state it stands in. */
  function showPending(state_: string): void {
    if (!pendingText) return;
    pendingText.textContent = publicCaseCopy.pending[pendingKey(state_)][lang];
    if (pending) pending.hidden = false;
  }

  /**
   * The verification block: the hash of the text as filed, every public event
   * with its own fingerprint and the fingerprint before it, the head of the
   * chain, and the receipt hash that covers it. The text hash is public from
   * filing, so the block stands even before the office answers.
   */
  function renderVerification(shell: PublicCaseShell, record: PublicTraceRecord | null): void {
    if (!verification) return;

    const textHash = typeof shell.textSha256 === 'string' && shell.textSha256
      ? shell.textSha256
      : typeof record?.textSha256 === 'string'
        ? record.textSha256
        : '';
    setText('[data-case-text-hash]', textHash, verification);
    const legacyKind = shell.textHashKind ?? record?.textHashKind;
    show(verification.querySelector('[data-case-text-hash-legacy]'), legacyKind === 'normalized-legacy');

    const events = Array.isArray(record?.events) ? (record?.events as PublicEvent[]) : [];
    const list = verification.querySelector<HTMLElement>('[data-public-events]');
    if (list) list.replaceChildren(...events.map((event) => publicEventRow(event)));
    show(verification.querySelector('[data-public-events-empty]'), events.length === 0);

    const lastEventHash = typeof record?.lastEventHash === 'string' && record.lastEventHash
      ? record.lastEventHash
      : typeof events.at(-1)?.hash === 'string'
        ? String(events.at(-1)?.hash)
        : '';
    show(verification.querySelector('[data-last-event-hash-row]'), Boolean(lastEventHash));
    if (lastEventHash) setText('[data-last-event-hash]', lastEventHash, verification);

    const receiptId = typeof record?.id === 'string' ? record.id : '';
    show(verification.querySelector('[data-receipt-id-row]'), Boolean(receiptId));
    if (receiptId) setText('[data-receipt-id]', receiptId, verification);

    const receiptHash = typeof record?.receiptHash === 'string' ? record.receiptHash : '';
    show(verification.querySelector('[data-receipt-hash-row]'), Boolean(receiptHash));
    if (receiptHash) setText('[data-public-hash]', receiptHash, verification);

    verification.hidden = false;
  }

  /** The first twelve hex characters name a hash; the whole hash stays reachable. */
  function shortHash(value: string): string {
    return value.length > 12 ? `${value.slice(0, 12)}…` : value;
  }

  function hashRow(term: string, value: string): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'pilot-verify-hash';
    const dd = createTextElement('dd', value);
    dd.title = value;
    row.append(createTextElement('dt', term), dd);
    return row;
  }

  /**
   * One public event: when it happened, who wrote it, what it says, and the two
   * fingerprints that place it in the chain. A removal is an event of its own,
   * and the assignment and the commitment name the unit and the signer.
   */
  function publicEventRow(event: PublicEvent): HTMLLIElement {
    const copy = publicCaseCopy.verification;
    const item = document.createElement('li');
    item.className = 'pilot-verify-event';
    item.dataset.action = String(event?.action ?? '');
    item.append(
      createTextElement('p', translatedAction(event?.action, lang), 'pilot-verify-action'),
      createTextElement(
        'p',
        [formatPilotDate(event?.createdAt, lang), translatedRole(event?.actorRole, lang)]
          .filter(Boolean)
          .join(' · '),
        'pilot-verify-meta',
      ),
    );

    const detail = eventDetail(event);
    if (detail) item.append(createTextElement('p', detail, 'pilot-verify-meta'));

    const hash = typeof event?.hash === 'string' ? event.hash : '';
    const previous = typeof event?.previousHash === 'string' ? event.previousHash : '';
    if (hash) {
      const box = document.createElement('details');
      box.className = 'pilot-verify-hashes';
      const summary = createTextElement('summary', `${shortHash(hash)} · ${copy.hashOpen[lang]}`);
      const rows = document.createElement('dl');
      rows.append(hashRow(copy.eventHash[lang], hash));
      rows.append(
        previous
          ? hashRow(copy.previousHash[lang], previous)
          : hashRow(copy.previousHash[lang], copy.chainStart[lang]),
      );
      box.append(summary, rows);
      item.append(box);
    }
    return item;
  }

  /** What a milestone carries beyond its name: the unit, the signer, the reason. */
  function eventDetail(event: PublicEvent): string {
    const record = event as unknown as Record<string, unknown>;
    if (event?.action === 'office-assigned' && event.unit) {
      return `${publicCaseCopy.answer.unit[lang]}: ${entityName(event.unit, lang)}`;
    }
    if (event?.action === 'commitment-published') {
      const signedBy = event.signedBy;
      const name = typeof signedBy === 'string' ? signedBy : signedBy?.name ?? '';
      const title = typeof signedBy === 'string' ? '' : signedBy?.title ?? '';
      const signature_ = [name, title].filter(Boolean).join(', ');
      return signature_ ? `${publicCaseCopy.answer.signedBy[lang]}: ${signature_}` : '';
    }
    if (event?.action === 'text-removed') {
      return translatedTextRemoved(String(record.reason ?? ''), lang);
    }
    if (event?.action === 'case-closed') {
      const reason = typeof record.publicReason === 'string' ? record.publicReason.trim() : '';
      return reason;
    }
    return '';
  }

  /**
   * One fact the text block reads off the public trail: the date the office
   * released a redacted text. The removal itself is a public event and says so
   * in the verification block.
   */
  function readReleaseDate(record: PublicTraceRecord | null): void {
    releasedAtFromEvents = '';
    const events = Array.isArray(record?.events) ? record?.events ?? [] : [];
    for (const event of events) {
      if (event?.action === 'text-released') releasedAtFromEvents = formatPilotDate(event.createdAt, lang);
    }
  }

  /* ---- attention --------------------------------------------------------- */

  function renderAttention(shell: PublicCaseShell): void {
    if (!attention) return;
    const store = readAttentionStore();
    const state_ = String(shell.state ?? '');
    const checkable = state_ === 'resolved' || state_ === 'disputed';
    const counts: Record<AttentionKind, number> = {
      follow: Number(shell.followerCount) || 0,
      'also-affected': Number(shell.alsoAffectedCount) || 0,
      'not-fixed': Number(shell.notFixedCount) || 0,
    };
    const add: Record<AttentionKind, string> = {
      follow: publicCaseCopy.attention.followAdd[lang],
      'also-affected': publicCaseCopy.attention.alsoAffectedAdd[lang],
      'not-fixed': publicCaseCopy.attention.notFixedAdd[lang],
    };

    attention.querySelectorAll<HTMLElement>('[data-attention-item]').forEach((item) => {
      const kind = attentionKind(item.dataset.attentionItem);
      // "Not fixed" is a claim about a completion, so it exists only once one does.
      if (kind === 'not-fixed') item.hidden = !checkable;
      const count = item.querySelector<HTMLElement>('[data-attention-count]');
      if (count) count.textContent = String(counts[kind]);

      const button = item.querySelector<HTMLButtonElement>('[data-attention-button]');
      if (!button) return;
      const added = store.marks[markKey(shell.caseNumber, kind)] === true;
      button.textContent = added ? publicCaseCopy.attention.withdraw[lang] : add[kind];
      button.setAttribute('aria-pressed', added ? 'true' : 'false');
      button.disabled = false;
    });
    show(attention.querySelector('[data-not-fixed-note]'), checkable);
  }

  function bindAttention(shell: PublicCaseShell): void {
    if (!attention) return;
    attention.querySelectorAll<HTMLElement>('[data-attention-item]').forEach((item) => {
      const kind = attentionKind(item.dataset.attentionItem);
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
    kind: AttentionKind,
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
      shell.notFixedCount = counts.notFixedCount;
      renderAttention(shell);
      if (checkSection && !checkSection.hidden) {
        setText('[data-not-fixed-count]', String(counts.notFixedCount), checkSection);
      }
    } catch (error) {
      if (attentionError) {
        attentionError.textContent = `${publicCaseCopy.attention.failed[lang]} ${apiErrorMessage(error, lang)}`;
      }
      button.disabled = false;
    }
  }

  /* ---- the filer's two actions ------------------------------------------- */

  /**
   * The dispute is public text on a public case, so it goes through the same
   * public route the page reads from, carrying the key the filer already holds.
   */
  function bindDispute(config: PilotConfig | null): void {
    const form = checkSection?.querySelector<HTMLFormElement>('[data-dispute-form]');
    if (!form || form.dataset.bound === 'true') return;
    form.dataset.bound = 'true';
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const field = form.querySelector<HTMLTextAreaElement>('[data-dispute-text]');
      const body = field?.value.trim() ?? '';
      if (!body) {
        setText('[data-dispute-state]', publicCaseCopy.check.disputeRequired[lang], form);
        field?.focus();
        return;
      }
      const submit = form.querySelector<HTMLButtonElement>('[data-dispute-submit]');
      if (submit) submit.disabled = true;
      setText('[data-dispute-state]', pilotCopy.common.loading[lang], form);
      void disputeCase(caseNumber, { reopenKey, text: body })
        .then((result) => {
          if (field) field.value = '';
          setText('[data-dispute-state]', publicCaseCopy.check.disputeSent[lang], form);
          readReleaseDate(result.record);
          renderShell(result.case, config);
          renderAttention(result.case);
          renderAnswer(result.case, result.record, config);
        })
        .catch((error) => {
          const message =
            error instanceof PilotApiError && error.code === 'dispute_limit'
              ? publicCaseCopy.check.disputeLimit[lang]
              : `${publicCaseCopy.check.disputeFailed[lang]} ${apiErrorMessage(error, lang)}`;
          setText('[data-dispute-state]', message, form);
          if (submit) submit.disabled = false;
        });
    });
  }

  /**
   * A reader's report about the text. It carries the same follower key the
   * attention marks use, so a second report by the same browser changes
   * nothing; the mark kept here only tells this browser it already sent one.
   * The server owns the dedup, the limit and the count, and the count is never
   * drawn on this page.
   */
  function bindNotice(shell: PublicCaseShell): void {
    const form = document.querySelector<HTMLFormElement>('[data-notice-form]');
    if (!form) return;
    const store = readAttentionStore();
    const key = markKey(shell.caseNumber, 'notice');
    const submit = form.querySelector<HTMLButtonElement>('[data-notice-submit]');
    if (store.marks[key] === true) {
      setText('[data-notice-state]', publicCaseCopy.notice.already[lang], form);
      if (submit) submit.disabled = true;
    }
    if (form.dataset.bound === 'true') return;
    form.dataset.bound = 'true';
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const select = form.querySelector<HTMLSelectElement>('[data-notice-reason]');
      const field = form.querySelector<HTMLTextAreaElement>('[data-notice-note]');
      const note = field?.value.trim() ?? '';
      const button = form.querySelector<HTMLButtonElement>('[data-notice-submit]');
      if (button) button.disabled = true;
      setText('[data-notice-state]', pilotCopy.common.loading[lang], form);
      void noticeCase(caseNumber, {
        followerKey: store.followerKey,
        reason: noticeReason(select?.value),
        ...(note ? { note } : {}),
      })
        .then((result) => {
          store.marks[key] = true;
          writeAttentionStore();
          if (field) field.value = '';
          setText('[data-notice-state]', publicCaseCopy.notice.sent[lang], form);
          // The third report holds the text, so the block is drawn again.
          renderShell(result.case, loadedConfig);
        })
        .catch((error) => {
          setText(
            '[data-notice-state]',
            `${publicCaseCopy.notice.failed[lang]} ${apiErrorMessage(error, lang)}`,
            form,
          );
          if (button) button.disabled = false;
        });
    });
  }

  /** Only a reason a reader may name; the other four belong to the system. */
  function noticeReason(value: unknown): AssessmentHoldReason {
    return ASSESSMENT_HOLD_REASONS.includes(value as AssessmentHoldReason)
      ? (value as AssessmentHoldReason)
      : 'other';
  }

  /**
   * The filer takes their own text off the public record. It asks twice, never
   * once, and the second tap is the one that removes it. The case, its number
   * and the hash of the original text stay where they were.
   */
  function bindErase(shell: PublicCaseShell, config: PilotConfig | null): void {
    const box = document.querySelector<HTMLElement>('[data-case-erase]');
    if (!box || !isFiler || box.dataset.bound === 'true') return;
    box.dataset.bound = 'true';
    const open = box.querySelector<HTMLButtonElement>('[data-erase-open]');
    const panel = box.querySelector<HTMLElement>('[data-erase-confirm]');
    const go = box.querySelector<HTMLButtonElement>('[data-erase-go]');
    const cancel = box.querySelector<HTMLButtonElement>('[data-erase-cancel]');

    open?.addEventListener('click', () => {
      show(panel, true);
      open.hidden = true;
      go?.focus();
    });

    cancel?.addEventListener('click', () => {
      show(panel, false);
      if (open) open.hidden = false;
      open?.focus();
    });

    go?.addEventListener('click', () => {
      go.disabled = true;
      setText('[data-erase-state]', pilotCopy.common.loading[lang], box);
      void eraseText(shell.caseNumber, { reopenKey })
        .then((result) => {
          setText('[data-erase-state]', publicCaseCopy.erase.done[lang], box);
          renderShell(result.case, config);
          renderAttention(result.case);
        })
        .catch((error) => {
          setText(
            '[data-erase-state]',
            `${publicCaseCopy.erase.failed[lang]} ${apiErrorMessage(error, lang)}`,
            box,
          );
          go.disabled = false;
        });
    });
  }

  /**
   * The label appeal is a private message to the office, not public text, so it
   * goes to the case-message route with the same key and nothing else.
   */
  function bindLabelAppeal(): void {
    const form = document.querySelector<HTMLFormElement>('[data-label-appeal]');
    if (!form || form.dataset.bound === 'true') return;
    form.dataset.bound = 'true';
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const field = form.querySelector<HTMLTextAreaElement>('[data-appeal-text]');
      const body = field?.value.trim() ?? '';
      if (!body) {
        field?.focus();
        return;
      }
      const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (submit) submit.disabled = true;
      setText('[data-appeal-state]', pilotCopy.common.loading[lang], form);
      void sendLabelAppeal(caseNumber, body)
        .then(() => {
          if (field) field.value = '';
          setText('[data-appeal-state]', publicCaseCopy.label.appealSent[lang], form);
        })
        .catch(() => {
          setText('[data-appeal-state]', publicCaseCopy.label.appealFailed[lang], form);
          if (submit) submit.disabled = false;
        });
    });
  }

  /**
   * One message on the case, by the key its filer holds. The BFF owns the route
   * and the backend owns the wording of the refusal; this only posts the shape
   * the case-message route takes.
   */
  async function sendLabelAppeal(number: string, body: string): Promise<void> {
    const response = await fetch(`/pilot/vrsar/api/cases/${encodeURIComponent(number)}/messages`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify({ reopenKey, kind: 'label-appeal', body }),
    });
    if (!response.ok) throw new Error('label_appeal_failed');
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
      loadedConfig = config;
      readReleaseDate(result.record);
      renderShell(shell, config);
      renderAttention(shell);
      bindAttention(shell);
      renderAnswer(shell, result.record, config);
      bindDispute(config);
      bindNotice(shell);
      bindErase(shell, config);
      bindLabelAppeal();
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
