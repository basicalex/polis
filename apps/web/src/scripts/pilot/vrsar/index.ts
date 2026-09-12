// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { getPilotConfig, getPilotSession, PilotApiError } from '../../../lib/pilot/vrsar/api';
import { entityName } from '../../../lib/pilot/vrsar/model';
import { pilotCopy, pilotHref, pickLocalized, translatedRole } from '../../../content/pilot/vrsar';
import {
  apiErrorMessage,
  clearState,
  createTextElement,
  currentPilotLang,
  setState,
} from './shell';

let started = false;

export function initVrsarEntry(): void {
  if (started) return;
  started = true;
  const lang = currentPilotLang();
  const configState = document.querySelector<HTMLElement>('[data-config-state]');
  const configDetails = document.querySelector<HTMLElement>('[data-config-details]');
  const alert = document.querySelector<HTMLElement>('[data-runtime-alert]');
  const alertDetail = document.querySelector<HTMLElement>('[data-runtime-alert-detail]');
  const retry = document.querySelector<HTMLButtonElement>('[data-config-retry]');
  const sources = document.querySelector<HTMLElement>('[data-config-sources]');
  const intake = document.querySelector<HTMLElement>('[data-intake-state]');
  const pageState = document.querySelector<HTMLElement>('[data-page-state]');
  const actions = document.querySelector<HTMLElement>('[data-entry-actions]');

  let runtimeDown = false;

  /**
   * While the runtime is unreachable, retrying is the only action that can
   * work, so the role card keeps its links but gives up the primary rank and
   * the page is left with a single primary (rule H2).
   */
  function rankActions(): void {
    actions?.querySelectorAll<HTMLElement>('[data-rank]').forEach((element) => {
      const rank = element.dataset.rank ?? 'secondary';
      element.dataset.variant = runtimeDown && rank === 'primary' ? 'secondary' : rank;
    });
  }

  /** One connection failure, one card, one retry (rule S2). */
  function showAlert(message: string, focus: boolean): void {
    if (alertDetail) alertDetail.textContent = message;
    if (!alert) return;
    alert.hidden = false;
    runtimeDown = true;
    rankActions();
    if (focus) alert.focus({ preventScroll: true });
  }

  function hideAlert(): void {
    if (alert) alert.hidden = true;
    runtimeDown = false;
    rankActions();
  }

  async function loadConfig(): Promise<void> {
    setState(configState, pilotCopy.common.loading[lang]);
    try {
      const config = await getPilotConfig();
      const municipality = entityName(config.municipality, lang);
      const category = entityName(config.category, lang);
      const office = entityName(config.office, lang);
      const municipalityLabel = document.querySelector<HTMLElement>('[data-config-municipality-label]');
      if (municipalityLabel) municipalityLabel.textContent = pilotCopy.common.municipality[lang];
      const municipalityValue = document.querySelector<HTMLElement>('[data-config-municipality]');
      const categoryValue = document.querySelector<HTMLElement>('[data-config-category]');
      const officeValue = document.querySelector<HTMLElement>('[data-config-office]');
      if (municipalityValue) municipalityValue.textContent = municipality;
      if (categoryValue) categoryValue.textContent = category;
      if (officeValue) officeValue.textContent = office;
      if (configDetails) configDetails.hidden = false;
      clearState(configState);
      hideAlert();
      setState(
        intake,
        config.intakeOpen ? pilotCopy.entry.intakeOpen[lang] : pilotCopy.entry.intakeClosed[lang],
        config.intakeOpen ? 'success' : 'warning',
      );
      const rows = Array.isArray(config.sources)
        ? config.sources.flatMap((source) => {
            if (!source || typeof source.url !== 'string') return [];
            let url: URL;
            try {
              url = new URL(source.url);
            } catch {
              return [];
            }
            if (url.protocol !== 'https:' && url.protocol !== 'http:') return [];
            const item = document.createElement('li');
            const link = createTextElement('a', pickLocalized(source.label ?? source.name ?? source.title, lang, url.hostname));
            link.href = url.toString();
            link.rel = 'noreferrer';
            item.append(link);
            return [item];
          })
        : [];
      sources?.replaceChildren(...rows);
    } catch (error) {
      if (configDetails) configDetails.hidden = true;
      clearState(configState);
      clearState(intake);
      sources?.replaceChildren();
      showAlert(apiErrorMessage(error, lang), true);
    }
  }

  async function loadSession(): Promise<void> {
    try {
      const session = await getPilotSession();
      setState(pageState, `${pilotCopy.common.role[lang]}: ${translatedRole(session.role, lang)}`, 'success');
      let path = '/pilot/vrsar';
      let label = pilotCopy.nav.home[lang];
      if (session.role === 'resident') {
        path = '/pilot/vrsar/cases';
        label = pilotCopy.nav.cases[lang];
      } else if (session.role === 'official') {
        path = '/pilot/vrsar/staff';
        label = pilotCopy.nav.staff[lang];
      } else if (session.role === 'reviewer') {
        path = '/pilot/vrsar/review';
        label = pilotCopy.nav.review[lang];
      }
      const link = createTextElement('a', label);
      link.className = 'btn';
      link.dataset.rank = 'primary';
      link.href = pilotHref(path, lang);
      actions?.replaceChildren(link);
      rankActions();
    } catch (error) {
      if (error instanceof PilotApiError && error.status === 401) {
        setState(pageState, pilotCopy.entry.signedOut[lang]);
        const login = createTextElement('a', pilotCopy.nav.login[lang]);
        login.className = 'btn';
        login.dataset.rank = 'primary';
        login.href = pilotHref('/pilot/vrsar/login', lang);
        const receipts = createTextElement('a', pilotCopy.nav.receipts[lang]);
        receipts.className = 'btn';
        receipts.dataset.rank = 'secondary';
        receipts.href = pilotHref('/pilot/vrsar/receipts', lang);
        actions?.replaceChildren(login, receipts);
        rankActions();
        return;
      }
      // The runtime alert already carries the failure and the single retry.
      setState(pageState, pilotCopy.entry.roleUnavailable[lang], 'warning');
      actions?.replaceChildren();
      showAlert(apiErrorMessage(error, lang), false);
    }
  }

  retry?.addEventListener('click', () => {
    void loadConfig();
    void loadSession();
  });
  void loadConfig();
  void loadSession();
}
