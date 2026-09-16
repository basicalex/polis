// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  demoStaffLogin,
  exchangeMagicLink,
  exchangeOidcCallback,
  getOidcAuthorization,
  getPilotSession,
  requestMagicLink,
} from '../../../lib/pilot/vrsar/api';
import { pilotCopy, pilotHref } from '../../../content/pilot/vrsar';
import { apiErrorMessage, clearState, currentPilotLang, setState } from './shell';

let started = false;

function roleDestination(role: string, lang: 'hr' | 'it' | 'en'): string {
  if (role === 'resident') return pilotHref('/pilot/vrsar/cases', lang);
  if (role === 'official') return pilotHref('/pilot/vrsar/staff', lang);
  return pilotHref('/pilot/vrsar', lang);
}

export function initVrsarLogin(): void {
  if (started) return;
  started = true;
  const lang = currentPilotLang();
  const state = document.querySelector<HTMLElement>('[data-page-state]');
  const emailForm = document.querySelector<HTMLFormElement>('[data-magic-form]');
  const emailInput = document.querySelector<HTMLInputElement>('#pilot-email');
  const emailError = document.querySelector<HTMLElement>('[data-email-error]');
  const magicSubmit = document.querySelector<HTMLButtonElement>('[data-magic-submit]');
  const oidcButton = document.querySelector<HTMLButtonElement>('[data-oidc-button]');
  const demoButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-demo-role]'));

  const hash = location.hash.startsWith('#') ? new URLSearchParams(location.hash.slice(1)) : null;
  const magicEmail = hash?.get('email') ?? '';
  const magicToken = hash?.get('token') ?? '';
  const query = new URLSearchParams(location.search);
  const code = query.get('code') ?? '';
  const oidcState = query.get('state') ?? '';
  const cleanUrl = new URL(location.pathname, location.origin);
  cleanUrl.searchParams.set('lang', lang);
  if (location.hash || code || oidcState) history.replaceState(null, '', cleanUrl.toString());

  async function finishSignIn(action: () => Promise<void>): Promise<void> {
    setState(state, pilotCopy.login.signingIn[lang]);
    if (emailForm) emailForm.hidden = true;
    if (oidcButton) oidcButton.disabled = true;
    for (const button of demoButtons) button.disabled = true;
    try {
      await action();
      const session = await getPilotSession();
      setState(state, pilotCopy.login.signedIn[lang], 'success');
      location.replace(roleDestination(session.role, lang));
    } catch (error) {
      setState(state, apiErrorMessage(error, lang), 'error');
      if (emailForm) emailForm.hidden = false;
      if (oidcButton) oidcButton.disabled = false;
      for (const button of demoButtons) button.disabled = false;
    }
  }

  if (magicEmail || magicToken) {
    if (!magicEmail || !magicToken) {
      setState(state, pilotCopy.login.invalidLink[lang], 'error');
    } else {
      void finishSignIn(() => exchangeMagicLink(magicEmail, magicToken));
    }
  } else if (code || oidcState) {
    if (!code || !oidcState) {
      setState(state, pilotCopy.login.invalidLink[lang], 'error');
    } else {
      void finishSignIn(() => exchangeOidcCallback(code, oidcState));
    }
  }

  // Test instance only: the role is all the browser sends, the server holds the passcode.
  for (const button of demoButtons) {
    button.addEventListener('click', () => {
      const role = button.dataset.demoRole;
      if (role !== 'official') return;
      clearState(state);
      void finishSignIn(() => demoStaffLogin(role));
    });
  }

  emailForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearState(state);
    if (emailError) emailError.textContent = '';
    const email = emailInput?.value.trim() ?? '';
    if (!email || !emailInput?.checkValidity()) {
      if (emailInput) emailInput.setAttribute('aria-invalid', 'true');
      if (emailError) emailError.textContent = pilotCopy.filing.required[lang];
      emailInput?.focus();
      return;
    }
    emailInput.removeAttribute('aria-invalid');
    if (magicSubmit) {
      magicSubmit.disabled = true;
      magicSubmit.textContent = pilotCopy.login.sending[lang];
    }
    try {
      await requestMagicLink(email);
      setState(state, pilotCopy.login.sent[lang], 'success');
    } catch (error) {
      setState(state, apiErrorMessage(error, lang), 'error');
    } finally {
      if (magicSubmit) {
        magicSubmit.disabled = false;
        magicSubmit.textContent = pilotCopy.login.sendLink[lang];
      }
    }
  });

  oidcButton?.addEventListener('click', async () => {
    clearState(state);
    oidcButton.disabled = true;
    try {
      const authorizationUrl = await getOidcAuthorization();
      location.assign(authorizationUrl);
    } catch (error) {
      setState(state, apiErrorMessage(error, lang), 'error');
      oidcButton.disabled = false;
    }
  });
}
