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
  const [base, index, detail] = await Promise.all([
    readFile(new URL('../src/layouts/Base.astro', import.meta.url), 'utf8'),
    readFile(new URL('complaints/index.astro', root), 'utf8'),
    readFile(new URL(join('complaints', '[id].astro'), root), 'utf8'),
  ]);

  assert.equal((base.match(/href="\/complaints"/g) ?? []).length, 1);
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
    'href=\"/governance/jur-croatia-local\"',
    'href=\"/transparency\"',
    'href=\"/verify\"',
    'href=\"/partners\"',
    'href=\"/pilot/results\"',
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
  const [presentation, hr, component, content] = await Promise.all([
    readFile(new URL('presentation.astro', root), 'utf8'),
    readFile(new URL('hr/presentation.astro', root), 'utf8'),
    readFile(new URL('../src/components/PublicReleaseHome.astro', import.meta.url), 'utf8'),
    readFile(new URL('../src/content/public-release.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(presentation, /<PublicReleaseHome lang="en" \/>/);
  assert.match(hr, /<PublicReleaseHome lang="hr" \/>/);
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
  const [index, hr, hub] = await Promise.all([
    readFile(new URL('index.astro', root), 'utf8'),
    readFile(new URL('hr/index.astro', root), 'utf8'),
    readFile(new URL(join('demo', 'index.astro'), root), 'utf8'),
  ]);

  for (const page of [index, hr]) {
    for (const href of [
      '/demo/citizen',
      '/demo/official',
      '/demo/review',
      '/demo/record',
      '/demo/embed',
    ]) {
      assert.match(page, new RegExp(`'${href}'`), href);
    }
    assert.match(page, /landing/);
    assert.doesNotMatch(page, /PublicReleaseHome/);
  }

  assert.match(index, /'\/presentation'/);
  assert.match(index, /Astro\.redirect\('\/presentation\?present=1', 302\)/);
  assert.match(hr, /'\/hr\/presentation'/);
  assert.match(hr, /Astro\.redirect\('\/hr\/presentation\?present=1', 302\)/);
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
  const releaseNav = base.slice(base.indexOf('<nav class=\"site-nav release-nav\"'), base.indexOf('</nav>', base.indexOf('<nav class=\"site-nav release-nav\"')));
  assert.doesNotMatch(
    releaseNav,
    /\/login|\/complaints|\/contribute|\/rewards|\/proofs|\/verify|\/assistant|\/audit|\/governance/,
  );
  assert.match(releaseNav, /href=\{presentationHref\}/);
  assert.match(base, /const presentHref = `\$\{presentationHref\}\?present=1`/);
});

test('release styles carry the locked phone, focus, motion, print, and font contracts', async () => {
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(styles, /BarlowCondensed-SemiBold\.ttf/);
  assert.match(styles, /BarlowCondensed-Bold\.ttf/);
  assert.match(styles, /--tap-target: 2\.75rem/);
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
