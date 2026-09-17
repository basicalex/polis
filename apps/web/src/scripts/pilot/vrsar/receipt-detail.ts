// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { getPilotConfig, getPublicRecord } from '../../../lib/pilot/vrsar/api';
import { entityName, safeStringList, type PilotConfig, type PublicTraceRecord } from '../../../lib/pilot/vrsar/model';
import { pilotCopy, statusTone, translatedStatus } from '../../../content/pilot/vrsar';
import {
  apiErrorMessage,
  clearState,
  createTextElement,
  currentPilotLang,
  formatPilotDate,
  recordIdFromPath,
  renderTrace,
  setState,
} from './shell';

let started = false;

export function initVrsarReceiptDetail(): void {
  if (started) return;
  started = true;
  const lang = currentPilotLang();
  const id = recordIdFromPath();
  const state = document.querySelector<HTMLElement>('[data-page-state]');
  const receipt = document.querySelector<HTMLElement>('[data-public-receipt]');
  const retry = document.querySelector<HTMLButtonElement>('[data-retry]');
  const print = document.querySelector<HTMLButtonElement>('[data-print]');

  function setText(selector: string, value: string): void {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) element.textContent = value;
  }

  /**
   * The number the filer and the office quote leads the receipt. The public
   * snapshot does not carry it yet (`PublicRecord` in services/trace-service),
   * so the line stays out until the field lands rather than showing the UUID.
   */
  function caseNumberOf(record: PublicTraceRecord): string {
    const value = (record as PublicTraceRecord & { caseNumber?: unknown }).caseNumber;
    return typeof value === 'string' ? value : '';
  }

  /** The UUID is machine data: one labelled row, never the heading. */
  function setRecordIdRow(value: string): void {
    const meta = document.querySelector<HTMLElement>('[data-public-receipt] .pilot-meta');
    if (!meta) return;
    let row = meta.querySelector<HTMLElement>('[data-public-record-id-row]');
    if (!row) {
      row = document.createElement('div');
      row.dataset.publicRecordIdRow = '';
      row.append(
        createTextElement('dt', pilotCopy.common.recordId[lang]),
        createTextElement('dd', '', 'pilot-hash'),
      );
      meta.append(row);
    }
    const cell = row.querySelector('dd');
    if (cell) cell.textContent = value;
  }

  function render(record: PublicTraceRecord, config: PilotConfig): void {
    const published = record.status === 'answered' || record.status === 'resolved' || record.status === 'disputed';
    if (record.testEnvironment !== true || !published) {
      throw new Error('invalid_public_record_response');
    }
    const caseNumber = caseNumberOf(record);
    const heading = document.querySelector<HTMLElement>('[data-receipt-id]');
    if (heading) {
      heading.textContent = caseNumber;
      heading.hidden = !caseNumber;
    }
    setRecordIdRow(record.id);
    const status = document.querySelector<HTMLElement>('.pilot-receipt-header .status-label');
    if (status) {
      status.dataset.status = record.status;
      status.dataset.tone = statusTone(record.status);
      status.textContent = translatedStatus(record.status, lang);
    }
    const statusNote = record.status === 'resolved'
      ? pilotCopy.receipts.resolved[lang]
      : record.status === 'disputed'
        ? pilotCopy.receipts.disputed[lang]
        : pilotCopy.receipts.publishedNotResolved[lang];
    setText('[data-public-status-note]', statusNote);
    setText('[data-public-office]', entityName(config.office, lang));
    setText('[data-public-category]', entityName(config.category, lang));
    setText('[data-public-due-date]', formatPilotDate(record.dueDate, lang, true));
    setText('[data-public-published-at]', formatPilotDate(record.publishedAt, lang));
    const resolvedAtRow = document.querySelector<HTMLElement>('[data-public-resolved-at-row]');
    if (record.status === 'resolved' && record.resolvedAt) {
      setText('[data-public-resolved-at]', formatPilotDate(record.resolvedAt, lang));
      if (resolvedAtRow) resolvedAtRow.hidden = false;
    } else if (resolvedAtRow) {
      resolvedAtRow.hidden = true;
    }
    setText('[data-public-hash]', record.receiptHash);
    setText('[data-public-commitment]', record.commitment);
    // The signature is the answer's authority; the slot is optional so the
    // receipt component can carry it wherever it reads best.
    setText('[data-public-signed-by]', `${record.signedBy.name} · ${record.signedBy.title}`);

    const evidenceSection = document.querySelector<HTMLElement>('[data-public-evidence-section]');
    if (record.status === 'resolved') {
      setText('[data-public-evidence-note]', record.evidenceNote ?? '');
      const links = document.querySelector<HTMLElement>('[data-public-evidence-links]');
      const rows = safeStringList(record.evidenceUrls).flatMap((value) => {
        let url: URL;
        try {
          url = new URL(value);
        } catch {
          return [];
        }
        if (url.protocol !== 'https:' || url.username || url.password) return [];
        const item = document.createElement('li');
        const link = createTextElement('a', url.toString());
        link.href = url.toString();
        link.rel = 'noreferrer';
        item.append(link);
        return [item];
      });
      links?.replaceChildren(...rows);
      if (evidenceSection) evidenceSection.hidden = false;
    } else if (evidenceSection) {
      evidenceSection.hidden = true;
    }

    renderTrace(document, record.status, record.events, { hideMissingStages: true });
    if (receipt) receipt.hidden = false;
    if (print) print.hidden = false;
  }

  async function load(): Promise<void> {
    if (retry) retry.hidden = true;
    setState(state, pilotCopy.common.loading[lang]);
    if (!id) {
      setState(state, pilotCopy.common.notAvailable[lang], 'error');
      return;
    }
    try {
      const [record, config] = await Promise.all([getPublicRecord(id), getPilotConfig()]);
      render(record, config);
      clearState(state);
    } catch (error) {
      if (receipt) receipt.hidden = true;
      if (print) print.hidden = true;
      setState(state, apiErrorMessage(error, lang), 'error');
      if (retry) retry.hidden = false;
    }
  }

  retry?.addEventListener('click', () => void load());
  print?.addEventListener('click', () => window.print());
  void load();
}
