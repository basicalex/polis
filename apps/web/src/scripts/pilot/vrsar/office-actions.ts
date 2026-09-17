// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * The five office commands the case workspace runs: accept responsibility,
 * publish a commitment, report completion, put a disputed case back in work,
 * and attach a private file. Each builder returns a detached form; the caller
 * decides where it lives and supplies `run`, which owns the pending label, the
 * state line and the refresh. Nothing here reads the page.
 */

import {
  assignRecord,
  reopenCase,
  submitCommitment,
  submitResolution,
  uploadPrivateAttachment,
} from '../../../lib/pilot/vrsar/api';
import type { OfficialSignature, PrivateTraceRecord } from '../../../lib/pilot/vrsar/model';
import { pilotCopy, type PilotLang } from '../../../content/pilot/vrsar';
import { workspaceCopy } from '../../../content/pilot/vrsar-workspace';
import { createField, createTextElement, setFieldError } from './shell';

const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'application/pdf', 'text/plain']);
/**
 * The signing name and title are typed on every answer, so the last pair is
 * kept as a convenience. It is the only thing this workspace writes to Web
 * Storage: no session, no token, and nothing about the filer.
 */
const SIGNATURE_KEY = 'polis.pilot.vrsar.signature';

export function rememberedSignature(): OfficialSignature {
  try {
    const stored = window.localStorage.getItem(SIGNATURE_KEY);
    if (!stored) return { name: '', title: '' };
    const parsed = JSON.parse(stored) as Partial<OfficialSignature>;
    return {
      name: typeof parsed.name === 'string' ? parsed.name : '',
      title: typeof parsed.title === 'string' ? parsed.title : '',
    };
  } catch {
    // Private browsing, blocked storage, or a stale value: the fields start empty.
    return { name: '', title: '' };
  }
}

export function rememberSignature(signature: OfficialSignature): void {
  try {
    window.localStorage.setItem(SIGNATURE_KEY, JSON.stringify(signature));
  } catch {
    // Storage is a convenience; the answer is already on its way.
  }
}

async function fileBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/** One HTTPS link per line; an empty list is allowed where evidence is optional. */
export function readEvidenceUrls(value: string): string[] | null {
  const urls = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const valid = urls.every((entry) => {
    try {
      const parsed = new URL(entry);
      return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
    } catch {
      return false;
    }
  });
  return valid ? urls : null;
}

/**
 * What a form needs from the page: the record it acts on, the language, and
 * one runner that reports progress and refreshes the case afterwards.
 */
export interface OfficeActionContext {
  record: PrivateTraceRecord;
  lang: PilotLang;
  run: (
    button: HTMLButtonElement,
    pending: string,
    done: string,
    operation: () => Promise<unknown>,
  ) => void;
}

function actionRow(button: HTMLButtonElement): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'pilot-actions';
  row.append(button);
  return row;
}

function submitButton(label: string, variant: 'primary' | 'secondary'): HTMLButtonElement {
  const button = createTextElement('button', label, 'btn');
  button.type = 'submit';
  button.dataset.variant = variant;
  return button;
}

/**
 * Name and title travel with every answer and stand on the public record,
 * so they are one pair of required fields, prefilled from the last answer.
 */
function signatureFields(
  record: PrivateTraceRecord,
  lang: PilotLang,
): { fields: HTMLElement[]; read: () => OfficialSignature } {
  const remembered = rememberedSignature();
  const name = document.createElement('input');
  name.id = `office-signed-name-${record.id}`;
  name.type = 'text';
  name.required = true;
  name.maxLength = 120;
  name.autocomplete = 'name';
  name.value = remembered.name;
  const nameField = createField(name, pilotCopy.staff.signedByName[lang], {
    hint: pilotCopy.staff.signedByHint[lang],
  });

  const title = document.createElement('input');
  title.id = `office-signed-title-${record.id}`;
  title.type = 'text';
  title.required = true;
  title.maxLength = 120;
  title.setAttribute('autocomplete', 'organization-title');
  title.value = remembered.title;
  const titleField = createField(title, pilotCopy.staff.signedByTitle[lang]);

  return {
    fields: [nameField.field, titleField.field],
    read: () => ({ name: name.value.trim(), title: title.value.trim() }),
  };
}

/**
 * `open` has one honest action and no fields, so the primary control is the
 * whole form: one press accepts responsibility for the case.
 */
export function assignForm(context: OfficeActionContext): HTMLFormElement {
  const { record, lang } = context;
  const form = document.createElement('form');
  form.className = 'case-primary-form';
  form.dataset.officeForm = 'assign';
  const button = submitButton(pilotCopy.staff.assign[lang], 'primary');
  form.append(button);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    context.run(
      button,
      pilotCopy.staff.assigning[lang],
      workspaceCopy.done.assigned[lang],
      () => assignRecord(record.id, record.version),
    );
  });
  return form;
}

