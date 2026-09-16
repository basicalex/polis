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
    caseNumber: { prefix: 'VRS' },
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
  TRACE_GATEWAY_ACTOR_IDS: 'trace-gateway-test',
  TRACE_ATTENTION_PEPPER: 'attention-pepper-secret-32-bytes!!',
  TRACE_AI_INTAKE_URL: 'https://ai.test/intake',
  TRACE_AI_COMPLIANCE_URL: 'https://ai.test/compliance',
  TRACE_HOLD_TERMS: '  BAD term,Another  ',
  TRACE_CONFIDENTIAL_TERMS: '  MITO,Whistleblower  ',
  TRACE_RETENTION_INTERVAL_MINUTES: '15',
};

test('trace config maps roles and public text policy settings from the injected pilot loader', () => {
  const config = parseTraceConfig(env, () => pilot);
  assert.equal(config.officialIds.has('trace-official-test'), true);
  assert.equal(config.gatewayIds.has('trace-gateway-test'), true);
  assert.equal(config.attentionPepper, env.TRACE_ATTENTION_PEPPER);
  assert.equal(config.aiIntakeUrl, 'https://ai.test/intake');
  assert.equal(config.aiComplianceUrl, 'https://ai.test/compliance');
  assert.deepEqual(config.holdTerms, ['bad term', 'another']);
  assert.deepEqual(config.confidentialTerms, ['mito', 'whistleblower']);
  assert.equal(config.retentionIntervalMinutes, 15);
  assert.equal(config.pilot.publicTextMode, 'open');
  assert.equal(config.pilot.publicTextRetentionDays, 730);
  assert.equal(config.caseNumberPrefix, 'VRS');
  const optional = parseTraceConfig(
    {
      ...env,
      TRACE_AI_INTAKE_URL: undefined,
      TRACE_AI_COMPLIANCE_URL: undefined,
      TRACE_HOLD_TERMS: ' , ',
      TRACE_CONFIDENTIAL_TERMS: ' , ',
      TRACE_RETENTION_INTERVAL_MINUTES: undefined,
    },
    () => pilot,
  );
  assert.equal(optional.aiIntakeUrl, null);
  assert.equal(optional.aiComplianceUrl, null);
  assert.deepEqual(optional.holdTerms, []);
  assert.deepEqual(optional.confidentialTerms, []);
  assert.equal(optional.retentionIntervalMinutes, 0);
  assert.deepEqual(publicTraceConfig(config), {
    municipality: pilot.municipality,
    category: pilot.category,
    office: pilot.office,
    testEnvironment: true,
    intakeOpen: true,
    publicTextMode: 'open',
    publicTextRetentionDays: 730,
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
    { TRACE_GATEWAY_ACTOR_IDS: '' },
    { TRACE_OFFICIAL_CITIZEN_IDS: 'same', TRACE_GATEWAY_ACTOR_IDS: 'same' },
    { TRACE_OFFICIAL_CITIZEN_IDS: 'duplicate,duplicate' },
    { TRACE_ATTENTION_PEPPER: '' },
    { TRACE_ATTENTION_PEPPER: 'too-short' },
    { TRACE_AI_INTAKE_URL: '/relative' },
    { TRACE_AI_INTAKE_URL: 'ftp://ai.test/intake' },
    { TRACE_AI_INTAKE_URL: 'https://user:secret@ai.test/intake' },
    { TRACE_AI_COMPLIANCE_URL: '/relative' },
    { TRACE_AI_COMPLIANCE_URL: 'ftp://ai.test/compliance' },
    { TRACE_AI_COMPLIANCE_URL: 'https://user:secret@ai.test/compliance' },
    { TRACE_RETENTION_INTERVAL_MINUTES: '-1' },
    { TRACE_RETENTION_INTERVAL_MINUTES: '1.5' },
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
  for (const publicTextMode of ['unknown', 1]) {
    assert.throws(() => parseTraceConfig(env, () => ({ ...pilot, publicTextMode })));
  }
  for (const publicTextRetentionDays of [29, 30.5, '730']) {
    assert.throws(() => parseTraceConfig(env, () => ({ ...pilot, publicTextRetentionDays })));
  }
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
  for (const caseNumber of [{ prefix: 'vrs' }, { prefix: 'VRSAR' }]) {
    assert.throws(() =>
      parseTraceConfig(env, () => ({
        ...pilot,
        municipality: { ...pilot.municipality, caseNumber },
      })),
    );
  }
});
