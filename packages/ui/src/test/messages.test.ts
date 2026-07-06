import test from 'node:test';
import assert from 'node:assert/strict';
import { en } from '../messages/en.ts';
import { hr } from '../messages/hr.ts';
import { t } from '../messages/index.ts';

const VERIFICATION_STATES = [
  'valid',
  'valid_but_superseded',
  'valid_but_expired',
  'revoked',
  'integrity_failure',
  'signature_invalid',
  'timestamp_invalid',
  'issuer_unknown',
  'status_unknown',
  'private_or_restricted',
  'not_found',
] as const;

const MECHANISMS = ['hash', 'signature', 'timestamp', 'registry', 'issuer'] as const;
const CHECK_STATUSES = ['pass', 'fail', 'indeterminate', 'not_present', 'not_checked'] as const;
const REGISTRY_STATUSES = ['active', 'superseded', 'revoked', 'expired', 'sealed', 'unknown'];
const CONFIDENCE_STATES = [
  'unsupported_draft',
  'single_source',
  'multi_source',
  'official_source',
  'official_confirmed',
  'expert_reviewed',
  'contested',
  'outdated',
  'superseded',
];
const REVIEW_STATES = [
  'draft',
  'submitted',
  'needs_revision',
  'under_review',
  'approved',
  'contested',
  'deprecated',
  'rejected',
  'archived',
];

test('every verdict headline and explanation key exists in en', () => {
  for (const state of VERIFICATION_STATES) {
    assert.ok(`verdict.${state}.headline` in en, `missing verdict.${state}.headline`);
    assert.ok(`verdict.${state}.explanation` in en, `missing verdict.${state}.explanation`);
  }
  assert.ok('verdict.note.proof_not_truth' in en);
  assert.ok('verdict.note.test_signature' in en);
});

test('mechanism and status labels exist in en', () => {
  for (const mechanism of MECHANISMS) {
    assert.ok(`mechanism.${mechanism}` in en, `missing mechanism.${mechanism}`);
  }
  for (const status of CHECK_STATUSES) {
    assert.ok(`status.${status}` in en, `missing status.${status}`);
  }
});

test('every check labelKey producible by the verdict engine exists in en', () => {
  const labelKeys = [
    'check.hash.pass',
    'check.hash.fail',
    'check.hash.not_checked',
    'check.signature.test_key',
    ...['pass', 'fail', 'indeterminate', 'not_checked', 'not_present'].map(
      (s) => `check.signature.${s}`,
    ),
    ...['pass', 'fail', 'indeterminate', 'not_checked', 'not_present'].map(
      (s) => `check.timestamp.${s}`,
    ),
    ...REGISTRY_STATUSES.map((s) => `check.registry.${s}`),
    'check.issuer.pass',
    'check.issuer.unknown',
    'check.issuer.not_checked',
    'check.generic.not_found',
    'check.generic.restricted',
  ];
  for (const key of labelKeys) {
    assert.ok(key in en, `missing ${key}`);
  }
});

test('badge catalogs cover all confidence and review states', () => {
  for (const state of CONFIDENCE_STATES) {
    assert.ok(`confidence.${state}` in en, `missing confidence.${state}`);
  }
  for (const state of REVIEW_STATES) {
    assert.ok(`review.${state}` in en, `missing review.${state}`);
  }
});

test('hr keys are a subset of en keys', () => {
  const enKeys = new Set(Object.keys(en));
  for (const key of Object.keys(hr)) {
    assert.ok(enKeys.has(key), `hr has unknown key ${key}`);
  }
});

test('t() falls back to English for missing hr keys', () => {
  assert.equal(t('verdict.valid.headline', 'hr'), en['verdict.valid.headline']);
  assert.equal(t('verdict.valid.headline'), en['verdict.valid.headline']);
});
