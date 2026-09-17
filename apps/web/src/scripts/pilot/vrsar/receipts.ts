// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { listPublicRecords } from '../../../lib/pilot/vrsar/api';
import type { PublicTraceRecord } from '../../../lib/pilot/vrsar/model';
import { pilotCopy, pilotHref, type PilotLang } from '../../../content/pilot/vrsar';
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

/**
 * The number a filer and the office both quote. The public snapshot does not
 * carry it yet (`PublicRecord` in services/trace-service), so the row reads it
 * defensively and simply leaves the line out until the field lands. The UUID
 * is never offered as a substitute: it belongs in the address, nowhere else.
 */
function caseNumberOf(record: PublicTraceRecord): string {
  const value = (record as PublicTraceRecord & { caseNumber?: unknown }).caseNumber;
  return typeof value === 'string' ? value : '';
}

function signatureLine(record: PublicTraceRecord, lang: PilotLang): string {
  const signed = [record.signedBy?.name, record.signedBy?.title].filter(Boolean).join(' · ');
  return [signed, formatPilotDate(record.publishedAt, lang)].filter(Boolean).join(' · ');
}

export function initVrsarReceipts(): void {
  if (started) return;
  started = true;
  const lang = currentPilotLang();
  const state = document.querySelector<HTMLElement>('[data-page-state]');
  const list = document.querySelector<HTMLElement>('[data-public-list]');
  const retry = document.querySelector<HTMLButtonElement>('[data-retry]');
  const empty = document.querySelector<HTMLElement>('[data-empty-state]');

  /** A receipt exists from the moment the office answers, in all three states. */
  function isPublished(record: PublicTraceRecord): boolean {
    return record.testEnvironment === true
      && (record.status === 'answered' || record.status === 'resolved' || record.status === 'disputed');
  }

  function render(records: PublicTraceRecord[]): void {
    const rows = records.map((record) => {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.className = 'pilot-ledger-row';
      link.href = pilotHref(`/pilot/vrsar/receipts/${encodeURIComponent(record.id)}`, lang);
      const main = document.createElement('span');
      main.className = 'pilot-ledger-main';
      const caseNumber = caseNumberOf(record);
      if (caseNumber) {
        main.append(createTextElement('span', caseNumber, 'pilot-ledger-id'));
      }
      // The commitment is cut at two lines in CSS, so the full text stays here.
      const commitment = createTextElement('span', record.commitment, 'pilot-ledger-title');
      commitment.title = record.commitment;
      main.append(commitment, createTextElement('span', signatureLine(record, lang), 'pilot-ledger-meta'));
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
      const records = await listPublicRecords();
      const safe = records.filter(isPublished);
      render(safe);
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
