// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('../src/pages/', import.meta.url);

async function exists(path) {
  await access(new URL(path, root));
}

test('web has required phase 1 and public-release routes', async () => {
  const presentation = await readFile(new URL('presentation.astro', root), 'utf8');
  assert.match(presentation, /PublicReleaseHome/);
  await exists('index.astro');
  await exists('en/index.astro');
  await exists(join('en', 'presentation.astro'));
  await exists('hr/index.astro');
  await exists(join('hr', 'presentation.astro'));
  await exists('release-boundary.astro');
  await exists('governance/[jurisdiction]/index.astro');
  await exists(join('governance', '[jurisdiction]', 'institutions', '[institutionId].astro'));
  await exists(join('governance', '[jurisdiction]', 'roles', '[roleId].astro'));
  await exists(join('governance', '[jurisdiction]', 'processes', '[processId].astro'));
});

test('web has trust-experience routes', async () => {
  await exists('verify.astro');
  await exists('proofs.astro');
  await exists(join('proofs', '[id].astro'));
  await exists(join('claims', '[id].astro'));
});

test('resident complaints routes are client-fetched and linked from primary navigation', async () => {
  await exists(join('complaints', 'index.astro'));
  await exists(join('complaints', '[id].astro'));
  const [base, chromeContent, index, detail] = await Promise.all([
    readFile(new URL('../src/layouts/Base.astro', import.meta.url), 'utf8'),
    readFile(new URL('../src/content/chrome.ts', import.meta.url), 'utf8'),
    readFile(new URL('complaints/index.astro', root), 'utf8'),
    readFile(new URL(join('complaints', '[id].astro'), root), 'utf8'),
  ]);

  assert.equal((chromeContent.match(/href: '\/complaints'/g) ?? []).length, 1);
  assert.match(base, /window\.__API_URL/);
  assert.match(index, /sessionStorage\.getItem\('web_session'\)/);
  assert.match(index, /\/api\/v1\/complaints\/mine/);
  assert.match(index, /method: 'POST'/);
  assert.match(index, /\/api\/v1\/complaints'/);
  assert.match(detail, /\/information-requests\//);
  assert.match(detail, /\/appeals/);
  assert.match(detail, /sessionStorage\.getItem\('web_session'\)/);
  const indexFrontmatter = index.slice(0, index.indexOf('---', 3) + 3);
  const detailFrontmatter = detail.slice(0, detail.indexOf('---', 3) + 3);
  assert.doesNotMatch(indexFrontmatter, /fetch\(/);
  assert.doesNotMatch(detailFrontmatter, /fetch\(/);
});

test('web verify page uses the client-side hashing flow', async () => {
  const verify = await readFile(new URL('verify.astro', root), 'utf8');
  assert.match(verify, /VerifierFlow/);
  assert.doesNotMatch(verify, /verify\/file/);
  assert.doesNotMatch(verify, /contentBase64/);
});

test('M-RA web surfaces carry accountability markers and trust links', async () => {
  const pages = [
    'mandate-holders/index.astro',
    join('mandate-holders', '[id].astro'),
    join('commitments', '[id].astro'),
  ];

  for (const page of pages) {
    const source = await readFile(new URL(page, root), 'utf8');
    assert.match(source, /accountability, not endorsement/, page);
    assert.match(source, /public-read/, page);
    assert.match(source, /verifiable/, page);
    assert.match(source, /href="\/audit"/, page);
    assert.match(source, /href="\/proofs"/, page);
    assert.match(source, /href="\/verify"/, page);
  }
});

test('mandate-holder detail scorecard counts deep-link to status evidence anchors', async () => {
  const source = await readFile(new URL(join('mandate-holders', '[id].astro'), root), 'utf8');
  assert.match(source, /statusAnchor/);
  assert.match(source, /\?status=delivered#\$\{statusAnchor\('delivered'\)\}/);
  assert.match(source, /\?status=in_progress#\$\{statusAnchor\('in_progress'\)\}/);
  assert.match(source, /\?status=proposed#\$\{statusAnchor\('proposed'\)\}/);
  assert.match(source, /\?status=partial#\$\{statusAnchor\('partial'\)\}/);
  assert.match(source, /\?status=not_delivered#\$\{statusAnchor\('not_delivered'\)\}/);
  assert.match(source, /\?status=overdue#\$\{statusAnchor\('overdue'\)\}/);
  assert.match(source, /id=\{statusFilter \? statusAnchor\(statusFilter\) : 'commitments'\}/);
  assert.match(source, /id=\{`commitment-\$\{c\.effectiveStatus\}-\$\{c\.id\}`\}/);
  assert.match(source, /evidence and audit details/);
});

test('pilot demonstrator support pages keep their local-mode disclosure and resources', async () => {
  const pages = ['partners.astro', join('pilot', 'results.astro')];
  const truthPhrases = [
    'simulated complaints-process demonstrator',
    'synthetic fixtures',
    'development trust material',
    'no government integration',
    'implemented locally',
    'mocked',
    'operationally accepted',
  ];
  const directLinks = [
    'href="/governance/jur-croatia-local"',
    'href="/transparency"',
    'href="/verify"',
    'href="/partners"',
    'href="/pilot/results"',
  ];

  for (const page of pages) {
    const source = await readFile(new URL(page, root), 'utf8');
    for (const phrase of truthPhrases) assert.match(source, new RegExp(phrase), `${page}: ${phrase}`);
    for (const href of directLinks) assert.match(source, new RegExp(href), `${page}: ${href}`);
  }

  const partners = await readFile(new URL('partners.astro', root), 'utf8');
  assert.match(partners, /<Base title="Simulated charter">/);
  assert.match(partners, /<h1>Simulated charter<\/h1>/);
  assert.match(partners, /Demonstrator charter data are unavailable/);
  assert.doesNotMatch(partners, /Pilot Partners|Pilot charter loading…|<strong>Live:<\/strong>/);

  const results = await readFile(new URL(join('pilot', 'results.astro'), root), 'utf8');
  assert.match(results, /<Base title="Demonstrator fixture results">/);
  assert.match(results, /<h1>Demonstrator fixture results<\/h1>/);
  assert.match(results, /Seeded scenario measures — synthetic fixtures/);
  assert.match(results, /Illustrated outputs[\s\S]*synthetic fixtures · development trust material · no government integration/);
  assert.match(results, /Demonstration result data are unavailable/);
  assert.doesNotMatch(results, /Pilot Results|\bN\/A\b/);
});

test('public release uses one bilingual five-stage semantic Trace composition', async () => {
  const [presentation, english, component, content] = await Promise.all([
    readFile(new URL('presentation.astro', root), 'utf8'),
    readFile(new URL('en/presentation.astro', root), 'utf8'),
    readFile(new URL('../src/components/PublicReleaseHome.astro', import.meta.url), 'utf8'),
    readFile(new URL('../src/content/public-release.ts', import.meta.url), 'utf8'),
  ]);

  // Croatian at the root, English under /en/ (revision decision R1).
  assert.match(presentation, /<PublicReleaseHome lang="hr" \/>/);
  assert.match(english, /<PublicReleaseHome lang="en" \/>/);
  assert.match(component, /stages\.map/);
  assert.match(component, /record\.events\.slice\(0, index \+ 1\)/);
  for (const stage of ['voice', 'responsibility', 'response', 'check', 'receipt']) {
    assert.match(content, new RegExp(`id: '${stage}'`), stage);
  }
  for (const fixture of [
    'voice-vrsar-001',
    'boundary-case-002',
    'commitment-vrsar-003',
    'proof-vrsar-004',
    'pilot-vrsar-005',
    'receipt-vrsar-006',
  ]) {
    assert.match(content, new RegExp(fixture), fixture);
  }
  assert.match(content, /PENDING REVIEW/);
  assert.match(content, /PENDING REVIEW → PUBLISHED/);
  assert.match(content, /ČEKA NEOVISNU PROVJERU → OBJAVLJENO/);
  assert.match(content, /Publication followed independent review\./);
  assert.match(content, /It does not claim the promise is fulfilled or terminally resolved\./);
  assert.match(component, /trace-event-proposed/);
  assert.match(component, /isProposedResponse/);
  assert.doesNotMatch(component, /trace-event-gate/);
  assert.match(content, /A match shows the registered bytes match; it does not make the claim true\./);
  assert.match(content, /Općina Vrsar is a pilot target only/);
  assert.match(component, /privateCategories\.map/);
  assert.match(component, /receiptRows\.map/);
  assert.match(component, /pilotQuestions\.map/);
  assert.doesNotMatch(component, /fetch\s*\(/);
  assert.doesNotMatch(component, /<form\b/);
});

test('the root is the place map and the demo entries moved to the hub', async () => {
  const [index, english, hub, place, englishPlace] = await Promise.all([
    readFile(new URL('index.astro', root), 'utf8'),
    readFile(new URL('en/index.astro', root), 'utf8'),
    readFile(new URL(join('demo', 'index.astro'), root), 'utf8'),
    readFile(new URL(join('[place]', 'index.astro'), root), 'utf8'),
    readFile(new URL(join('en', '[place]', 'index.astro'), root), 'utf8'),
  ]);

  // S1: the map and nothing else on the root (entry-flow R1).
  for (const page of [index, english]) {
    assert.match(page, /PlaceMap/);
    assert.match(page, /chrome="entry"/);
    assert.match(page, /zupanija/);
    assert.doesNotMatch(page, /PublicLanding|PublicReleaseHome/);
    assert.doesNotMatch(page, /\/demo\//);
  }

  // The five role surfaces are listed on the hub, not on the front door.
  for (const href of [
    '/demo/citizen',
    '/demo/official',
    '/demo/review',
    '/demo/record',
    '/demo/embed',
  ]) {
    assert.match(hub, new RegExp(`'${href}'`), href);
  }
  assert.doesNotMatch(hub, /Astro\.redirect\('\/', 302\)/);

  // Old presenter links keep working.
  assert.match(index, /Astro\.redirect\('\/presentation\?present=1', 302\)/);
  assert.match(english, /Astro\.redirect\('\/en\/presentation\?present=1', 302\)/);

  // S2: unknown slug is a 404, known-but-not-live answers 200 (R4).
  for (const page of [place, englishPlace]) {
    assert.match(page, /findPlace\(Astro\.params\.place \?\? ''\)/);
    assert.match(page, /new Response\(null, \{ status: 404 \}\)/);
    assert.match(page, /IntentScreen/);
  }
});

test('the intent screen shows two buttons in the fixed order', async () => {
  const screen = await readFile(
    new URL('../src/components/entry/IntentScreen.astro', import.meta.url),
    'utf8',
  );
  const record = screen.indexOf("data-variant=\"secondary\"");
  const report = screen.indexOf("data-variant=\"primary\"");
  assert.ok(record > 0 && report > record, 'the public record must come before filing (R7)');
  assert.match(screen, /\$\{base\}\$\{place\.slug\}\/zapis/);
  assert.match(screen, /\$\{base\}\$\{place\.slug\}\/prijava/);
  assert.match(screen, /backHref = `\$\{base\}\?zupanija=\$\{place\.county\}`/);
});

test('the place map ships our own SVG and no map provider', async () => {
  const [map, script] = await Promise.all([
    readFile(new URL('../src/components/entry/PlaceMap.astro', import.meta.url), 'utf8'),
    readFile(new URL('../src/scripts/entry/map.ts', import.meta.url), 'utf8'),
  ]);
  // Boundary attribution rides with the map (ODbL and CC BY-SA are share-alike).
  assert.match(map, /attribution/);
  assert.doesNotMatch(map, /leaflet/i);
  assert.doesNotMatch(script, /leaflet|tile\.openstreetmap/i);
  // Every request the script makes is same-origin data we generated.
  const fetches = script.match(/fetch\((['"`])[^'"`]+\1/g) ?? [];
  assert.ok(fetches.length > 0);
  for (const call of fetches) assert.match(call, /fetch\((['"`])\/geo\//, call);
  // Location is asked for on a tap, never on load (R5).
  assert.match(script, /locate\?\.addEventListener\('click'/);
  assert.equal((script.match(/getCurrentPosition/g) ?? []).length, 1);
});

test('entry chrome uses the approved full Polis lockup once', async () => {
  const [base, styles, lockup] = await Promise.all([
    readFile(new URL('../src/layouts/Base.astro', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles/entry.css', import.meta.url), 'utf8'),
    readFile(new URL('../public/brand/polis-lockup.svg', import.meta.url), 'utf8'),
  ]);

  assert.equal((base.match(/src="\/brand\/polis-lockup\.svg"/g) ?? []).length, 1);
  assert.match(base, /class="entry-wordmark-image"[^>]*alt="Polis"/);
  assert.doesNotMatch(base, /class="entry-wordmark"[^>]*>Polis<\/a>/);
  assert.match(styles, /\.entry-wordmark \{[^}]*min-height: var\(--tap-target\)/s);
  assert.match(styles, /width: clamp\(7rem, 20vw, 8\.25rem\)/);
  assert.match(lockup, /viewBox="0 0 224\.27 44"/);
});

test('the report map bundles Leaflet only on the filing surface', async () => {
  const [component, mapScript, reportScript, styles, placeMap, placeMapScript, places, privacy, content] =
    await Promise.all([
      readFile(new URL('../src/components/entry/ReportForm.astro', import.meta.url), 'utf8'),
      readFile(new URL('../src/scripts/entry/report-map.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/scripts/entry/report.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/styles/entry.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/components/entry/PlaceMap.astro', import.meta.url), 'utf8'),
      readFile(new URL('../src/scripts/entry/map.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/content/places.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/pages/privacy.astro', import.meta.url), 'utf8'),
      readFile(new URL('../src/content/entry.ts', import.meta.url), 'utf8'),
    ]);

  assert.match(component, /import 'leaflet\/dist\/leaflet\.css'/);
  assert.match(component, /href="https:\/\/www\.openstreetmap\.org\/copyright"/);
  assert.match(component, /data-report-map-canvas/);
  assert.match(component, /data-map-error/);
  assert.doesNotMatch(component, /<svg data-map|data-layer="place"/);
  assert.match(reportScript, /import\('\.\/report-map'\)/);
  assert.match(mapScript, /REPORT_MAP_TILE_URL = 'https:\/\/tile\.openstreetmap\.org\/\{z\}\/\{x\}\/\{y\}\.png'/);
  assert.match(mapScript, /const INITIAL_ZOOM = 15/);
  assert.match(mapScript, /const MAX_ZOOM = 19/);
  assert.match(mapScript, /maxNativeZoom: MAX_ZOOM/);
  assert.match(mapScript, /iconSize: \[44, 44\]/);
  assert.match(styles, /\.report-map \.leaflet-control-zoom\.leaflet-bar a \{[^}]*width: var\(--tap-target\);[^}]*height: var\(--tap-target\)/s);
  assert.doesNotMatch(mapScript, /detectRetina|fetch\(|geo\/hr|geoSlug|polygon/i);
  assert.match(mapScript, /const failedTiles = new Set<HTMLElement>\(\)/);
  assert.match(mapScript, /tiles\.on\('tileerror'/);
  assert.match(mapScript, /tiles\.on\('tileload', resolveTileFailure\)/);
  assert.match(mapScript, /tiles\.on\('tileunload', resolveTileFailure\)/);
  assert.match(mapScript, /delete root\.dataset\.tiles/);
  assert.match(mapScript, /mapError\.textContent = ''/);
  assert.match(mapScript, /prefers-reduced-motion: reduce/);
  assert.match(places, /reportMapCenter: \{ lat: 45\.149, lon: 13\.605 \}/);
  assert.match(privacy, /entryStrings\.reportMapPrivacy/);
  assert.match(content, /OpenStreetMap receives your IP address and the map area shown/);
  assert.doesNotMatch(placeMap, /leaflet/i);
  assert.doesNotMatch(placeMapScript, /leaflet|tile\.openstreetmap/i);
});

test('security policy permits only OpenStreetMap tile images', async () => {
  const [headers, middleware] = await Promise.all([
    readFile(new URL('../public/_headers', import.meta.url), 'utf8'),
    readFile(new URL('../src/middleware.ts', import.meta.url), 'utf8'),
  ]);

  for (const source of [headers, middleware]) {
    assert.match(source, /img-src 'self' data: blob: https:\/\/tile\.openstreetmap\.org;/);
    assert.doesNotMatch(source, /connect-src[^;]*openstreetmap/);
    assert.doesNotMatch(source, /script-src[^;]*openstreetmap/);
  }
});

test('public release presenter preserves keyboard, fullscreen recovery, and default-visible content', async () => {
  const component = await readFile(new URL('../src/components/PublicReleaseHome.astro', import.meta.url), 'utf8');
  for (const key of ['ArrowRight', 'ArrowDown', 'PageDown', 'ArrowLeft', 'ArrowUp', 'PageUp', 'Home', 'End']) {
    assert.match(component, new RegExp(key), key);
  }
  assert.match(component, /button, a, input, textarea, select, \[contenteditable="true"\]/);
  assert.match(component, /Math\.max\(0, Math\.min\(sections\.length - 1, nextIndex\)\)/);
  assert.match(component, /requestFullscreen/);
  assert.match(component, /fullscreenDenied/);
  assert.match(component, /role="status"/);
  assert.match(component, /root\.classList\.add\('is-enhanced'\)/);
});

test('release Base emits the direction contract first and removes service actions in release mode', async () => {
  const [base, content] = await Promise.all([
    readFile(new URL('../src/layouts/Base.astro', import.meta.url), 'utf8'),
    readFile(new URL('../src/content/public-release.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(base, /<body><Fragment set:html=\{`<!-- direction-contract/);
  assert.match(
    content,
    /FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN\.md/,
  );
  assert.match(base, /publicRelease \? \(/);
  assert.match(base, /!publicRelease && \(/);
  const releaseNav = base.slice(base.indexOf('<nav class="site-nav release-nav"'), base.indexOf('</nav>', base.indexOf('<nav class="site-nav release-nav"')));
  assert.doesNotMatch(
    releaseNav,
    /\/login|\/complaints|\/contribute|\/rewards|\/proofs|\/verify|\/assistant|\/audit|\/governance/,
  );
  assert.match(releaseNav, /href=\{presentationHref\}/);
  assert.match(base, /const presentHref = `\$\{presentationHref\}\?present=1`/);
});

test('release styles carry the locked phone, focus, motion, print, and font contracts', async () => {
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  const base = await readFile(
    new URL('../../../packages/ui/src/styles/base.css', import.meta.url),
    'utf8',
  );
  // One display face in both worlds; Barlow Condensed is retired.
  assert.match(styles, /SourceSerif4-SemiBold-latin\.woff2/);
  assert.doesNotMatch(styles, /BarlowCondensed/);
  assert.match(base, /--display: 'Source Serif 4'/);
  // Tokens live in @polis/ui only; the app redefines none of them.
  assert.match(base, /--tap-target: 2\.75rem/);
  assert.doesNotMatch(styles, /^\s*--(polis|trust|space|radius|shadow|type|tap-target|display|body|mono)-?[a-z0-9-]*:/m);
  assert.match(styles, /outline: 0\.125rem solid var\(--polis-trace\)/);
  assert.match(styles, /@media \(max-width: 40rem\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /@media print/);
  assert.match(styles, /overflow-x: clip/);
  assert.match(styles, /\.receipt-table td::before/);
});

test('release boundary accepts and stores no data', async () => {
  const boundary = await readFile(new URL('release-boundary.astro', root), 'utf8');
  assert.match(boundary, /accepts, submits, and stores no data/);
  assert.match(boundary, /Ne prihvaća, ne šalje i ne pohranjuje podatke/);
  assert.doesNotMatch(boundary, /<form\b|fetch\s*\(/);
});

test('site chrome groups the local navigation and skips to main content', async () => {
  const [base, chrome, chromeContent] = await Promise.all([
    readFile(new URL('../src/layouts/Base.astro', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles/chrome.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/content/chrome.ts', import.meta.url), 'utf8'),
  ]);
  // The skip link targets the id that actually sits on <main> (audit F13).
  assert.match(base, /class="skip-link" href="#main-content"/);
  assert.match(base, /<main class="site-main" id="main-content">/);
  assert.doesNotMatch(base, /href="#public-record"/);

  // Four disclosure groups, not thirteen flat links (audit F5). Three come
  // from the data list and Account is rendered around the auth slot, so the
  // exclusive-accordion name appears at two places in the source.
  assert.match(base, /import '\.\.\/styles\/chrome\.css';/);
  assert.equal((base.match(/name="polis-nav-group"/g) ?? []).length, 2);
  const groups = chromeContent.slice(
    chromeContent.indexOf('export const localNavGroups'),
    chromeContent.indexOf('export const accountNav'),
  );
  assert.deepEqual(
    (groups.match(/^ {4}label: \{ en: '(\w+)', hr: '[^']+' \},$/gm) ?? []).map((line) => line.trim()),
    [
      "label: { en: 'Record', hr: 'Zapis' },",
      "label: { en: 'Trust', hr: 'Povjerenje' },",
      "label: { en: 'Learn', hr: 'Upute' },",
    ],
  );
  assert.match(base, /<summary class="nav-group-summary">\{text\(accountNav\.label, lang\)\}<\/summary>/);

  // Every destination keeps a one-line description in both languages (S3).
  const hrefs = groups.match(/href: '/g) ?? [];
  const notes = groups.match(/note: \{/g) ?? [];
  assert.equal(hrefs.length, 13);
  assert.equal(notes.length, hrefs.length);

  // Current page and current group are marked by text, not colour alone (P4).
  assert.match(base, /aria-current=\{isCurrentPath\(item\.href\) \? 'page' : undefined\}/);
  assert.match(chrome, /aria-current='page'\]\s*\{[^}]*font-weight: 700/);
  assert.match(chrome, /\.nav-group\[data-current='true'\] > \.nav-group-summary/);

  // Phone: one Menu disclosure at the minimum target size.
  assert.match(base, /<summary class="nav-root-summary">\{text\(menuButton, lang\)\}<\/summary>/);
  assert.match(chrome, /\.nav-root-summary \{[^}]*min-height: var\(--tap-target\)/);
  assert.match(chrome, /@media \(max-width: 40rem\)/);
  // Scripting only carries the phone collapse and Escape handling.
  assert.match(base, /event\.key !== 'Escape'/);
});

test('Croatian is the default language and English lives under /en/', async () => {
  const [index, presentation, hrIndex, hrPresentation, base] = await Promise.all([
    readFile(new URL('index.astro', root), 'utf8'),
    readFile(new URL('presentation.astro', root), 'utf8'),
    readFile(new URL('hr/index.astro', root), 'utf8'),
    readFile(new URL('hr/presentation.astro', root), 'utf8'),
    readFile(new URL('../src/layouts/Base.astro', import.meta.url), 'utf8'),
  ]);

  // The root pair is Croatian and declares both alternates.
  assert.match(index, /const lang = 'hr' as const;/);
  assert.match(index, /alternates=\{\{ hr: '\/', en: '\/en\/' \}\}/);
  assert.match(presentation, /alternates=\{\{ hr: '\/presentation', en: '\/en\/presentation' \}\}/);

  // The old Croatian addresses are permanent redirects that keep the query.
  assert.match(hrIndex, /Astro\.redirect\(`\/\$\{Astro\.url\.search\}`, 301\)/);
  assert.match(hrPresentation, /Astro\.redirect\(`\/presentation\$\{Astro\.url\.search\}`, 301\)/);

  // Both languages plus x-default are declared in the head.
  assert.match(base, /<link rel="alternate" hreflang="hr" href=\{absolute\(alternates\.hr\)\} \/>/);
  assert.match(base, /<link rel="alternate" hreflang="en" href=\{absolute\(alternates\.en\)\} \/>/);
  assert.match(base, /<link rel="alternate" hreflang="x-default" href=\{absolute\(alternates\.hr\)\} \/>/);
});

test('site chrome and footer read one bilingual content source', async () => {
  const [base, chrome, chromeContent] = await Promise.all([
    readFile(new URL('../src/layouts/Base.astro', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles/chrome.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/content/chrome.ts', import.meta.url), 'utf8'),
  ]);

  // No chrome string is written in the layout; every one comes from chrome.ts.
  assert.match(base, /from '\.\.\/content\/chrome'/);
  assert.match(base, /\{text\(skipLink, lang\)\}/);
  assert.doesNotMatch(base, />Skip to content</);
  assert.doesNotMatch(base, />Menu</);

  // The banner text keeps one source in public-release.ts and is re-exported.
  assert.match(chromeContent, /export \{ releaseBanner, releaseBannerDetails \};/);

  // Footer: brand sentence, three link groups, the language switch, and the
  // boundary or version row (revision decision R5).
  assert.match(base, /class="footer-blurb"/);
  for (const group of ["id: 'product'", "id: 'trust'", "id: 'source'"]) {
    assert.match(chromeContent, new RegExp(group), group);
  }
  assert.match(base, /\{text\(languageSwitch, lang\)\}/);
  assert.match(base, /statusLabels\.demonstrationFixture\[lang\]/);
  assert.match(base, /statusLabels\.notLive\[lang\]/);
  assert.match(base, /id="version-meta"/);
  assert.match(base, /apiUrl \+ '\/version'/);

  // Header, footer, and banner content share the page column (decision R2).
  assert.equal((base.match(/class="site-container/g) ?? []).length, 3);
  assert.match(chrome, /\.site-container \{\s*width: min\(var\(--page-measure\), 100%\);/);
  assert.match(chrome, /padding-inline: var\(--page-gutter\)/);
  // Footer columns collapse to one on phones.
  assert.match(chrome, /\.footer-nav \{\s*grid-template-columns: minmax\(0, 1fr\);/);
});

test('the place ledger, filing, and case-number pages exist under both languages', async () => {
  const pages = [
    join('[place]', 'zapis', 'index.astro'),
    join('[place]', 'zapis', '[caseNumber].astro'),
    join('[place]', 'prijava', 'index.astro'),
    join('[place]', 'prijava', '[caseNumber].astro'),
    join('en', '[place]', 'zapis', 'index.astro'),
    join('en', '[place]', 'zapis', '[caseNumber].astro'),
    join('en', '[place]', 'prijava', 'index.astro'),
    join('en', '[place]', 'prijava', '[caseNumber].astro'),
  ];
  for (const page of pages) await exists(page);

  // Only a live place with a backend behind it renders the flow; a known place
  // without one falls back to S2's "još nije ovdje" and an unknown slug is 404.
  for (const page of pages) {
    const source = await readFile(new URL(page, root), 'utf8');
    assert.match(source, /findPilotPlace\(slug\)/, page);
    assert.match(source, /new Response\(null, \{ status: 404 \}\)/, page);
    assert.match(source, /IntentScreen/, page);
    assert.match(source, /chrome="entry"/, page);
  }

  // A case number is a route, so an unreadable one is the same 404 as an
  // unknown slug and never reaches the API.
  for (const page of pages.filter((name) => name.includes('[caseNumber]'))) {
    const source = await readFile(new URL(page, root), 'utf8');
    assert.match(source, /caseNumberRegExp\.test\(caseNumber\)/, page);
  }
});

test('the place ledger lists every state and says a count is not a vote', async () => {
  const [component, script, content] = await Promise.all([
    readFile(new URL('../src/components/entry/PlaceLedger.astro', import.meta.url), 'utf8'),
    readFile(new URL('../src/scripts/entry/ledger.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/content/entry.ts', import.meta.url), 'utf8'),
  ]);

  // The reviewed case-number shape, reused rather than rewritten.
  assert.match(component, /CASE_NUMBER_PATTERN/);
  assert.match(script, /caseNumberRegExp\.test\(value\)/);
  // The existing stamp recipe and state translation, not a second vocabulary.
  assert.match(script, /translatedCaseState/);
  assert.match(script, /caseStateTone/);
  assert.match(script, /listPublicCases\(LIST_LIMIT\)/);
  // A row shape while loading, never a spinner.
  assert.match(component, /ledger-row--skeleton/);
  // Empty state carries an action, error state carries a retry.
  assert.match(component, /EmptyState/);
  assert.match(component, /data-retry/);
  // The attention line keeps the meaning of the fixed "Ovo nije glasovanje".
  assert.match(content, /Broj pratitelja nije glasovanje i ne mijenja redoslijed\./);

  // Held and closed cases are counted in the strip, so a removal shows as a
  // number on the office's own page.
  assert.match(component, /key: 'held'/);
  assert.match(component, /key: 'closed'/);
  assert.match(script, /countHeld\(shells\)/);
  // Each row carries the report itself, or says the text is held.
  assert.match(script, /textExcerpt\(shell\.text\)/);
  assert.match(script, /ledger-row-text/);
  assert.match(content, /ledgerTextHeld/);
  // No resident surface promises a review of the text.
  for (const source of [component, script, content]) {
    assert.doesNotMatch(source, /neovisn/i);
    assert.doesNotMatch(source, /independent review/i);
  }
});

test('the filing screen says what this municipality publishes and when', async () => {
  const [content, component] = await Promise.all([
    readFile(new URL('../src/content/entry.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/entry/ReportForm.astro', import.meta.url), 'utf8'),
  ]);

  // One sentence per publicity mode; the place decides which one the page says.
  assert.match(content, /Tekst i lokaciju objavljujemo odmah, pod brojem predmeta\./);
  assert.match(content, /Tekst i lokaciju objavljuje ured nakon provjere\./);
  assert.match(content, /Tekst i lokaciju ne objavljujemo\./);
  assert.match(component, /place\.publicTextMode === 'release'/);
  assert.match(component, /place\.publicTextMode === 'shell'/);
  assert.match(component, /label\('reportPrivacyOpen'\)/);

  // The warning a filer can act on before they write stays.
  assert.match(content, /Ne pišite imena, brojeve telefona ni registracije drugih ljudi\./);
  // The photo is the one thing that is not published in this wave.
  assert.match(content, /Zasad je vidi samo ured i ne objavljuje se\./);
  // The old promise of approval before publication is gone.
  assert.doesNotMatch(content, /dok ga ured ne odobri/);

  // The rest of the paragraph: controller, what stays private, retention,
  // rights, the data protection officer, and the way to the full notice.
  assert.match(content, /Vaši kontaktni podaci i fotografija ostaju privatni\./);
  assert.match(content, /Prijavu čuvamo \{days\} dana\./);
  assert.match(content, /Voditelj obrade je \{controller\}, \{address\}\./);
  assert.match(content, /pravo na pristup, brisanje i prigovor/);
  assert.match(component, /'\{controller\}', place\.privacy\.controllerName\[lang\]/);
  assert.match(component, /'\{address\}', place\.privacy\.controllerAddress\[lang\]/);
  assert.match(component, /'\{days\}', String\(place\.privacy\.retentionDays\)/);
  assert.match(component, /'\{email\}', place\.privacy\.dpoContact/);
  assert.match(component, /\$\{base\}\$\{place\.slug\}\/privatnost/);
  assert.match(component, /label\('reportPrivacyLink'\)/);
});

test('every live place has a data protection notice in both languages', async () => {
  const pages = [join('[place]', 'privatnost.astro'), join('en', '[place]', 'privatnost.astro')];
  for (const page of pages) await exists(page);

  const [hr, en, notice, privacy, content] = await Promise.all([
    readFile(new URL(pages[0], root), 'utf8'),
    readFile(new URL(pages[1], root), 'utf8'),
    readFile(new URL('../src/components/entry/PrivacyNotice.astro', import.meta.url), 'utf8'),
    readFile(new URL('privacy.astro', root), 'utf8'),
    readFile(new URL('../src/content/entry.ts', import.meta.url), 'utf8'),
  ]);

  // Only a municipality that signed is a controller, so a known place without
  // one has no notice at all rather than an empty page.
  for (const [page, source] of [[pages[0], hr], [pages[1], en]]) {
    assert.match(source, /findPilotPlace\(slug\)/, page);
    assert.match(source, /new Response\(null, \{ status: 404 \}\)/, page);
    assert.match(source, /PrivacyNotice/, page);
    assert.match(source, /chrome="entry"/, page);
  }
  assert.match(hr, /lang = 'hr'/);
  assert.match(en, /lang = 'en'/);

  // The notice names the controller, the retention period and the officer, and
  // says which line about publication this municipality's mode gives.
  assert.match(notice, /'\{controller\}', privacy\.controllerName\[lang\]/);
  assert.match(notice, /'\{address\}', privacy\.controllerAddress\[lang\]/);
  assert.match(notice, /'\{days\}', String\(privacy\.retentionDays\)/);
  assert.match(notice, /'\{email\}', privacy\.dpoContact/);
  assert.match(notice, /privacy\.confidentialContact/);
  assert.match(notice, /place\.publicTextMode === 'release'/);
  assert.match(notice, /place\.publicTextMode === 'shell'/);
  assert.match(notice, /privacyWhatIsPublicOpen/);
  // The hash outlives the text, and the notice says so.
  assert.match(content, /Otisak izvornog teksta ostaje javan i nakon uklanjanja teksta/);
  assert.match(content, /Pritužbu možete podnijeti Agenciji za zaštitu osobnih podataka \(AZOP\)\./);

  // The platform notice stays the platform's: the map tiles and one link per
  // live place to the municipality that is the controller.
  assert.match(privacy, /entryStrings\.reportMapPrivacy/);
  assert.match(privacy, /livePlaces/);
  assert.match(privacy, /\/privatnost/);
});

test('the case-number screen asks the public shell what happened to the text', async () => {
  const [component, script] = await Promise.all([
    readFile(new URL('../src/components/entry/CaseNumber.astro', import.meta.url), 'utf8'),
    readFile(new URL('../src/scripts/entry/case-number.ts', import.meta.url), 'utf8'),
  ]);

  // A reserved block, empty until the shell answers.
  assert.match(component, /data-outcome\b/);
  assert.match(component, /data-outcome-body/);
  assert.match(component, /data-outcome-heading/);
  assert.match(component, /data-outcome-note/);
  assert.match(component, /data-outcome-contact/);
  // The confidential officer travels as data on the root, not as a request.
  assert.match(component, /data-confidential-name=/);
  assert.match(component, /data-confidential-email=/);
  assert.match(component, /data-confidential-phone=/);

  assert.match(script, /getPublicCase\(caseNumber\)/);
  assert.match(script, /held\.textStatus !== 'held'/);
  assert.match(script, /'confidential'/);
  assert.match(script, /'pending-release'/);
  assert.match(script, /'policy'/);
  // Contact lines only for the person holding the key.
  assert.match(script, /if \(hasKey\) showConfidentialContact\(page\)/);
  // A failed answer leaves the screen as it was.
  assert.match(script, /\} catch \{\n    return;/);

  // The key never becomes a query and nothing about this case is stored.
  assert.doesNotMatch(script, /\?k=/);
  assert.doesNotMatch(script, /localStorage/);
  assert.doesNotMatch(script, /sessionStorage/);
});

test('filing asks for no identity and sends an optional WGS84 point', async () => {
  const [component, script, mapScript] = await Promise.all([
    readFile(new URL('../src/components/entry/ReportForm.astro', import.meta.url), 'utf8'),
    readFile(new URL('../src/scripts/entry/report.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/scripts/entry/report-map.ts', import.meta.url), 'utf8'),
  ]);

  // No name, no contact, no category (entry-flow R9). The one photo is the
  // only thing a person may attach, and it asks for no identity either.
  assert.doesNotMatch(component, /type="email"|type="tel"|name="name"/);
  assert.match(component, /<textarea/);
  assert.match(component, /maxlength=\{MAX_TEXT\}/);
  assert.match(component, /<noscript>/);

  // The camera seed is not a pin. A point only appears after map, keyboard or
  // explicit geolocation input, and clearing it restores text-only filing.
  assert.doesNotMatch(component, /data-layer="pin"|class="report-pin"/);
  assert.match(component, /data-clear-location hidden/);
  assert.match(mapScript, /map\.on\('click'/);
  assert.match(mapScript, /marker\.on\('dragend'/);
  assert.match(mapScript, /event\.key !== 'Enter' && event\.key !== ' '/);
  assert.match(mapScript, /options\.onCoordinatesChange\(null\)/);
  assert.equal((mapScript.match(/getCurrentPosition/g) ?? []).length, 1);
  assert.match(mapScript, /locateButton\.addEventListener\('click'/);
  assert.match(mapScript, /enableHighAccuracy: true/);

  // Map startup is isolated from the form; coordinates stay WGS84 latitude,
  // longitude at five decimals and precede any free-text location detail.
  assert.match(script, /import\('\.\/report-map'\)/);
  assert.match(script, /\.catch\(showMapUnavailable\)/);
  assert.match(script, /`\$\{pin\.lat\.toFixed\(5\)\},\$\{pin\.lon\.toFixed\(5\)\}`/);
  assert.match(script, /\[pinLocation\(\), where\?\.value\.trim\(\) \?\? ''\]/);
  assert.match(script, /fileAnonymousCase\(/);

  // The key leaves in a fragment, never a query (R10).
  assert.match(script, /#k=\$\{encodeURIComponent\(filed\.reopenKey\)\}/);
  assert.doesNotMatch(script, /\?k=/);
});

test('the filing photo is re-encoded in the browser and never shown publicly', async () => {
  const [component, script, api, proxy, ledger, publicCase] = await Promise.all([
    readFile(new URL('../src/components/entry/ReportForm.astro', import.meta.url), 'utf8'),
    readFile(new URL('../src/scripts/entry/report.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/pilot/vrsar/api.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/pilot/vrsar/proxy.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/entry/PlaceLedger.astro', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/entry/PlaceCase.astro', import.meta.url), 'utf8'),
  ]);

  // One photo, from the camera or the gallery, and only the two accepted types.
  assert.match(component, /type="file"/);
  assert.match(component, /accept="image\/jpeg,image\/png"/);
  assert.match(component, /capture="environment"/);
  assert.doesNotMatch(component, /multiple/);

  // Re-encoding through a canvas is what drops the EXIF block, GPS included.
  assert.match(script, /imageOrientation: 'from-image'/);
  assert.match(script, /createElement\('canvas'\)/);
  assert.match(script, /'image\/jpeg',\n\s*PHOTO_QUALITY/);
  assert.match(script, /PHOTO_LONG_EDGE = 1600/);
  assert.match(script, /MAX_PHOTO_BYTES = 2 \* 1024 \* 1024/);
  // One halved retry, then the person is told rather than guessed at.
  assert.match(script, /\[PHOTO_LONG_EDGE, PHOTO_LONG_EDGE \/ 2\]/);
  // The photo rides inside the filing request, under the backend's own key.
  assert.match(script, /filing\.photo = photo/);
  assert.match(api, /photo\?: AnonymousCasePhoto/);
  assert.match(proxy, /bodyKeys: \['text', 'location', 'photo'\]/);
  assert.match(proxy, /objectKeys: \{ photo: \['contentType', 'base64'\] \}/);

  // Restricted attachment: no public surface mentions it.
  assert.doesNotMatch(ledger, /photo|fotograf/i);
  assert.doesNotMatch(publicCase, /photo|fotograf/i);
});

test('the reopen key never reaches a path, a query, or a request', async () => {
  const sources = await Promise.all(
    [
      '../src/scripts/entry/case-number.ts',
      '../src/scripts/entry/case.ts',
      '../src/scripts/entry/report.ts',
      '../src/components/entry/CaseNumber.astro',
      '../src/components/entry/PlaceCase.astro',
    ].map(async (path) => [path, await readFile(new URL(path, import.meta.url), 'utf8')]),
  );

  for (const [path, source] of sources) {
    // No key in a query string and no key handed to fetch.
    assert.doesNotMatch(source, /[?&]k=/, path);
    assert.doesNotMatch(source, /reopenKey[^\n]*\?/, path);
    assert.doesNotMatch(source, /fetch\([^)]*reopenKey/, path);
    assert.doesNotMatch(source, /href[^\n]*\?[^\n]*k=/, path);
  }

  const s5 = sources.find(([path]) => path.endsWith('case-number.ts'))[1];
  // S5 reads the key from its own fragment and writes it back into one.
  assert.match(s5, /location\.hash/);
  assert.match(s5, /new URLSearchParams\(fragment\)\.get\('k'\)/);
  assert.match(s5, /recordUrl\.hash = `k=\$\{encodeURIComponent\(key\)\}`/);
  // Without a fragment there is no key section at all.
  assert.match(s5, /if \(!key\) return;/);

  const casePage = sources.find(([path]) => path.endsWith('scripts/entry/case.ts'))[1];
  assert.match(casePage, /new URLSearchParams\(fragment\)\.get\('k'\)/);
  assert.match(casePage, /writeText\(location\.href\)/);
});

test('the map pages state the boundary attribution once', async () => {
  const [base, map, index, english] = await Promise.all([
    readFile(new URL('../src/layouts/Base.astro', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/entry/PlaceMap.astro', import.meta.url), 'utf8'),
    readFile(new URL('index.astro', root), 'utf8'),
    readFile(new URL('en/index.astro', root), 'utf8'),
  ]);
  // The corner of the map that draws the boundaries keeps it; the footer keeps
  // its links and stops repeating it.
  assert.match(map, /entry-map-attribution/);
  assert.doesNotMatch(base, /entry-attribution/);
  assert.match(base, /class="entry-footer-links"/);
  for (const page of [index, english]) assert.doesNotMatch(page, /\battribution\b/);
});
