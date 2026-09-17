// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * One case, one page. The header names the case and carries the single action
 * its state allows; the main column holds the report, the public text and one
 * merged activity stream with the composer at its foot; the properties column
 * holds the label/value rows and every secondary action.
 */

import {
  closeCase,
  decideAiProposal,
  getPilotConfig,
  getPrivateRecord,
  getPublicCase,
  holdCase,
  labelCase,
  listCaseMessages,
  privateAttachmentHref,
  releaseCase,
  sendCaseMessage,
} from '../../../lib/pilot/vrsar/api';
import type {
  AiProposal,
  CaseMessage,
  HoldReason,
  PilotConfig,
  PilotRole,
  PrivateTraceRecord,
  PublicCaseShell,
  PublicTextMode,
  TraceAttachment,
  TraceEvent,
} from '../../../lib/pilot/vrsar/model';
import { CLOSED_REASONS } from '../../../lib/pilot/vrsar/model';
import {
  pilotCopy,
  pilotHref,
  statusTone,
  textStatusTone,
  translatedAction,
  translatedAiKind,
  translatedAiStatus,
  translatedCaseLabel,
  translatedClosedReason,
  translatedDelivery,
  translatedHoldReason,
  translatedOrigin,
  translatedRole,
  translatedStatus,
  translatedTextStatus,
} from '../../../content/pilot/vrsar';
import { workspaceCopy } from '../../../content/pilot/vrsar-workspace';
import {
  assignForm,
  attachmentForm,
  commitmentForm,
  reopenForm,
  resolutionForm,
  type OfficeActionContext,
} from './office-actions';
import {
  apiErrorMessage,
  clearState,
  createField,
  createStatus,
  createTextElement,
  currentPilotLang,
  formatPilotDate,
  recordIdFromPath,
  requirePilotRole,
  setFieldError,
  setState,
} from './shell';

/** One SMS-sized question. The gateway splits nothing; the office writes short. */
const MAX_MESSAGE_CHARS = 480;
/** Below this the model's own confidence is worth stating as a caution. */
const LOW_CONFIDENCE = 0.5;
/** A commitment longer than this is folded behind a disclosure in the column. */
const COMMITMENT_PREVIEW = 240;
const STAFF_ROLES: readonly PilotRole[] = ['official'];
/*
 * The reasons an official may choose. The other four — pending-release, policy,
 * notices, confidential — belong to the system, which is why they are not in
 * this list and the backend refuses them from the hold route. Where one of them
 * is the current reason, the case page prints it as a label.
 */
const HOLD_REASONS: readonly HoldReason[] = ['personal-data', 'abuse', 'off-topic', 'other'];

function isSystemHoldReason(reason: unknown): boolean {
  return typeof reason === 'string' && !(HOLD_REASONS as readonly string[]).includes(reason);
}

let started = false;

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

