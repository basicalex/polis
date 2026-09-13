// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * The public case page under a place. The case itself is the pilot script,
 * unchanged; this file only handles the reopen key the person may be carrying
 * in the fragment.
 *
 * A fragment never reaches a server: it is not part of the request. Nothing
 * here copies it into a query, a path, or a fetch, and the only place it goes
 * is the visitor's own clipboard.
 */

import { initVrsarPublicCase } from '../pilot/vrsar/public-case';

initVrsarPublicCase();

const root = document.querySelector<HTMLElement>('[data-entry-case]');
if (root) keepTheKey(root);

function keepTheKey(page: HTMLElement): void {
  const line = page.querySelector<HTMLElement>('[data-key-line]');
  const copy = page.querySelector<HTMLButtonElement>('[data-copy-link]');
  if (!line || !copy) return;
  if (!readKey()) return;

  const strings = readStrings();
  line.hidden = false;
  let flip = 0;
  copy.addEventListener('click', () => {
    void navigator.clipboard?.writeText(location.href).then(() => {
      copy.textContent = strings.copied ?? '';
      window.clearTimeout(flip);
      flip = window.setTimeout(() => {
        copy.textContent = strings.copyLink ?? '';
      }, 2000);
    });
  });
}

/** The reopen key as this page received it, or an empty string. */
function readKey(): string {
  const fragment = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
  if (!fragment) return '';
  return new URLSearchParams(fragment).get('k') ?? '';
}

function readStrings(): Record<string, string> {
  const source = document.getElementById('entry-case-strings');
  if (!source?.textContent) return {};
  try {
    return JSON.parse(source.textContent) as Record<string, string>;
  } catch {
    return {};
  }
}
