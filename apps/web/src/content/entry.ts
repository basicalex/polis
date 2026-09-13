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

  /** chrome */
  attribution: {
    hr: '© OpenStreetMap contributors (ODbL) · geoBoundaries',
    en: '© OpenStreetMap contributors (ODbL) · geoBoundaries',
  },
  privacy: { hr: 'Privatnost', en: 'Privacy' },
  source: { hr: 'Izvorni kod', en: 'Source' },
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
} satisfies Record<string, LocalizedText>;
