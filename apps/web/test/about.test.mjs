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
  ['privacy.astro', '/o-polisu'],
  ['source.astro', '/o-polisu'],
  ['security.astro', '/o-polisu'],
  ['methodology.astro', '/o-polisu'],
  ['docs.astro', '/o-polisu'],
  ['transparency.astro', '/o-polisu#izdanje'],
  ['presentation.astro', '/o-polisu'],
  [join('hr', 'presentation.astro'), '/o-polisu'],
  [join('en', 'presentation.astro'), '/en/o-polisu'],
  [join('demo', 'index.astro'), '/o-polisu'],
  [join('demo', 'citizen.astro'), '/o-polisu'],
  [join('demo', 'official.astro'), '/o-polisu'],
  [join('demo', 'review.astro'), '/o-polisu'],
  [join('demo', 'record.astro'), '/o-polisu'],
  [join('demo', 'embed.astro'), '/o-polisu'],
];

test('About exists in both languages and renders the six sections', async () => {
  await exists('o-polisu.astro');
  await exists(join('en', 'o-polisu.astro'));

  const [hr, en, component] = await Promise.all([
    readFile(new URL('o-polisu.astro', root), 'utf8'),
    readFile(new URL(join('en', 'o-polisu.astro'), root), 'utf8'),
    readFile(new URL('../src/components/entry/AboutPolis.astro', import.meta.url), 'utf8'),
  ]);

  for (const [page, source] of [['hr', hr], ['en', en]]) {
    assert.match(source, /AboutPolis/, page);
    assert.match(source, /chrome="entry"/, page);
    assert.match(source, /alternates=\{\{ hr: '\/o-polisu', en: '\/en\/o-polisu' \}\}/, page);
  }
  assert.match(hr, /const lang = 'hr' as const;/);
  assert.match(en, /const lang = 'en' as const;/);

  // Six sections, in the fixed order, each an <h2> the release banner and the
  // retired transparency page can link into.
  assert.match(component, /aboutSectionIds/);
  for (const id of ['whatId', 'howId', 'openId', 'whoId', 'dataId', 'releaseId']) {
    assert.match(component, new RegExp(`id=\\{${id}\\}`), id);
  }
  assert.equal((component.match(/class="about-heading"/g) ?? []).length, 6);

  // The ledger words come from the ledger, and the map-tile sentence and the
  // per-place notices come from the surfaces that own them.
  assert.match(component, /entryStrings\.reportMapPrivacy/);
  assert.match(component, /livePlaces/);
  assert.match(component, /\/privatnost/);
});

test('the About content reads the ledger words and names the repository', async () => {
  const content = await readFile(new URL('../src/content/about.ts', import.meta.url), 'utf8');

  assert.match(content, /\/\/ HR draft: native editor review/);
  assert.match(content, /https:\/\/github\.com\/basicalex\/polis/);
  assert.match(content, /AGPL-3\.0-or-later/);
  assert.match(content, /https:\/\/intrface\.eu/);
  assert.match(content, /hello@intrface\.eu/);
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

  // Six sections, in the order the page reads them.
  const ids = content.slice(content.indexOf('aboutSectionIds'), content.indexOf('] as const;'));
  for (const id of ['sto-je-polis', 'kako-radi', 'javno-i-otvoreno', 'tko-stoji-iza', 'podaci', 'izdanje']) {
    assert.match(ids, new RegExp(`'${id}'`), id);
  }

  // At most six bullets say what this release does and does not do.
  const points = content.slice(content.indexOf('aboutReleasePoints'));
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
  assert.match(entry, /footerAbout: \{ hr: 'O Polisu', en: 'About Polis' \}/);

  // The release banner sends a reader to what this release does.
  assert.match(base, /href=\{`\$\{aboutHref\}#izdanje`\}/);
  // A release or a hosted test build shows no local platform navigation.
  assert.match(base, /\) : testInstance \? null : \(/);
});

test('every retired address serves a permanent redirect and nothing 404s', async () => {
  for (const [page, target] of redirects) {
    const source = await readFile(new URL(page, root), 'utf8');
    assert.match(source, /SPDX-License-Identifier: AGPL-3\.0-or-later/, page);
    assert.match(source, /Retired 2026-09-17/, page);
    assert.match(
      source,
      new RegExp(`return Astro\\.redirect\\('${target.replace('#', '#')}', 301\\);`),
      page,
    );
  }

  // The policy still answers for them, and it answers `safe`, because a
  // redirect has to be served rather than rewritten to the boundary page.
  for (const path of ['/privacy', '/source', '/transparency', '/presentation', '/demo/citizen']) {
    const entry = classifyReleasePath(path);
    assert.equal(entry.kind, 'safe', path);
    assert.equal(entry.inventory, 'retired', path);
  }
  for (const path of ['/o-polisu', '/en/o-polisu']) {
    const entry = classifyReleasePath(path);
    assert.equal(entry.kind, 'safe', path);
    assert.equal(entry.inventory, 'current', path);
  }
});
