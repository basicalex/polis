// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { classifyReleasePath } from '../src/lib/release-route-policy.mjs';

const root = new URL('../src/pages/', import.meta.url);

async function exists(path) {
  await access(new URL(path, root));
}

/** Every retired address and where it now sends the reader (decision D3). */
const redirects = [
  ['privacy.astro', '/about', '2026-09-17'],
  ['source.astro', '/about', '2026-09-17'],
  ['security.astro', '/about', '2026-09-17'],
  ['methodology.astro', '/about', '2026-09-17'],
  ['docs.astro', '/about', '2026-09-17'],
  ['transparency.astro', '/about#izdanje', '2026-09-17'],
  ['presentation.astro', '/about', '2026-09-17'],
  [join('hr', 'presentation.astro'), '/about', '2026-09-17'],
  [join('en', 'presentation.astro'), '/en/about', '2026-09-17'],
  [join('demo', 'index.astro'), '/about', '2026-09-17'],
  [join('demo', 'citizen.astro'), '/about', '2026-09-17'],
  [join('demo', 'official.astro'), '/about', '2026-09-17'],
  [join('demo', 'review.astro'), '/about', '2026-09-17'],
  [join('demo', 'record.astro'), '/about', '2026-09-17'],
  [join('demo', 'embed.astro'), '/about', '2026-09-17'],
  ['o-polisu.astro', '/about', '2026-09-29'],
  [join('en', 'o-polisu.astro'), '/en/about', '2026-09-29'],
];

test('About exists in both languages and carries the old About sections', async () => {
  await exists('about.astro');
  await exists(join('en', 'about.astro'));

  const [hr, en, component] = await Promise.all([
    readFile(new URL('about.astro', root), 'utf8'),
    readFile(new URL(join('en', 'about.astro'), root), 'utf8'),
    readFile(new URL('../src/components/entry/WhatIsPolis.astro', import.meta.url), 'utf8'),
  ]);

  for (const [page, source] of [['hr', hr], ['en', en]]) {
    assert.match(source, /WhatIsPolis/, page);
    assert.match(source, /chrome="entry"/, page);
    assert.match(source, /alternates=\{aboutHrefs\}/, page);
  }

  // The old About page's anchors survive, so links into /o-polisu#… still land.
  assert.match(component, /whatIsPolisSectionIds as ids/);
  for (const id of ['what', 'can', 'how', 'why', 'who', 'data', 'release']) {
    assert.match(component, new RegExp(`id=\\{ids\\.${id}\\}`), id);
  }

  // The map-tile sentence and the per-place notices come from the surfaces
  // that own them.
  assert.match(component, /entryStrings\.reportMapPrivacy/);
  assert.match(component, /livePlaces/);
  assert.match(component, /\/privatnost/);
});

test('the About content reads the ledger words and names the repository', async () => {
  const content = await readFile(new URL('../src/content/what-is-polis.ts', import.meta.url), 'utf8');

  assert.match(content, /\/\/ HR draft: native editor review/);
  assert.match(content, /https:\/\/github\.com\/basicalex\/polis/);
  assert.match(content, /AGPL-3\.0-or-later/);
  assert.match(content, /basic@intrface\.eu/);
  for (const stage of [
    'ledgerStageReceived',
    'ledgerStageAssigned',
    'ledgerStageAnswered',
    'ledgerStageResolved',
    'ledgerStageDisputed',
    'ledgerStageClosed',
  ]) {
    assert.match(content, new RegExp(`entryStrings\\.${stage}\\b`), stage);
  }

  const ids = content.slice(content.indexOf('whatIsPolisSectionIds'), content.indexOf('} as const;'));
  for (const id of ['sto-je-polis', 'sto-mozete', 'kako-radi', 'javno-i-otvoreno', 'tko-stoji-iza', 'podaci', 'izdanje']) {
    assert.match(ids, new RegExp(`'${id}'`), id);
  }

  // At most six bullets say what this release does not do.
  const points = content.slice(content.indexOf('whatIsPolisReleasePoints'));
  assert.ok((points.match(/^ {4}hr: /gm) ?? []).length <= 6, 'more than six release bullets');
});

test('the entry footer offers Intrface and About, and the banner points at the release section', async () => {
  const [base, entry] = await Promise.all([
    readFile(new URL('../src/layouts/Base.astro', import.meta.url), 'utf8'),
    readFile(new URL('../src/content/entry.ts', import.meta.url), 'utf8'),
  ]);

  const footer = base.slice(
    base.indexOf('<p class="entry-footer-links">'),
    base.indexOf('</p>', base.indexOf('<p class="entry-footer-links">')),
  );
  assert.match(footer, /href="https:\/\/intrface\.eu" rel="noreferrer"/);
  assert.match(footer, /entryStrings\.footerIntrface/);
  assert.match(footer, /href=\{aboutHref\}/);
  assert.match(footer, /entryStrings\.footerAbout/);
  assert.doesNotMatch(footer, /\/privacy|\/source/);
  assert.ok(
    footer.indexOf('footerIntrface') < footer.indexOf('footerAbout'),
    'Intrface comes before About',
  );

  assert.match(entry, /footerIntrface: \{ hr: 'Intrface', en: 'Intrface' \}/);
  assert.match(entry, /footerAbout: \{ hr: 'Što je Polis\?', en: 'What is Polis\?' \}/);

  // The release banner sends a reader to what this release does.
  assert.match(base, /href=\{`\$\{aboutHref\}#izdanje`\}/);
  // A release or a hosted test build shows no local platform navigation.
  assert.match(base, /\) : testInstance \? null : \(/);
});

test('the About page footer carries the INTRFACE link', async () => {
  const [base, entry] = await Promise.all([
    readFile(new URL('../src/layouts/Base.astro', import.meta.url), 'utf8'),
    readFile(new URL('../src/content/entry.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(base, /const onAbout = currentPath === aboutHref;/);
  const footer = base.slice(
    base.indexOf('<p class="entry-footer-links">'),
    base.indexOf('</p>', base.indexOf('<p class="entry-footer-links">')),
  );
  assert.match(
    footer,
    /\{onAbout \? \(\s*<a class="entry-footer-brand" href="https:\/\/intrface\.eu\/" rel="noreferrer">\{text\(entryStrings\.footerIntrfaceBrand, lang\)\}<\/a>/,
  );
  assert.match(entry, /footerIntrfaceBrand: \{ hr: 'INTRFACE', en: 'INTRFACE' \}/);
});

test('every retired address serves a permanent redirect and nothing 404s', async () => {
  for (const [page, target, retired] of redirects) {
    const source = await readFile(new URL(page, root), 'utf8');
    assert.match(source, /SPDX-License-Identifier: AGPL-3\.0-or-later/, page);
    assert.match(source, new RegExp(`Retired ${retired}`), page);
    assert.match(
      source,
      new RegExp(`return Astro\\.redirect\\('${target.replace('#', '#')}', 301\\);`),
      page,
    );
  }

  // The policy still answers for them, and it answers `safe`, because a
  // redirect has to be served rather than rewritten to the boundary page.
  for (const path of ['/privacy', '/source', '/transparency', '/presentation', '/demo/citizen', '/o-polisu', '/en/o-polisu']) {
    const entry = classifyReleasePath(path);
    assert.equal(entry.kind, 'safe', path);
    assert.equal(entry.inventory, 'retired', path);
  }
  for (const path of ['/about', '/en/about']) {
    const entry = classifyReleasePath(path);
    assert.equal(entry.kind, 'safe', path);
    assert.equal(entry.inventory, 'current', path);
  }
});
