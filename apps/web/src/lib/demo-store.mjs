/**
 * Client-side demo store for the `/demo/*` role surfaces.
 *
 * All state lives in the visitor's browser: `localStorage` under `polis-demo-v1`, with an
 * in-memory fallback when storage is unavailable or refuses a write. No network write exists.
 * The module is safe to import in Node (tests): every `window` and `localStorage` access is
 * guarded, and without a browser the store simply keeps state in memory.
 *
 * The meaning model is enforced here, not only in the UI. There is no exported way for an
 * official to publish a record or set a terminal status: `published` is reachable only through
 * `reviewCommitment` with an accepted decision, and the reviewer is a distinct actor.
 *
 * @typedef {import('../content/demo-fixtures.mjs').DemoRecord} DemoRecord
 * @typedef {import('../content/demo-fixtures.mjs').DemoEvent} DemoEvent
 * @typedef {import('../content/demo-strings.mjs').DemoLang} DemoLang
 * @typedef {import('../content/demo-strings.mjs').DisplayText} DisplayText
 *
 * @typedef {object} DemoState
 * @property {number} version
 * @property {DemoLang} lang
 * @property {DemoRecord[]} records
 */

import { seedLang, seedRecords } from '../content/demo-fixtures.mjs';
import {
  DEMO_CATEGORIES,
  DEMO_LANGS,
  demoActors,
  demoEventActions,
} from '../content/demo-strings.mjs';

export { DEMO_CATEGORIES, DEMO_LANGS };

/** localStorage key. Bumping the suffix retires older demo state. */
export const STORAGE_KEY = 'polis-demo-v1';

/** State shape version stored alongside the records. */
export const DEMO_STATE_VERSION = 1;

/** Trace stages, in order. */
export const DEMO_STAGES = Object.freeze([
  'voice',
  'responsibility',
  'response',
  'check',
  'receipt',
]);

/** Workflow statuses a demo record can hold. */
export const DEMO_STATUSES = Object.freeze([
  'open',
  'assigned',
  'commitment-pending-review',
  'returned',
  'published',
]);

/** Where a record came from. Only the seed uses `seed`. */
export const DEMO_ORIGINS = Object.freeze(['seed', 'app', 'embed']);

const ID_PREFIX = 'POLIS-D-';
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** @type {DemoState | null} */
let state = null;
/** @type {Readonly<DemoState> | null} */
let snapshot = null;
/** @type {Set<(state: Readonly<DemoState>) => void>} */
const listeners = new Set();
let storageBound = false;

/* -------------------------------------------------------------------------- */
/* plumbing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

/**
 * The browser's localStorage, or `null` outside a browser and wherever storage is blocked.
 * Reading the property itself can throw in a locked-down browser, so it stays inside try/catch.
 *
 * @returns {Storage | null}
 */
function storage() {
  try {
    if (typeof window === 'undefined') return null;
    const candidate = window.localStorage;
    if (!candidate || typeof candidate.getItem !== 'function') return null;
    return candidate;
  } catch {
    return null;
  }
}

/** @returns {DemoState} */
function seedState() {
  return {
    version: DEMO_STATE_VERSION,
    lang: DEMO_LANGS.includes(seedLang) ? seedLang : 'en',
    records: clone(/** @type {DemoRecord[]} */ (seedRecords)),
  };
}

/**
 * Accept only state this build understands. Anything else falls back to the seed.
 *
 * @param {unknown} raw
 * @returns {DemoState | null}
 */
function normalizeState(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = /** @type {Record<string, unknown>} */ (raw);
  if (candidate.version !== DEMO_STATE_VERSION) return null;
  if (!Array.isArray(candidate.records)) return null;
  const lang = DEMO_LANGS.includes(/** @type {DemoLang} */ (candidate.lang))
    ? /** @type {DemoLang} */ (candidate.lang)
    : 'en';

  for (const record of candidate.records) {
    if (!record || typeof record !== 'object') return null;
    const entry = /** @type {Record<string, unknown>} */ (record);
    if (typeof entry.id !== 'string' || entry.id.length === 0) return null;
    if (!DEMO_ORIGINS.includes(/** @type {string} */ (entry.origin))) return null;
    if (!DEMO_STAGES.includes(/** @type {string} */ (entry.stage))) return null;
    if (!DEMO_STATUSES.includes(/** @type {string} */ (entry.status))) return null;
    if (!Array.isArray(entry.events)) return null;
  }

  return {
    version: DEMO_STATE_VERSION,
    lang,
    records: /** @type {DemoRecord[]} */ (candidate.records),
  };
}

