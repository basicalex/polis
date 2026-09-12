// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';

import { parseTraceConfig, publicTraceConfig } from './config.js';

const pilot = {
  id: 'vrsar-orsera',
  testEnvironment: true,
  municipality: {
    id: 'vrsar-orsera',
    name: { hr: 'Vrsar', it: 'Orsera', en: 'Vrsar' },
    caseNumber: { prefix: 'VRS', start: 1000 },
  },
  category: { id: 'public-lighting', name: { hr: 'Rasvjeta', it: 'Luci', en: 'Lighting' } },
  office: {
    id: 'communal-system',
    name: { hr: 'Komunalni', it: 'Comunale', en: 'Communal' },
    routingStatus: 'inferred-test-only',
  },
  sources: [
    {
      id: 'official-source',
      title: 'Official source',
      url: 'https://example.test/source',
      retrievedAt: '2026-09-05',
      supports: ['Configured public fact.'],
    },
  ],
};

const env = {
  INTERNAL_API_TOKEN: 'internal-secret',
  DATABASE_URL: 'postgres://trace.test/trace',
  TRACE_INTAKE_OPEN: 'true',
  TRACE_OFFICIAL_CITIZEN_IDS: 'trace-official-test',
  TRACE_REVIEWER_CITIZEN_IDS: 'trace-reviewer-test',
  TRACE_GATEWAY_ACTOR_IDS: 'trace-gateway-test',
  TRACE_ATTENTION_PEPPER: 'attention-pepper-secret-32-bytes!!',
  TRACE_AI_INTAKE_URL: 'https://ai.test/intake',
};

test('trace config maps disjoint roles and public facts from the injected pilot loader', () => {
  const config = parseTraceConfig(env, () => pilot);
  assert.equal(config.officialIds.has('trace-official-test'), true);
  assert.equal(config.reviewerIds.has('trace-reviewer-test'), true);
  assert.equal(config.gatewayIds.has('trace-gateway-test'), true);
  assert.equal(config.attentionPepper, env.TRACE_ATTENTION_PEPPER);
  assert.equal(config.aiIntakeUrl, 'https://ai.test/intake');
  assert.equal(config.caseNumberPrefix, 'VRS');
  assert.equal(config.caseNumberStart, 1000);
  assert.equal(
    parseTraceConfig({ ...env, TRACE_AI_INTAKE_URL: undefined }, () => pilot).aiIntakeUrl,
    null,
  );
  assert.deepEqual(publicTraceConfig(config), {
    municipality: pilot.municipality,
    category: pilot.category,
    office: pilot.office,
    testEnvironment: true,
    intakeOpen: true,
    sources: [{ ...pilot.sources[0], url: 'https://example.test/source' }],
  });
});

test('trace config fails closed on credentials, database, intake, and role mapping errors', () => {
  const invalid: Array<Partial<typeof env>> = [
    { INTERNAL_API_TOKEN: '' },
    { DATABASE_URL: '' },
    { DATABASE_URL: 'https://not-postgres.test' },
    { DATABASE_URL: 'postgres://trace.test' },
    { TRACE_INTAKE_OPEN: undefined },
    { TRACE_INTAKE_OPEN: 'yes' },
    { TRACE_OFFICIAL_CITIZEN_IDS: '' },
    { TRACE_REVIEWER_CITIZEN_IDS: '' },
    { TRACE_GATEWAY_ACTOR_IDS: '' },
    { TRACE_OFFICIAL_CITIZEN_IDS: 'same', TRACE_REVIEWER_CITIZEN_IDS: 'same' },
    { TRACE_OFFICIAL_CITIZEN_IDS: 'same', TRACE_GATEWAY_ACTOR_IDS: 'same' },
    { TRACE_REVIEWER_CITIZEN_IDS: 'same', TRACE_GATEWAY_ACTOR_IDS: 'same' },
    { TRACE_OFFICIAL_CITIZEN_IDS: 'duplicate,duplicate' },
    { TRACE_ATTENTION_PEPPER: '' },
    { TRACE_ATTENTION_PEPPER: 'too-short' },
    { TRACE_AI_INTAKE_URL: '/relative' },
    { TRACE_AI_INTAKE_URL: 'ftp://ai.test/intake' },
    { TRACE_AI_INTAKE_URL: 'https://user:secret@ai.test/intake' },
  ];
  for (const override of invalid) {
    const candidate = { ...env, ...override } as NodeJS.ProcessEnv;
    assert.throws(() => parseTraceConfig(candidate, () => pilot));
  }
});

test('pilot configuration must match the fixed authority and contain valid cited sources', () => {
  assert.throws(() => parseTraceConfig(env, () => ({ ...pilot, id: 'other' })));
  assert.throws(() => parseTraceConfig(env, () => ({ ...pilot, testEnvironment: false })));
  assert.throws(() => parseTraceConfig(env, () => ({ ...pilot, sources: [] })));
  assert.throws(() =>
    parseTraceConfig(env, () => ({
      ...pilot,
      sources: [{ ...pilot.sources[0], url: 'http://unsafe.test' }],
    })),
  );
  assert.throws(() =>
    parseTraceConfig(env, () => ({
      ...pilot,
      sources: [{ ...pilot.sources[0], retrievedAt: '2026-02-29' }],
    })),
  );
  for (const caseNumber of [
    { prefix: 'vrs', start: 1000 },
    { prefix: 'VRSAR', start: 1000 },
    { prefix: 'VRS', start: 0 },
    { prefix: 'VRS', start: 1.5 },
  ]) {
    assert.throws(() =>
      parseTraceConfig(env, () => ({
        ...pilot,
        municipality: { ...pilot.municipality, caseNumber },
      })),
    );
  }
});
