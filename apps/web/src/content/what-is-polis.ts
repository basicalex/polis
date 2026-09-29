// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later
// HR draft: native editor review

/*
 * "What is Polis?", the page `/` and `/en/` open on. It also replaces the old
 * About page (`/o-polisu`), which now redirects here.
 *
 * The purpose is the one the draft municipal announcement states
 * (docs/pilot/vrsar-announcement-post.html): a resident reports a communal
 * problem with no account and without knowing which office handles it, the
 * report gets a case number, the responsible section publishes what it will do
 * and by when, then the fix with evidence, and every step stays public under
 * the same number. The publicity and public-check rules follow
 * docs/pilot/public-text-policy.md (D1–D3).
 *
 * Five parts, in the order the other INTRFACE products use: the opening with
 * one action into the tool, what you can do, how it works in three steps, why
 * the record holds (with who runs Polis and what happens to the data), and a
 * close that repeats the action with one scope line and what this release does
 * not do yet. The anchors keep the old About page's six ids, so links into
 * `/o-polisu#…` land on the same subject here.
 */

import { entryStrings } from './entry';
import type { LocalizedText } from './public-release';

export const whatIsPolisRepository = 'https://github.com/basicalex/polis';
export const whatIsPolisLicence = 'AGPL-3.0-or-later';
export const whatIsPolisContactEmail = 'basic@intrface.eu';

/** Section anchors, in page order. The six ids of the retired About page survive. */
export const whatIsPolisSectionIds = {
  what: 'sto-je-polis',
  can: 'sto-mozete',
  how: 'kako-radi',
  why: 'javno-i-otvoreno',
  who: 'tko-stoji-iza',
  data: 'podaci',
  release: 'izdanje',
} as const;

export const whatIsPolisMeta = {
  title: { hr: 'Što je Polis?', en: 'What is Polis?' },
  description: {
    hr: 'Prijavite komunalni problem svojoj općini bez računa. Prijava dobije broj predmeta, a svatko vidi tko ju je preuzeo, što je obećano i što se promijenilo.',
    en: 'Report a communal problem to your municipality with no account. The report gets a case number, and anyone can see who took it, what was promised, and what changed.',
  },
} satisfies Record<string, LocalizedText>;

export const whatIsPolisStrings = {
  /* the opening */
  /*
   * The headline says what Polis does, the way the other INTRFACE products
   * open; the question stays in the tab title and the footer link. Two
   * sentences: the report, then what you watch.
   */
  headline: {
    hr: 'Prijavite problem u svom mjestu.',
    en: 'Report a problem where you live.',
  },
  headlineThen: {
    hr: 'Pratite tko ga je preuzeo, što je obećano i što se promijenilo.',
    en: 'Then see who took it, what was promised and what changed.',
  },
  lede: {
    hr: 'Polis ne traži račun, a ne morate znati ni koji je ured nadležan. Prijava dobije broj predmeta i svaki korak ostaje javan pod tim brojem.',
    en: 'Polis needs no account, and you do not need to know which office handles it. The report gets a case number, and every step stays public under that number.',
  },
  open: { hr: 'Otvorite Polis', en: 'Open Polis' },
  stateLabel: { hr: 'Stanje', en: 'Status' },
  state: {
    hr: 'javna testna instanca sa sintetičkim podacima. Nijedna općina još ne koristi Polis.',
    en: 'a public test instance with synthetic data. No municipality uses Polis yet.',
  },
  mapCaption: {
    hr: 'Polis se otvara na ovoj karti Hrvatske.',
    en: 'Polis opens on this map of Croatia.',
  },

  /* what you can do */
  doTitle: { hr: 'Što možete', en: 'What you can do' },

  /* how it works */
  howTitle: { hr: 'Kako radi', en: 'How it works' },
  stagesLabel: {
    hr: 'Stanja kroz koja predmet prolazi u javnom zapisu',
    en: 'The states a case moves through on the public record',
  },

  /* why the record holds */
  whyTitle: { hr: 'Zašto se zapisu može vjerovati', en: 'Why the record holds' },
  sourceLink: { hr: 'Izvorni kod na GitHubu', en: 'Source code on GitHub' },

  whoTitle: { hr: 'Tko vodi Polis', en: 'Who runs Polis' },
  whoBuilds: {
    hr: 'Polis gradi i vodi {intrface} j.d.o.o.',
    en: '{intrface} j.d.o.o. builds and runs Polis.',
  },
  whoController: {
    hr: 'Općina koja ga koristi voditelj je obrade prijava koje prima.',
    en: 'A municipality that uses it is the controller of the reports it receives.',
  },
  whoWrite: { hr: 'Pišite nam na {email}.', en: 'Write to us at {email}.' },

  dataTitle: { hr: 'Što se događa s podacima', en: 'What happens to the data' },
  dataProcessor: {
    hr: 'Intrface obrađuje prijave po uputi općine i ne koristi ih ni za što drugo.',
    en: 'Intrface processes reports on the municipality’s instructions and uses them for nothing else.',
  },
  dataNotices: {
    hr: 'Mjesto koje prima prijave ima svoju obavijest o zaštiti osobnih podataka:',
    en: 'A place that takes reports has its own data protection notice:',
  },

  /* the close */
  closeTitle: {
    hr: 'Otvorite kartu i odaberite svoje mjesto.',
    en: 'Open the map and pick your place.',
  },
  scope: {
    hr: 'Prijave zasad prima samo Vrsar, i to kao test sa sintetičkim predmetima. Općina Vrsar cilj je pilota; ništa ovdje ne podrazumijeva dogovor ni ovlaštenje.',
    en: 'Only Vrsar takes reports for now, as a test with synthetic cases. Općina Vrsar is a pilot target; nothing here implies an agreement or an authorization.',
  },
  releaseTitle: { hr: 'Što ovo izdanje još ne radi', en: 'What this release does not do yet' },
} satisfies Record<string, LocalizedText>;

