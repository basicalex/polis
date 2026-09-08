import { getPrivateRecord, privateAttachmentHref } from '../../../lib/pilot/vrsar/api';
import type { PrivateTraceRecord, TraceAttachment, TraceEvent } from '../../../lib/pilot/vrsar/model';
import { pilotCopy, translatedAction, translatedRole } from '../../../content/pilot/vrsar';
import {
  apiErrorMessage,
  clearState,
  createStatus,
  createTextElement,
  currentPilotLang,
  formatPilotDate,
  recordIdFromPath,
  renderTrace,
  requirePilotRole,
  setState,
} from './shell';

let started = false;

function definition(term: string, value: string): HTMLDivElement {
  const row = document.createElement('div');
  row.append(createTextElement('dt', term), createTextElement('dd', value));
  return row;
}

export function initVrsarCaseDetail(): void {
  if (started) return;
  started = true;
  const lang = currentPilotLang();
  const id = recordIdFromPath();
  const state = document.querySelector<HTMLElement>('[data-page-state]');
  const root = document.querySelector<HTMLElement>('[data-private-record]');
  const retry = document.querySelector<HTMLButtonElement>('[data-retry]');

  function render(record: PrivateTraceRecord): void {
    const idElement = document.querySelector<HTMLElement>('[data-record-id]');
    if (idElement) idElement.textContent = record.id;
    const status = document.querySelector<HTMLElement>('[data-record-status]');
    status?.replaceWith(createStatus(record.status, lang));
    const fields = document.querySelector<HTMLElement>('[data-private-fields]');
    fields?.replaceChildren(
      definition(pilotCopy.detail.subject[lang], record.subject),
      definition(pilotCopy.detail.narrative[lang], record.narrative),
      definition(pilotCopy.detail.location[lang], record.location),
      definition(pilotCopy.detail.contact[lang], record.contactEmail || pilotCopy.common.notAvailable[lang]),
      definition(pilotCopy.common.created[lang], formatPilotDate(record.createdAt, lang)),
      definition(pilotCopy.common.updated[lang], formatPilotDate(record.updatedAt, lang)),
    );
    renderTrace(document, record.status, record.events);
    const events = document.querySelector<HTMLElement>('[data-private-events]');
    const eventRows = (Array.isArray(record.events) ? record.events : []).map((event: TraceEvent) => {
      const item = document.createElement('li');
      item.append(
        createTextElement('strong', translatedAction(event.action, lang)),
        createTextElement('span', `${translatedRole(event.actorRole, lang)} · ${formatPilotDate(event.createdAt, lang)}`, 'pilot-event-meta'),
      );
      if (event.note) item.append(createTextElement('span', event.note, 'pilot-event-meta'));
      return item;
    });
    events?.replaceChildren(...eventRows);
    const attachments = document.querySelector<HTMLElement>('[data-private-attachments]');
    const attachmentRows = (Array.isArray(record.attachments) ? record.attachments : []).map((attachment: TraceAttachment) => {
      const item = document.createElement('li');
      const link = createTextElement('a', attachment.filename || pilotCopy.common.details[lang], 'pilot-ledger-row');
      link.href = privateAttachmentHref(record.id, attachment.id);
      link.setAttribute('download', '');
      item.append(link);
      return item;
    });
    attachments?.replaceChildren(
      ...(attachmentRows.length ? attachmentRows : [createTextElement('li', pilotCopy.detail.noAttachments[lang], 'pilot-state')]),
    );
    if (root) root.hidden = false;
  }

  async function load(): Promise<void> {
    if (retry) retry.hidden = true;
    setState(state, pilotCopy.common.loading[lang]);
    const session = await requirePilotRole(['resident']);
    if (!session) return;
    if (!id) {
      setState(state, pilotCopy.common.notAvailable[lang], 'error');
      return;
    }
    try {
      const record = await getPrivateRecord(id);
      render(record);
      clearState(state);
    } catch (error) {
      if (root) root.hidden = true;
      setState(state, apiErrorMessage(error, lang), 'error');
      if (retry) retry.hidden = false;
    }
  }

  retry?.addEventListener('click', () => void load());
  void load();
}
