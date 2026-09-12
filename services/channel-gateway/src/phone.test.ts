// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeE164 } from './phone.js';

test('Croatian international and national forms collapse to one E.164 value', () => {
  for (const value of ['+385911234567', '00385 91 123 4567', '091 123-4567', '0(91)1234567']) {
    assert.equal(normalizeE164(value), '+385911234567');
  }
});

test('normalization rejects non-Croatian, malformed, short, and unsupported-country input', () => {
  for (const value of ['385911234567', '+38640123456', '091/123/4567', '091abc4567', '0123']) {
    assert.throws(() => normalizeE164(value));
  }
  assert.throws(() => normalizeE164('0911234567', 'IT'), /defaultCountry/);
});
