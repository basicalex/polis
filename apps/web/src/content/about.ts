// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later
// HR draft: native editor review

/*
 * The About page, in both product languages.
 *
 * One reading page says what Polis is, how it works, what is public, who runs
 * it, what happens to the data, and what this release does. It replaces the old
 * platform stubs — privacy, source, security, methodology, docs, transparency —
 * which now redirect here. Every fact on it comes from this file, from
 * `entry.ts` (the ledger words and the map-tile sentence) or from `places.ts`
 * (the live places).
 */

import { entryStrings } from './entry';
import type { LocalizedText } from './public-release';

/** The repository and the licence, as the retired source page named them. */
export const aboutRepository = 'https://github.com/basicalex/polis';
export const aboutLicence = 'AGPL-3.0-or-later';
export const aboutIntrfaceSite = 'https://intrface.eu';
export const aboutContactEmail = 'hello@intrface.eu';

export const aboutMeta = {
  title: { hr: 'Polis — O Polisu', en: 'Polis — About Polis' },
  description: {
    hr: 'Što je Polis, kako radi, što je javno, tko ga vodi i što ovo izdanje radi.',
    en: 'What Polis is, how it works, what is public, who runs it, and what this release does.',
  },
} satisfies Record<string, LocalizedText>;

/** The six sections, in order. Both languages share the Croatian anchors. */
export const aboutSectionIds = [
  'sto-je-polis',
  'kako-radi',
  'javno-i-otvoreno',
  'tko-stoji-iza',
  'podaci',
  'izdanje',
] as const;

export const aboutStrings = {
  heading: { hr: 'O Polisu', en: 'About Polis' },

  /* 1 · what Polis is */
  whatTitle: { hr: 'Što je Polis', en: 'What Polis is' },
  whatBody: {
    hr: 'Polis je javno mjesto na kojem stanovnici i njihova općina rješavaju probleme zajedno. Prijavite što ne radi, bez računa. Prijava dobije broj i javni zapis. Ured preuzme odgovornost, da obvezu s rokom i objavi što je učinio. Sve to vidi svatko.',
    en: 'Polis is the public place where residents and their municipality solve problems together. Report what is broken, with no account. The report gets a number and a public record. The office takes responsibility, gives a commitment with a date, and publishes what it did. Everyone can see all of it.',
  },

  /* 2 · how it works */
  howTitle: { hr: 'Kako radi', en: 'How it works' },
  howAfter: {
    hr: 'Podnositelj ponovno otvara predmet ključem iz svoje poveznice. Na javnom zapisu svatko može označiti „isti problem” ili „nije riješeno”. Nitko ne glasa i ništa se ne rangira.',
    en: 'The filer reopens a case with the key from their link. On the public record anyone can mark “same problem” or “not fixed”. Nobody votes and nothing is ranked.',
  },

  /* 3 · public and open */
  openTitle: { hr: 'Javno i otvoreno', en: 'Public and open' },
  openBody: {
    hr: 'Javni zapis je javan u svakom stanju. Tekst prijave objavljuje se pri podnošenju, nakon provjere na osobne podatke. Kontakt i fotografija ostaju u uredu. Događaji su hash-povezani, pa se redoslijed ne može tiho prepraviti. Izvorni kod je otvoren pod licencijom AGPL. Svatko ga može čitati, prijaviti grešku ili predložiti izmjenu.',
    en: 'The public record is public in every state. The report text is published when it is filed, after a check for personal data. Contact details and the photo stay with the office. Events are hash-linked, so the order cannot be quietly rewritten. The source code is open under the AGPL licence. Anyone can read it, report a bug, or propose a change.',
  },
  openRepositoryLabel: { hr: 'Repozitorij', en: 'Repository' },
  openLicenceLabel: { hr: 'Licencija', en: 'Licence' },

  /* 4 · who is behind it */
  whoTitle: { hr: 'Tko stoji iza Polisa', en: 'Who is behind Polis' },
  whoBuilds: {
    hr: 'Polis gradi i vodi {intrface} j.d.o.o.',
    en: '{intrface} j.d.o.o. builds and runs Polis.',
  },
  whoController: {
    hr: 'Općina koja ga koristi voditelj je obrade prijava koje prima.',
    en: 'The municipality that uses it is the controller of the reports it receives.',
  },
  whoWrite: {
    hr: 'Pišite nam na {email}.',
    en: 'Write to us at {email}.',
  },

  /* 5 · data and privacy */
  dataTitle: { hr: 'Podaci i privatnost', en: 'Data and privacy' },
  dataProcessor: {
    hr: 'Intrface obrađuje podatke po uputi općine i ne koristi prijave ni za što drugo.',
    en: 'Intrface processes the data on the municipality’s instructions and does not use reports for anything else.',
  },
  dataNotices: {
    hr: 'Svaka općina ima svoju obavijest o zaštiti osobnih podataka:',
    en: 'Each municipality has its own data protection notice:',
  },

  /* 6 · this release */
  releaseTitle: { hr: 'Ovo izdanje', en: 'This release' },
  releaseSynthetic: {
    hr: 'Instanca koja je javno dostupna radi na sintetičkim podacima dok općina ne potpiše.',
    en: 'The hosted instance runs on synthetic data until a municipality signs.',
  },
} satisfies Record<string, LocalizedText>;