/** @returns {DemoState | null} */
function readStoredState() {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeState(JSON.parse(raw));
  } catch {
    return null;
  }
}

function persist() {
  const store = storage();
  if (!store || !state) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage full, disabled, or private: the in-memory state stays authoritative */
  }
}

function notify() {
  const current = getState();
  for (const listener of [...listeners]) {
    try {
      listener(current);
    } catch {
      /* a broken subscriber must not stop the others */
    }
  }
}

function bindStorageEvents() {
  if (storageBound) return;
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  storageBound = true;
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    state = readStoredState() ?? seedState();
    snapshot = null;
    notify();
  });
}

/** @returns {DemoState} */
function ensureState() {
  if (!state) {
    state = readStoredState() ?? seedState();
    bindStorageEvents();
  }
  return state;
}

function commit() {
  snapshot = null;
  persist();
  notify();
}

/* -------------------------------------------------------------------------- */
/* validation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Accept a plain string (what a visitor typed) or a bilingual `{ en, hr }` object
 * (seed fixtures and store-generated text).
 *
 * @param {unknown} value
 * @param {string} field
 * @param {{ optional?: boolean }} [options]
 * @returns {DisplayText}
 */
function normalizeDisplayText(value, field, options = {}) {
  if (value === null || value === undefined || value === '') {
    if (options.optional) return '';
    throw new Error(`${field} is required.`);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed && !options.optional) throw new Error(`${field} is required.`);
    return trimmed;
  }
  if (typeof value === 'object') {
    const entry = /** @type {Record<string, unknown>} */ (value);
    const en = typeof entry.en === 'string' ? entry.en.trim() : '';
    const hr = typeof entry.hr === 'string' ? entry.hr.trim() : '';
    if (!en && !hr) {
      if (options.optional) return '';
      throw new Error(`${field} is required.`);
    }
    return { en: en || hr, hr: hr || en };
  }
  throw new Error(`${field} must be text.`);
}

/**
 * @param {string} id
 * @returns {DemoRecord}
 */
function requireRecord(id) {
  ensureState();
  const record = state?.records.find((entry) => entry.id === id);
  if (!record) throw new Error(`Unknown demo record: ${String(id)}.`);
  return record;
}

function nextRecordId() {
  ensureState();
  const numbers = (state?.records ?? [])
    .map((entry) => Number.parseInt(String(entry.id).replace(ID_PREFIX, ''), 10))
    .filter((value) => Number.isFinite(value));
  const next = (numbers.length > 0 ? Math.max(...numbers) : 0) + 1;
  return `${ID_PREFIX}${String(next).padStart(4, '0')}`;
}

/**
 * @param {DemoRecord} record
 * @param {{ stage: string, actor: DisplayText, action: DisplayText, at: string,
 *   kind: 'appended' | 'proposed', note?: DisplayText }} event
 */
function appendEvent(record, event) {
  const last = record.events[record.events.length - 1];
  /** @type {DemoEvent} */
  const next = {
    seq: last ? last.seq + 1 : 1,
    stage: /** @type {DemoEvent['stage']} */ (event.stage),
    actor: event.actor,
    action: event.action,
    at: event.at,
    kind: event.kind,
  };
  if (event.note) next.note = event.note;
  record.events = [...record.events, next];
  return next;
}

function now() {
  return new Date().toISOString();
}

/* -------------------------------------------------------------------------- */
/* public API                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Deep-frozen snapshot of the whole demo state.
 *
 * @returns {Readonly<DemoState>}
 */
export function getState() {
  ensureState();
  if (!snapshot) snapshot = deepFreeze(clone(/** @type {DemoState} */ (state)));
  return /** @type {Readonly<DemoState>} */ (snapshot);
}

