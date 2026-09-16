// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * S5 behaviour: copy the number, and — only when this page was opened on the
 * filer's own link — show and copy the address that carries the reopen key.
 *
 * The key is read from this page's fragment, which the browser never sends.
 * It is not logged, not put in a query, and not stored; it goes to the
 * clipboard and into the one link on this page, nowhere else.
 *
 * After the number is painted the page asks the public shell what happened to
 * the text. That answer needs no key and no session: it is the same shell the
 * public record shows. It fills a block whose height is already reserved, so a
 * slow or failed answer moves nothing on the screen.
 */

import { getPublicCase } from '../../lib/pilot/vrsar/api';

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
  void fillOutcome(page, Boolean(key));
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

/*
 * What happened to the text of this case. Only a held text says anything: a
 * public or redacted one is on the record already, and the block stays empty.
 * The confidential contact is named only to the person holding the key.
 */
async function fillOutcome(page: HTMLElement, hasKey: boolean): Promise<void> {
  const body = page.querySelector<HTMLElement>('[data-outcome-body]');
  const note = page.querySelector<HTMLElement>('[data-outcome-note]');
  const caseNumber = page.dataset.case ?? '';
  if (!body || !note || !caseNumber) return;

  let held: { textStatus: string; holdReason: string | null };
  try {
    held = (await getPublicCase(caseNumber)).case;
  } catch {
    return;
  }
  if (held.textStatus !== 'held') return;

  const strings = readStrings();
  const heading = page.querySelector<HTMLElement>('[data-outcome-heading]');

  if (held.holdReason === 'confidential') {
    if (heading) {
      heading.textContent = strings.outcomeConfidentialHeading ?? '';
      heading.hidden = false;
    }
    note.textContent = strings.outcomeConfidentialNote ?? '';
    if (hasKey) showConfidentialContact(page);
  } else if (held.holdReason === 'pending-release') {
    note.textContent = strings.outcomePendingRelease ?? '';
  } else if (held.holdReason === 'policy') {
    note.textContent = strings.outcomePolicy ?? '';
  } else {
    note.textContent = [strings.outcomeHeld, strings.outcomeOfficeDecides]
      .filter(Boolean)
      .join(' ');
  }

  body.hidden = false;
}

/** The municipality's confidential officer, from the root's own data. */
function showConfidentialContact(page: HTMLElement): void {
  const contact = page.querySelector<HTMLElement>('[data-outcome-contact]');
  if (!contact) return;
  const name = page.dataset.confidentialName ?? '';
  const email = page.dataset.confidentialEmail ?? '';
  const phone = page.dataset.confidentialPhone ?? '';
  if (!name && !email && !phone) return;

  const nameLine = contact.querySelector<HTMLElement>('[data-outcome-contact-name]');
  const emailLink = contact.querySelector<HTMLAnchorElement>('[data-outcome-contact-email]');
  const phoneLink = contact.querySelector<HTMLAnchorElement>('[data-outcome-contact-phone]');
  if (nameLine) nameLine.textContent = name;
  if (emailLink) {
    emailLink.textContent = email;
    emailLink.href = `mailto:${email}`;
  }
  if (phoneLink) {
    phoneLink.textContent = phone;
    phoneLink.href = `tel:${phone.replace(/[^+\d]/g, '')}`;
  }
  contact.hidden = false;
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
