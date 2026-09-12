// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { getPilotConfig, listPublicRecords } from '../../../lib/pilot/vrsar/api';
import type { PilotConfig, PublicTraceRecord } from '../../../lib/pilot/vrsar/model';
import { entityName } from '../../../lib/pilot/vrsar/model';
import { pilotCopy, pilotHref } from '../../../content/pilot/vrsar';
import {
  apiErrorMessage,
  clearState,
  createStatus,
  createTextElement,
  currentPilotLang,
  formatPilotDate,
  setState,
} from './shell';

let started = false;

export function initVrsarReceipts(): void {
  if (started) return;
  started = true;
  const lang = currentPilotLang();
  const state = document.querySelector<HTMLElement>('[data-page-state]');
  const list = document.querySelector<HTMLElement>('[data-public-list]');
  const retry = document.querySelector<HTMLButtonElement>('[data-retry]');
  const empty = document.querySelector<HTMLElement>('[data-empty-state]');

  function render(records: PublicTraceRecord[], config: PilotConfig): void {
    const safeRecords = records.filter(
      (record) => record.testEnvironment === true && (record.status === 'published' || record.status === 'resolved'),
    );
    const rows = safeRecords.map((record) => {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.className = 'pilot-ledger-row';
      link.href = pilotHref(`/pilot/vrsar/receipts/${encodeURIComponent(record.id)}`, lang);
      const main = document.createElement('span');
      main.className = 'pilot-ledger-main';
      main.append(
        createTextElement('span', record.publicSummary, 'pilot-ledger-title'),
        createTextElement('span', record.id, 'pilot-ledger-id'),
        createTextElement(
          'span',
          `${entityName(config.category, lang)} · ${entityName(config.office, lang)} · ${formatPilotDate(record.publishedAt, lang)}`,
          'pilot-ledger-meta',
        ),
      );
      link.append(main, createStatus(record.status, lang));
      item.append(link);
      return item;
    });
    list?.replaceChildren(...rows);
  }

  async function load(): Promise<void> {
    if (retry) retry.hidden = true;
    if (empty) empty.hidden = true;
    setState(state, pilotCopy.common.loading[lang]);
    try {
      const [records, config] = await Promise.all([listPublicRecords(), getPilotConfig()]);
      const safe = records.filter(
        (record) => record.testEnvironment === true && (record.status === 'published' || record.status === 'resolved'),
      );
      render(safe, config);
      // An empty ledger is a state with a purpose and one action, not a message.
      if (empty) empty.hidden = safe.length > 0;
      clearState(state);
    } catch (error) {
      list?.replaceChildren();
      if (empty) empty.hidden = true;
      setState(state, `${pilotCopy.receipts.loadError[lang]} ${apiErrorMessage(error, lang)}`, 'error');
      if (retry) retry.hidden = false;
    }
  }

  retry?.addEventListener('click', () => void load());
  void load();
}
