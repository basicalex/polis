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
