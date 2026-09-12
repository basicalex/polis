// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createPrivateRecord,
  getPilotConfig,
  getPrivateRecord,
  uploadPrivateAttachment,
} from '../../../lib/pilot/vrsar/api';
import { pilotCopy, pilotHref, translatedError } from '../../../content/pilot/vrsar';
import { entityName } from '../../../lib/pilot/vrsar/model';
import { apiErrorMessage, clearState, currentPilotLang, requirePilotRole, setState } from './shell';

const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'application/pdf', 'text/plain']);
let started = false;

async function fileBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function initVrsarFile(): void {
  if (started) return;
  started = true;
  const lang = currentPilotLang();
  const state = document.querySelector<HTMLElement>('[data-page-state]');
  const form = document.querySelector<HTMLFormElement>('[data-report-form]');
  const submit = document.querySelector<HTMLButtonElement>('[data-report-submit]');
  const attachmentInput = document.querySelector<HTMLInputElement>('#report-attachments');

  function field(name: string): HTMLInputElement | HTMLTextAreaElement | null {
    return form?.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null;
  }

  function fieldError(name: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-error-for="${name}"]`);
  }

  function clearValidation(): void {
    form?.querySelectorAll<HTMLElement>('[aria-invalid="true"]').forEach((element) => element.removeAttribute('aria-invalid'));
    form?.querySelectorAll<HTMLElement>('[data-error-for]').forEach((element) => { element.textContent = ''; });
  }

  function validate(): { subject: string; narrative: string; location: string; contactEmail?: string; files: File[] } | null {
    clearValidation();
    let firstInvalid: HTMLElement | null = null;
    const required = ['subject', 'narrative', 'location'] as const;
    for (const name of required) {
      const control = field(name);
      if (control && !control.value.trim()) {
        control.setAttribute('aria-invalid', 'true');
        const error = fieldError(name);
        if (error) error.textContent = pilotCopy.filing.required[lang];
        firstInvalid ??= control;
      }
    }
    const contact = field('contactEmail') as HTMLInputElement | null;
    if (contact?.value && !contact.checkValidity()) {
      contact.setAttribute('aria-invalid', 'true');
      const error = fieldError('contactEmail');
      if (error) error.textContent = translatedError('invalid_request', lang);
      firstInvalid ??= contact;
    }
    const files = Array.from(attachmentInput?.files ?? []);
    const total = files.reduce((sum, file) => sum + file.size, 0);
    if (total > MAX_ATTACHMENT_BYTES || files.some((file) => !ALLOWED_TYPES.has(file.type))) {
      attachmentInput?.setAttribute('aria-invalid', 'true');
      const error = fieldError('attachments');
      if (error) {
        error.textContent = total > MAX_ATTACHMENT_BYTES
          ? pilotCopy.filing.attachmentTooLarge[lang]
          : translatedError('unsupported_attachment_type', lang);
      }
      firstInvalid ??= attachmentInput;
    }
    firstInvalid?.focus();
    if (firstInvalid) return null;
    const contactEmail = contact?.value.trim();
    return {
      subject: field('subject')?.value.trim() ?? '',
      narrative: field('narrative')?.value.trim() ?? '',
      location: field('location')?.value.trim() ?? '',
      ...(contactEmail ? { contactEmail } : {}),
      files,
    };
  }

  Promise.all([requirePilotRole(['resident']), getPilotConfig()])
    .then(([session, config]) => {
      if (!session) return;
      const category = document.querySelector<HTMLInputElement>('[data-fixed-category]');
      const office = document.querySelector<HTMLElement>('[data-fixed-office]');
      if (category) category.value = entityName(config.category, lang);
      if (office) office.textContent = `${pilotCopy.common.office[lang]}: ${entityName(config.office, lang)}`;
      if (!config.intakeOpen) {
        setState(state, pilotCopy.entry.intakeClosed[lang], 'warning');
        return;
      }
      clearState(state);
      if (form) form.hidden = false;
    })
    .catch((error) => setState(state, apiErrorMessage(error, lang), 'error'));

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = validate();
    if (!input) return;
    if (submit) {
      submit.disabled = true;
      submit.textContent = pilotCopy.filing.submitting[lang];
    }
    setState(state, pilotCopy.filing.submitting[lang]);
    let createdId = '';
    try {
      let record = await createPrivateRecord({
        subject: input.subject,
        narrative: input.narrative,
        location: input.location,
        ...(input.contactEmail ? { contactEmail: input.contactEmail } : {}),
      });
      createdId = record.id;
      for (const file of input.files) {
        setState(state, pilotCopy.filing.uploading[lang]);
        await uploadPrivateAttachment(record.id, {
          expectedVersion: record.version,
          filename: file.name,
          contentType: file.type,
          base64: await fileBase64(file),
        });
        record = await getPrivateRecord(record.id);
      }
      setState(state, pilotCopy.filing.filed[lang], 'success');
      location.assign(pilotHref(`/pilot/vrsar/cases/${encodeURIComponent(record.id)}`, lang));
    } catch (error) {
      const message = apiErrorMessage(error, lang);
      setState(state, createdId ? `${pilotCopy.filing.filed[lang]} ${message}` : message, createdId ? 'warning' : 'error');
      if (createdId) {
        const link = document.createElement('a');
        link.className = 'btn';
        link.dataset.variant = 'secondary';
        link.href = pilotHref(`/pilot/vrsar/cases/${encodeURIComponent(createdId)}`, lang);
        link.textContent = pilotCopy.common.details[lang];
        form.replaceChildren(link);
      }
    } finally {
      if (submit && !createdId) {
        submit.disabled = false;
        submit.textContent = pilotCopy.filing.submit[lang];
      }
    }
  });
}