export function commitmentForm(context: OfficeActionContext): HTMLFormElement {
  const { record, lang } = context;
  const form = document.createElement('form');
  form.className = 'pilot-form';
  form.dataset.officeForm = 'commitment';

  const commitment = document.createElement('textarea');
  commitment.id = `office-commitment-${record.id}`;
  commitment.required = true;
  commitment.rows = 3;
  commitment.maxLength = 2000;
  commitment.value = record.commitment ?? '';
  const commitmentField = createField(commitment, pilotCopy.staff.commitment[lang]);

  const due = document.createElement('input');
  due.id = `office-due-${record.id}`;
  due.type = 'date';
  due.required = true;
  due.value = record.dueDate ?? '';
  const dueField = createField(due, pilotCopy.staff.dueDate[lang], { width: 'date' });

  const signature = signatureFields(record, lang);

  const evidence = document.createElement('textarea');
  evidence.id = `office-commitment-evidence-${record.id}`;
  evidence.rows = 2;
  evidence.maxLength = 2000;
  const evidenceField = createField(evidence, pilotCopy.staff.evidenceOptional[lang]);

  const button = submitButton(pilotCopy.staff.fileCommitment[lang], 'primary');
  // The publication rule sits above the button it governs (rule I3).
  form.append(
    commitmentField.field,
    dueField.field,
    ...signature.fields,
    evidenceField.field,
    createTextElement('p', pilotCopy.staff.publishesNow[lang], 'pilot-state'),
    actionRow(button),
  );

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const signedBy = signature.read();
    const note = evidence.value.trim();
    context.run(
      button,
      pilotCopy.staff.filingCommitment[lang],
      workspaceCopy.done.commitment[lang],
      async () => {
        const updated = await submitCommitment(record.id, {
          commitment: commitment.value.trim(),
          dueDate: due.value,
          signedBy,
          ...(note ? { evidenceNote: note } : {}),
        });
        rememberSignature(signedBy);
        return updated;
      },
    );
  });
  return form;
}

export function resolutionForm(context: OfficeActionContext): HTMLFormElement {
  const { record, lang } = context;
  const form = document.createElement('form');
  form.className = 'pilot-form';
  form.dataset.officeForm = 'resolution';

  const note = document.createElement('textarea');
  note.id = `office-evidence-${record.id}`;
  note.required = true;
  note.rows = 3;
  note.maxLength = 2000;
  const noteField = createField(note, pilotCopy.staff.evidenceNote[lang]);

  const urls = document.createElement('textarea');
  urls.id = `office-evidence-urls-${record.id}`;
  urls.required = true;
  urls.rows = 2;
  urls.maxLength = 4000;
  const urlsField = createField(urls, pilotCopy.staff.evidenceUrls[lang], {
    hint: pilotCopy.staff.evidenceUrlsHint[lang],
  });

  const signature = signatureFields(record, lang);
  const button = submitButton(pilotCopy.staff.submitResolution[lang], 'primary');
  form.append(
    createTextElement('p', pilotCopy.entry.publicationRule[lang], 'field-hint'),
    noteField.field,
    urlsField.field,
    ...signature.fields,
    createTextElement('p', pilotCopy.staff.publishesNow[lang], 'pilot-state'),
    actionRow(button),
  );

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const evidenceUrls = readEvidenceUrls(urls.value);
    if (!evidenceUrls || evidenceUrls.length === 0) {
      setFieldError(urlsField, urls, pilotCopy.staff.evidenceUrlsHint[lang]);
      return;
    }
    setFieldError(urlsField, urls, '');
    const signedBy = signature.read();
    context.run(
      button,
      pilotCopy.staff.submittingResolution[lang],
      workspaceCopy.done.resolution[lang],
      async () => {
        const updated = await submitResolution(record.id, {
          evidenceNote: note.value.trim(),
          evidenceUrls,
          signedBy,
        });
        rememberSignature(signedBy);
        return updated;
      },
    );
  });
  return form;
}

/** From `disputed`: the office accepts the dispute and answers again. */
export function reopenForm(context: OfficeActionContext): HTMLFormElement {
  const { record, lang } = context;
  const form = document.createElement('form');
  form.className = 'pilot-form';
  form.dataset.officeForm = 'reopen';
  const note = document.createElement('textarea');
  note.id = `office-reopen-note-${record.id}`;
  note.rows = 2;
  note.maxLength = 2000;
  const noteField = createField(note, pilotCopy.staff.reopenNote[lang]);
  const button = submitButton(pilotCopy.staff.reopen[lang], 'secondary');
  form.append(
    createTextElement('p', pilotCopy.staff.reopenIntro[lang], 'pilot-state'),
    noteField.field,
    actionRow(button),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const trimmed = note.value.trim();
    context.run(
      button,
      pilotCopy.staff.reopening[lang],
      workspaceCopy.done.reopened[lang],
      () => reopenCase(record.id, trimmed ? { note: trimmed } : {}),
    );
  });
  return form;
}

export function attachmentForm(context: OfficeActionContext): HTMLFormElement {
  const { record, lang } = context;
  const form = document.createElement('form');
  form.className = 'pilot-form';
  form.dataset.officeForm = 'attachment';
  const input = document.createElement('input');
  input.type = 'file';
  input.id = `office-attachment-${record.id}`;
  input.accept = 'image/png,image/jpeg,application/pdf,text/plain';
  const attachmentField = createField(input, pilotCopy.filing.attachments[lang], {
    hint: pilotCopy.filing.attachmentHint[lang],
  });
  const button = submitButton(pilotCopy.staff.attachmentSubmit[lang], 'secondary');
  form.append(attachmentField.field, actionRow(button));
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
    context.run(
      button,
      pilotCopy.filing.uploading[lang],
      workspaceCopy.done.attachment[lang],
      async () => {
        await uploadPrivateAttachment(record.id, {
          expectedVersion: record.version,
          filename: file.name,
          contentType: file.type,
          base64: await fileBase64(file),
        });
      },
    );
  });
  return form;
}
