// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

// HR draft: native editor review

import type { LocalizedText } from './vrsar';

const localized = (hr: string, it: string, en: string): LocalizedText => Object.freeze({ hr, it, en });

/**
 * Wording that belongs to the case workspace only. Everything the pilot
 * already names — states, hold reasons, office actions, close reasons — stays
 * in `pilotCopy`; this object adds the few strings the single-page layout
 * needs and nothing else.
 */
export const workspaceCopy = Object.freeze({
  /* One line replaces the privacy banner: what stays in, what goes out. */
  privacyLine: localized(
    'Predmet, opis, lokacija, kontakt i privitci ostaju privatni. Javni tekst, obveza i dokazi objavljuju se.',
    'Oggetto, descrizione, luogo, contatto e allegati restano privati. Il testo pubblico, l’impegno e le prove vengono pubblicati.',
    'Subject, narrative, location, contact and attachments stay private. The public text, the commitment and the evidence are published.',
  ),
  worklist: localized('Radni red', 'Coda dell’ufficio', 'Worklist'),
  privateStamp: localized('Privatno', 'Privato', 'Private'),
  reportHeading: localized('Prijava', 'Segnalazione', 'Report'),
  activityHeading: localized('Tijek', 'Andamento', 'Activity'),
  propertiesHeading: localized('Svojstva predmeta', 'Proprietà del caso', 'Case properties'),
  /* The one action at the top right, named for the state it moves. */
  primary: {
    commitment: localized(
      'Objavi obvezu s rokom',
      'Pubblica l’impegno con la scadenza',
      'Publish the commitment with a due date',
    ),
    resolutionAgain: localized(
      'Prijavi dovršetak ponovno',
      'Segnala di nuovo il completamento',
      'Report completion again',
    ),
    reopen: localized('Vrati u rad', 'Rimetti in lavorazione', 'Put back in progress'),
  },
  /* Where no action is left, the header says what the case is waiting on. */
  state: {
    resolved: localized(
      'Dovršetak prijavljen. Podnositelj i javnost ga provjeravaju.',
      'Completamento segnalato. Il segnalante e il pubblico lo stanno verificando.',
      'Completion reported. The filer and the public are checking it.',
    ),
    closed: localized('Predmet je zatvoren.', 'Il caso è chiuso.', 'The case is closed.'),
  },
  done: {
    assigned: localized(
      'Odgovornost je preuzeta.',
      'La responsabilità è stata assunta.',
      'Responsibility accepted.',
    ),
    commitment: localized('Obveza je objavljena.', 'L’impegno è pubblicato.', 'The commitment is published.'),
    resolution: localized(
      'Dovršetak je prijavljen.',
      'Il completamento è stato segnalato.',
      'Completion is reported.',
    ),
    reopened: localized(
      'Predmet je vraćen u rad.',
      'Il caso è tornato in lavorazione.',
      'The case is back in progress.',
    ),
    attachment: localized('Privitak je dodan.', 'L’allegato è stato aggiunto.', 'The attachment was added.'),
  },
  /* Short words for the row of text actions under the public text. */
  text: {
    hold: localized('Zadrži', 'Trattieni', 'Hold'),
    release: localized('Objavi', 'Pubblica', 'Release'),
  },
  properties: {
    state: localized('Stanje', 'Stato', 'State'),
    signature: localized('Potpis', 'Firma', 'Signature'),
    more: localized('više', 'altro', 'more'),
    overdue: localized('Rok je prošao', 'Scadenza superata', 'Past due'),
    attention: localized('Javnost', 'Pubblico', 'Public attention'),
    followers: localized('Prati', 'Segue', 'Following'),
    alsoAffected: localized('Isti problem', 'Stesso problema', 'Also affected'),
    notFixed: localized('Nije riješeno', 'Non risolto', 'Not fixed'),
    disputes: localized('Osporavanja', 'Contestazioni', 'Disputes'),
    attachments: localized('Privitci', 'Allegati', 'Attachments'),
    addAttachment: localized('Dodaj privitak', 'Aggiungi un allegato', 'Add an attachment'),
  },
  /* Who appended the row, in one word, for events and messages alike. */
  activity: {
    resident: localized('Stanovnik', 'Residente', 'Resident'),
    office: localized('Ured', 'Ufficio', 'Office'),
    system: localized('Sustav', 'Sistema', 'System'),
    gateway: localized('Kanal', 'Canale', 'Channel'),
    empty: localized('Još nema zabilježenih događaja.', 'Nessun evento registrato.', 'No events recorded yet.'),
    composerNotice: localized(
      'Poruka ide podnositelju kanalom prijave i nije javna.',
      'Il messaggio va al segnalante tramite il canale della segnalazione e non è pubblico.',
      'The message goes to the filer through the report channel and is not public.',
    ),
  },
});
