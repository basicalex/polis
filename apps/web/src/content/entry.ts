// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * Entry-flow strings: the place map (S1) and the intent screen (S2).
 *
 * PENDING NATIVE-EDITOR REVIEW. Croatian is the source language and every line
 * here is a build placeholder taken from the entry-flow spec and the HR
 * glossary. A native editor confirms each label before release (entry-flow
 * R11); English is the second language and follows whatever Croatian settles on.
 */

import type { LocalizedText } from './public-release';

export const entryStrings = {
  /** S1 · the map */
  question: { hr: 'Gdje ste?', en: 'Where are you?' },
  mapLabel: { hr: 'Karta Hrvatske po županijama', en: 'Map of Croatia by county' },
  regionLabel: { hr: 'Županija', en: 'County' },
  regionPlaceholder: { hr: 'Odaberite županiju', en: 'Choose a county' },
  regionSubmit: { hr: 'Prikaži', en: 'Show' },
  wholeCountry: { hr: 'Cijela Hrvatska', en: 'All of Croatia' },
  locate: { hr: 'Moja lokacija', en: 'Use my location' },
  locating: { hr: 'Tražim vašu lokaciju…', en: 'Finding your location…' },
  pickOnMap: { hr: 'Odaberite mjesto na karti.', en: 'Pick a place on the map.' },
  notHereYet: { hr: 'Još nije ovdje.', en: 'Not here yet.' },
  searchLabel: { hr: 'Potražite mjesto', en: 'Search for a place' },
  searchPlaceholder: { hr: 'Ime mjesta', en: 'Place name' },
  searchNoResults: { hr: 'Nema rezultata.', en: 'No matches.' },
  countyPlaces: { hr: 'Mjesta u županiji', en: 'Places in this county' },

  /** S2 · intent */
  backToMap: { hr: '← Karta', en: '← Map' },
  record: { hr: 'Javni zapis', en: 'Public record' },
  recordNote: { hr: 'Svi predmeti, u svakom stanju.', en: 'Every case, in every state.' },
  report: { hr: 'Prijavite problem', en: 'Report a problem' },
  reportNote: {
    hr: 'Bez računa. Dobit ćete broj predmeta.',
    en: 'No account. You get a case number.',
  },

  /** S3 · the place ledger */
  ledgerTitle: { hr: 'Javni zapis', en: 'Public record' },
  ledgerOpen: { hr: 'Otvoreno', en: 'Open' },
  ledgerOverdue: { hr: 'Rok prekoračen', en: 'Past due' },
  ledgerClosed: { hr: 'Zatvoreno', en: 'Closed' },
  ledgerCapped: { hr: 'posljednjih 100', en: 'the latest 100' },

  /*
   * The stage chips. The labels are the same reviewed words the status stamp on
   * a row carries, in lower case, so a chip and a stamp never read as two
   * different things.
   */
  ledgerStageLegend: { hr: 'Faza postupka', en: 'Stage of the process' },
  ledgerStageAll: { hr: 'Sve', en: 'All' },
  ledgerStageReceived: { hr: 'Zaprimljeno', en: 'Received' },
  ledgerStageAssigned: { hr: 'Dodijeljeno', en: 'Assigned' },
  ledgerStageInReview: { hr: 'U provjeri', en: 'In review' },
  ledgerStagePublished: { hr: 'Objavljeno', en: 'Published' },
  ledgerStageResolved: { hr: 'Riješeno', en: 'Resolved' },
  ledgerStageClosed: { hr: 'Zatvoreno', en: 'Closed' },
  ledgerStageEmpty: { hr: 'Nema predmeta u ovoj fazi.', en: 'No cases at this stage.' },
  ledgerStageEmptyAll: { hr: 'Prikaži sve predmete', en: 'Show every case' },

  /* One line under a row that has reached an answer. */
  ledgerHintPublished: { hr: 'Ured je objavio obvezu.', en: 'The office published its commitment.' },
  ledgerHintResolved: { hr: 'Riješeno', en: 'Resolved' },
  ledgerHintOverdue: { hr: 'Rok prekoračen', en: 'Past due' },
  ledgerSearchLabel: { hr: 'Broj predmeta', en: 'Case number' },
  ledgerSearchPlaceholder: { hr: 'VRS-123456', en: 'VRS-123456' },
  ledgerSearchSubmit: { hr: 'Otvori', en: 'Open' },
  ledgerSearchInvalid: {
    hr: 'Broj predmeta ima oblik VRS-123456.',
    en: 'A case number has the form VRS-123456.',
  },
  ledgerFiled: { hr: 'Podneseno', en: 'Filed' },
  ledgerDue: { hr: 'Rok', en: 'Due' },
  ledgerFollowers: { hr: 'Prati', en: 'Following' },
  ledgerAlsoAffected: { hr: 'Isti problem', en: 'Same problem' },
  ledgerEmpty: { hr: 'Još nema predmeta.', en: 'No cases yet.' },
  ledgerEmptyPurpose: {
    hr: 'Ovdje stoji svaki predmet ove općine, u svakom stanju, čim ga ured zaprimi.',
    en: 'Every case of this municipality stands here, in every state, from the moment the office receives it.',
  },
  ledgerError: { hr: 'Zapis trenutno nije dostupan.', en: 'The record is unavailable right now.' },
  ledgerRetry: { hr: 'Pokušajte ponovno', en: 'Try again' },
  ledgerLoading: { hr: 'Učitavanje predmeta…', en: 'Loading cases…' },
  ledgerNotAVote: {
    hr: 'Broj pratitelja nije glasovanje i ne mijenja redoslijed.',
    en: 'The follower count is not a vote and does not change the order.',
  },

  /** The public case page under a place */
  caseBack: { hr: '← Javni zapis', en: '← Public record' },
  caseKeyLine: {
    hr: 'Ovo je vaša poveznica s ključem za ponovno otvaranje. Sačuvajte je.',
    en: 'This is your link with the reopen key. Keep it.',
  },
  copyLink: { hr: 'Kopiraj poveznicu', en: 'Copy link' },
  copy: { hr: 'Kopiraj', en: 'Copy' },
  copied: { hr: 'Kopirano', en: 'Copied' },

  /** S4 · filing */
  reportMapLabel: { hr: 'Karta općine', en: 'Map of the municipality' },
  reportMapCaption: { hr: 'Dodirnite kartu gdje je problem.', en: 'Tap the map where the problem is.' },
  reportTextLabel: { hr: 'Što se dogodilo?', en: 'What happened?' },
  reportTextRequired: { hr: 'Napišite što se dogodilo.', en: 'Write what happened.' },
  reportCharsLeft: { hr: 'Preostalo znakova:', en: 'Characters left:' },
  reportWhereLabel: { hr: 'Gdje točno?', en: 'Where exactly?' },
  reportWherePlaceholder: {
    hr: 'npr. Stup 14, kod pekare',
    en: 'e.g. Lamp post 14, by the bakery',
  },
  reportPhotoAdd: { hr: 'Dodaj fotografiju', en: 'Add a photo' },
  reportPhotoRemove: { hr: 'Ukloni', en: 'Remove' },
  reportPhotoWorking: { hr: 'Obrađujem fotografiju…', en: 'Preparing photo…' },
  reportPhotoAlt: { hr: 'Odabrana fotografija', en: 'The selected photo' },
  reportPhotoTooLarge: {
    hr: 'Fotografija je prevelika. Pokušajte s manjom.',
    en: 'The photo is too large. Try a smaller one.',
  },
  reportPhotoUnreadable: {
    hr: 'Fotografiju nije moguće pripremiti. Pošaljite prijavu bez nje.',
    en: 'The photo could not be prepared. Send the report without it.',
  },
  /*
   * Says the two things a person needs before they attach a photo: it is not
   * published, and the phone's location and device data are dropped because the
   * browser re-encodes the picture before it leaves the phone.
   */
  reportPhotoNote: {
    hr: 'Jedna fotografija, neobavezno. Vidi je samo ured. Ne objavljuje se, a lokacija i podaci fotoaparata brišu se prije slanja.',
    en: 'One photo, optional. Only the office sees it. It is never published, and the location and camera data are stripped before it is sent.',
  },
  reportSubmit: { hr: 'Pošalji prijavu', en: 'Send report' },
  reportSending: { hr: 'Šaljem…', en: 'Sending…' },
  reportPrivacyNote: {
    hr: 'Bez računa. Vaš tekst ne objavljuje se; javno je samo broj predmeta, područje, kategorija i stanje dok ga ured ne odobri.',
    en: 'No account. Your text is not published; only the case number, the area, the category and the state are public until the office approves it.',
  },
  reportFailed: { hr: 'Prijava nije poslana. Pokušajte ponovno.', en: 'The report was not sent. Try again.' },
  reportNoScript: {
    hr: 'Za slanje je potreban JavaScript ili pošaljite SMS na broj općine.',
    en: 'Sending needs JavaScript, or send an SMS to the municipality number.',
  },

  /** S5 · the case number */
  caseNumberTitle: { hr: 'Vaš broj predmeta', en: 'Your case number' },
  caseLinkTitle: { hr: 'Vaša poveznica', en: 'Your link' },
  caseKeyNote: {
    hr: 'S ovom poveznicom možete kasnije dopuniti ili povući prijavu. Bez nje to nije moguće.',
    en: 'With this link you can add to or withdraw the report later. Without it you cannot.',
  },
  caseOpenRecord: { hr: 'Otvori javni zapis predmeta', en: 'Open the public case record' },
  /*
   * Croatian puts the place name in the accusative after "na", which the place
   * list cannot produce from the nominative. One live place, one line; a second
   * live place needs its own form from the native editor.
   */
  caseBackToPlace: { hr: 'Natrag na Općinu Vrsar', en: 'Back to Vrsar Municipality' },

  /** chrome */
  attribution: {
    hr: '© OpenStreetMap contributors (ODbL) · geoBoundaries',
    en: '© OpenStreetMap contributors (ODbL) · geoBoundaries',
  },
  privacy: { hr: 'Privatnost', en: 'Privacy' },
  source: { hr: 'Izvorni kod', en: 'Source' },
  /*
   * The band a hosted test build carries on every entry page. It names the
   * instance, the data and the fact that the municipality does not answer here,
   * so nobody mistakes a test link for the real channel.
   */
  testInstance: {
    hr: 'Testna instanca. Podaci su sintetički. Ovo nije službeni kanal Općine Vrsar.',
    en: 'Test instance. Data is synthetic. This is not an official channel of Općina Vrsar.',
  },
  /** Same band, one link: the office side of the test instance is one tap away. */
  testInstanceStaff: {
    hr: 'Za općinu: prijava',
    en: 'For the municipality: sign in',
  },
} satisfies Record<string, LocalizedText>;

