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
import type {
  OfficialProfile,
  PilotConfigEntity,
  PrivateTraceRecord,
} from '../../../lib/pilot/vrsar/model';
import { entityName } from '../../../lib/pilot/vrsar/model';
import { pilotCopy, type PilotLang } from '../../../content/pilot/vrsar';
import { workspaceCopy } from '../../../content/pilot/vrsar-workspace';
import { createField, createTextElement, setFieldError } from './shell';

const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'application/pdf', 'text/plain']);

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
  /** Who is signing, read from the login. Null means the operator wrote no profile. */
  profile: OfficialProfile | null;
  /** The sections of the office, from the pilot config; one or none needs no choice. */
  units: PilotConfigEntity[];
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
 * The signer is the login, not a typed pair of fields: the name and the title
 * come from the official's own profile and only stand here to be read before
 * the answer publishes under them.
 */
function signatureReadout(profile: OfficialProfile, lang: PilotLang): HTMLElement {
  const box = document.createElement('div');
  box.className = 'pilot-signer';
  box.dataset.officeSigner = 'profile';
  const line = [profile.name, profile.title].filter(Boolean).join(', ');
  box.append(
    createTextElement('p', `${pilotCopy.staff.signer[lang]}: ${line}`, 'pilot-signer-name'),
    createTextElement('p', pilotCopy.staff.signerFromProfile[lang], 'field-hint'),
  );
  if (profile.unit) {
    box.append(
      createTextElement(
        'p',
        `${pilotCopy.staff.unit[lang]}: ${entityName(profile.unit, lang)}`,
        'field-hint',
      ),
    );
  }
  return box;
}

/**
 * Without a profile there is nobody to sign, so the form says what is missing
 * and carries no button: an answer with no name on it is not an option.
 */
function missingProfileForm(kind: string, lang: PilotLang): HTMLFormElement {
  const form = document.createElement('form');
  form.className = 'pilot-form';
  form.dataset.officeForm = kind;
  form.dataset.officeBlocked = 'profile';
  form.append(createTextElement('p', pilotCopy.staff.signerMissing[lang], 'pilot-state'));
  form.addEventListener('submit', (event) => event.preventDefault());
  return form;
}

/**
 * `open` has one honest action: take the case on. Where the office runs more
 * than one section the form asks which one takes it; with a single section
 * there is nothing to ask, and the backend reads the unit off the profile.
 */
export function assignForm(context: OfficeActionContext): HTMLFormElement {
  const { record, lang, units } = context;
  const form = document.createElement('form');
  form.className = 'case-primary-form';
  form.dataset.officeForm = 'assign';

  const choice = units.length > 1 ? unitSelect(record, units, lang, context.profile) : null;
  if (choice) form.append(choice.field);

  const button = submitButton(pilotCopy.staff.assign[lang], 'primary');
  form.append(button);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const unitId = choice?.read() ?? '';
    context.run(
      button,
      pilotCopy.staff.assigning[lang],
      workspaceCopy.done.assigned[lang],
      () => assignRecord(record.id, record.version, unitId || undefined),
    );
  });
  return form;
}

/** The sections of the office, with the official's own section chosen first. */
function unitSelect(
  record: PrivateTraceRecord,
  units: PilotConfigEntity[],
  lang: PilotLang,
  profile: OfficialProfile | null,
): { field: HTMLElement; read: () => string } {
  const select = document.createElement('select');
  select.id = `office-unit-${record.id}`;
  select.required = true;
  for (const unit of units) {
    const option = document.createElement('option');
    option.value = String(unit.id ?? '');
    option.textContent = entityName(unit, lang) || String(unit.id ?? '');
    select.append(option);
  }
  const own = profile?.unit?.id ?? '';
  if (own && units.some((unit) => unit.id === own)) select.value = own;
  const parts = createField(select, pilotCopy.staff.unitChoose[lang]);
  return { field: parts.field, read: () => select.value };
}

export function commitmentForm(context: OfficeActionContext): HTMLFormElement {
  const { record, lang, profile } = context;
  if (!profile) return missingProfileForm('commitment', lang);
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
    signatureReadout(profile, lang),
    evidenceField.field,
    createTextElement('p', pilotCopy.staff.publishesNow[lang], 'pilot-state'),
    actionRow(button),
  );

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const note = evidence.value.trim();
    context.run(
      button,
      pilotCopy.staff.filingCommitment[lang],
      workspaceCopy.done.commitment[lang],
      () =>
        submitCommitment(record.id, {
          expectedVersion: record.version,
          commitment: commitment.value.trim(),
          dueDate: due.value,
          ...(note ? { evidenceNote: note } : {}),
        }),
    );
  });
  return form;
}

export function resolutionForm(context: OfficeActionContext): HTMLFormElement {
  const { record, lang, profile } = context;
  if (!profile) return missingProfileForm('resolution', lang);
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

  const button = submitButton(pilotCopy.staff.submitResolution[lang], 'primary');
  form.append(
    createTextElement('p', pilotCopy.entry.publicationRule[lang], 'field-hint'),
    noteField.field,
    urlsField.field,
    signatureReadout(profile, lang),
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
    // The completion is signed server-side by the same profile as the commitment.
    context.run(
      button,
      pilotCopy.staff.submittingResolution[lang],
      workspaceCopy.done.resolution[lang],
      () =>
        submitResolution(record.id, {
          evidenceNote: note.value.trim(),
          evidenceUrls,
        }),
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
