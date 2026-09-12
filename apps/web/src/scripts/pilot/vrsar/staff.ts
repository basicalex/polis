// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  assignRecord,
  getPrivateRecord,
  listPrivateRecords,
  submitCommitment,
  submitResolution,
  uploadPrivateAttachment,
} from '../../../lib/pilot/vrsar/api';
import type { PrivateTraceRecord, TraceEvent } from '../../../lib/pilot/vrsar/model';
import { pilotCopy, translatedRole } from '../../../content/pilot/vrsar';
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

const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'application/pdf', 'text/plain']);
let started = false;
let records: PrivateTraceRecord[] = [];
let selectedId = '';

async function fileBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function fieldRow(term: string, value: string): HTMLDivElement {
  const row = document.createElement('div');
  row.append(createTextElement('dt', term), createTextElement('dd', value));
  return row;
}

export function initVrsarStaff(): void {
  if (started) return;
  started = true;
  const lang = currentPilotLang();
  const state = document.querySelector<HTMLElement>('[data-page-state]');
  const workspace = document.querySelector<HTMLElement>('[data-staff-workspace]');
  const list = document.querySelector<HTMLElement>('[data-record-list]');
  const detail = document.querySelector<HTMLElement>('[data-record-detail]');
  const traceSection = document.querySelector<HTMLElement>('[data-trace-section]');
  const actions = document.querySelector<HTMLElement>('[data-staff-actions]');
  const retry = document.querySelector<HTMLButtonElement>('[data-retry]');

  function actionState(container: HTMLElement): HTMLParagraphElement {
    const element = createTextElement('p', '', 'pilot-state');
    element.tabIndex = -1;
    element.setAttribute('role', 'status');
    element.setAttribute('aria-live', 'polite');
    container.append(element);
    return element;
  }

  async function runAction(
    button: HTMLButtonElement,
    pending: string,
    operation: () => Promise<PrivateTraceRecord | void>,
    message: HTMLElement,
  ): Promise<void> {
    button.disabled = true;
    const label = button.textContent ?? '';
    button.textContent = pending;
    setState(message, pending);
    try {
      await operation();
      await loadRecords(selectedId);
    } catch (error) {
      setState(message, apiErrorMessage(error, lang), 'error');
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  }

  function renderRecordList(): void {
    const rows = records.map((record) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pilot-ledger-row';
      if (record.id === selectedId) button.setAttribute('aria-current', 'true');
      const main = document.createElement('span');
      main.className = 'pilot-ledger-main';
      main.append(
        createTextElement('span', record.subject || record.id, 'pilot-ledger-title'),
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

  function renderPrivateDetail(record: PrivateTraceRecord): void {
    if (!detail) return;
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
      fieldRow(pilotCopy.common.version[lang], String(record.version)),
    );
    panel.append(fields);
    const feedback = [...(Array.isArray(record.events) ? record.events : [])]
      .reverse()
      .find((event: TraceEvent) => event.note && (event.action?.toLowerCase().includes('return') || event.action?.toLowerCase().includes('vrat')));
    if (feedback?.note) {
      panel.append(
        createTextElement('h3', pilotCopy.staff.privateFeedback[lang]),
        createTextElement('p', feedback.note),
        createTextElement('p', `${translatedRole(feedback.actorRole, lang)} · ${formatPilotDate(feedback.createdAt, lang)}`, 'pilot-event-meta'),
      );
    }
    detail.replaceChildren(panel);
    if (traceSection) traceSection.hidden = false;
    renderTrace(document, record.status, record.events);
  }

  function commitmentForm(record: PrivateTraceRecord): HTMLElement {
    const section = document.createElement('section');
    section.className = 'panel pilot-section';
    section.append(createTextElement('h3', pilotCopy.staff.commitmentHeading[lang]));
    const form = document.createElement('form');
    form.className = 'pilot-form';

    const summary = document.createElement('textarea');
    summary.id = `staff-summary-${record.id}`;
    summary.required = true;
    summary.maxLength = 1000;
    summary.value = record.publicSummary ?? '';
    const summaryField = createField(summary, pilotCopy.staff.publicSummary[lang]);

    const commitment = document.createElement('textarea');
    commitment.id = `staff-commitment-${record.id}`;
    commitment.required = true;
    commitment.maxLength = 2000;
    commitment.value = record.commitment ?? '';
    const commitmentField = createField(commitment, pilotCopy.staff.commitment[lang]);

    const due = document.createElement('input');
    due.id = `staff-due-${record.id}`;
    due.type = 'date';
    due.required = true;
    due.value = record.dueDate ?? '';
    const dueField = createField(due, pilotCopy.staff.dueDate[lang], { width: 'date' });

    const actions = document.createElement('div');
    actions.className = 'pilot-actions';
    const button = createTextElement('button', pilotCopy.staff.fileCommitment[lang], 'btn');
    button.dataset.variant = 'primary';
    button.type = 'submit';
    actions.append(button);
    const message = actionState(section);
    form.append(summaryField.field, commitmentField.field, dueField.field, actions);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      void runAction(
        button,
        pilotCopy.staff.filingCommitment[lang],
        () => submitCommitment(record.id, {
          expectedVersion: record.version,
          publicSummary: summary.value.trim(),
          commitment: commitment.value.trim(),
          dueDate: due.value,
        }),
        message,
      );
    });
    section.insertBefore(form, message);
    return section;
  }

  function resolutionForm(record: PrivateTraceRecord): HTMLElement {
    const section = document.createElement('section');
    section.className = 'panel pilot-section';
    section.append(
      createTextElement('h3', pilotCopy.staff.resolutionHeading[lang]),
      createTextElement('p', pilotCopy.entry.publicationRule[lang], 'field-hint'),
    );
    const form = document.createElement('form');
    form.className = 'pilot-form';

    const note = document.createElement('textarea');
    note.id = `staff-evidence-${record.id}`;
    note.required = true;
    note.maxLength = 2000;
    const noteField = createField(note, pilotCopy.staff.evidenceNote[lang]);

    const urls = document.createElement('textarea');
    urls.id = `staff-evidence-urls-${record.id}`;
    urls.required = true;
    urls.maxLength = 4000;
    const urlsField = createField(urls, pilotCopy.staff.evidenceUrls[lang], {
      hint: pilotCopy.staff.evidenceUrlsHint[lang],
    });

    const actions = document.createElement('div');
    actions.className = 'pilot-actions';
    const button = createTextElement('button', pilotCopy.staff.submitResolution[lang], 'btn');
    button.dataset.variant = 'primary';
    button.type = 'submit';
    actions.append(button);
    const message = actionState(section);
    form.append(noteField.field, urlsField.field, actions);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const evidenceUrls = urls.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
      const validUrls = evidenceUrls.length > 0 && evidenceUrls.every((value) => {
        try {
          const parsed = new URL(value);
          return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
        } catch {
          return false;
        }
      });
      if (!validUrls) {
        setFieldError(urlsField, urls, pilotCopy.staff.evidenceUrlsHint[lang]);
        return;
      }
      setFieldError(urlsField, urls, '');
      void runAction(
        button,
        pilotCopy.staff.submittingResolution[lang],
        () => submitResolution(record.id, {
          expectedVersion: record.version,
          evidenceNote: note.value.trim(),
          evidenceUrls,
        }),
        message,
      );
    });
    section.insertBefore(form, message);
    return section;
  }

  function attachmentForm(record: PrivateTraceRecord): HTMLElement {
    const section = document.createElement('section');
    section.className = 'panel pilot-section';
    section.append(createTextElement('h3', pilotCopy.staff.attachmentHeading[lang]));
    const form = document.createElement('form');
    form.className = 'pilot-form';
    const input = document.createElement('input');
    input.type = 'file';
    input.id = `staff-attachment-${record.id}`;
    input.accept = 'image/png,image/jpeg,application/pdf,text/plain';
    const attachmentField = createField(input, pilotCopy.filing.attachments[lang], {
      hint: pilotCopy.filing.attachmentHint[lang],
    });
    const actions = document.createElement('div');
    actions.className = 'pilot-actions';
    const button = createTextElement('button', pilotCopy.staff.attachmentSubmit[lang], 'btn');
    button.dataset.variant = 'secondary';
    button.type = 'submit';
    actions.append(button);
    const message = actionState(section);
    form.append(attachmentField.field, actions);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const file = input.files?.[0];
      if (!file || file.size > MAX_ATTACHMENT_BYTES || !ALLOWED_TYPES.has(file.type)) {
        setFieldError(
          attachmentField,
          input,
          file && file.size > MAX_ATTACHMENT_BYTES
            ? pilotCopy.filing.attachmentTooLarge[lang]
            : pilotCopy.filing.attachmentHint[lang],
        );
        return;
      }
      setFieldError(attachmentField, input, '');
      void runAction(
        button,
        pilotCopy.filing.uploading[lang],
        async () => {
          await uploadPrivateAttachment(record.id, {
            expectedVersion: record.version,
            filename: file.name,
            contentType: file.type,
            base64: await fileBase64(file),
          });
        },
        message,
      );
    });
    section.insertBefore(form, message);
    return section;
  }

  function renderActions(record: PrivateTraceRecord): void {
    if (!actions) return;
    const rows: Node[] = [];
    if (record.status === 'open') {
      const section = document.createElement('section');
      section.className = 'panel pilot-section';
      const button = createTextElement('button', pilotCopy.staff.assign[lang], 'btn');
      button.dataset.variant = 'primary';
      button.type = 'button';
      const message = actionState(section);
      section.insertBefore(button, message);
      button.addEventListener('click', () => void runAction(
        button,
        pilotCopy.staff.assigning[lang],
        () => assignRecord(record.id, record.version),
        message,
      ));
      rows.push(section);
    } else if (record.status === 'assigned' || record.status === 'returned') {
      rows.push(commitmentForm(record));
    } else if (record.status === 'published') {
      rows.push(resolutionForm(record));
    } else {
      rows.push(createTextElement('p', pilotCopy.staff.noAction[lang], 'pilot-state'));
    }
    rows.push(attachmentForm(record));
    actions.replaceChildren(...rows);
  }

  async function selectRecord(id: string): Promise<void> {
    selectedId = id;
    renderRecordList();
    if (detail) detail.replaceChildren(createTextElement('p', pilotCopy.common.loading[lang], 'pilot-state'));
    if (actions) actions.replaceChildren();
    try {
      const record = await getPrivateRecord(id);
      const index = records.findIndex((item) => item.id === record.id);
      if (index >= 0) records[index] = record;
      renderPrivateDetail(record);
      renderActions(record);
    } catch (error) {
      detail?.replaceChildren(createTextElement('p', apiErrorMessage(error, lang), 'pilot-state'));
      if (retry) retry.hidden = false;
    }
  }

  async function loadRecords(preferredId = ''): Promise<void> {
    if (retry) retry.hidden = true;
    setState(state, pilotCopy.common.loading[lang]);
    const session = await requirePilotRole(['official']);
    if (!session) return;
    try {
      records = (await listPrivateRecords()).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      if (workspace) workspace.hidden = false;
      clearState(state);
      selectedId = preferredId && records.some((record) => record.id === preferredId)
        ? preferredId
        : records[0]?.id ?? '';
      renderRecordList();
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

  retry?.addEventListener('click', () => void loadRecords(selectedId));
  void loadRecords();
}
