// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';

import { SMS_APPENDED, SMS_BLOCKED, SMS_CONFIRM, SMS_RELAY, spellCaseNumberHr } from './copy-hr.js';

const GSM_7_BASIC = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'.split(
    '',
  ),
);
const GSM_7_EXT = new Set('^{}\\[~]|€'.split(''));

function gsm7Length(value: string): number {
  let units = 0;
  for (const character of value) {
    if (GSM_7_BASIC.has(character)) units += 1;
    else if (GSM_7_EXT.has(character)) units += 2;
    else throw new Error(`not GSM-7: ${character}`);
  }
  return units;
}

test('spellCaseNumberHr spells letters and Croatian digit words', () => {
  assert.equal(spellCaseNumberHr('VRS-1842'), 'V R S, jedan, osam, četiri, dva');
});

test('SMS confirmation has exact spelling and stays within one GSM-7 SMS', () => {
  const message = SMS_CONFIRM('VRS-1842');
  assert.equal(message, 'Prijava je zaprimljena. Broj predmeta: VRS-1842.');
  assert.equal(gsm7Length(message) <= 160, true);
});

test('Croatian SMS strings keep exact wording', () => {
  assert.equal(SMS_APPENDED('VRS-1842'), 'Poruka je dodana predmetu VRS-1842.');
  assert.equal(SMS_RELAY('VRS-1842', 'Tekst'), 'Predmet VRS-1842: Tekst');
  assert.equal(SMS_BLOCKED, 'Poruke su zaustavljene. Pošaljite POČNI za nastavak.');
});
