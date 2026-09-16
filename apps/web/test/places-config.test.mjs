// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { livePlaces } from '../src/content/places.ts';

test('live place publicity copies match their pilot configs', async () => {
  for (const place of livePlaces) {
    const configUrl = new URL(`../../../config/pilots/${place.pilotId}.json`, import.meta.url);
    const config = JSON.parse(await readFile(configUrl, 'utf8'));
    assert.equal(config.publicTextMode, place.publicTextMode, `${place.pilotId}: publicTextMode`);
    assert.equal(
      config.publicTextRetentionDays,
      place.privacy.retentionDays,
      `${place.pilotId}: publicTextRetentionDays`,
    );
  }
});