/**
 * The six states of a case, one plain sentence each. The label is the ledger
 * word itself, read from `entry.ts`, so the page and the ledger cannot drift.
 */
export const aboutStages: { label: LocalizedText; line: LocalizedText }[] = [
  {
    label: entryStrings.ledgerStageReceived,
    line: {
      hr: 'Prijava je stigla i dobila broj predmeta.',
      en: 'The report arrived and got a case number.',
    },
  },
  {
    label: entryStrings.ledgerStageAssigned,
    line: {
      hr: 'Ured je preuzeo predmet i imenovao osobu koja za njega odgovara.',
      en: 'The office took the case and named who answers for it.',
    },
  },
  {
    label: entryStrings.ledgerStageAnswered,
    line: {
      hr: 'Ured je pod svojim imenom upisao obvezu s rokom.',
      en: 'The office filed a commitment with a date, under its own name.',
    },
  },
  {
    label: entryStrings.ledgerStageResolved,
    line: {
      hr: 'Ured je objavio što je učinio.',
      en: 'The office published what it did.',
    },
  },
  {
    label: entryStrings.ledgerStageDisputed,
    line: {
      hr: 'Podnositelj ili netko iz javnosti kaže da problem nije riješen.',
      en: 'The filer or someone else says the problem is not fixed.',
    },
  },
  {
    label: entryStrings.ledgerStageClosed,
    line: {
      hr: 'Predmet je zaključen, a zapis ostaje javan.',
      en: 'The case is finished and the record stays public.',
    },
  },
];

/** What this release does and does not do. */
export const aboutReleasePoints: LocalizedText[] = [
  {
    hr: 'Prijave se podnose i prate na testnoj instanci; svi predmeti na njoj su sintetički.',
    en: 'Reports are filed and tracked on a test instance; every case on it is synthetic.',
  },
  {
    hr: 'Tekst prijave javan je od podnošenja; kontakt i fotografija ostaju u uredu.',
    en: 'The report text is public from filing; contact details and the photo stay with the office.',
  },
  {
    hr: 'Ured se prijavljuje demonstracijskim pristupom; službena prijava e-poštom još nije uključena.',
    en: 'The office signs in with a demonstration passcode; official e-mail sign-in is not on yet.',
  },
  {
    hr: 'Prijava telefonom i SMS-om još nije uključena.',
    en: 'Reporting by phone and SMS is not on yet.',
  },
  {
    hr: 'Nijedan broj na stranici nije stvaran rezultat, sudjelovanje ni ishod.',
    en: 'No number on the page is a real result, a real participation count, or a real outcome.',
  },
  {
    hr: 'Općina Vrsar je cilj pilota; ništa ovdje ne podrazumijeva dogovor ni ovlaštenje.',
    en: 'Općina Vrsar is a pilot target; nothing here implies an agreement or an authorization.',
  },
];