/**
 * Deep-frozen snapshot of one record, or `null` when the id is unknown.
 *
 * @param {string} id
 * @returns {Readonly<DemoRecord> | null}
 */
export function getRecord(id) {
  return getState().records.find((record) => record.id === id) ?? null;
}

/**
 * Subscribe to state changes. The listener runs after every mutation in this tab and after a
 * `storage` event from another tab.
 *
 * @param {(state: Readonly<DemoState>) => void} listener
 * @returns {() => void} unsubscribe
 */
export function subscribe(listener) {
  if (typeof listener !== 'function') throw new Error('subscribe expects a function.');
  ensureState();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Restore the committed seed fixtures and drop everything the visitor filed.
 *
 * @returns {Readonly<DemoState>}
 */
export function resetDemo() {
  const lang = state?.lang;
  state = seedState();
  if (lang && DEMO_LANGS.includes(lang)) state.lang = lang;
  commit();
  return getState();
}

/**
 * @param {DemoLang} lang
 * @returns {Readonly<DemoState>}
 */
export function setLang(lang) {
  ensureState();
  if (!DEMO_LANGS.includes(lang)) throw new Error(`Unknown demo language: ${String(lang)}.`);
  if (state && state.lang !== lang) {
    state.lang = lang;
    commit();
  }
  return getState();
}

/**
 * File a report. The record starts at stage `voice` with status `open` and one appended event.
 *
 * @param {{ subject: DisplayText, narrative?: DisplayText, category: string,
 *   origin?: 'app' | 'embed' }} input
 * @returns {Readonly<DemoRecord>}
 */
export function fileVoice(input) {
  ensureState();
  const fields = input ?? /** @type {never} */ ({});
  const subject = normalizeDisplayText(fields.subject, 'A report subject');
  const narrative = normalizeDisplayText(fields.narrative, 'A report description', {
    optional: true,
  });
  const category = fields.category;
  if (!DEMO_CATEGORIES.includes(category)) {
    throw new Error(`Choose one of these categories: ${DEMO_CATEGORIES.join(', ')}.`);
  }
  const origin = fields.origin ?? 'app';
  if (origin !== 'app' && origin !== 'embed') {
    throw new Error('A filed demo report has origin "app" or "embed". Seeds come from fixtures.');
  }

  const at = now();
  /** @type {DemoRecord} */
  const record = {
    id: nextRecordId(),
    origin,
    subject,
    narrative,
    category: /** @type {DemoRecord['category']} */ (category),
    createdAt: at,
    stage: 'voice',
    status: 'open',
    responsibility: null,
    commitment: null,
    review: null,
    events: [],
  };
  appendEvent(record, {
    stage: 'voice',
    actor: demoActors.resident,
    action: demoEventActions.reportFiled,
    at,
    kind: 'appended',
  });

  /** @type {DemoState} */ (state).records = [
    .../** @type {DemoState} */ (state).records,
    record,
  ];
  commit();
  return /** @type {Readonly<DemoRecord>} */ (getRecord(record.id));
}

/**
 * Name the responsible office. Only an open record can be assigned.
 *
 * @param {string} id
 * @param {{ office: DisplayText, role: DisplayText }} input
 * @returns {Readonly<DemoRecord>}
 */
export function assignResponsibility(id, input) {
  const record = requireRecord(id);
  if (record.status !== 'open') {
    throw new Error(
      `${record.id} already has a responsible office: it is at status "${record.status}".`,
    );
  }
  const fields = input ?? /** @type {never} */ ({});
  const office = normalizeDisplayText(fields.office, 'A responsible office');
  const role = normalizeDisplayText(fields.role, 'A responsible role');

  record.responsibility = { office, role };
  record.stage = 'responsibility';
  record.status = 'assigned';
  appendEvent(record, {
    stage: 'responsibility',
    actor: office,
    action: demoEventActions.responsibilityAssigned,
    at: now(),
    kind: 'appended',
  });
  commit();
  return /** @type {Readonly<DemoRecord>} */ (getRecord(record.id));
}

/**
 * File a scoped commitment. It starts `PENDING REVIEW` and its trace event is proposed history,
 * not appended history. An official cannot publish it and cannot set a terminal status.
 *
 * A record returned by review can be re-filed; the earlier proposed event keeps its return note.
 *
 * @param {string} id
 * @param {{ text: DisplayText, due: string, filedBy: DisplayText }} input
 * @returns {Readonly<DemoRecord>}
 */
export function fileCommitment(id, input) {
  const record = requireRecord(id);
  if (record.status !== 'assigned' && record.status !== 'returned') {
    throw new Error(
      `${record.id} cannot take a commitment at status "${record.status}": assign a responsible office first.`,
    );
  }
  const fields = input ?? /** @type {never} */ ({});
  const text = normalizeDisplayText(fields.text, 'A commitment');
  const filedBy = normalizeDisplayText(fields.filedBy, 'A filing role');
  const due = typeof fields.due === 'string' ? fields.due.trim() : '';
  if (!DATE_ONLY.test(due)) throw new Error('A commitment due date must be a YYYY-MM-DD date.');

  record.commitment = { text, due, filedBy, reviewStatus: 'pending' };
  record.review = null;
  record.stage = 'response';
  record.status = 'commitment-pending-review';
  appendEvent(record, {
    stage: 'response',
    actor: filedBy,
    action: demoEventActions.commitmentFiled,
    at: now(),
    kind: 'proposed',
  });
  commit();
  return /** @type {Readonly<DemoRecord>} */ (getRecord(record.id));
}

/**
 * The independent review gate. This is the only path to `published`.
 *
 * `accepted` flips the pending proposed event to appended history, then appends a check event and
 * a receipt event; the record reaches stage `receipt`, status `published`.
 * `returned` leaves the record at stage `response` with status `returned`; the proposed event
 * stays proposed and carries the return note.
 *
 * @param {string} id
 * @param {{ decision: 'accepted' | 'returned', note?: DisplayText, reviewer: DisplayText }} input
 *   `note` is required when the decision is `returned`.
 * @returns {Readonly<DemoRecord>}
 */
export function reviewCommitment(id, input) {
  const record = requireRecord(id);
  const fields = input ?? /** @type {never} */ ({});
  const decision = fields.decision;
  if (decision !== 'accepted' && decision !== 'returned') {
    throw new Error('A review decision is either "accepted" or "returned".');
  }
  if (record.status !== 'commitment-pending-review' || record.commitment?.reviewStatus !== 'pending') {
    throw new Error(`${record.id} has no commitment pending review.`);
  }
  const reviewer = normalizeDisplayText(fields.reviewer, 'A reviewer');
  // A return must tell the office what to correct; acceptance may stand on the record alone.
  const note = normalizeDisplayText(fields.note, 'A review note', {
    optional: decision === 'accepted',
  });

  const pendingIndex = [...record.events]
    .reverse()
    .findIndex((event) => event.kind === 'proposed');
  const proposed =
    pendingIndex === -1 ? null : record.events[record.events.length - 1 - pendingIndex];

  const at = now();
  record.review = { decision, note, reviewer };

  if (decision === 'returned') {
    record.commitment.reviewStatus = 'returned';
    record.stage = 'response';
    record.status = 'returned';
    if (proposed) {
      record.events = record.events.map((event) =>
        event === proposed ? { ...event, note } : event,
      );
    }
    commit();
    return /** @type {Readonly<DemoRecord>} */ (getRecord(record.id));
  }

  record.commitment.reviewStatus = 'accepted';
  if (proposed) {
    record.events = record.events.map((event) =>
      event === proposed ? { ...event, kind: 'appended' } : event,
    );
  }
  appendEvent(record, {
    stage: 'check',
    actor: reviewer,
    action: demoEventActions.reviewAccepted,
    at,
    kind: 'appended',
    note: note || undefined,
  });
  appendEvent(record, {
    stage: 'receipt',
    actor: demoActors.publicRecord,
    action: demoEventActions.published,
    at,
    kind: 'appended',
  });
  record.stage = 'receipt';
  record.status = 'published';
  commit();
  return /** @type {Readonly<DemoRecord>} */ (getRecord(record.id));
}
