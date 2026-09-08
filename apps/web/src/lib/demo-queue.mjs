/**
 * Queue helpers shared by the `/demo/official` and `/demo/review` surfaces.
 *
 * Both surfaces render the same ledger: a bucket rail, one row per record, and the five-stage
 * trace. Only the actions differ. Everything here takes its data as arguments and keeps no
 * state of its own — page state (selection, bucket, form values, errors) stays on the page,
 * and so does every element that only one surface builds.
 *
 * Plain client-side JS, no Astro imports: an Astro `<script>` loads it the same way it loads
 * the demo store.
 *
 * @typedef {import('../content/demo-strings.mjs').DemoLang} DemoLang
 * @typedef {import('../content/demo-strings.mjs').DisplayText} DisplayText
 * @typedef {import('../content/demo-strings.mjs').LocalizedText} LocalizedText
 * @typedef {import('../content/demo-fixtures.mjs').DemoRecord} DemoRecord
 *
 * @typedef {object} StampEntry
 * @property {DisplayText} text
 * @property {string} mod
 *
 * @typedef {object} BucketDef
 * @property {string} id
 * @property {readonly string[] | null} statuses Null counts every record.
 * @property {DisplayText} label
 * @property {boolean} [always] `false` hides the bucket while it is empty and unselected.
 */

import { resolveText } from '../content/demo-strings.mjs';

/** Below this width the detail card moves under the selected row. */
export const COMPACT_QUERY = '(max-width: 56.24rem)';

/**
 * Read a display field in one language.
 *
 * @param {DisplayText | null | undefined} value
 * @param {DemoLang} lang
 * @returns {string}
 */
export function text(value, lang) {
  return resolveText(value, lang);
}

/**
 * A date the way the visitor's language writes it. A bare `YYYY-MM-DD` is read as UTC so the
 * day never shifts with the reader's timezone.
 *
 * @param {string} iso
 * @param {DemoLang} lang
 * @returns {string}
 */
