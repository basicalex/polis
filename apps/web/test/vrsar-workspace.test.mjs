// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PILOT_LANGS } from '../src/content/pilot/vrsar.ts';
import { workspaceCopy } from '../src/content/pilot/vrsar-workspace.ts';

const webRoot = new URL('../', import.meta.url);

/** Every leaf must be one localized object, never a bare string. */
function walk(value, path, visit) {
  const keys = Object.keys(value);
  const localized = PILOT_LANGS.every((lang) => typeof value[lang] === 'string');
  if (localized) {
    visit(value, path);
    return;
  }
  assert.ok(keys.length > 0, `${path} is empty`);
  for (const key of keys) {
    const child = value[key];
    assert.equal(typeof child, 'object', `${path}.${key} must be a localized object`);
    walk(child, `${path}.${key}`, visit);
  }
}

function occurrences(source, needle) {
  return source.split(needle).length - 1;
}

test('workspaceCopy carries Croatian, Italian and English for every string', () => {
  let leaves = 0;
  walk(workspaceCopy, 'workspaceCopy', (value, path) => {
    leaves += 1;
    for (const lang of PILOT_LANGS) {
      assert.equal(typeof value[lang], 'string', `${path}.${lang} is missing`);
      assert.ok(value[lang].trim().length > 0, `${path}.${lang} is empty`);
    }
    assert.deepEqual(Object.keys(value).sort(), [...PILOT_LANGS].sort(), `${path} has extra keys`);
  });
  assert.ok(leaves > 20, 'the workspace copy should cover the new screen');
});

test('the case workspace has one primary action and one action panel', async () => {
  const page = await readFile(new URL('src/pages/pilot/vrsar/cases/[caseId].astro', webRoot), 'utf8');
  assert.equal(occurrences(page, 'data-primary-action'), 1);
  assert.equal(occurrences(page, 'data-action-panel'), 1);
  // The properties column is the only place the record UUID is printed.
  assert.match(page, /data-properties\b/);
  assert.match(page, /import '\.\.\/\.\.\/\.\.\/\.\.\/styles\/pilot\/vrsar-workspace\.css'/);
  // The old privacy banner component is gone from this page.
  assert.doesNotMatch(page, /VrsarPrivateBoundary/);
});

test('the AI section exists only when the record carries a proposal', async () => {
  const script = await readFile(new URL('src/scripts/pilot/vrsar/case-detail.ts', webRoot), 'utf8');
  assert.match(script, /current\.aiProposals\.length > 0/);
  assert.match(script, /if \(!isStaff\(\) \|\| !hasProposals\) \{\n\s*aiMount\.replaceChildren\(\);/);
});

test('office-actions owns the five office forms and never reads the page', async () => {
  const script = await readFile(new URL('src/scripts/pilot/vrsar/office-actions.ts', webRoot), 'utf8');
  for (const builder of [
    'assignForm',
    'commitmentForm',
    'resolutionForm',
    'reopenForm',
    'attachmentForm',
  ]) {
    assert.match(script, new RegExp(`export function ${builder}\\(context: OfficeActionContext\\)`), builder);
  }
  assert.doesNotMatch(script, /document\.querySelector/);
  assert.doesNotMatch(script, /data-record-detail/);
});
