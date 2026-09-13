// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * S5 behaviour: copy the number, and — only when this page was opened on the
 * filer's own link — show and copy the address that carries the reopen key.
 *
 * The key is read from this page's fragment, which the browser never sends.
 * It is not logged, not put in a query, and not stored; it goes to the
 * clipboard and into the one link on this page, nowhere else.
 */

const root = document.querySelector<HTMLElement>('[data-case-number]');
if (root) start(root);

function start(page: HTMLElement): void {
  const number = page.querySelector<HTMLElement>('[data-number]');
  const copyNumber = page.querySelector<HTMLButtonElement>('[data-copy-number]');
  const keySection = page.querySelector<HTMLElement>('[data-key-section]');
  const linkLine = page.querySelector<HTMLElement>('[data-link]');
  const copyLink = page.querySelector<HTMLButtonElement>('[data-copy-link]');
  const recordLink = page.querySelector<HTMLAnchorElement>('[data-record-link]');
  const strings = readStrings();

  if (copyNumber && number) {
    bindCopy(copyNumber, () => number.textContent?.trim() ?? '', strings.copy ?? '', strings.copied ?? '');
  }

  const key = readKey();
  if (!key) return;

  const recordHref = page.dataset.recordHref ?? '';
  const recordUrl = new URL(recordHref, location.href);
  recordUrl.hash = `k=${encodeURIComponent(key)}`;
  const full = recordUrl.href;

  if (recordLink) recordLink.href = `${recordHref}#k=${encodeURIComponent(key)}`;
  if (linkLine) linkLine.textContent = full;
  if (keySection) keySection.hidden = false;
  if (copyLink) bindCopy(copyLink, () => full, strings.copyLink ?? '', strings.copied ?? '');
}

function bindCopy(button: HTMLButtonElement, value: () => string, idle: string, done: string): void {
  let flip = 0;
  button.addEventListener('click', () => {
    void navigator.clipboard?.writeText(value()).then(() => {
      button.textContent = done;
      window.clearTimeout(flip);
      flip = window.setTimeout(() => {
        button.textContent = idle;
      }, 2000);
    });
  });
}

/** The reopen key this page was opened with, or an empty string. */
function readKey(): string {
  const fragment = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
  if (!fragment) return '';
  return new URLSearchParams(fragment).get('k') ?? '';
}

function readStrings(): Record<string, string> {
  const source = document.getElementById('case-number-strings');
  if (!source?.textContent) return {};
  try {
    return JSON.parse(source.textContent) as Record<string, string>;
  } catch {
    return {};
  }
}
