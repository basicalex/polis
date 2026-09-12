// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Copy for the public case surface: the case-number lookup, the public case
 * shell at /pilot/vrsar/zapis/<broj>, the attention control, and the channel
 * help block. Croatian is authored first; Italian and English follow the same
 * shape as src/content/pilot/vrsar.ts so the language switcher keeps working.
 *
 * Every string a reader sees on that surface lives here, so a native editor can
 * review the Croatian in one file.
 */

import type { LocalizedText, PilotLang } from './vrsar';

const localized = (hr: string, it: string, en: string): LocalizedText => Object.freeze({ hr, it, en });

/** A case number as the channel gateway issues it, e.g. VRS-1842. */
export const CASE_NUMBER_PATTERN = '[A-Z]{2,4}-[0-9]{1,8}';
export const caseNumberRegExp = /^[A-Z]{2,4}-\d{1,8}$/;

export function isCaseNumber(value: string): boolean {
  return caseNumberRegExp.test(value);
}

export function publicCaseHref(caseNumber: string, lang: PilotLang): string {
  return `/pilot/vrsar/zapis/${encodeURIComponent(caseNumber)}?lang=${lang}`;
}

export const publicCaseCopy = Object.freeze({
  page: {
    heading: localized('Javni zapis predmeta', 'Record pubblico del caso', 'Public case record'),
    intro: localized(
      'Javni zapis postoji od zaprimanja prijave. Pokazuje stanje, rok i pozornost javnosti. Javni tekst objavljuje se tek nakon neovisne provjere.',
      'Il record pubblico esiste dal momento della ricezione. Mostra lo stato, il termine e l’attenzione pubblica. Il testo pubblico viene pubblicato solo dopo la revisione indipendente.',
      'The public record exists from the moment the report is received. It shows the state, the due date, and public attention. Public text publishes only after independent review.',
    ),
  },

  lookup: {
    heading: localized('Otvorite predmet po broju', 'Apri un caso con il numero', 'Open a case by number'),
    label: localized('Broj predmeta', 'Numero del caso', 'Case number'),
    hint: localized(
      'Broj ste dobili u odgovoru na prijavu. Oblik je VRS-1842.',
      'Hai ricevuto il numero nella risposta alla segnalazione. Il formato è VRS-1842.',
      'You received the number in the reply to your report. The format is VRS-1842.',
    ),
    submit: localized('Otvori zapis', 'Apri il record', 'Open record'),
    invalid: localized(
      'Broj predmeta ima oblik VRS-1842.',
      'Il numero del caso ha il formato VRS-1842.',
      'A case number has the form VRS-1842.',
    ),
  },

  shell: {
    heading: localized('Stanje predmeta', 'Stato del caso', 'Case state'),
    caseNumber: localized('Broj predmeta', 'Numero del caso', 'Case number'),
    area: localized('Područje', 'Area', 'Area'),
    category: localized('Kategorija', 'Categoria', 'Category'),
    trace: localized('Tijek', 'Percorso', 'Path'),
    time: localized('Vrijeme', 'Tempo', 'Time'),
    due: localized('Rok', 'Termine', 'Due'),
    daysOne: localized('dan od zaprimanja', 'giorno dalla ricezione', 'day since filing'),
    daysMany: localized('dana od zaprimanja', 'giorni dalla ricezione', 'days since filing'),
    pendingPublicText: localized(
      'Javni sadržaj još nije odobren. Objavljuje se tek nakon neovisne provjere.',
      'Il contenuto pubblico non è ancora approvato. Viene pubblicato solo dopo la revisione indipendente.',
      'The public text is not approved yet. It publishes only after independent review.',
    ),
    notFound: localized('Predmet nije pronađen.', 'Caso non trovato.', 'The case was not found.'),
    notFoundHint: localized(
      'Provjerite broj i pokušajte ponovno.',
      'Controlla il numero e riprova.',
      'Check the number and try again.',
    ),
  },

  /**
   * Reviewed stamps for the public case shell. They are meaning labels, not
   * descriptions: never paraphrase them, change them only here.
   */
  state: {
    received: localized('ZAPRIMLJENO', 'RICEVUTO', 'RECEIVED'),
    assigned: localized('DODIJELJENO', 'ASSEGNATO', 'ASSIGNED'),
    'in-review': localized('U PROVJERI', 'IN VERIFICA', 'IN REVIEW'),
    published: localized('OBJAVLJENO', 'PUBBLICATO', 'PUBLISHED'),
    resolved: localized('RIJEŠENO', 'RISOLTO', 'RESOLVED'),
    closed: localized('ZATVORENO', 'CHIUSO', 'CLOSED'),
  } as Readonly<Record<string, LocalizedText>>,

  attention: {
    heading: localized('Pozornost javnosti', 'Attenzione pubblica', 'Public attention'),
    alsoAffectedCount: localized('Isti problem', 'Stesso problema', 'Same problem'),
    alsoAffectedAdd: localized('Imam isti problem', 'Ho lo stesso problema', 'I have the same problem'),
    followCount: localized('Prati', 'Segui', 'Follow'),
    followAdd: localized('Prati', 'Segui', 'Follow'),
    withdraw: localized('Povuci', 'Ritira', 'Withdraw'),
    notAVote: localized(
      'Ovo nije glasovanje. Broj ne mijenja redoslijed obrade.',
      'Non è un voto. Il numero non cambia l’ordine di trattazione.',
      'This is not a vote. The number does not change the order of handling.',
    ),
    failed: localized(
      'Oznaka nije spremljena. Pokušajte ponovno.',
      'Il segnale non è stato salvato. Riprova.',
      'The mark was not saved. Try again.',
    ),
  },

  channel: {
    heading: localized('Prijava pozivom ili SMS-om', 'Segnalazione per telefono o SMS', 'Reporting by call or SMS'),
    numberLabel: localized('Broj za prijavu', 'Numero per le segnalazioni', 'Reporting number'),
    numberUnset: localized(
      '+385 — (broj još nije aktivan)',
      '+385 — (numero non ancora attivo)',
      '+385 — (number not active yet)',
    ),
    inactiveStamp: localized('NIJE AKTIVNO', 'NON ATTIVO', 'NOT ACTIVE'),
    privacyLine: localized(
      'Vaš broj telefona nikada ne ulazi u javni zapis.',
      'Il tuo numero di telefono non entra mai nel record pubblico.',
      'Your phone number never enters the public record.',
    ),
    recordingLine: localized(
      'Snimka poziva glasovno se izobličuje, prepisuje u tekst i zatim briše.',
      'La registrazione viene distorta nella voce, trascritta e poi cancellata.',
      'The recording is voice-distorted, transcribed, then deleted.',
    ),
    tariffLine: localized(
      'Pozivi i SMS poruke naplaćuju se po tarifi vašeg operatera.',
      'Chiamate e SMS sono tariffati dal tuo operatore.',
      'Calls and SMS are charged at your operator’s tariff.',
    ),
  },
});

export function translatedCaseState(state: unknown, lang: PilotLang): string {
  const key = typeof state === 'string' ? state : '';
  return publicCaseCopy.state[key]?.[lang] ?? publicCaseCopy.state.received[lang];
}

/**
 * The word carries the state; the tone only reinforces it (rule P4). A closed
 * shell stays neutral: closure is an outcome, not a failure.
 */
const caseStateTones: Readonly<Record<string, string>> = Object.freeze({
  received: 'trace',
  assigned: 'warning',
  'in-review': 'warning',
  published: 'valid',
  resolved: 'valid',
  closed: 'unknown',
});

export function caseStateTone(state: unknown): string {
  const key = typeof state === 'string' ? state : '';
  return caseStateTones[key] ?? 'unknown';
}
