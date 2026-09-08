import { listPrivateRecords } from '../../../lib/pilot/vrsar/api';
import type { PrivateTraceRecord } from '../../../lib/pilot/vrsar/model';
import { pilotCopy, pilotHref } from '../../../content/pilot/vrsar';
import {
  apiErrorMessage,
  clearState,
  createStatus,
  createTextElement,
  currentPilotLang,
  formatPilotDate,
  requirePilotRole,
  setState,
} from './shell';

let started = false;

export function initVrsarCases(): void {
  if (started) return;
  started = true;
  const lang = currentPilotLang();
  const state = document.querySelector<HTMLElement>('[data-page-state]');
  const list = document.querySelector<HTMLElement>('[data-case-list]');
  const retry = document.querySelector<HTMLButtonElement>('[data-retry]');
  const empty = document.querySelector<HTMLElement>('[data-empty-state]');

  function render(records: PrivateTraceRecord[]): void {
    const rows = records.map((record) => {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.className = 'pilot-ledger-row';
      link.href = pilotHref(`/pilot/vrsar/cases/${encodeURIComponent(record.id)}`, lang);
      const main = document.createElement('span');
      main.className = 'pilot-ledger-main';
      main.append(
        createTextElement('span', record.subject || pilotCopy.detail.heading[lang], 'pilot-ledger-title'),
        createTextElement('span', record.id, 'pilot-ledger-id'),
        createTextElement('span', `${pilotCopy.common.updated[lang]} ${formatPilotDate(record.updatedAt, lang)}`, 'pilot-ledger-meta'),
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
    const session = await requirePilotRole(['resident']);
    if (!session) return;
    try {
      const records = await listPrivateRecords();
      render(records);
      // An empty queue is a state with a purpose and one action, not a message.
      if (empty) empty.hidden = records.length > 0;
      clearState(state);
    } catch (error) {
      render([]);
      if (empty) empty.hidden = true;
      setState(state, `${pilotCopy.cases.loadError[lang]} ${apiErrorMessage(error, lang)}`, 'error');
      if (retry) retry.hidden = false;
    }
  }

  retry?.addEventListener('click', () => void load());
  void load();
}
