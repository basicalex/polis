// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PILOT_LANGS, pilotCopy } from '../src/content/pilot/vrsar.ts';

const webRoot = new URL('../', import.meta.url);

test('the boundary band is one line short enough for a 390 px screen', async () => {
  for (const lang of PILOT_LANGS) {
    const text = pilotCopy.boundary[lang];
    assert.ok(text.length < 48, `${lang} boundary is ${text.length} characters: ${text}`);
    assert.doesNotMatch(text, /\n/);
    // The full sentence, with the municipality disclaimer, stays reachable.
    assert.ok(pilotCopy.boundaryFull[lang].length > text.length);
  }
  const shell = await readFile(
    new URL('src/components/pilot/vrsar/VrsarPilotShell.astro', webRoot),
    'utf8',
  );
  assert.match(shell, /class="pilot-boundary" title=\{pilotCopy\.boundaryFull\[lang\]\}/);
  assert.match(shell, /pilotCopy\.boundary\[lang\]/);
  const styles = await readFile(new URL('src/styles/pilot/vrsar.css', webRoot), 'utf8');
  const band = styles.slice(styles.indexOf("html[data-pilot='vrsar'] .pilot-boundary {"));
  assert.match(band.slice(0, band.indexOf('}')), /max-height: 2rem;[\s\S]*text-overflow: ellipsis;/);
});

test('the private boundary renders as a line unless a caller asks for the panel', async () => {
  const source = await readFile(
    new URL('src/components/pilot/vrsar/VrsarPrivateBoundary.astro', webRoot),
    'utf8',
  );
  assert.match(source, /variant\?: 'line' \| 'panel';/);
  assert.match(source, /variant = 'line'/);
  assert.match(source, /data-variant=\{variant\}/);
  // No caller passes a variant, so every existing notice is now the line.
  for (const page of [
    'src/pages/pilot/vrsar/file.astro',
    'src/pages/pilot/vrsar/cases/index.astro',
    'src/pages/pilot/vrsar/cases/[caseId].astro',
  ]) {
    const markup = await readFile(new URL(page, webRoot), 'utf8');
    assert.doesNotMatch(markup, /<VrsarPrivateBoundary[^>]*variant=/);
  }
  const styles = await readFile(new URL('src/styles/pilot/vrsar.css', webRoot), 'utf8');
  assert.match(styles, /\.pilot-private-boundary\[data-variant='line'\][\s\S]*?background: none;/);
});

test('the skip link is hidden until it has focus itself', async () => {
  const styles = await readFile(new URL('src/styles/pilot/vrsar.css', webRoot), 'utf8');
  assert.match(styles, /html\[data-pilot='vrsar'\] \.skip-link \{[\s\S]*?clip-path: inset\(50%\);/);
  assert.match(styles, /html\[data-pilot='vrsar'\] \.skip-link:focus \{[\s\S]*?clip-path: none;/);
});

test('a receipt row quotes the case number and keeps the UUID in the address', async () => {
  const source = await readFile(new URL('src/scripts/pilot/vrsar/receipts.ts', webRoot), 'utf8');
  for (const line of source.split('\n')) {
    if (!line.includes('record.id')) continue;
    assert.match(line, /encodeURIComponent\(record\.id\)/, `unexpected record.id use: ${line.trim()}`);
  }
  assert.match(source, /caseNumberOf\(record\)/);
  assert.match(source, /'pilot-ledger-id'/);
  // The page context is in the top bar, so it is gone from every row.
  assert.doesNotMatch(source, /entityName/);
  const detail = await readFile(new URL('src/scripts/pilot/vrsar/receipt-detail.ts', webRoot), 'utf8');
  assert.match(detail, /pilotCopy\.common\.recordId\[lang\]/);
  assert.match(detail, /heading\.textContent = caseNumber/);
});

test('every pilot copy string carries Croatian, Italian and English', () => {
  const walk = (value, path) => {
    if (typeof value === 'string') return;
    assert.ok(value && typeof value === 'object', `${path} is not copy`);
    const keys = Object.keys(value);
    if (keys.length === PILOT_LANGS.length && keys.every((key) => PILOT_LANGS.includes(key))) {
      for (const lang of PILOT_LANGS) {
        assert.equal(typeof value[lang], 'string', `${path}.${lang} is missing`);
        assert.ok(value[lang].trim().length > 0, `${path}.${lang} is empty`);
      }
      return;
    }
    for (const key of keys) walk(value[key], `${path}.${key}`);
  };
  walk(pilotCopy, 'pilotCopy');
});
