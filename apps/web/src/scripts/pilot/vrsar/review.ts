// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getPrivateRecord,
  listPrivateRecords,
  reviewCommitment,
  reviewResolution,
} from '../../../lib/pilot/vrsar/api';
import type { PrivateTraceRecord } from '../../../lib/pilot/vrsar/model';
import { pilotCopy } from '../../../content/pilot/vrsar';
import {
  apiErrorMessage,
  clearState,
  createField,
  createStatus,
  createTextElement,
  currentPilotLang,
  formatPilotDate,
  renderTrace,
  requirePilotRole,
  setFieldError,
  setState,
} from './shell';

let started = false;
let records: PrivateTraceRecord[] = [];
let selectedId = '';

function fieldRow(term: string, value: string): HTMLDivElement {
  const row = document.createElement('div');
  row.append(createTextElement('dt', term), createTextElement('dd', value));
  return row;
}

export function initVrsarReview(): void {
  if (started) return;
  started = true;
  const lang = currentPilotLang();
  const state = document.querySelector<HTMLElement>('[data-page-state]');
  const workspace = document.querySelector<HTMLElement>('[data-review-workspace]');
  const list = document.querySelector<HTMLElement>('[data-record-list]');
  const detail = document.querySelector<HTMLElement>('[data-record-detail]');
  const traceSection = document.querySelector<HTMLElement>('[data-trace-section]');
  const actions = document.querySelector<HTMLElement>('[data-review-actions]');
  const retry = document.querySelector<HTMLButtonElement>('[data-retry]');

  function renderList(): void {
    const rows = records.map((record) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pilot-ledger-row';
      if (record.id === selectedId) button.setAttribute('aria-current', 'true');
      const main = document.createElement('span');
      main.className = 'pilot-ledger-main';
      main.append(
        createTextElement('span', record.publicSummary || record.id, 'pilot-ledger-title'),
        createTextElement('span', record.id, 'pilot-ledger-id'),
        createTextElement('span', formatPilotDate(record.updatedAt, lang), 'pilot-ledger-meta'),
      );
      button.append(main, createStatus(record.status, lang));
      button.addEventListener('click', () => void selectRecord(record.id));
      item.append(button);
      return item;
    });
    list?.replaceChildren(...rows);
  }

  function renderDetail(record: PrivateTraceRecord): void {
    const panel = document.createElement('section');
    panel.className = 'panel pilot-section';
    panel.append(createStatus(record.status, lang));
    const fields = document.createElement('dl');
    fields.className = 'pilot-meta';
    fields.append(
      fieldRow(pilotCopy.common.recordId[lang], record.id),
      fieldRow(pilotCopy.detail.subject[lang], record.subject),
      fieldRow(pilotCopy.detail.narrative[lang], record.narrative),
      fieldRow(pilotCopy.detail.location[lang], record.location),
      fieldRow(pilotCopy.detail.contact[lang], record.contactEmail || pilotCopy.common.notAvailable[lang]),
      fieldRow(pilotCopy.staff.publicSummary[lang], record.publicSummary || pilotCopy.common.notAvailable[lang]),
      fieldRow(pilotCopy.staff.commitment[lang], record.commitment || pilotCopy.common.notAvailable[lang]),
      fieldRow(pilotCopy.staff.dueDate[lang], record.dueDate ? formatPilotDate(record.dueDate, lang, true) : pilotCopy.common.notAvailable[lang]),
      fieldRow(pilotCopy.staff.evidenceNote[lang], record.evidenceNote || pilotCopy.common.notAvailable[lang]),
      fieldRow(pilotCopy.staff.evidenceUrls[lang], Array.isArray(record.evidenceUrls) && record.evidenceUrls.length ? record.evidenceUrls.join('\n') : pilotCopy.common.notAvailable[lang]),
    );
    panel.append(fields);
    detail?.replaceChildren(panel);
    if (traceSection) traceSection.hidden = false;
    renderTrace(document, record.status, record.events);
  }

  function decisionForm(record: PrivateTraceRecord): HTMLElement {
    const isResolution = record.status === 'resolution-pending-review';
    const section = document.createElement('section');
    section.className = 'panel pilot-section';
    section.append(
      createTextElement('h3', isResolution ? pilotCopy.review.resolutionHeading[lang] : pilotCopy.review.commitmentHeading[lang]),
      createTextElement('p', pilotCopy.entry.publicationRule[lang], 'field-hint'),
    );
    const form = document.createElement('form');
    form.className = 'pilot-form';

    const note = document.createElement('textarea');
    note.id = `review-note-${record.id}`;
    note.maxLength = 2000;
    const noteField = createField(note, pilotCopy.review.note[lang], {
      hint: pilotCopy.review.noteHint[lang],
    });

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.id = `review-privacy-${record.id}`;
    check.value = 'confirmed';
    const checkField = createField(check, pilotCopy.review.privacyCheck[lang]);
    checkField.field.classList.add('field-choice');
    // The box reads before its wording, so it leads the row.
    checkField.field.insertBefore(check, checkField.field.firstChild);

    const buttonRow = document.createElement('div');
    buttonRow.className = 'pilot-actions';
    const accept = createTextElement(
      'button',
      isResolution ? pilotCopy.review.acceptResolution[lang] : pilotCopy.review.acceptCommitment[lang],
      'btn',
    );
    accept.dataset.variant = 'primary';
    accept.type = 'submit';
    accept.value = 'accept';
    accept.name = 'decision';
    // Returning writes an event that cannot be withdrawn, so it carries the
    // danger variant and sits to the right of the accepting action (rule I7).
    const returned = createTextElement(
      'button',
      isResolution ? pilotCopy.review.returnResolution[lang] : pilotCopy.review.returnCommitment[lang],
      'btn',
    );
    returned.dataset.variant = 'danger';
    returned.type = 'submit';
    returned.value = 'return';
    returned.name = 'decision';
    buttonRow.append(accept, returned);
    const message = createTextElement('p', '', 'pilot-state');
    message.tabIndex = -1;
    message.setAttribute('role', 'status');
    message.setAttribute('aria-live', 'polite');
    form.append(
      noteField.field,
      checkField.field,
      createTextElement('p', pilotCopy.review.decisionPermanent[lang], 'field-hint'),
      buttonRow,
      message,
    );
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
      const decision = submitter?.value === 'return' ? 'return' : 'accept';
      if (decision === 'return' && !note.value.trim()) {
        setFieldError(noteField, note, pilotCopy.review.returnNeedsNote[lang]);
        return;
      }
      setFieldError(noteField, note, '');
      if (decision === 'accept' && !check.checked) {
        setFieldError(checkField, check, pilotCopy.review.acceptNeedsCheck[lang]);
        return;
      }
      setFieldError(checkField, check, '');
      accept.disabled = true;
      returned.disabled = true;
      setState(message, pilotCopy.review.deciding[lang]);
      try {
        if (isResolution) {
          await reviewResolution(record.id, { expectedVersion: record.version, decision, note: note.value.trim() });
        } else {
          await reviewCommitment(record.id, { expectedVersion: record.version, decision, note: note.value.trim() });
        }
        await loadRecords();
      } catch (error) {
        setState(message, apiErrorMessage(error, lang), 'error');
        accept.disabled = false;
        returned.disabled = false;
      }
    });
    section.append(form);
    return section;
  }

  function renderActions(record: PrivateTraceRecord): void {
    if (!actions) return;
    if (record.status === 'commitment-pending-review' || record.status === 'resolution-pending-review') {
      actions.replaceChildren(decisionForm(record));
    } else {
      actions.replaceChildren(createTextElement('p', pilotCopy.review.noAction[lang], 'pilot-state'));
    }
  }

  async function selectRecord(id: string): Promise<void> {
    selectedId = id;
    renderList();
    detail?.replaceChildren(createTextElement('p', pilotCopy.common.loading[lang], 'pilot-state'));
    actions?.replaceChildren();
    try {
      const record = await getPrivateRecord(id);
      renderDetail(record);
      renderActions(record);
    } catch (error) {
      detail?.replaceChildren(createTextElement('p', apiErrorMessage(error, lang), 'pilot-state'));
      if (retry) retry.hidden = false;
    }
  }

  async function loadRecords(): Promise<void> {
    if (retry) retry.hidden = true;
    setState(state, pilotCopy.common.loading[lang]);
    const session = await requirePilotRole(['reviewer']);
    if (!session) return;
    try {
      records = (await listPrivateRecords())
        .filter((record) => record.status === 'commitment-pending-review' || record.status === 'resolution-pending-review')
        .sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
      if (workspace) workspace.hidden = false;
      clearState(state);
      selectedId = records.some((record) => record.id === selectedId) ? selectedId : records[0]?.id ?? '';
      renderList();
      if (selectedId) await selectRecord(selectedId);
      else {
        detail?.replaceChildren(createTextElement('p', pilotCopy.common.noResults[lang], 'pilot-state'));
        actions?.replaceChildren();
        if (traceSection) traceSection.hidden = true;
      }
    } catch (error) {
      setState(state, apiErrorMessage(error, lang), 'error');
      if (retry) retry.hidden = false;
    }
  }

  retry?.addEventListener('click', () => void loadRecords());
  void loadRecords();
}