/** Sortable time; an unparsable stamp sinks to the top rather than throwing. */
function sortTime(value: unknown): number {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function signatureLabel(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  const parts = value as { name?: unknown; title?: unknown };
  const name = typeof parts.name === 'string' ? parts.name.trim() : '';
  const title = typeof parts.title === 'string' ? parts.title.trim() : '';
  return [name, title].filter(Boolean).join(' · ');
}

export function initVrsarCaseDetail(): void {
  if (started) return;
  started = true;
  const lang = currentPilotLang();
  const id = recordIdFromPath();

  const state = document.querySelector<HTMLElement>('[data-page-state]');
  const root = document.querySelector<HTMLElement>('[data-private-record]');
  const retry = document.querySelector<HTMLButtonElement>('[data-retry]');

  const backLink = document.querySelector<HTMLAnchorElement>('[data-case-back]');
  const numberSlot = document.querySelector<HTMLElement>('[data-record-id]');
  const statusSlot = document.querySelector<HTMLElement>('[data-record-status]');
  const originSlot = document.querySelector<HTMLElement>('[data-record-origin]');
  const subjectSlot = document.querySelector<HTMLElement>('[data-case-subject]');
  const primarySlot = document.querySelector<HTMLElement>('[data-primary-action]');
  const secondarySlot = document.querySelector<HTMLElement>('[data-secondary-action]');
  const stateSentence = document.querySelector<HTMLElement>('[data-state-sentence]');

  // One state line outside every part a re-render replaces, so a confirmation
  // or an error survives the refresh it triggered.
  const actionState = document.querySelector<HTMLElement>('[data-action-state]');
  const actionPanel = document.querySelector<HTMLElement>('[data-action-panel]');
  const actionTitle = document.querySelector<HTMLElement>('[data-action-title]');
  const actionBody = document.querySelector<HTMLElement>('[data-action-body]');
  const actionClose = document.querySelector<HTMLButtonElement>('[data-action-close]');

  const reportNarrative = document.querySelector<HTMLElement>('[data-report-narrative]');
  const reportFields = document.querySelector<HTMLElement>('[data-report-fields]');

  const textSection = document.querySelector<HTMLElement>('[data-public-text-section]');
  const textStamp = document.querySelector<HTMLElement>('[data-public-stamp]');
  const textPanel = document.querySelector<HTMLElement>('[data-public-text-panel]');
  const textActions = document.querySelector<HTMLElement>('[data-public-text-actions]');

  const activityList = document.querySelector<HTMLElement>('[data-activity-list]');
  const composer = document.querySelector<HTMLElement>('[data-composer]');

  const propertiesList = document.querySelector<HTMLElement>('[data-properties]');
  const attachmentsList = document.querySelector<HTMLElement>('[data-private-attachments]');
  const attachmentUpload = document.querySelector<HTMLElement>('[data-attachment-upload]');
  const aiMount = document.querySelector<HTMLElement>('[data-ai-mount]');
  const closeSection = document.querySelector<HTMLElement>('[data-close-section]');
  const closeAction = document.querySelector<HTMLElement>('[data-close-action]');

  let record: PrivateTraceRecord | null = null;
  let shell: PublicCaseShell | null = null;
  let config: PilotConfig | null = null;
  let role: PilotRole = 'resident';
  let messages: CaseMessage[] = [];
  let composerBuilt = false;
  let attachmentVersion = -1;
  let textActionsState: 'none' | 'form' | 'blocked' | 'shell' | 'removed' = 'none';
  let textStatusState = '';
  let labelRow: HTMLElement | null = null;
  let panelInvoker: HTMLElement | null = null;

  /** The municipality's publicity mode; 'open' until the config says otherwise. */
  function publicTextMode(): PublicTextMode {
    return config?.publicTextMode ?? 'open';
  }

  function isStaff(): boolean {
    return STAFF_ROLES.includes(role);
  }

  function definition(term: string, value: string | Node, className = ''): HTMLDivElement {
    const row = document.createElement('div');
    const dd = document.createElement('dd');
    if (className) dd.className = className;
    dd.append(typeof value === 'string' ? document.createTextNode(value) : value);
    row.append(createTextElement('dt', term), dd);
    return row;
  }

  /**
   * The public shell is the only place the text, its visibility and its labels
   * live, so the office reads its own case exactly as the public does.
   */
  async function loadShell(): Promise<void> {
    const caseNumber = record?.caseNumber;
    if (!caseNumber || !isStaff()) {
      shell = null;
      return;
    }
    try {
      shell = (await getPublicCase(caseNumber)).case;
    } catch {
      shell = null;
    }
  }

  async function loadMessages(): Promise<void> {
    if (!isStaff()) {
      messages = [];
      return;
    }
    try {
      messages = await listCaseMessages(id);
    } catch {
      // The stream still carries the events; the failure is not worth a banner.
      messages = [];
    }
  }

  async function refresh(): Promise<void> {
    record = await getPrivateRecord(id);
    await loadShell();
    await loadMessages();
    renderRecord(record);
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
      await refresh();
    } catch {
      // The refresh is best effort; the message above already says what to do.
    }
  }

  function closeActionPanel(restoreFocus = true): void {
    if (!actionPanel || !actionBody) return;
    actionPanel.hidden = true;
    actionBody.replaceChildren();
    if (restoreFocus && panelInvoker?.isConnected) panelInvoker.focus();
    panelInvoker = null;
  }

  function openActionPanel(invoker: HTMLElement, title: string, body: Node): void {
    if (!actionPanel || !actionBody || !actionTitle) return;
    panelInvoker = invoker;
    actionTitle.textContent = title;
    actionBody.replaceChildren(body);
    actionPanel.hidden = false;
    clearState(actionState);
    actionTitle.focus();
  }

  function runOfficeCommand(
    button: HTMLButtonElement,
    pending: string,
    done: string,
    operation: () => Promise<unknown>,
  ): void {
    void (async () => {
      button.disabled = true;
      const label = button.textContent ?? '';
      button.textContent = pending;
      setState(actionState, pending);
      try {
        await operation();
        closeActionPanel(false);
        await refresh();
        setState(actionState, done, 'success');
        actionState?.focus();
      } catch (error) {
        await reportCommandError(error, actionState);
      } finally {
        button.disabled = false;
        button.textContent = label;
      }
    })();
  }

  function officeContext(current: PrivateTraceRecord): OfficeActionContext {
    return { record: current, lang, run: runOfficeCommand };
  }

  function panelButton(
    label: string,
    variant: 'primary' | 'secondary' | 'tertiary',
    title: string,
    build: (current: PrivateTraceRecord) => Node,
  ): HTMLButtonElement {
    const button = createTextElement('button', label, 'btn');
    button.type = 'button';
    button.dataset.variant = variant;
    button.addEventListener('click', () => {
      if (!record) return;
      openActionPanel(button, title, build(record));
    });
    return button;
  }

  /* ---- header ----------------------------------------------------------- */

  function originBadge(origin: unknown): HTMLSpanElement {
    const value = typeof origin === 'string' ? origin : 'unknown';
    const badge = stamp(translatedOrigin(value, lang), 'unknown', { origin: value });
    badge.setAttribute('aria-label', `${pilotCopy.channel.label[lang]}: ${translatedOrigin(value, lang)}`);
    return badge;
  }

  /**
   * One action, named for the state it moves (rule P3). Where the state leaves
   * the office nothing to do, the header says what the case is waiting on.
   */
  function renderPrimaryAction(current: PrivateTraceRecord): void {
    if (!primarySlot || !secondarySlot || !stateSentence) return;
    primarySlot.replaceChildren();
    secondarySlot.replaceChildren();
    stateSentence.replaceChildren();
    primarySlot.hidden = true;
    secondarySlot.hidden = true;
    stateSentence.hidden = true;
    if (role !== 'official') return;

    if (current.status === 'open') {
      primarySlot.append(assignForm(officeContext(current)));
      primarySlot.hidden = false;
      return;
    }
    if (current.status === 'assigned') {
      primarySlot.append(
        panelButton(
          workspaceCopy.primary.commitment[lang],
          'primary',
          pilotCopy.staff.commitmentHeading[lang],
          (target) => commitmentForm(officeContext(target)),
        ),
      );
      primarySlot.hidden = false;
      return;
    }
    if (current.status === 'answered' || current.status === 'disputed') {
      const label = current.status === 'disputed'
        ? workspaceCopy.primary.resolutionAgain[lang]
        : pilotCopy.staff.submitResolution[lang];
      primarySlot.append(
        panelButton(label, 'primary', pilotCopy.staff.resolutionHeading[lang], (target) =>
          resolutionForm(officeContext(target)),
        ),
      );
      primarySlot.hidden = false;
      if (current.status === 'disputed') {
        secondarySlot.append(
          panelButton(
            workspaceCopy.primary.reopen[lang],
            'tertiary',
            pilotCopy.staff.reopenHeading[lang],
            (target) => reopenForm(officeContext(target)),
          ),
        );
        secondarySlot.hidden = false;
      }
      return;
    }
    if (current.status === 'resolved') {
      stateSentence.append(createTextElement('span', workspaceCopy.state.resolved[lang]));
      stateSentence.hidden = false;
      return;
    }
    if (current.status === 'closed') {
      const reason = `${pilotCopy.close.reason[lang]}: ${translatedClosedReason(current.closedReason, lang)}`;
      stateSentence.append(
        createTextElement('span', `${workspaceCopy.state.closed[lang]} ${reason}`),
      );
      stateSentence.hidden = false;
    }
  }

  function renderHeader(current: PrivateTraceRecord): void {
    if (backLink) {
      backLink.href = role === 'official'
        ? pilotHref(`/pilot/vrsar/staff?case=${encodeURIComponent(current.id)}`, lang)
        : pilotHref('/pilot/vrsar/cases', lang);
      backLink.textContent = role === 'official'
        ? workspaceCopy.worklist[lang]
        : pilotCopy.common.back[lang];
    }
    // The case number is the name of the case; the UUID belongs to one
    // properties row and nowhere else.
    if (numberSlot) numberSlot.textContent = current.caseNumber || pilotCopy.detail.heading[lang];
    if (statusSlot) {
      statusSlot.textContent = translatedStatus(current.status, lang);
      statusSlot.dataset.tone = statusTone(current.status);
      statusSlot.dataset.status = current.status;
    }
    originSlot?.replaceChildren(originBadge(current.origin));
    if (subjectSlot) subjectSlot.textContent = current.subject;
    renderPrimaryAction(current);
  }

  /* ---- report ----------------------------------------------------------- */

  function renderReport(current: PrivateTraceRecord): void {
    // The subject is the line under the case number and nowhere else. Where the
    // narrative repeats it word for word, the report starts at the fields.
    if (reportNarrative) {
      reportNarrative.textContent = current.narrative;
      reportNarrative.hidden = current.narrative.trim() === current.subject.trim();
    }
    reportFields?.replaceChildren(
      definition(pilotCopy.detail.location[lang], current.location),
      definition(
        pilotCopy.detail.contact[lang],
        current.contactEmail || pilotCopy.common.notAvailable[lang],
      ),
      definition(pilotCopy.common.created[lang], formatPilotDate(current.createdAt, lang)),
      definition(pilotCopy.channel.label[lang], translatedOrigin(current.origin, lang)),
    );
  }

  /* ---- public text ------------------------------------------------------ */

  async function runTextCommand(
    button: HTMLButtonElement,
    pending: string,
    done: string,
    operation: () => Promise<PrivateTraceRecord>,
  ): Promise<void> {
    button.disabled = true;
    const label = button.textContent ?? '';
    button.textContent = pending;
    setState(actionState, pending);
    try {
      record = await operation();
      await loadShell();
      setState(actionState, done, 'success');
      renderRecord(record);
    } catch (error) {
      await reportCommandError(error, actionState);
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  }

  function renderPublicTextPanel(): void {
    if (!textPanel) return;
    if (textStamp) {
      const status = shell?.textStatus ?? 'unknown';
      textStamp.textContent = translatedTextStatus(status, lang);
      textStamp.dataset.tone = textStatusTone(status);
      textStamp.dataset.textStatus = String(status);
      textStamp.setAttribute(
        'aria-label',
        `${pilotCopy.publicText.status[lang]}: ${translatedTextStatus(status, lang)}`,
      );
    }
    if (!shell) {
      textPanel.replaceChildren(
        createTextElement('p', pilotCopy.publicText.unavailable[lang], 'pilot-state'),
      );
      return;
    }
    const body: Node[] = [];
    if (shell.textStatus === 'removed') {
      body.push(createTextElement('p', pilotCopy.publicText.removedNoRelease[lang], 'pilot-state'));
    } else if (shell.textStatus === 'held') {
      body.push(
        createTextElement('p', pilotCopy.publicText.heldNotice[lang], 'pilot-state'),
        createTextElement(
          'p',
          `${pilotCopy.publicText.holdReason[lang]}: ${translatedHoldReason(shell.holdReason, lang)}`,
          'pilot-event-meta',
        ),
      );
    } else {
      body.push(
        createTextElement('p', shell.text ?? pilotCopy.common.notAvailable[lang], 'pilot-public-copy'),
      );
    }
    if ((shell.labels ?? []).includes('form-letter')) {
      body.push(createTextElement('p', pilotCopy.publicText.labelExplanation[lang], 'pilot-event-meta'));
    }
    textPanel.replaceChildren(...body);
  }

  function inlineAction(summaryText: string): HTMLDetailsElement {
    const details = document.createElement('details');
    details.className = 'case-inline-action';
    details.append(createTextElement('summary', summaryText));
    return details;
  }

  /**
   * The reason on the case, printed rather than offered, when the system set
   * it. An official cannot pick these, so a select would lie about the choice.
   * The row is built empty and filled on every render, because the disclosure
   * around it is built once and must not be rebuilt under a half-typed note.
   */
  function systemReasonRow(): HTMLElement {
    const row = createTextElement('p', '', 'pilot-event-meta');
    row.dataset.systemReason = '';
    row.hidden = true;
    return row;
  }

  function renderSystemReasonRows(): void {
    const shown = Boolean(shell && shell.textStatus === 'held' && isSystemHoldReason(shell.holdReason));
    const line = shown
      ? `${pilotCopy.publicText.holdReason[lang]}: ${translatedHoldReason(shell?.holdReason, lang)}`
      : '';
    for (const row of textActions?.querySelectorAll<HTMLElement>('[data-system-reason]') ?? []) {
      row.textContent = line;
      row.hidden = !shown;
    }
  }

  function holdDisclosure(): HTMLDetailsElement {
    const details = inlineAction(workspaceCopy.text.hold[lang]);
    details.append(systemReasonRow());
    const form = document.createElement('form');
    form.className = 'pilot-form';
    const reason = document.createElement('select');
    reason.id = 'case-hold-reason';
    reason.required = true;
    for (const value of HOLD_REASONS) {
      const option = createTextElement('option', translatedHoldReason(value, lang));
      option.value = value;
      reason.append(option);
    }
    const reasonField = createField(reason, pilotCopy.publicText.holdReason[lang], {
      hint: pilotCopy.publicText.systemReasonsHint[lang],
    });
    const note = document.createElement('textarea');
    note.id = 'case-hold-note';
    note.rows = 2;
    note.maxLength = 2000;
    const noteField = createField(note, pilotCopy.publicText.holdNote[lang]);
    const row = document.createElement('div');
    row.className = 'pilot-actions';
    const submit = createTextElement('button', pilotCopy.publicText.hold[lang], 'btn');
    submit.type = 'submit';
    submit.dataset.variant = 'secondary';
    row.append(submit);
    form.append(reasonField.field, noteField.field, row);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!form.reportValidity() || !record) return;
      const trimmed = note.value.trim();
      void runTextCommand(
        submit,
        pilotCopy.publicText.holding[lang],
        pilotCopy.publicText.held[lang],
        () => holdCase(record!.id, {
          reason: reason.value as HoldReason,
          ...(trimmed ? { note: trimmed } : {}),
        }),
      );
    });
    details.append(form);
    return details;
  }

  function releaseDisclosure(): HTMLDetailsElement {
    const details = inlineAction(workspaceCopy.text.release[lang]);
    // In release mode this form is the act of publishing, and the reason the
    // text is waiting stands above it as a label.
    details.append(systemReasonRow());
    const form = document.createElement('form');
    form.className = 'pilot-form';
    const redacted = document.createElement('textarea');
    redacted.id = 'case-release-redacted';
    redacted.rows = 4;
    redacted.maxLength = 4000;
    // The original as filed is what a shortened version starts from.
    redacted.value = record?.narrative ?? shell?.text ?? '';
    const redactedField = createField(redacted, pilotCopy.publicText.redactedText[lang], {
      hint: pilotCopy.publicText.redactedHint[lang],
    });
    const row = document.createElement('div');
    row.className = 'pilot-actions';
    const asFiled = createTextElement('button', pilotCopy.publicText.releaseAsFiled[lang], 'btn');
    asFiled.type = 'button';
    asFiled.dataset.variant = 'primary';
    const withRedaction = createTextElement('button', pilotCopy.publicText.releaseRedacted[lang], 'btn');
    withRedaction.type = 'button';
    withRedaction.dataset.variant = 'secondary';
    row.append(asFiled, withRedaction);
    form.append(redactedField.field, row);

    asFiled.addEventListener('click', () => {
      if (!record) return;
      void runTextCommand(
        asFiled,
        pilotCopy.publicText.releasing[lang],
        pilotCopy.publicText.released[lang],
        () => releaseCase(record!.id, {}),
      );
    });
    withRedaction.addEventListener('click', () => {
      if (!record || !form.reportValidity()) return;
      const text = redacted.value.trim();
      if (!text) {
        setFieldError(redactedField, redacted, pilotCopy.filing.required[lang]);
        return;
      }
      setFieldError(redactedField, redacted, '');
      void runTextCommand(
        withRedaction,
        pilotCopy.publicText.releasing[lang],
        pilotCopy.publicText.released[lang],
        () => releaseCase(record!.id, { redactedText: text }),
      );
    });
    details.append(form);
    return details;
  }

  /** The soft label is a toggle, available in every state (rule P4). */
  function renderLabelButton(): void {
    if (!labelRow) return;
    const labelled = (shell?.labels ?? []).includes('form-letter');
    const button = createTextElement('button', pilotCopy.publicText.labelHeading[lang], 'btn');
    button.type = 'button';
    button.dataset.variant = 'secondary';
    button.setAttribute('aria-pressed', labelled ? 'true' : 'false');
    button.disabled = !shell;
    button.addEventListener('click', () => {
      if (!record) return;
      void runTextCommand(
        button,
        pilotCopy.publicText.labelling[lang],
        pilotCopy.publicText.labelled[lang],
        () => labelCase(record!.id, { label: 'form-letter', action: labelled ? 'clear' : 'set' }),
      );
    });
    labelRow.replaceChildren(button);
  }

  /**
   * Which text actions the office has. A closed case stops them, as the
   * transition table says; a removed text stops them too, and a shell-mode
   * municipality never releases. Each says so in one sentence instead of
   * showing a dead form.
   */
  function textActionsMode(current: PrivateTraceRecord): 'form' | 'blocked' | 'shell' | 'removed' {
    if (current.status === 'closed') return 'blocked';
    if (shell?.textStatus === 'removed') return 'removed';
    if (publicTextMode() === 'shell') return 'shell';
    return 'form';
  }

  function textActionsBody(mode: 'form' | 'blocked' | 'shell' | 'removed'): Node[] {
    if (mode === 'blocked') {
      return [createTextElement('p', pilotCopy.publicText.closedNoAction[lang], 'pilot-state')];
    }
    if (mode === 'removed') {
      return [createTextElement('p', pilotCopy.publicText.removedNoRelease[lang], 'pilot-state')];
    }
    if (mode === 'shell') {
      return [
        holdDisclosure(),
        createTextElement('p', pilotCopy.publicText.shellModeNoRelease[lang], 'pilot-state'),
      ];
    }
    // Releasing is only an act where the text is currently withheld.
    return shell?.textStatus === 'held'
      ? [holdDisclosure(), releaseDisclosure()]
      : [holdDisclosure()];
  }

  function renderPublicText(current: PrivateTraceRecord): void {
    if (!textSection || !textActions) return;
    textSection.hidden = !isStaff();
    if (!isStaff()) return;
    renderPublicTextPanel();
    const mode = textActionsMode(current);
    const status = String(shell?.textStatus ?? 'unknown');
    // Rebuilt only when the permitted set changes, so a half-typed note stays.
    if (textActionsState !== mode || textStatusState !== status) {
      textActionsState = mode;
      textStatusState = status;
      labelRow = document.createElement('div');
      textActions.replaceChildren(...textActionsBody(mode), labelRow);
    }
    renderSystemReasonRows();
    renderLabelButton();
  }

  /* ---- activity --------------------------------------------------------- */

  /** One word for who appended the row, in the shared stamp recipe. */
  function actorStamp(actor: unknown, text: string): HTMLSpanElement {
    return stamp(text, 'unknown', { actor: typeof actor === 'string' ? actor : 'system' });
  }

  function eventActor(actorRole: unknown): string {
    return actorRole === 'resident'
      ? workspaceCopy.activity.resident[lang]
      : actorRole === 'official'
        ? workspaceCopy.activity.office[lang]
        : actorRole === 'gateway'
          ? workspaceCopy.activity.gateway[lang]
          : workspaceCopy.activity.system[lang];
  }

  function activityRow(actor: unknown, actorText: string, nodes: Node[]): HTMLLIElement {
    const item = document.createElement('li');
    const body = document.createElement('div');
    body.className = 'case-activity-body';
    body.append(...nodes);
    item.append(actorStamp(actor, actorText), body);
    return item;
  }

  function eventRow(event: TraceEvent): HTMLLIElement {
    const nodes: Node[] = [
      createTextElement('strong', translatedAction(event.action, lang)),
      createTextElement('span', formatPilotDate(event.createdAt, lang), 'pilot-event-meta'),
    ];
    if (event.note) nodes.push(createTextElement('span', event.note, 'pilot-event-meta'));
    const item = activityRow(event.actorRole, eventActor(event.actorRole), nodes);
    item.dataset.kind = 'event';
    return item;
  }

  function messageRow(message: CaseMessage): HTMLLIElement {
    // A notice comes from a reader the office never sees, so it is filed under
    // the system rather than under the filer.
    const author = message.kind === 'notice'
      ? translatedRole('system', lang)
      : message.direction === 'inbound'
        ? workspaceCopy.activity.resident[lang]
        : workspaceCopy.activity.office[lang];
    const actor = message.kind === 'notice'
      ? 'system'
      : message.direction === 'inbound'
        ? 'resident'
        : 'official';
    // An appeal, a dispute or a notice is named, so it never reads as an
    // ordinary reply. A plain message needs no name: the stamp already says
    // who wrote it and the body says the rest.
    const kind = message.kind === 'label-appeal'
      ? pilotCopy.messages.labelAppeal[lang]
      : message.kind === 'dispute'
        ? pilotCopy.messages.dispute[lang]
        : message.kind === 'notice'
          ? pilotCopy.messages.notice[lang]
          : '';
    const marks = document.createElement('p');
    marks.className = 'case-activity-marks';
    if (message.kind === 'notice' && message.noticeReason) {
      marks.append(
        stamp(translatedHoldReason(message.noticeReason, lang), 'unknown', {
          noticeReason: String(message.noticeReason),
        }),
      );
    } else if (message.direction === 'outbound') {
      marks.append(
        stamp(translatedDelivery(message.deliveryState, lang), 'unknown', {
          delivery: String(message.deliveryState ?? 'unknown'),
        }),
      );
    }
    const item = activityRow(actor, author, [
      ...(kind ? [createTextElement('strong', kind)] : []),
      createTextElement('p', message.body),
      createTextElement(
        'span',
        `${translatedOrigin(message.channel, lang)} · ${formatPilotDate(message.createdAt, lang)}`,
        'pilot-event-meta',
      ),
      marks,
    ]);
    item.dataset.kind = 'message';
    item.dataset.direction = message.direction;
    return item;
  }

  /** Events and messages in one list, oldest first: one story, not two. */
  function renderActivity(current: PrivateTraceRecord): void {
    if (!activityList) return;
    const events = Array.isArray(current.events) ? current.events : [];
    const entries = [
      ...events.map((event) => ({ at: sortTime(event.createdAt), node: eventRow(event) })),
      ...messages.map((message) => ({ at: sortTime(message.createdAt), node: messageRow(message) })),
    ].sort((left, right) => left.at - right.at);
    activityList.replaceChildren(
      ...(entries.length
        ? entries.map((entry) => entry.node)
        : [createTextElement('li', workspaceCopy.activity.empty[lang], 'pilot-state')]),
    );
  }

  /** Officials write questions; residents never post here. */
  function renderComposer(): void {
    if (!composer) return;
    composer.hidden = role !== 'official';
    // Built once: a refresh of the case must not clear a half-typed question.
    if (role !== 'official' || composerBuilt) return;
    composerBuilt = true;
    const form = document.createElement('form');
    form.className = 'pilot-form';
    const body = document.createElement('textarea');
    body.id = 'case-message-body';
    body.required = true;
    body.rows = 3;
    body.maxLength = MAX_MESSAGE_CHARS;
    const field = createField(body, pilotCopy.messages.body[lang]);
    // One muted row under the box: the visibility notice on the left, what is
    // left of the message on the right (rule P6).
    const meta = document.createElement('p');
    meta.className = 'case-composer-meta';
    const counter = createTextElement(
      'span',
      `${pilotCopy.messages.remaining[lang]}: ${MAX_MESSAGE_CHARS}`,
      'case-composer-count',
    );
    counter.setAttribute('aria-live', 'polite');
    meta.append(
      createTextElement('span', workspaceCopy.activity.composerNotice[lang]),
      counter,
    );
    body.addEventListener('input', () => {
      counter.textContent = `${pilotCopy.messages.remaining[lang]}: ${MAX_MESSAGE_CHARS - body.value.length}`;
    });
    const row = document.createElement('div');
    row.className = 'pilot-actions';
    const send = createTextElement('button', pilotCopy.messages.send[lang], 'btn');
    send.type = 'submit';
    send.dataset.variant = 'primary';
    row.append(send);
    form.append(field.field, meta, row);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!form.reportValidity() || !record) return;
      void (async () => {
        send.disabled = true;
        const label = send.textContent ?? '';
        send.textContent = pilotCopy.messages.sending[lang];
        setState(actionState, pilotCopy.messages.sending[lang]);
        try {
          const result = await sendCaseMessage(record!.id, {
            expectedVersion: record!.version,
            kind: 'question',
            body: body.value.trim(),
          });
          record = result.record;
          body.value = '';
          counter.textContent = `${pilotCopy.messages.remaining[lang]}: ${MAX_MESSAGE_CHARS}`;
          setState(actionState, pilotCopy.messages.sent[lang], 'success');
          await loadMessages();
          renderRecord(record);
        } catch (error) {
          await reportCommandError(error, actionState);
        } finally {
          send.disabled = false;
          send.textContent = label;
        }
      })();
    });

    composer.replaceChildren(form);
  }

  /* ---- properties column ------------------------------------------------ */

  function dueValue(current: PrivateTraceRecord): Node {
    if (!current.dueDate) return document.createTextNode(pilotCopy.common.notAvailable[lang]);
    const wrap = document.createElement('span');
    wrap.append(formatPilotDate(current.dueDate, lang, true));
    const settled = current.status === 'resolved' || current.status === 'closed';
    const parsed = Date.parse(`${current.dueDate}T23:59:59Z`);
    if (!settled && Number.isFinite(parsed) && parsed < Date.now()) {
      wrap.append(' ', stamp(workspaceCopy.properties.overdue[lang], 'danger', { overdue: 'true' }));
    }
    return wrap;
  }

  function commitmentValue(current: PrivateTraceRecord): Node {
    const text = current.commitment ?? '';
    if (!text) return document.createTextNode(pilotCopy.common.notAvailable[lang]);
    if (text.length <= COMMITMENT_PREVIEW) return document.createTextNode(text);
    const details = document.createElement('details');
    details.className = 'case-more';
    details.append(
      createTextElement(
        'summary',
        `${text.slice(0, COMMITMENT_PREVIEW).trimEnd()}… ${workspaceCopy.properties.more[lang]}`,
      ),
      createTextElement('p', text),
    );
    return details;
  }

  function signatureValue(current: PrivateTraceRecord): string {
    const events = Array.isArray(current.events) ? current.events : [];
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const found = signatureLabel((events[index] as { signedBy?: unknown }).signedBy);
      if (found) return found;
    }
    return (
      signatureLabel((current as { signedBy?: unknown }).signedBy) ||
      pilotCopy.common.notAvailable[lang]
    );
  }

  function publicTextValue(): Node {
    const marks = document.createElement('span');
    marks.className = 'case-activity-marks';
    const status = shell?.textStatus ?? 'unknown';
    marks.append(stamp(translatedTextStatus(status, lang), textStatusTone(status), {
      textStatus: String(status),
    }));
    if (shell?.textStatus === 'held') {
      marks.append(stamp(translatedHoldReason(shell.holdReason, lang), 'warning', {
        holdReason: String(shell.holdReason ?? 'unknown'),
      }));
    }
    // How many readers reported the text, beside what the public can see of it.
    const notices = Number(shell?.noticeCount) || 0;
    if (notices > 0) {
      marks.append(stamp(`${pilotCopy.publicText.noticeCount[lang]}: ${notices}`, 'unknown', {
        noticeCount: String(notices),
      }));
    }
    for (const label of shell?.labels ?? []) {
      // A soft label never highlights: the chip stays in the neutral tone (rule P4).
      marks.append(stamp(translatedCaseLabel(label, lang), 'unknown', { caseLabel: label }));
    }
    return marks;
  }

  function attentionValue(current: PrivateTraceRecord): string {
    const count = (value: unknown): string =>
      typeof value === 'number' && Number.isFinite(value) ? String(value) : '0';
    return [
      `${workspaceCopy.properties.followers[lang]}: ${count(shell?.followerCount ?? current.followerCount)}`,
      `${workspaceCopy.properties.alsoAffected[lang]}: ${count(shell?.alsoAffectedCount ?? current.alsoAffectedCount)}`,
      `${workspaceCopy.properties.notFixed[lang]}: ${count(shell?.notFixedCount)}`,
      `${workspaceCopy.properties.disputes[lang]}: ${count(shell?.disputeCount)}`,
    ].join(' · ');
  }

  function renderProperties(current: PrivateTraceRecord): void {
    if (!propertiesList) return;
    const rows: HTMLDivElement[] = [
      definition(workspaceCopy.properties.state[lang], createStatus(current.status, lang)),
      definition(pilotCopy.staff.dueDate[lang], dueValue(current)),
      definition(pilotCopy.receipts.commitment[lang], commitmentValue(current)),
      definition(workspaceCopy.properties.signature[lang], signatureValue(current)),
    ];
    if (isStaff()) {
      rows.push(
        definition(pilotCopy.publicText.heading[lang], publicTextValue()),
        definition(workspaceCopy.properties.attention[lang], attentionValue(current)),
      );
    }
    if (current.status === 'closed') {
      rows.push(
        definition(
          pilotCopy.close.closedPublicReason[lang],
          current.closedPublicReason || pilotCopy.common.notAvailable[lang],
        ),
      );
    }
    // The only place the UUID is printed (rule: case number everywhere else).
    rows.push(
      definition(pilotCopy.common.recordId[lang], current.id, 'case-record-id'),
      definition(pilotCopy.common.version[lang], String(current.version)),
    );
    propertiesList.replaceChildren(...rows);
  }

  function renderAttachments(current: PrivateTraceRecord): void {
    const rows = (Array.isArray(current.attachments) ? current.attachments : []).map(
      (attachment: TraceAttachment) => {
        const item = document.createElement('li');
        const link = createTextElement('a', attachment.filename || pilotCopy.common.details[lang]);
        link.href = privateAttachmentHref(current.id, attachment.id);
        link.setAttribute('download', '');
        item.append(link);
        return item;
      },
    );
    attachmentsList?.replaceChildren(
      ...(rows.length
        ? rows
        : [createTextElement('li', pilotCopy.detail.noAttachments[lang], 'pilot-state')]),
    );
    if (!attachmentUpload) return;
    attachmentUpload.hidden = role !== 'official';
    if (role !== 'official' || attachmentVersion === current.version) return;
    // Rebuilt on a version change so the upload never carries a stale version.
    attachmentVersion = current.version;
    const details = inlineAction(workspaceCopy.properties.addAttachment[lang]);
    details.append(attachmentForm(officeContext(current)));
    attachmentUpload.replaceChildren(details);
  }

  function proposalPanel(proposal: AiProposal): HTMLElement {
    const item = document.createElement('li');
    item.className = 'case-proposal';
    const marks = document.createElement('p');
    marks.className = 'case-activity-marks';
    marks.append(stamp(translatedAiStatus(proposal.status, lang), 'unknown', { aiStatus: proposal.status }));
    item.append(createTextElement('strong', translatedAiKind(proposal.kind, lang)), marks);
    item.append(
      createTextElement(
        'p',
        proposedValueText(proposal) || pilotCopy.common.notAvailable[lang],
      ),
      createTextElement(
        'p',
        `${pilotCopy.ai.confidence[lang]}: ${percent(proposal.confidence, lang)} · ${pilotCopy.ai.model[lang]}: ${proposal.modelId} · ${proposal.modelVersion}`,
        'pilot-event-meta',
      ),
    );

    // Risk reads as sentences, not as a colour or an icon (rules P4, C2).
    if (typeof proposal.confidence === 'number' && proposal.confidence < LOW_CONFIDENCE) {
      item.append(createTextElement('p', pilotCopy.ai.lowConfidence[lang], 'pilot-state'));
    }
    if (proposal.kind === 'duplicate-of') {
      item.append(createTextElement('p', pilotCopy.ai.duplicateRisk[lang], 'pilot-state'));
    }

    if (proposal.status !== 'proposed') {
      item.append(
        createTextElement(
          'p',
          `${pilotCopy.ai.decidedAt[lang]}: ${formatPilotDate(proposal.decidedAt, lang)}`,
          'pilot-event-meta',
        ),
      );
      if (proposal.decisionNote) {
        item.append(createTextElement('p', proposal.decisionNote, 'pilot-event-meta'));
      }
      return item;
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
    item.append(form);

    function decide(button: HTMLButtonElement, decision: 'accepted' | 'rejected'): void {
      if (!record) return;
      const trimmed = note.value.trim();
      const target = record;
      runOfficeCommand(button, pilotCopy.ai.deciding[lang], pilotCopy.ai.decided[lang], () =>
        decideAiProposal(target.id, proposal.id, {
          expectedVersion: target.version,
          decision,
          ...(trimmed ? { note: trimmed } : {}),
        }),
      );
    }

    accept.addEventListener('click', () => decide(accept, 'accepted'));
    reject.addEventListener('click', () => decide(reject, 'rejected'));
    return item;
  }

  /** The section exists only where a proposal does; an empty one would lie. */
  function renderProposals(current: PrivateTraceRecord): void {
    if (!aiMount) return;
    const hasProposals = Array.isArray(current.aiProposals) && current.aiProposals.length > 0;
    if (!isStaff() || !hasProposals) {
      aiMount.replaceChildren();
      return;
    }
    const section = document.createElement('section');
    section.className = 'case-properties-group';
    section.append(createTextElement('h3', pilotCopy.ai.heading[lang], 'case-properties-title'));
    section.append(createTextElement('p', pilotCopy.ai.rule[lang], 'pilot-disclosure'));
    const list = document.createElement('ul');
    list.className = 'case-proposals';
    list.append(...(current.aiProposals ?? []).map((proposal) => proposalPanel(proposal)));
    section.append(list);
    aiMount.replaceChildren(section);
  }

  /* ---- close ------------------------------------------------------------ */

  function closeForm(current: PrivateTraceRecord): HTMLElement {
    const wrap = document.createElement('div');
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
    confirmBox.hidden = true;
    const confirmRow = document.createElement('div');
    confirmRow.className = 'pilot-actions';
    const cancel = createTextElement('button', pilotCopy.common.cancel[lang], 'btn');
    cancel.type = 'button';
    cancel.dataset.variant = 'secondary';
    const confirm = createTextElement('button', pilotCopy.close.confirm[lang], 'btn');
    confirm.type = 'button';
    confirm.dataset.variant = 'danger';
    confirmRow.append(cancel, confirm);
    confirmBox.append(
      createTextElement('p', pilotCopy.close.confirmWarning[lang], 'pilot-state'),
      confirmRow,
    );

    wrap.append(createTextElement('p', pilotCopy.close.intro[lang], 'pilot-state'), form, confirmBox);

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
      const trimmed = note.value.trim();
      runOfficeCommand(confirm, pilotCopy.close.closing[lang], pilotCopy.close.closed[lang], () =>
        closeCase(current.id, {
          expectedVersion: current.version,
          reason: reason.value,
          publicReason: publicReason.value.trim(),
          ...(trimmed ? { note: trimmed } : {}),
        }),
      );
    });

    return wrap;
  }

  /** The office closes the case, and only while it can still be closed. */
  function renderCloseSection(current: PrivateTraceRecord): void {
    if (!closeSection || !closeAction) return;
    closeSection.hidden = role !== 'official';
    if (role !== 'official') return;
    const closable = current.status === 'open' || current.status === 'assigned';
    if (!closable) {
      closeSection.hidden = true;
      closeAction.replaceChildren();
      return;
    }
    closeAction.replaceChildren(
      panelButton(pilotCopy.close.submit[lang], 'secondary', pilotCopy.close.heading[lang], (target) =>
        closeForm(target),
      ),
    );
  }

  /* ---- render ----------------------------------------------------------- */

  function renderRecord(current: PrivateTraceRecord): void {
    renderHeader(current);
    renderReport(current);
    renderPublicText(current);
    renderActivity(current);
    renderComposer();
    renderProperties(current);
    renderAttachments(current);
    renderProposals(current);
    renderCloseSection(current);
    if (root) root.hidden = false;
  }

  async function load(): Promise<void> {
    if (retry) retry.hidden = true;
    setState(state, pilotCopy.common.loading[lang]);
    const session = await requirePilotRole(['resident', 'official']);
    if (!session) return;
    role = session.role;
    if (!id) {
      setState(state, pilotCopy.common.notAvailable[lang], 'error');
      return;
    }
    try {
      // The publicity mode decides which text actions exist, so it is read with
      // the record; a config that will not load leaves the open-mode forms up.
      const [loaded, loadedConfig] = await Promise.all([
        getPrivateRecord(id),
        getPilotConfig().catch(() => null),
      ]);
      record = loaded;
      config = loadedConfig;
      await loadShell();
      await loadMessages();
      renderRecord(record);
      clearState(state);
    } catch (error) {
      if (root) root.hidden = true;
      setState(state, apiErrorMessage(error, lang), 'error');
      if (retry) retry.hidden = false;
    }
  }

  actionClose?.addEventListener('click', () => closeActionPanel());
  retry?.addEventListener('click', () => void load());
  void load();
}
