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

test('the top bar names one level of scope beside the brand', async () => {
  const shell = await readFile(new URL('src/scripts/pilot/vrsar/shell.ts', webRoot), 'utf8');
  const line = shell.slice(shell.indexOf('data-pilot-context-slot'));
  // The category and the department belong to the home scope block and the
  // case page, so the context line carries the municipality and nothing else.
  assert.match(line, /entityName\(configResult\.value\.municipality, lang\)/);
  assert.doesNotMatch(line, /entityName\(config\.category/);
  assert.doesNotMatch(line, /entityName\(config\.office/);
  const markup = await readFile(
    new URL('src/components/pilot/vrsar/VrsarPilotShell.astro', webRoot),
    'utf8',
  );
  // The navigation keeps an accessible name even though the line is shorter.
  assert.match(markup, /<nav class="pilot-nav" aria-label=\{pilotCopy\.appTitle\[lang\]\}/);
});

test('one type scale is declared once and the office pages spend it', async () => {
  const styles = await readFile(new URL('src/styles/pilot/vrsar.css', webRoot), 'utf8');
  const steps = [
    '--pilot-type-title',
    '--pilot-type-section',
    '--pilot-type-group',
    '--pilot-type-row',
    '--pilot-type-lead',
    '--pilot-type-meta',
  ];
  for (const step of steps) {
    const declarations = styles.split('\n').filter((line) => line.trim().startsWith(`${step}:`));
    assert.equal(declarations.length, 1, `${step} is declared ${declarations.length} times`);
  }
  // A page title is a tool name, not a presentation title.
  assert.match(styles, /\.pilot-page-header h1 \{[\s\S]*?font-size: var\(--pilot-type-title\);/);
  assert.doesNotMatch(styles, /font-size: var\(--type-heading-lg\)/);
  // A row title never outweighs the group head above it.
  assert.match(styles, /\.pilot-ledger-title \{[\s\S]*?font-size: var\(--pilot-type-row\);[\s\S]*?font-weight: 400;/);
  const worklist = await readFile(new URL('src/styles/pilot/vrsar-worklist.css', webRoot), 'utf8');
  assert.match(worklist, /\.worklist-group-head \{[\s\S]*?font-size: var\(--pilot-type-group\);/);
  assert.match(worklist, /\.worklist-subject \{[\s\S]*?font-size: var\(--pilot-type-row\);[\s\S]*?font-weight: 400;/);
  // Stamps line up down both lists because they share one column width.
  assert.match(worklist, /\.worklist-row-head \{[\s\S]*?var\(--pilot-stamp-column\)/);
  assert.match(styles, /\.pilot-ledger\[data-list='receipts'\] \.pilot-ledger-row \{[\s\S]*?var\(--pilot-stamp-column\)/);
});

test('the office home reorders the shared blocks instead of dropping them', async () => {
  const page = await readFile(new URL('src/pages/pilot/vrsar/index.astro', webRoot), 'utf8');
  for (const hook of ['data-entry-page', 'data-entry-role', 'data-entry-lookup', 'data-entry-scope', 'data-entry-aside']) {
    assert.match(page, new RegExp(hook), hook);
  }
  const script = await readFile(new URL('src/scripts/pilot/vrsar/index.ts', webRoot), 'utf8');
  assert.match(script, /session\.role === 'official'/);
  assert.match(script, /page\.dataset\.role = 'official'/);
  assert.match(script, /lookupSection\.dataset\.lookup = 'compact'/);
  const styles = await readFile(new URL('src/styles/pilot/vrsar.css', webRoot), 'utf8');
  // The resident view is untouched: every rule hangs off the official role.
  for (const block of ['[data-entry-role]', '[data-entry-lookup]', '[data-entry-scope]', '[data-entry-aside]']) {
    assert.ok(
      styles.includes(`.pilot-page[data-role='official'] > ${block}`),
      `${block} is styled outside the official role`,
    );
  }
});

test('the office home opens on the queue counts, and a resident sees none', async () => {
  const page = await readFile(new URL('src/pages/pilot/vrsar/index.astro', webRoot), 'utf8');
  // The block ships hidden, so a resident and a failed private call see nothing.
  assert.match(page, /data-entry-counts\n\s+hidden/);
  assert.match(page, /<div class="pilot-stats" data-entry-stats><\/div>/);
  assert.match(page, /worklistCopy\.overviewHeading\[lang\]/);

  const script = await readFile(new URL('src/scripts/pilot/vrsar/index.ts', webRoot), 'utf8');
  // The counts come from the worklist's own functions, not a second count.
  assert.match(script, /import \{ todayKey, WORKLIST_FILTERS, worklistCounts \} from '\.\/staff'/);
  assert.match(script, /listPrivateRecords\(\),\n\s+listPublicCases\(100\)/);
  assert.doesNotMatch(script, /OPEN_STATUSES|counts\.open \+= 1/);
  // Only an official asks for private records, and each count is a way in.
  assert.match(script, /if \(!isOfficial \|\| !countsSection \|\| !countsStrip\) return;/);
  assert.match(script, /\/pilot\/vrsar\/staff\?filter=\$\{key\}/);
  // A private call that fails leaves the block hidden, with no second banner.
  assert.match(
    script,
    /\} catch \{\n\s+countsStrip\.replaceChildren\(\);\n\s+countsSection\.hidden = true;/,
  );

  const styles = await readFile(new URL('src/styles/pilot/vrsar.css', webRoot), 'utf8');
  assert.ok(
    styles.includes(".pilot-page[data-role='official'] > [data-entry-counts]"),
    'the counts block is ordered outside the official role',
  );
});