/** Page titles and meta descriptions, one line each, no marketing. */
export const entryMeta = {
  mapTitle: { hr: 'Polis — Gdje ste?', en: 'Polis — Where are you?' },
  mapDescription: {
    hr: 'Odaberite svoje mjesto na karti Hrvatske i otvorite javni zapis ili prijavite problem.',
    en: 'Pick your place on the map of Croatia, then open the public record or report a problem.',
  },
  placeDescription: {
    hr: 'Javni zapis predmeta i prijava problema za vaše mjesto.',
    en: 'The public case record and problem reporting for your place.',
  },
  ledgerTitle: { hr: 'Polis — Javni zapis', en: 'Polis — Public record' },
  ledgerDescription: {
    hr: 'Svi predmeti ove općine, u svakom stanju, s rokom i pozornošću javnosti.',
    en: 'Every case of this municipality, in every state, with its due date and public attention.',
  },
  caseDescription: {
    hr: 'Stanje jednog predmeta, rok i pozornost javnosti.',
    en: 'The state of one case, its due date and public attention.',
  },
  reportTitle: { hr: 'Polis — Prijavite problem', en: 'Polis — Report a problem' },
  reportDescription: {
    hr: 'Prijavite problem bez računa. Dobit ćete broj predmeta i poveznicu.',
    en: 'Report a problem without an account. You get a case number and a link.',
  },
  caseNumberTitle: { hr: 'Polis — Vaš broj predmeta', en: 'Polis — Your case number' },
  caseNumberDescription: {
    hr: 'Broj predmeta i poveznica s ključem za ponovno otvaranje.',
    en: 'The case number and the link that carries the reopen key.',
  },
} satisfies Record<string, LocalizedText>;
