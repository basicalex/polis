// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { assessText, normalizedSha256 } from './compliance.js';

const originalInternalToken = process.env.INTERNAL_API_TOKEN;
process.env.INTERNAL_API_TOKEN = 'compliance-test-internal-token';
after(() => {
  if (originalInternalToken === undefined) delete process.env.INTERNAL_API_TOKEN;
  else process.env.INTERNAL_API_TOKEN = originalInternalToken;
});

interface AssessmentOptions {
  location?: string | null;
  recentNarrativeHashes?: string[];
  holdTerms?: string[];
  gatewayUrl?: string | null;
  fetch?: typeof fetch;
}

function runAssessment(text: string, options: AssessmentOptions = {}) {
  return assessText(
    {
      text,
      location: options.location ?? null,
      municipalityId: 'vrsar-orsera',
      recentNarrativeHashes: options.recentNarrativeHashes ?? [],
    },
    {
      gatewayUrl: options.gatewayUrl ?? null,
      holdTerms: options.holdTerms ?? [],
      fetch: options.fetch,
    },
  );
}

test('plain Croatian report passes without a hold or signal', async () => {
  const result = await runAssessment('Rupa na cesti kod škole, već tjedan dana.');

  assert.equal(result.hold, null);
  assert.equal(result.formLetter, false);
  assert.deepEqual(result.signals, []);
});

test('e-mail address causes a personal-data hold', async () => {
  const result = await runAssessment('Javite mi se na stanar@example.hr.');

  assert.equal(result.hold, 'personal-data');
  assert.deepEqual(result.signals, ['local:email']);
});

test('Croatian phone detector accepts +385 and 09x separator forms', async () => {
  for (const phone of ['+385 91 234 5678', '+385/91/234-5678', '091-234/5678']) {
    const result = await runAssessment(`Nazovite ${phone}.`);
    assert.equal(result.hold, 'personal-data', phone);
    assert.deepEqual(result.signals, ['local:phone'], phone);
  }
});

test('OIB detector checks the ISO 7064 MOD 11,10 check digit', async () => {
  const valid = await runAssessment('Moj OIB je 12345678903.');
  const invalid = await runAssessment('Broj predmeta je 12345678904.');

  assert.equal(valid.hold, 'personal-data');
  assert.deepEqual(valid.signals, ['local:oib']);
  assert.equal(invalid.hold, null);
  assert.deepEqual(invalid.signals, []);
});

test('Croatian licence plate in the location causes a personal-data hold', async () => {
  const text = 'Vozilo blokira prolaz.';
  const result = await runAssessment(text, { location: 'Parkiralište uz PU-1234-AA' });

  assert.equal(result.hold, 'personal-data');
  assert.deepEqual(result.signals, ['local:plate']);
  assert.equal(result.normalizedSha256, normalizedSha256(text));
});

test('built-in and configured hold terms match whole words after case normalization', async () => {
  const builtIn = await runAssessment('PEDERČINA je ostavila ovu poruku.');
  const configured = await runAssessment('Ovo je PRIJETNJA.', { holdTerms: ['prijetnja'] });
  const substring = await runAssessment('Opis prijetnjama nije jednak terminu.', {
    holdTerms: ['prijetnja'],
  });

  assert.equal(builtIn.hold, 'abuse');
  assert.deepEqual(builtIn.signals, ['local:hold-term']);
  assert.equal(configured.hold, 'abuse');
  assert.deepEqual(configured.signals, ['local:hold-term']);
  assert.equal(substring.hold, null);
});

test('personal-data hold takes precedence over abuse', async () => {
  const result = await runAssessment('Pederčina, piši mi na stanar@example.hr.');

  assert.equal(result.hold, 'personal-data');
  assert.deepEqual(result.signals, ['local:email', 'local:hold-term']);
});

test('normalized duplicate hash applies the form-letter label', async () => {
  const text = 'Rupa na cesti kod škole.';
  const result = await runAssessment(text, {
    recentNarrativeHashes: [normalizedSha256('  RUPA NA CESTI KOD ŠKOLE!!!  ')],
  });

  assert.equal(result.formLetter, true);
  assert.deepEqual(result.signals, ['local:duplicate']);
});

test('gateway request can add a hold and form-letter label', async () => {
  const gatewayFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(input, 'https://ai.test/internal/ai/compliance');
    assert.equal(init?.method, 'POST');
    assert.equal(
      (init?.headers as Record<string, string>)['x-polis-internal-token'],
      'compliance-test-internal-token',
    );
    assert.deepEqual(JSON.parse(String(init?.body)), {
      text: 'Nejasna prijava.',
      location: 'Vrsar',
      language: 'hr',
    });
    assert.ok(init?.signal instanceof AbortSignal);
    return Response.json({ hold: 'off-topic', formLetterScore: 0.8, note: 'model result' });
  }) as typeof fetch;

  const result = await runAssessment('Nejasna prijava.', {
    location: 'Vrsar',
    gatewayUrl: 'https://ai.test/',
    fetch: gatewayFetch,
  });

  assert.equal(result.hold, 'off-topic');
  assert.equal(result.formLetter, true);
  assert.deepEqual(result.signals, ['gateway:hold', 'gateway:form-letter']);
});

test('gateway hold does not replace a local hold', async () => {
  const gatewayFetch = (async () =>
    Response.json({ hold: 'off-topic', formLetterScore: 0 })) as typeof fetch;
  const result = await runAssessment('Moj e-mail je stanar@example.hr.', {
    gatewayUrl: 'https://ai.test',
    fetch: gatewayFetch,
  });

  assert.equal(result.hold, 'personal-data');
  assert.deepEqual(result.signals, ['local:email']);
});

test('gateway failures and malformed replies fail open as skipped', async () => {
  const fetches: Array<typeof fetch> = [
    (async () => new Response(null, { status: 404 })) as typeof fetch,
    (async () => new Response(null, { status: 503 })) as typeof fetch,
    (async () => Response.json({ hold: 'unsupported', formLetterScore: 0.2 })) as typeof fetch,
    (async () => Response.json({ hold: null, formLetterScore: 'high' })) as typeof fetch,
    (async () => {
      throw new Error('network down');
    }) as typeof fetch,
  ];

  for (const fetchImpl of fetches) {
    const result = await runAssessment('Rupa na cesti.', {
      gatewayUrl: 'https://ai.test',
      fetch: fetchImpl,
    });
    assert.equal(result.hold, null);
    assert.equal(result.formLetter, false);
    assert.deepEqual(result.signals, ['gateway:skipped']);
  }
});