/** What the live site lets a visitor do, one line each. */
export const whatIsPolisAbilities: { title: LocalizedText; line: LocalizedText }[] = [
  {
    title: { hr: 'Pronađite svoje mjesto', en: 'Find your place' },
    line: {
      hr: 'Odaberite ga na karti ili po županiji, upišite mu ime ili upotrijebite svoju lokaciju.',
      en: 'Pick it on the map or by county, type its name, or use your location.',
    },
  },
  {
    title: entryStrings.report,
    line: {
      hr: 'Opišite problem i, ako želite, označite točku na karti i dodajte fotografiju. Bez računa; dobit ćete broj predmeta.',
      en: 'Describe the problem and, if you like, mark the spot on a map and add a photo. No account; you get a case number.',
    },
  },
  {
    title: { hr: 'Čitajte javni zapis', en: 'Read the public record' },
    line: {
      hr: 'Svi predmeti u mjestu, u svakom stanju, s odgovorom ureda uz njih.',
      en: 'Every case in a place, in every state, with the office’s answer beside it.',
    },
  },
  {
    title: { hr: 'Provjerite popravak', en: 'Check the fix' },
    line: {
      hr: 'Kad ured kaže da je problem riješen, podnositelj to može osporiti, a svatko drugi označiti „nije riješeno”.',
      en: 'When the office says a problem is fixed, the filer can dispute it and anyone else can mark it “not fixed”.',
    },
  },
];

/** The loop in three steps: say something, then watch the file. */
export const whatIsPolisSteps: { title: LocalizedText; line: LocalizedText }[] = [
  {
    title: { hr: 'Javite se', en: 'Say something' },
    line: {
      hr: 'Prijavite što ne valja u vašem mjestu. Prijava dobije broj predmeta i javni zapis.',
      en: 'Report what is wrong where you live. The report gets a case number and a public record.',
    },
  },
  {
    title: { hr: 'Pogledajte tko ju je preuzeo', en: 'See who got it' },
    line: {
      hr: 'Nadležni odsjek općine preuzme predmet i imenuje osobu koja za njega odgovara.',
      en: 'The responsible section of the municipality takes the case and names who answers for it.',
    },
  },
  {
    title: {
      hr: 'Pogledajte što je obećano i što se promijenilo',
      en: 'See what was promised and what changed',
    },
    line: {
      hr: 'Odsjek pod svojim imenom objavi što će učiniti i do kada, a zatim rješenje s dokazom. Svaki korak ostaje vidljiv pod istim brojem predmeta.',
      en: 'The section publishes, under its own name, what it will do and by when, then the fix with evidence. Every step stays visible under the same case number.',
    },
  },
];

/**
 * The six states, in ledger order, with the tone the ledger stamps them in. The
 * labels are the ledger words themselves, read from `entry.ts`.
 */
export const whatIsPolisStages: {
  label: LocalizedText;
  tone: 'unknown' | 'trace' | 'valid' | 'warning';
}[] = [
  { label: entryStrings.ledgerStageReceived, tone: 'unknown' },
  { label: entryStrings.ledgerStageAssigned, tone: 'trace' },
  { label: entryStrings.ledgerStageAnswered, tone: 'trace' },
  { label: entryStrings.ledgerStageResolved, tone: 'valid' },
  { label: entryStrings.ledgerStageDisputed, tone: 'warning' },
  { label: entryStrings.ledgerStageClosed, tone: 'unknown' },
];

/** Why the record can be trusted, one fact from the code per line. */
export const whatIsPolisReasons: LocalizedText[] = [
  {
    hr: 'Polis ne traži ime, e-poštu, adresu ni račun.',
    en: 'Polis asks for no name, e-mail, address or account.',
  },
  {
    hr: 'Tekst prijave javan je od podnošenja, nakon provjere na osobne podatke. Fotografija ostaje u uredu.',
    en: 'The report text is public from filing, after a check for personal data. The photo stays with the office.',
  },
  {
    hr: 'Ured potpisuje odgovor imenom, funkcijom i datumom.',
    en: 'The office signs its answer with a name, a title and a date.',
  },
  {
    hr: 'Svaki događaj hash-povezan je s prethodnim, pa se redoslijed ne može tiho prepraviti.',
    en: 'Each event is hash-linked to the one before, so the order cannot be quietly rewritten.',
  },
  {
    hr: 'Nitko ne glasa i ništa se ne rangira.',
    en: 'Nobody votes and nothing is ranked.',
  },
  {
    hr: 'Kod je otvoren pod licencijom AGPL-3.0-or-later. Kako se podaci obrađuju, može provjeriti svatko, ne samo općina.',
    en: 'The code is open under AGPL-3.0-or-later. Anyone, not only the municipality, can check how the data is handled.',
  },
];

/** What this release does not do yet. The test instance and synthetic data are in the state line. */
export const whatIsPolisReleasePoints: LocalizedText[] = [
  {
    hr: 'Prijava telefonom i SMS-om još nije uključena.',
    en: 'Reporting by phone and SMS is not on yet.',
  },
  {
    hr: 'Nijedan broj na stranici nije stvaran rezultat, sudjelovanje ni ishod.',
    en: 'No number on the site is a real result, a real participation count, or a real outcome.',
  },
];
