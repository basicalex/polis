import {
  pilotCopy,
  pilotHref,
  statusTone,
  translatedAction,
  translatedError,
  translatedRole,
  translatedStatus,
  type PilotLang,
} from '../../../content/pilot/vrsar';
import { getPilotConfig, getPilotSession, logoutPilotSession, PilotApiError } from '../../../lib/pilot/vrsar/api';
import { entityName, latestTraceEvent, type PilotRole, type PilotSession, type TraceEvent } from '../../../lib/pilot/vrsar/model';

let shellStarted = false;
let sessionPromise: Promise<PilotSession> | null = null;

export function currentPilotLang(): PilotLang {
  const lang = document.documentElement.lang;
  return lang === 'it' || lang === 'en' ? lang : 'hr';
}

export function formatPilotDate(value: unknown, lang = currentPilotLang(), dateOnly = false): string {
  if (typeof value !== 'string' || !value) return pilotCopy.common.dateUnavailable[lang];
  const date = dateOnly && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00Z`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return pilotCopy.common.dateUnavailable[lang];
  return new Intl.DateTimeFormat(lang === 'hr' ? 'hr-HR' : lang === 'it' ? 'it-IT' : 'en-GB', {
    dateStyle: 'medium',
    ...(dateOnly ? {} : { timeStyle: 'short' }),
  }).format(date);
}

export function createTextElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text: unknown,
  className?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = typeof text === 'string' || typeof text === 'number' ? String(text) : '';
  return element;
}

export function setState(
  element: HTMLElement | null,
  message: string,
  tone: 'neutral' | 'error' | 'warning' | 'success' = 'neutral',
): void {
  if (!element) return;
  element.textContent = message;
  element.dataset.tone = tone;
  element.hidden = false;
  if (tone === 'error') element.focus({ preventScroll: false });
}

export function clearState(element: HTMLElement | null): void {
  if (!element) return;
  element.textContent = '';
  element.dataset.tone = 'neutral';
  element.hidden = true;
}

export function apiErrorMessage(error: unknown, lang = currentPilotLang()): string {
  if (error instanceof PilotApiError) return translatedError(error.code, lang);
  if (error instanceof Error && error.message === 'invalid_records_response') {
    return pilotCopy.common.connectionError[lang];
  }
  return pilotCopy.common.connectionError[lang];
}

export function createStatus(status: unknown, lang = currentPilotLang()): HTMLSpanElement {
  const value = typeof status === 'string' ? status : 'unknown';
  const element = createTextElement('span', translatedStatus(value, lang), 'status-label');
  element.dataset.tone = statusTone(value);
  element.dataset.status = value;
  return element;
}

/**
 * One field: label, control, optional hint, and an error line that sits under
 * the control it belongs to (rules H6, I5, S2). The control keeps the field's
 * id so the label and both messages stay wired to it.
 */
export interface PilotFieldParts {
  field: HTMLDivElement;
  error: HTMLParagraphElement;
}

export function createField(
  control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  labelText: string,
  options: { hint?: string; width?: 'date' | 'code' | 'email' } = {},
): PilotFieldParts {
  const field = document.createElement('div');
  field.className = 'field';
  if (options.width) field.dataset.width = options.width;
  const label = createTextElement('label', labelText);
  label.htmlFor = control.id;
  const error = createTextElement('p', '', 'field-error');
  error.id = `${control.id}-error`;
  const describedBy: string[] = [];
  field.append(label, control);
  if (options.hint) {
    const hint = createTextElement('p', options.hint, 'field-hint');
    hint.id = `${control.id}-hint`;
    field.append(hint);
    describedBy.push(hint.id);
  }
  describedBy.push(error.id);
  control.setAttribute('aria-describedby', describedBy.join(' '));
  field.append(error);
  return { field, error };
}

export function setFieldError(
  parts: PilotFieldParts,
  control: HTMLElement,
  message: string,
): void {
  parts.error.textContent = message;
  if (message) {
    control.setAttribute('aria-invalid', 'true');
    control.focus();
  } else {
    control.removeAttribute('aria-invalid');
  }
}

export function getSession(): Promise<PilotSession> {
  sessionPromise ??= getPilotSession().catch((error) => {
    sessionPromise = null;
    throw error;
  });
  return sessionPromise;
}

export async function requirePilotRole(allowed: readonly PilotRole[]): Promise<PilotSession | null> {
  const lang = currentPilotLang();
  try {
    const session = await getSession();
    if (!allowed.includes(session.role)) {
      const state = document.querySelector<HTMLElement>('[data-page-state]');
      setState(state, pilotCopy.common.wrongRole[lang], 'error');
      return null;
    }
    return session;
  } catch (error) {
    if (error instanceof PilotApiError && error.status === 401) {
      const returnUrl = `${location.pathname}${location.search}`;
      const login = new URL(pilotHref('/pilot/vrsar/login', lang), location.origin);
      login.searchParams.set('return', returnUrl);
      location.replace(login.toString());
      return null;
    }
    const state = document.querySelector<HTMLElement>('[data-page-state]');
    setState(state, apiErrorMessage(error, lang), 'error');
    return null;
  }
}

export function recordIdFromPath(): string {
  const parts = location.pathname.split('/').filter(Boolean);
  const raw = parts.at(-1) ?? '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return '';
  }
}

export function renderTrace(
  root: ParentNode,
  status: unknown,
  eventsValue: unknown,
  options: { hideMissingStages?: boolean } = {},
): void {
  const lang = currentPilotLang();
  const events = Array.isArray(eventsValue) ? (eventsValue as TraceEvent[]) : [];
  const activeStage: Record<string, string> = {
    open: 'voice',
    assigned: 'responsibility',
    'commitment-pending-review': 'check',
    returned: 'response',
    published: 'receipt',
    'resolution-pending-review': 'check',
    resolved: 'receipt',
  };
  const active = activeStage[typeof status === 'string' ? status : ''] ?? 'voice';

  root.querySelectorAll<HTMLElement>('[data-trace] [data-stage]').forEach((stage) => {
    const stageName = stage.dataset.stage ?? '';
    const event = latestTraceEvent(events, stageName);
    stage.hidden = Boolean(options.hideMissingStages && !event);
    stage.dataset.state = event ? 'appended' : stageName === active ? 'active' : 'ahead';
    if (stageName === active && !event) stage.dataset.state = 'active';
    stage.dataset.proposed =
      (status === 'commitment-pending-review' || status === 'resolution-pending-review') && stageName === 'check'
        ? 'true'
        : 'false';
    const note = stage.querySelector<HTMLElement>('[data-trace-note]');
    if (!note) return;
    if (!event) {
      note.textContent = stageName === active ? translatedStatus(status, lang) : '';
      return;
    }
    const parts = [translatedAction(event.action, lang), translatedRole(event.actorRole, lang), formatPilotDate(event.createdAt, lang)].filter(Boolean);
    note.textContent = parts.join(' · ');
  });
}

function currentPage(): string {
  return document.querySelector<HTMLElement>('[data-pilot-shell]')?.dataset.page ?? '';
}

function navLink(path: string, label: string, pageNames: string[], lang: PilotLang): HTMLAnchorElement {
  const link = createTextElement('a', label);
  link.href = pilotHref(path, lang);
  if (pageNames.includes(currentPage())) link.setAttribute('aria-current', 'page');
  return link;
}

function renderNavigation(session: PilotSession | null): void {
  const lang = currentPilotLang();
  const nav = document.querySelector<HTMLElement>('[data-pilot-nav]');
  if (!nav) return;
  const nodes: Node[] = [
    navLink('/pilot/vrsar', pilotCopy.nav.home[lang], ['home'], lang),
  ];
  if (session?.role === 'resident') {
    nodes.push(
      navLink('/pilot/vrsar/file', pilotCopy.nav.file[lang], ['file'], lang),
      navLink('/pilot/vrsar/cases', pilotCopy.nav.cases[lang], ['cases', 'case-detail'], lang),
    );
  } else if (session?.role === 'official') {
    nodes.push(navLink('/pilot/vrsar/staff', pilotCopy.nav.staff[lang], ['staff'], lang));
  } else if (session?.role === 'reviewer') {
    nodes.push(navLink('/pilot/vrsar/review', pilotCopy.nav.review[lang], ['review'], lang));
  }
  nodes.push(
    navLink('/pilot/vrsar/receipts', pilotCopy.nav.receipts[lang], ['receipts', 'receipt-detail'], lang),
  );
  if (session) {
    const role = createTextElement('span', translatedRole(session.role, lang), 'pilot-context');
    role.setAttribute('aria-label', `${pilotCopy.common.role[lang]}: ${translatedRole(session.role, lang)}`);
    const logout = createTextElement('button', pilotCopy.nav.logout[lang]);
    logout.type = 'button';
    logout.addEventListener('click', async () => {
      logout.disabled = true;
      try {
        await logoutPilotSession();
      } catch {
        // The BFF clears its HttpOnly cookie even if upstream revocation is unavailable.
      }
      location.assign(pilotHref('/pilot/vrsar/login', lang));
    });
    nodes.push(role, logout);
  } else {
    nodes.push(navLink('/pilot/vrsar/login', pilotCopy.nav.login[lang], ['login'], lang));
  }
  nav.replaceChildren(...nodes);
}

export function initPilotShell(): void {
  if (shellStarted) return;
  shellStarted = true;
  const lang = currentPilotLang();
  const context = document.querySelector<HTMLElement>('[data-pilot-context]');

  Promise.allSettled([getPilotConfig(), getSession()]).then(([configResult, sessionResult]) => {
    if (configResult.status === 'fulfilled' && context) {
      const config = configResult.value;
      const municipality = entityName(config.municipality, lang);
      const category = entityName(config.category, lang);
      const office = entityName(config.office, lang);
      context.textContent = [municipality, category, office].filter(Boolean).join(' · ') || pilotCopy.appTitle[lang];
    }
    renderNavigation(sessionResult.status === 'fulfilled' ? sessionResult.value : null);
  });
}
