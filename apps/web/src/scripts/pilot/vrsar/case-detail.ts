// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  closeCase,
  decideAiProposal,
  getPrivateRecord,
  listCaseMessages,
  privateAttachmentHref,
  sendCaseMessage,
} from '../../../lib/pilot/vrsar/api';
import type {
  AiProposal,
  CaseMessage,
  PilotRole,
  PrivateTraceRecord,
  TraceAttachment,
  TraceEvent,
} from '../../../lib/pilot/vrsar/model';
import { CLOSED_REASONS } from '../../../lib/pilot/vrsar/model';
import {
  pilotCopy,
  translatedAction,
  translatedAiKind,
  translatedAiStatus,
  translatedClosedReason,
  translatedDelivery,
  translatedOrigin,
  translatedRole,
} from '../../../content/pilot/vrsar';
import {
  apiErrorMessage,
  clearState,
  createField,
  createStatus,
  createTextElement,
  currentPilotLang,
  formatPilotDate,
  recordIdFromPath,
  renderTrace,
  requirePilotRole,
  setState,
} from './shell';

/** One SMS-sized question. The gateway splits nothing; the office writes short. */
const MAX_MESSAGE_CHARS = 480;
/** Below this the model's own confidence is worth stating as a caution. */
const LOW_CONFIDENCE = 0.5;
const STAFF_ROLES: readonly PilotRole[] = ['official', 'reviewer'];

let started = false;

function definition(term: string, value: string): HTMLDivElement {
  const row = document.createElement('div');
  row.append(createTextElement('dt', term), createTextElement('dd', value));
  return row;
}

/** The shared stamp recipe: one word, no fill, tone only reinforces it. */
function stamp(text: string, tone: string, data?: Record<string, string>): HTMLSpanElement {
  const element = createTextElement('span', text, 'status-label');
  element.dataset.tone = tone;
  for (const [key, value] of Object.entries(data ?? {})) element.dataset[key] = value;
  return element;
}

function proposedValueText(proposal: AiProposal): string {
  const value = proposal.proposedValue;
  if (!value || typeof value !== 'object') return '';
  for (const entry of Object.values(value)) {
    if (typeof entry === 'string' && entry) return entry;
  }
  return '';
}

function percent(value: unknown, lang: ReturnType<typeof currentPilotLang>): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return pilotCopy.common.notAvailable[lang];
  const locale = lang === 'hr' ? 'hr-HR' : lang === 'it' ? 'it-IT' : 'en-GB';
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(value);
}