export function formatDate(iso, lang) {
  if (!iso) return '';
  const value = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00Z` : iso;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === 'hr' ? 'hr-HR' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/**
 * One element, optionally with a class and text.
 *
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {string} [className]
 * @param {string} [content]
 * @returns {HTMLElementTagNameMap[K]}
 */
export function el(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

/**
 * The status stamp: a short ink-stamp chip, never a sentence.
 *
 * A surface whose map covers every status it lists needs no fallback; one that lists wider key
 * types passes the entry to fall back on.
 *
 * @param {Record<string, StampEntry>} stampFor
 * @param {string} status
 * @param {DemoLang} lang
 * @param {StampEntry} [fallback]
 * @returns {HTMLSpanElement}
 */
export function stamp(stampFor, status, lang, fallback) {
  const entry = stampFor[status] ?? fallback;
  const mod = entry ? entry.mod : 'pending';
  return el('span', `demo-stamp demo-stamp--${mod}`, text(entry ? entry.text : '', lang));
}

/**
 * Key for one form control, so typed values and focus survive a re-render.
 *
 * @param {string} recordId
 * @param {string} name
 * @returns {string}
 */
export function fieldKey(recordId, name) {
  return `${recordId}:${name}`;
}

/**
 * What the visitor typed, or the default when they have typed nothing.
 *
 * @param {Map<string, string>} formValues
 * @param {string} recordId
 * @param {string} name
 * @param {string} fallback
 * @returns {string}
 */
export function currentValue(formValues, recordId, name, fallback) {
  const stored = formValues.get(fieldKey(recordId, name));
  return stored === undefined ? fallback : stored;
}

/**
 * A store error as display text. The store throws in English; both slots carry it.
 *
 * @param {unknown} error
 * @returns {LocalizedText}
 */
export function messageOf(error) {
  const message = error instanceof Error ? error.message : String(error);
  return { en: message, hr: message };
}

/**
 * Does this record belong in the named bucket? An unknown bucket, or one with no statuses,
 * takes everything.
 *
 * @param {DemoRecord} record
 * @param {string} bucketId
 * @param {readonly BucketDef[]} bucketDefs
 * @returns {boolean}
 */
export function matchesBucket(record, bucketId, bucketDefs) {
  const def = bucketDefs.find((entry) => entry.id === bucketId);
  if (!def || !def.statuses) return true;
  return def.statuses.includes(record.status);
}

/**
 * The five ordered stages. A stage whose last event is appended is public history; the stage
 * the record stands on is active; anything past it is ahead. A proposed event keeps its stage
 * dashed below the review gate.
 *
 * @param {DemoRecord} record
 * @param {DemoLang} lang
 * @param {object} options
 * @param {readonly string[]} options.stages Stage ids, in order.
 * @param {Record<string, DisplayText>} options.stageLabels
 * @param {Record<string, DisplayText>} options.stageNotes What a stage says before it happens.
 * @param {DisplayText} options.pendingLabel Stamp for a stage holding a proposed event.
 * @returns {HTMLOListElement}
 */
export function renderTrace(record, lang, options) {
  const list = el('ol', 'demo-trace');
  const stageIndex = options.stages.indexOf(record.stage);

  options.stages.forEach((stage, index) => {
    const events = record.events.filter((event) => event.stage === stage);
    const last = events[events.length - 1] ?? null;
    const classes = ['demo-trace-stage'];
    if (last && last.kind === 'appended' && (index < stageIndex || record.status === 'published')) {
      classes.push('is-appended');
    } else if (index === stageIndex) {
      classes.push('is-active');
    } else if (index < stageIndex) {
      classes.push('is-appended');
    } else {
      classes.push('is-ahead');
    }
    if (last && last.kind === 'proposed') classes.push('is-proposed');

    const item = el('li', classes.join(' '));
    const marker = el('span', 'demo-trace-marker');
    marker.setAttribute('aria-hidden', 'true');

    const body = el('div', 'demo-trace-body');
    const head = el('div', 'demo-trace-head');
    head.append(el('p', 'demo-trace-line', text(options.stageLabels[stage], lang)));
    if (last && last.kind === 'proposed') {
      head.append(el('span', 'demo-stamp demo-stamp--pending', text(options.pendingLabel, lang)));
    }
    body.append(head);

    const noteText = last
      ? `${text(last.action, lang)} · ${formatDate(last.at, lang)}`
      : text(options.stageNotes[stage], lang);
    body.append(el('p', 'demo-trace-note', noteText));

    item.append(marker, body);
    list.append(item);
  });

  return list;
}

/**
 * One ledger row: id, subject, category, status stamp, filing date.
 *
 * @param {DemoRecord} record
 * @param {DemoLang} lang
 * @param {object} options
 * @param {boolean} options.selected
 * @param {Record<string, DisplayText>} options.categoryLabels
 * @param {(status: string, lang: DemoLang) => HTMLSpanElement} options.stamp
 * @param {(record: DemoRecord) => void} options.onSelect
 * @returns {HTMLLIElement}
 */
export function renderRow(record, lang, options) {
  const item = el('li');
  const row = el('button', 'demo-ledger-row');
  row.type = 'button';
  row.setAttribute('data-record', record.id);
  row.setAttribute('data-focus-key', fieldKey(record.id, 'row'));
  if (options.selected) row.setAttribute('aria-current', 'true');
  row.append(
    el('span', 'demo-ledger-id', record.id),
    el('span', 'demo-ledger-subject', text(record.subject, lang)),
    el('span', 'demo-chip', text(options.categoryLabels[record.category], lang)),
    options.stamp(record.status, lang),
    el('span', 'demo-ledger-date', formatDate(record.createdAt, lang)),
  );
  row.addEventListener('click', () => options.onSelect(record));
  item.append(row);
  return item;
}

/**
 * The bucket rail, with a count per bucket. A bucket marked `always: false` stays out of the
 * rail while it is empty and unselected.
 *
 * @param {Element | null} bucketList
 * @param {readonly DemoRecord[]} records
 * @param {DemoLang} lang
 * @param {object} options
 * @param {readonly BucketDef[]} options.bucketDefs
 * @param {string} options.activeBucket
 * @param {(bucketId: string) => void} options.onSelect
 * @returns {void}
 */
export function renderBuckets(bucketList, records, lang, options) {
  if (!(bucketList instanceof HTMLElement)) return;
  const items = [];
  for (const def of options.bucketDefs) {
    const statuses = def.statuses;
    const count = statuses
      ? records.filter((record) => statuses.includes(record.status)).length
      : records.length;
    if (def.always === false && count === 0 && options.activeBucket !== def.id) continue;
    const item = el('li');
    const button = el('button', 'queue-bucket');
    button.type = 'button';
    button.setAttribute('aria-pressed', options.activeBucket === def.id ? 'true' : 'false');
    button.setAttribute('data-focus-key', `bucket:${def.id}`);
    button.append(
      el('span', 'queue-bucket-label', text(def.label, lang)),
      el('span', 'queue-bucket-count', String(count)),
    );
    button.addEventListener('click', () => options.onSelect(def.id));
    item.append(button);
    items.push(item);
  }
  bucketList.replaceChildren(...items);
}

/**
 * The compact breakpoint, or null where `matchMedia` is missing.
 *
 * @returns {MediaQueryList | null}
 */
export function compactQuery() {
  return typeof window.matchMedia === 'function' ? window.matchMedia(COMPACT_QUERY) : null;
}

/**
 * Re-render on a store change, on a viewport crossing the compact breakpoint (the detail panel
 * moves between its own column and the selected row), and once now.
 *
 * @param {object} options
 * @param {(listener: () => void) => unknown} options.subscribe
 * @param {MediaQueryList | null} options.compact
 * @param {() => void} options.render
 * @returns {void}
 */
export function wireQueue(options) {
  options.subscribe(() => options.render());
  const compact = options.compact;
  if (compact && typeof compact.addEventListener === 'function') {
    compact.addEventListener('change', () => options.render());
  }
  options.render();
}

/**
 * One label/value row of a detail list.
 *
 * The label is the quiet part and the value carries the ink (rule H3). `variant`
 * marks the two data a reviewer reads first: `lead` sets the commitment text at
 * body size, `loud` makes the due date the loudest datum on the panel.
 *
 * @param {string} term
 * @param {string | Node} value
 * @param {'lead' | 'loud'} [variant]
 * @returns {HTMLDivElement}
 */
export function fieldRow(term, value, variant) {
  const row = el('div');
  row.append(el('dt', undefined, term));
  const dd = el('dd', variant ? `is-${variant}` : undefined);
  if (typeof value === 'string') dd.textContent = value;
  else dd.append(value);
  row.append(dd);
  return row;
}

/**
 * A subheading group: whitespace and one hairline separate it from the next
 * group, never a bordered panel inside a bordered panel (rules H7, D5).
 *
 * @param {string} title
 * @param {...(Node | null | undefined)} children
 * @returns {HTMLElement}
 */
export function group(title, ...children) {
  const section = el('section', 'demo-group');
  section.append(el('h4', 'demo-group-title', title));
  for (const child of children) if (child) section.append(child);
  return section;
}

/**
 * The empty state of a region: what it is for, up to two concrete tips, and one
 * action where a legal action exists (rule S1). Same markup and classes as
 * `packages/ui/src/astro/EmptyState.astro`, built at runtime because the demo
 * queues render from the store.
 *
 * @param {object} spec
 * @param {string} spec.title
 * @param {string} [spec.purpose]
 * @param {readonly string[]} [spec.tips] Anything past the second is dropped.
 * @param {{ label: string, href?: string, onClick?: () => void, variant?: 'primary' | 'tertiary' }} [spec.action]
 * @returns {HTMLDivElement}
 */
export function emptyState(spec) {
  const box = el('div', 'empty-state');
  box.append(el('p', 'empty-state-title', spec.title));
  if (spec.purpose) box.append(el('p', 'empty-state-purpose', spec.purpose));
  const tips = (spec.tips ?? []).filter(Boolean).slice(0, 2);
  if (tips.length > 0) {
    const list = el('ul', 'empty-state-tips');
    for (const tip of tips) list.append(el('li', undefined, tip));
    box.append(list);
  }
  const action = spec.action;
  if (action) {
    const variant = action.variant ?? 'tertiary';
    if (action.href) {
      const link = el('a', 'btn empty-state-action', action.label);
      link.href = action.href;
      link.setAttribute('data-variant', variant);
      box.append(link);
    } else if (action.onClick) {
      const button = el('button', 'btn empty-state-action', action.label);
      button.type = 'button';
      button.setAttribute('data-variant', variant);
      button.addEventListener('click', action.onClick);
      box.append(button);
    }
  }
  return box;
}

/**
 * Write a `role="status"` region as a state label plus a sentence: the word
 * carries the state without colour, the sentence says what happened (rules P4,
 * S2). An empty `label` clears the region.
 *
 * @param {Element | null} region
 * @param {object} message
 * @param {string} message.label Short state word, e.g. the stamp text.
 * @param {string} message.tone `.status-label` tone.
 * @param {string} message.text
 * @returns {void}
 */
export function statusLine(region, message) {
  if (!(region instanceof HTMLElement)) return;
  if (!message || !message.text) {
    region.replaceChildren();
    return;
  }
  region.classList.add('demo-status-line');
  const parts = [];
  if (message.label) {
    const label = el('span', 'status-label', message.label);
    label.setAttribute('data-tone', message.tone || 'trace');
    parts.push(label);
  }
  parts.push(el('span', undefined, message.text));
  region.replaceChildren(...parts);
}
