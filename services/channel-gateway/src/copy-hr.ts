// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

// Bound to docs/communication/hr-terminology-glossary.md: prijava, zaprimljeno, predmet; formal Vi.

export const PROMPT_HR =
  'Dobar dan. Ovo je automatska prijava komunalnog problema. Opišite problem nakon zvučnog signala. Ako ne navedete svoje ime, prijava će se voditi anonimno. Kada završite, poklopite.';

export const SMS_BLOCKED = 'Poruke su zaustavljene. Pošaljite POČNI za nastavak.';

export function SMS_CONFIRM(caseNumber: string): string {
  return `Prijava je zaprimljena. Broj predmeta: ${caseNumber}.`;
}

export function SMS_APPENDED(caseNumber: string): string {
  return `Poruka je dodana predmetu ${caseNumber}.`;
}

export function SMS_RELAY(caseNumber: string, text: string): string {
  return `Predmet ${caseNumber}: ${text}`;
}

const DIGIT_WORDS: Readonly<Record<string, string>> = {
  '0': 'nula',
  '1': 'jedan',
  '2': 'dva',
  '3': 'tri',
  '4': 'četiri',
  '5': 'pet',
  '6': 'šest',
  '7': 'sedam',
  '8': 'osam',
  '9': 'devet',
};

export function spellCaseNumberHr(caseNumber: string): string {
  const match = /^([A-Za-z]+)-?(.+)$/.exec(caseNumber);
  if (!match) return caseNumber;
  const prefix = [...match[1]!].map((character) => character.toUpperCase()).join(' ');
  const suffix = [...match[2]!].map((character) => DIGIT_WORDS[character] ?? character);
  return [prefix, ...suffix].join(', ');
}
