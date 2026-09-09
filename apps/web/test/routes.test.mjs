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

test('the landing opens every role demo and keeps old presenter links working', async () => {
  const [index, english, hub] = await Promise.all([
    readFile(new URL('index.astro', root), 'utf8'),
    readFile(new URL('en/index.astro', root), 'utf8'),
    readFile(new URL(join('demo', 'index.astro'), root), 'utf8'),
  ]);

  for (const page of [index, english]) {
    for (const href of [
      '/demo/citizen',
      '/demo/official',
      '/demo/review',
      '/demo/record',
      '/demo/embed',
    ]) {
      assert.match(page, new RegExp(`'${href}'`), href);
    }
    assert.match(page, /PublicLanding/);
    assert.doesNotMatch(page, /PublicReleaseHome/);
  }

  assert.match(index, /'\/presentation'/);
  assert.match(index, /Astro\.redirect\('\/presentation\?present=1', 302\)/);
  assert.match(english, /'\/en\/presentation'/);
  assert.match(english, /Astro\.redirect\('\/en\/presentation\?present=1', 302\)/);
  assert.match(hub, /Astro\.redirect\('\/', 302\)/);
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
