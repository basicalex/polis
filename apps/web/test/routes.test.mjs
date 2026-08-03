import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('../src/pages/', import.meta.url);

async function exists(path) {
  await access(new URL(path, root));
}

test('web has required phase 1 routes', async () => {
  const index = await readFile(new URL('index.astro', root), 'utf8');
  assert.match(index, /Polis Interface/);
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

test('pilot demonstrator pages disclose their development-only status and resources', async () => {
  const pages = [
    'index.astro',
    'partners.astro',
    join('pilot', 'results.astro'),
  ];
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

  const index = await readFile(new URL('index.astro', root), 'utf8');
  assert.match(index, /<section class="hero stack">\s*<h1>A resident resubmits a document after filing a complaint<\/h1>/);
  assert.doesNotMatch(index, /<p class="badge">/);
  assert.doesNotMatch(index, /Public interface pillars|Local civic infrastructure/);
  assert.match(index, /<ol>[\s\S]*Inspect process[\s\S]*Verify record[\s\S]*Read transparency[\s\S]*<\/ol>/);

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
