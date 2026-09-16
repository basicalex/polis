// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * The publicity mode as the two surfaces that read it see it: the place ledger
 * and the official's staff case view. The assertions are on the source, in the
 * style of test/vrsar-pilot.test.mjs, because both surfaces build their DOM in
 * the browser and what matters here is which branch exists at all.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { holdReasonLabels, pilotCopy, textStatusLabels } from '../src/content/pilot/vrsar.ts';
import { ASSESSMENT_HOLD_REASONS, HOLD_REASONS } from '../src/lib/pilot/vrsar/model.ts';

const webRoot = new URL('../', import.meta.url);

const read = (relative) => readFile(new URL(relative, webRoot), 'utf8');

test('the ledger summary strip names one text fact per mode', async () => {
  const [component, script] = await Promise.all([
    read('src/components/entry/PlaceLedger.astro'),
    read('src/scripts/entry/ledger.ts'),
  ]);

  // The mode reaches the page from places.ts and is overridden by the config.
  assert.match(component, /data-public-text-mode=\{place\.publicTextMode\}/);
  assert.match(script, /ledger\.dataset\.publicTextMode = textMode/);
  assert.match(script, /readTextMode\(config\.publicTextMode\)/);

  // The third slot by mode: held in open, pending release in release, removed
  // in shell. Open and closed stand in every mode.
  for (const [key, modes] of [
    ['open', 'open release shell'],
    ['overdue', 'open release shell'],
    ['held', 'open'],
    ['pendingRelease', 'release'],
    ['closed', 'open release shell'],
  ]) {
    assert.ok(
      component.includes(`key: '${key}'`) && component.includes(`modes: '${modes}'`),
      `the summary is missing ${key} for ${modes}`,
    );
  }
  // Removed is the shell mode's own slot and the fifth item elsewhere, and the
  // fifth one only appears once there is something to count.
  assert.match(component, /key: 'removed', label: label\('ledgerRemoved'\), modes: 'shell'/);
  assert.match(component, /key: 'removed', label: label\('ledgerRemoved'\), modes: 'open release', whenCounted: true/);
  assert.match(script, /summaryWhenCounted !== 'true' \|\| \(counts\[key\] \?\? 0\) > 0/);

  // Each of the four counts comes from the shared counting module, not from a
  // second rule written here.
  assert.match(script, /held: countHeld\(shells\)/);
  assert.match(script, /pendingRelease: countPendingRelease\(shells\)/);
  assert.match(script, /removed: countRemoved\(shells\)/);
});

test('a shell-mode row carries no text element, and the other modes say why', async () => {
  const script = await read('src/scripts/entry/ledger.ts');

  // The guard stands before anything that would build the line, so the shell
  // branch never reaches the held sentence.
  const guard = script.indexOf("if (textMode !== 'shell')");
  const rowText = script.indexOf("'ledger-row-text'");
  const heldString = script.indexOf('strings.textHeld');
  assert.ok(guard > 0, 'the row has no shell-mode guard');
  assert.ok(guard < rowText, 'the text element is built before the mode is checked');
  assert.ok(guard < heldString, 'the held sentence is read before the mode is checked');

  // A held row says which kind of hold it is; a removed row says which removal.
  assert.match(script, /shell\.holdReason === 'pending-release'\s*\?\s*strings\.textPending/);
  assert.match(script, /shell\.removedReason === 'retention'\s*\?\s*strings\.textRemovedRetention\s*:\s*strings\.textRemovedFiler/);
  assert.match(script, /line\.dataset\.removed = 'true'/);
});

test('the staff hold select offers the assessment reasons only', async () => {
  const script = await read('src/scripts/pilot/vrsar/case-detail.ts');

  const list = script.match(/const HOLD_REASONS: readonly HoldReason\[\] = \[(.*?)\];/s);
  assert.ok(list, 'case-detail.ts has no HOLD_REASONS list');
  const offered = list[1]
    .split(',')
    .map((entry) => entry.trim().replace(/^'|'$/g, ''))
    .filter(Boolean);
  assert.equal(offered.length, 4);
  assert.deepEqual(offered, [...ASSESSMENT_HOLD_REASONS]);

  // The other four are the system's, and the staff view prints them instead.
  for (const reason of HOLD_REASONS) {
    assert.ok(holdReasonLabels[reason], `no label for the hold reason ${reason}`);
  }
  assert.equal(HOLD_REASONS.length, 8);
  assert.equal(holdReasonLabels['pending-release'].hr, 'Čeka objavu');
  assert.equal(holdReasonLabels.policy.hr, 'Politika objave');
  assert.equal(holdReasonLabels.notices.hr, 'Prijave čitatelja');
  assert.equal(holdReasonLabels.confidential.hr, 'Povjerljiva osoba');
  assert.equal(textStatusLabels.removed.hr, 'UKLONJENO');

  assert.match(script, /function isSystemHoldReason/);
  assert.match(script, /hint: pilotCopy\.publicText\.systemReasonsHint\[lang\]/);
  assert.match(script, /function renderSystemReasonRows/);
});

test('the staff view refuses a release the mode or a removal already settled', async () => {
  const script = await read('src/scripts/pilot/vrsar/case-detail.ts');

  // Both notes are the ones the copy file carries, so the sentence a staff
  // member reads is the reviewed one.
  assert.match(script, /pilotCopy\.publicText\.shellModeNoRelease\[lang\]/);
  assert.match(script, /pilotCopy\.publicText\.removedNoRelease\[lang\]/);
  assert.equal(
    pilotCopy.publicText.shellModeNoRelease.hr,
    'Ova općina ne objavljuje tekst prijave, pa objava nije moguća.',
  );
  assert.equal(pilotCopy.publicText.removedNoRelease.hr, 'Tekst je uklonjen. Objava više nije moguća.');
  assert.equal(
    pilotCopy.publicText.systemReasonsHint.hr,
    'Razloge koje postavlja sustav službena osoba ne bira.',
  );

  // The rebuild guard knows all four outcomes, so a switch between them redraws.
  assert.match(script, /textActionsState: 'none' \| 'form' \| 'blocked' \| 'shell' \| 'removed'/);
  assert.match(script, /if \(shell\?\.textStatus === 'removed'\) return 'removed';/);
  assert.match(script, /if \(publicTextMode\(\) === 'shell'\) return 'shell';/);
  // The label row stays in every one of them.
  assert.match(script, /textActions\.replaceChildren\(\.\.\.textActionsBody\(mode\), labelRow\)/);
});

test('a notice reaches the staff thread as a system message with its reason', async () => {
  const script = await read('src/scripts/pilot/vrsar/case-detail.ts');

  assert.match(script, /message\.kind === 'notice'\s*\n?\s*\?\s*translatedRole\('system', lang\)/);
  assert.match(script, /pilotCopy\.messages\.notice\[lang\]/);
  assert.match(script, /translatedHoldReason\(message\.noticeReason, lang\)/);
  assert.equal(pilotCopy.messages.notice.hr, 'Prijava teksta');

  // The reader reports are counted next to what the public can see of the text.
  assert.match(script, /pilotCopy\.publicText\.noticeCount\[lang\]/);
  assert.equal(pilotCopy.publicText.noticeCount.hr, 'Prijave teksta');
});