export function initVrsarCaseDetail(): void {
  if (started) return;
  started = true;
  const lang = currentPilotLang();
  const id = recordIdFromPath();
  const state = document.querySelector<HTMLElement>('[data-page-state]');
  const root = document.querySelector<HTMLElement>('[data-private-record]');
  const retry = document.querySelector<HTMLButtonElement>('[data-retry]');
  const aiSection = document.querySelector<HTMLElement>('[data-ai-section]');
  const aiList = document.querySelector<HTMLElement>('[data-ai-list]');
  const messageSection = document.querySelector<HTMLElement>('[data-messages-section]');
  const messageList = document.querySelector<HTMLElement>('[data-messages-list]');
  const messageForm = document.querySelector<HTMLElement>('[data-message-form]');
  const closeSection = document.querySelector<HTMLElement>('[data-close-section]');
  const closeForm = document.querySelector<HTMLElement>('[data-close-form]');
  const closedNotice = document.querySelector<HTMLElement>('[data-closed-notice]');
  // Each section keeps one state line outside the parts a re-render replaces,
  // so a confirmation or an error survives the refresh it triggered.
  const aiState = document.querySelector<HTMLElement>('[data-ai-state]');
  const messagesState = document.querySelector<HTMLElement>('[data-messages-state]');
  const closeState = document.querySelector<HTMLElement>('[data-close-state]');

  let record: PrivateTraceRecord | null = null;
  let role: PilotRole = 'resident';
  let messageFormBuilt = false;
  let closeFormState: 'none' | 'form' | 'blocked' = 'none';

  function isStaff(): boolean {
    return STAFF_ROLES.includes(role);
  }

  /**
   * A stale version is the one error worth recovering from in place: refresh
   * the record so the next attempt carries the current version, and keep what
   * the user typed.
   */
  async function reportCommandError(error: unknown, message: HTMLElement | null): Promise<void> {
    setState(message, apiErrorMessage(error, lang), 'error');
    const code = (error as { code?: unknown })?.code;
    if (code !== 'stale_version' && code !== 'idempotency_conflict') return;
    try {
      record = await getPrivateRecord(id);
      renderRecord(record);
    } catch {
      // The refresh is best effort; the message above already says what to do.
    }
  }

  function originBadge(origin: unknown): HTMLSpanElement {
    const value = typeof origin === 'string' ? origin : 'unknown';
    const badge = stamp(translatedOrigin(value, lang), 'unknown', { origin: value });
    badge.setAttribute('aria-label', `${pilotCopy.channel.label[lang]}: ${translatedOrigin(value, lang)}`);
    return badge;
  }

  function renderClosedNotice(current: PrivateTraceRecord): void {
    if (!closedNotice) return;
    closedNotice.hidden = current.status !== 'closed';
    if (current.status !== 'closed') return;
    const fields = document.createElement('dl');
    fields.className = 'pilot-meta';
    fields.append(
      definition(pilotCopy.close.reason[lang], translatedClosedReason(current.closedReason, lang)),
      definition(
        pilotCopy.close.closedPublicReason[lang],
        current.closedPublicReason || pilotCopy.common.notAvailable[lang],
      ),
    );
    closedNotice.replaceChildren(
      createTextElement('h2', pilotCopy.close.closedHeading[lang]),
      fields,
    );
  }

  function proposalPanel(proposal: AiProposal): HTMLElement {
    const panel = document.createElement('li');
    panel.className = 'panel pilot-section';
    const marks = document.createElement('p');
    marks.className = 'pilot-ledger-meta';
    marks.append(stamp(translatedAiStatus(proposal.status, lang), 'unknown', { aiStatus: proposal.status }));
    panel.append(createTextElement('h3', translatedAiKind(proposal.kind, lang)), marks);

    const fields = document.createElement('dl');
    fields.className = 'pilot-meta';
    fields.append(
      definition(pilotCopy.ai.proposed[lang], proposedValueText(proposal) || pilotCopy.common.notAvailable[lang]),
      definition(pilotCopy.ai.confidence[lang], percent(proposal.confidence, lang)),
      definition(pilotCopy.ai.model[lang], `${proposal.modelId} · ${proposal.modelVersion}`),
    );
    panel.append(fields);

    // Risk reads as sentences, not as a colour or an icon (rules P4, C2).
    if (typeof proposal.confidence === 'number' && proposal.confidence < LOW_CONFIDENCE) {
      panel.append(createTextElement('p', pilotCopy.ai.lowConfidence[lang], 'pilot-state'));
    }
    if (proposal.kind === 'duplicate-of') {
      panel.append(createTextElement('p', pilotCopy.ai.duplicateRisk[lang], 'pilot-state'));
    }

    if (proposal.status !== 'proposed') {
      const decided = [
        pilotCopy.ai.decidedAt[lang],
        formatPilotDate(proposal.decidedAt, lang),
      ].join(': ');
      panel.append(createTextElement('p', decided, 'pilot-event-meta'));
      if (proposal.decisionNote) panel.append(createTextElement('p', proposal.decisionNote, 'pilot-event-meta'));
      return panel;
    }

    const form = document.createElement('form');
    form.className = 'pilot-form';
    const note = document.createElement('textarea');
    note.id = `ai-note-${proposal.id}`;
    note.maxLength = 2000;
    note.rows = 2;
    const noteField = createField(note, pilotCopy.ai.note[lang]);
    const row = document.createElement('div');
    row.className = 'pilot-actions';
    const reject = createTextElement('button', pilotCopy.ai.reject[lang], 'btn');
    reject.type = 'button';
    reject.dataset.variant = 'secondary';
    const accept = createTextElement('button', pilotCopy.ai.accept[lang], 'btn');
    accept.type = 'button';
    accept.dataset.variant = 'primary';
    row.append(reject, accept);
    form.append(noteField.field, row);
    panel.append(form);

    async function decide(button: HTMLButtonElement, decision: 'accepted' | 'rejected'): Promise<void> {
      if (!record) return;
      accept.disabled = true;
      reject.disabled = true;
      const label = button.textContent ?? '';
      button.textContent = pilotCopy.ai.deciding[lang];
      setState(aiState, pilotCopy.ai.deciding[lang]);
      try {
        const trimmed = note.value.trim();
        const result = await decideAiProposal(record.id, proposal.id, {
          expectedVersion: record.version,
          decision,
          ...(trimmed ? { note: trimmed } : {}),
        });
        record = result.record;
        setState(aiState, pilotCopy.ai.decided[lang], 'success');
        renderRecord(record);
      } catch (error) {
        await reportCommandError(error, aiState);
      } finally {
        accept.disabled = false;
        reject.disabled = false;
        button.textContent = label;
      }
    }

    accept.addEventListener('click', () => void decide(accept, 'accepted'));
    reject.addEventListener('click', () => void decide(reject, 'rejected'));
    return panel;
  }

  function renderProposals(current: PrivateTraceRecord): void {
    if (!aiSection || !aiList) return;
    aiSection.hidden = !isStaff();
    if (!isStaff()) return;
    const proposals = Array.isArray(current.aiProposals) ? current.aiProposals : [];
    aiList.replaceChildren(
      ...(proposals.length
        ? proposals.map((proposal) => proposalPanel(proposal))
        : [createTextElement('li', pilotCopy.ai.empty[lang], 'pilot-state')]),
    );
  }

  function messageRow(message: CaseMessage): HTMLLIElement {
    const item = document.createElement('li');
    item.dataset.direction = message.direction;
    // The office side sits to the right of the thread; the wording stays
    // left-aligned so it keeps a readable measure (rules L1, L6). The pilot
    // stylesheet is owned elsewhere, so the two offsets are set here.
    item.style.maxWidth = '46rem';
    if (message.direction === 'outbound') item.style.marginInlineStart = 'auto';
    const row = document.createElement('div');
    row.className = 'pilot-ledger-row';
    const main = document.createElement('div');
    main.className = 'pilot-ledger-main';
    const author = message.direction === 'inbound'
      ? pilotCopy.messages.inbound[lang]
      : pilotCopy.messages.outbound[lang];
    main.append(
      createTextElement('strong', author),
      createTextElement('p', message.body),
      createTextElement(
        'span',
        `${translatedOrigin(message.channel, lang)} · ${formatPilotDate(message.createdAt, lang)}`,
        'pilot-event-meta',
      ),
    );
    row.append(main);
    if (message.direction === 'outbound') {
      row.append(
        stamp(translatedDelivery(message.deliveryState, lang), 'unknown', {
          delivery: String(message.deliveryState ?? 'unknown'),
        }),
      );
    }
    item.append(row);
    return item;
  }

  function renderMessages(messages: readonly CaseMessage[]): void {
    if (!messageList) return;
    messageList.replaceChildren(
      ...(messages.length
        ? messages.map((message) => messageRow(message))
        : [createTextElement('li', pilotCopy.messages.empty[lang], 'pilot-state')]),
    );
  }

  async function loadMessages(): Promise<void> {
    if (!messageList || !isStaff()) return;
    try {
      renderMessages(await listCaseMessages(id));
    } catch (error) {
      messageList.replaceChildren(createTextElement('li', apiErrorMessage(error, lang), 'pilot-state'));
    }
  }

  /** Officials write questions; residents and reviewers never post here. */
  function renderMessageForm(): void {
    if (!messageForm) return;
    messageForm.hidden = role !== 'official';
    // Built once: a refresh of the case must not clear a half-typed question.
    if (role !== 'official' || messageFormBuilt) return;
    messageFormBuilt = true;
    const section = document.createElement('section');
    section.className = 'panel pilot-section';
    section.append(createTextElement('h3', pilotCopy.messages.formHeading[lang]));
    const form = document.createElement('form');
    form.className = 'pilot-form';
    const body = document.createElement('textarea');
    body.id = 'case-message-body';
    body.required = true;
    body.rows = 3;
    body.maxLength = MAX_MESSAGE_CHARS;
    const field = createField(body, pilotCopy.messages.body[lang], {
      hint: pilotCopy.messages.bodyHint[lang],
    });
    const counter = createTextElement(
      'p',
      `${pilotCopy.messages.remaining[lang]}: ${MAX_MESSAGE_CHARS}`,
      'field-hint',
    );
    counter.setAttribute('aria-live', 'polite');
    body.addEventListener('input', () => {
      counter.textContent = `${pilotCopy.messages.remaining[lang]}: ${MAX_MESSAGE_CHARS - body.value.length}`;
    });
    const row = document.createElement('div');
    row.className = 'pilot-actions';
    const send = createTextElement('button', pilotCopy.messages.send[lang], 'btn');
    send.type = 'submit';
    send.dataset.variant = 'primary';
    row.append(send);
    form.append(field.field, counter, row);
    section.append(form);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!form.reportValidity() || !record) return;
      void (async () => {
        send.disabled = true;
        const label = send.textContent ?? '';
        send.textContent = pilotCopy.messages.sending[lang];
        setState(messagesState, pilotCopy.messages.sending[lang]);
        try {
          const result = await sendCaseMessage(record.id, {
            expectedVersion: record.version,
            kind: 'question',
            body: body.value.trim(),
          });
          record = result.record;
          body.value = '';
          counter.textContent = `${pilotCopy.messages.remaining[lang]}: ${MAX_MESSAGE_CHARS}`;
          setState(messagesState, pilotCopy.messages.sent[lang], 'success');
          renderRecord(record);
          await loadMessages();
        } catch (error) {
          await reportCommandError(error, messagesState);
        } finally {
          send.disabled = false;
          send.textContent = label;
        }
      })();
    });

    messageForm.replaceChildren(section);
  }

  /** Reviewers only, and only while the case can still be closed. */
  function renderCloseForm(current: PrivateTraceRecord): void {
    if (!closeSection || !closeForm) return;
    const closable = current.status === 'open' || current.status === 'assigned' || current.status === 'returned';
    closeSection.hidden = role !== 'reviewer';
    if (role !== 'reviewer') return;
    if (!closable) {
      if (closeFormState === 'blocked') return;
      closeFormState = 'blocked';
      closeForm.replaceChildren(createTextElement('p', pilotCopy.close.noAction[lang], 'pilot-state'));
      return;
    }
    // Built once, so a refresh never clears a typed public reason.
    if (closeFormState === 'form') return;
    closeFormState = 'form';

    const form = document.createElement('form');
    form.className = 'pilot-form';
    const reason = document.createElement('select');
    reason.id = 'case-close-reason';
    reason.required = true;
    for (const value of CLOSED_REASONS) {
      const option = createTextElement('option', translatedClosedReason(value, lang));
      option.value = value;
      reason.append(option);
    }
    const reasonField = createField(reason, pilotCopy.close.reason[lang]);

    const publicReason = document.createElement('input');
    publicReason.id = 'case-close-public-reason';
    publicReason.type = 'text';
    publicReason.required = true;
    publicReason.maxLength = 200;
    const publicField = createField(publicReason, pilotCopy.close.publicReason[lang], {
      hint: pilotCopy.close.publicReasonHint[lang],
    });

    const note = document.createElement('textarea');
    note.id = 'case-close-note';
    note.rows = 2;
    note.maxLength = 2000;
    const noteField = createField(note, pilotCopy.close.note[lang]);

    const row = document.createElement('div');
    row.className = 'pilot-actions';
    const submit = createTextElement('button', pilotCopy.close.submit[lang], 'btn');
    submit.type = 'submit';
    submit.dataset.variant = 'primary';
    row.append(submit);
    form.append(reasonField.field, publicField.field, noteField.field, row);

    // The confirm step is a second, deliberate press: cancel on the left,
    // the irreversible action on the right (rule I7).
    const confirmBox = document.createElement('div');
    confirmBox.className = 'pilot-section';
    confirmBox.hidden = true;
    const confirmRow = document.createElement('div');
    confirmRow.className = 'pilot-actions';
    const cancel = createTextElement('button', pilotCopy.common.cancel[lang], 'btn');
    cancel.type = 'button';
    cancel.dataset.variant = 'secondary';
    const confirm = createTextElement('button', pilotCopy.close.confirm[lang], 'btn');
    confirm.type = 'button';
    confirm.dataset.variant = 'primary';
    confirmRow.append(cancel, confirm);
    confirmBox.append(
      createTextElement('h3', pilotCopy.close.confirmHeading[lang]),
      createTextElement('p', pilotCopy.close.confirmWarning[lang], 'pilot-state'),
      confirmRow,
    );

    const section = document.createElement('section');
    section.className = 'panel pilot-section';
    section.append(
      createTextElement('p', pilotCopy.close.intro[lang], 'pilot-lead'),
      form,
      confirmBox,
    );

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      confirmBox.hidden = false;
      submit.disabled = true;
      confirm.focus();
    });

    cancel.addEventListener('click', () => {
      confirmBox.hidden = true;
      submit.disabled = false;
      submit.focus();
    });

    confirm.addEventListener('click', () => {
      if (!record) return;
      void (async () => {
        confirm.disabled = true;
        cancel.disabled = true;
        setState(closeState, pilotCopy.close.closing[lang]);
        try {
          const trimmed = note.value.trim();
          const result = await closeCase(record.id, {
            expectedVersion: record.version,
            reason: reason.value,
            publicReason: publicReason.value.trim(),
            ...(trimmed ? { note: trimmed } : {}),
          });
          record = result.record;
          setState(closeState, pilotCopy.close.closed[lang], 'success');
          renderRecord(record);
        } catch (error) {
          await reportCommandError(error, closeState);
        } finally {
          confirm.disabled = false;
          cancel.disabled = false;
          confirmBox.hidden = true;
          submit.disabled = false;
        }
      })();
    });

    closeForm.replaceChildren(section);
  }

  function renderRecord(current: PrivateTraceRecord): void {
    const idElement = document.querySelector<HTMLElement>('[data-record-id]');
    if (idElement) idElement.textContent = current.caseNumber || current.id;
    const originSlot = document.querySelector<HTMLElement>('[data-record-origin]');
    originSlot?.replaceChildren(originBadge(current.origin));
    const status = document.querySelector<HTMLElement>('[data-record-status]');
    if (status) {
      const next = createStatus(current.status, lang);
      next.dataset.recordStatus = '';
      status.replaceWith(next);
    }
    const fields = document.querySelector<HTMLElement>('[data-private-fields]');
    fields?.replaceChildren(
      definition(pilotCopy.common.caseNumber[lang], current.caseNumber || pilotCopy.common.notAvailable[lang]),
      definition(pilotCopy.channel.label[lang], translatedOrigin(current.origin, lang)),
      definition(pilotCopy.detail.subject[lang], current.subject),
      definition(pilotCopy.detail.narrative[lang], current.narrative),
      definition(pilotCopy.detail.location[lang], current.location),
      definition(pilotCopy.detail.contact[lang], current.contactEmail || pilotCopy.common.notAvailable[lang]),
      definition(pilotCopy.common.created[lang], formatPilotDate(current.createdAt, lang)),
      definition(pilotCopy.common.updated[lang], formatPilotDate(current.updatedAt, lang)),
      definition(pilotCopy.common.recordId[lang], current.id),
    );
    renderClosedNotice(current);
    renderTrace(document, current.status, current.events);
    const events = document.querySelector<HTMLElement>('[data-private-events]');
    const eventRows = (Array.isArray(current.events) ? current.events : []).map((event: TraceEvent) => {
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
    const attachmentRows = (Array.isArray(current.attachments) ? current.attachments : []).map((attachment: TraceAttachment) => {
      const item = document.createElement('li');
      const link = createTextElement('a', attachment.filename || pilotCopy.common.details[lang], 'pilot-ledger-row');
      link.href = privateAttachmentHref(current.id, attachment.id);
      link.setAttribute('download', '');
      item.append(link);
      return item;
    });
    attachments?.replaceChildren(
      ...(attachmentRows.length ? attachmentRows : [createTextElement('li', pilotCopy.detail.noAttachments[lang], 'pilot-state')]),
    );
    renderProposals(current);
    if (messageSection) messageSection.hidden = !isStaff();
    renderMessageForm();
    renderCloseForm(current);
    if (root) root.hidden = false;
  }

  async function load(): Promise<void> {
    if (retry) retry.hidden = true;
    setState(state, pilotCopy.common.loading[lang]);
    const session = await requirePilotRole(['resident', 'official', 'reviewer']);
    if (!session) return;
    role = session.role;
    if (!id) {
      setState(state, pilotCopy.common.notAvailable[lang], 'error');
      return;
    }
    try {
      record = await getPrivateRecord(id);
      renderRecord(record);
      clearState(state);
      await loadMessages();
    } catch (error) {
      if (root) root.hidden = true;
      setState(state, apiErrorMessage(error, lang), 'error');
      if (retry) retry.hidden = false;
    }
  }

  retry?.addEventListener('click', () => void load());
  void load();
}
