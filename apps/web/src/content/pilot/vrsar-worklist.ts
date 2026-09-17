// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

// HR draft: native editor review

import type { LocalizedText } from './vrsar';

const localized = (hr: string, it: string, en: string): LocalizedText =>
  Object.freeze({ hr, it, en });

/**
 * Words the office worklist needs and `pilotCopy` does not already carry.
 * Everything that exists there — status names, "Rok", "Broj predmeta",
 * loading, retry, hold reasons — is reused, not restated here.
 */
export const worklistCopy = Object.freeze({
  lead: localized(
    'Predmeti su složeni po tome što ured mora učiniti sljedeće.',
    "I casi sono ordinati in base a ciò che l'ufficio deve fare come passo successivo.",
    'Cases are grouped by what the office must do next.',
  ),
  overviewHeading: localized('Pregled', 'Panoramica', 'Overview'),
  queueHeading: localized('Predmeti', 'Casi', 'Cases'),
  counts: {
    open: localized('Otvoreno', 'Aperti', 'Open'),
    overdue: localized('Rok istekao', 'Scadenza superata', 'Overdue'),
    held: localized('Zadržan tekst', 'Testo trattenuto', 'Text held'),
    disputed: localized('Osporeno', 'Contestati', 'Disputed'),
  },
  groups: {
    toAssign: localized('Za preuzimanje', 'Da assumere', 'To take on'),
    needsCommitment: localized(
      'Treba obvezu s rokom',
      'Serve un impegno con scadenza',
      'Needs a commitment with a due date',
    ),
    overdue: localized('Rok istekao', 'Scadenza superata', 'Overdue'),
    onTime: localized('U roku', 'Entro la scadenza', 'In time'),
    disputed: localized('Osporeno', 'Contestati', 'Disputed'),
    resolved: localized(
      'Dovršeno, provjerava javnost',
      'Completati, il pubblico verifica',
      'Completed, the public is checking',
    ),
    closed: localized('Zatvoreno', 'Chiusi', 'Closed'),
  },
  showClosed: localized(
    'Prikaži zatvorene ({count})',
    'Mostra i casi chiusi ({count})',
    'Show closed ({count})',
  ),
  hideClosed: localized('Sakrij zatvorene', 'Nascondi i casi chiusi', 'Hide closed'),
  overdueMark: localized('Rok je istekao', 'La scadenza è passata', 'The due date has passed'),
  textHeld: localized('Tekst zadržan', 'Testo trattenuto', 'Text held'),
  textRemoved: localized('Uklonjen tekst', 'Testo rimosso', 'Text removed'),
  notices: localized('Prijave čitatelja', 'Segnalazioni dei lettori', 'Reader reports'),
  emptyQueue: localized(
    'U radnom redu nema predmeta.',
    'Non ci sono casi nella coda.',
    'There are no cases in the queue.',
  ),
  emptyFilter: localized(
    'Nijedan predmet ne odgovara odabranom prikazu.',
    'Nessun caso corrisponde alla vista scelta.',
    'No case matches the selected view.',
  ),
});

export function worklistText(template: string, count: number): string {
  return template.replace('{count}', String(count));
}
