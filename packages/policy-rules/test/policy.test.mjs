// Real OPA policy evaluation tests. Shells out to the `opa` binary to evaluate
// the committed Rego bundles against fixture inputs and asserts the decision —
// no text-matching. Requires `opa` on PATH (installed in CI; locally via the
// project bootstrap). The companion `build`/`typecheck` scripts run `opa check`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');

/**
 * Evaluate a Rego module against `input`, returning the value at `query`
 * (e.g. "data.polis.rewards.eligible"). Throws if `opa` is unavailable so the
 * test fails loudly rather than silently passing.
 */
function opaEval(regoRel, input, query) {
  // Inject input via `with input as <json>` to avoid stdin/temp-file plumbing.
  const full = `${query} with input as ${JSON.stringify(input)}`;
  const out = execFileSync('opa', ['eval', '-f', 'json', '-d', join(pkgRoot, regoRel), full], {
    encoding: 'utf8',
  });
  const parsed = JSON.parse(out);
  return parsed?.result?.[0]?.expressions?.[0]?.value;
}

test('rewards denies political_agreement even when approved + under cap (ADR-007)', () => {
  assert.equal(
    opaEval(
      'rewards/rewards.rego',
      { action: 'political_agreement', review_state: 'approved', period_total: 0, monthly_cap: 5 },
      'data.polis.rewards.eligible',
    ),
    false,
  );
});

test('rewards grants eligible for approved civic effort under cap; denies draft + over-cap', () => {
  assert.equal(
    opaEval(
      'rewards/rewards.rego',
      { action: 'evidence', review_state: 'approved', period_total: 0, monthly_cap: 5 },
      'data.polis.rewards.eligible',
    ),
    true,
  );
  assert.equal(
    opaEval(
      'rewards/rewards.rego',
      { action: 'evidence', review_state: 'draft', period_total: 0, monthly_cap: 5 },
      'data.polis.rewards.eligible',
    ),
    false,
  );
  assert.equal(
    opaEval(
      'rewards/rewards.rego',
      { action: 'evidence', review_state: 'approved', period_total: 5, monthly_cap: 5 },
      'data.polis.rewards.eligible',
    ),
    false,
  );
});

test('vault access allows active, started, unexpired, unrevoked grant', () => {
  assert.equal(
    opaEval(
      'vault/access.rego',
      { grant: { status: 'active', revoked_at: null, starts_at: 0, expires_at: null }, now: 100 },
      'data.polis.vault.allow',
    ),
    true,
  );
});

test('vault access denies future-dated grant (starts_at > now)', () => {
  assert.equal(
    opaEval(
      'vault/access.rego',
      { grant: { status: 'active', revoked_at: null, starts_at: 200, expires_at: null }, now: 100 },
      'data.polis.vault.allow',
    ),
    false,
  );
});

test('vault access denies expired grant', () => {
  assert.equal(
    opaEval(
      'vault/access.rego',
      { grant: { status: 'active', revoked_at: null, starts_at: 0, expires_at: 50 }, now: 100 },
      'data.polis.vault.allow',
    ),
    false,
  );
});

test('vault access denies revoked grant', () => {
  assert.equal(
    opaEval(
      'vault/access.rego',
      { grant: { status: 'active', revoked_at: 50, starts_at: 0, expires_at: null }, now: 100 },
      'data.polis.vault.allow',
    ),
    false,
  );
});

test('vault proof_only scope reports no_bytes guard', () => {
  assert.equal(
    opaEval(
      'vault/access.rego',
      { grant: { scope: 'proof_only' } },
      'data.polis.vault.proof_only_no_bytes',
    ),
    true,
  );
  assert.equal(
    opaEval(
      'vault/access.rego',
      { grant: { scope: 'full_content' } },
      'data.polis.vault.proof_only_no_bytes',
    ),
    false,
  );
});

test('access allows the owner', () => {
  assert.equal(
    opaEval('access/access.rego', { subject: 'u1', owner: 'u1' }, 'data.polis.access.allow'),
    true,
  );
  assert.equal(
    opaEval('access/access.rego', { subject: 'u1', owner: 'u2' }, 'data.polis.access.allow'),
    false,
  );
});

test('ai publish requires citations AND approved sources AND no injection AND approved review (ADR-005 / §30.6)', () => {
  // Fully grounded + approved: allowed.
  assert.equal(
    opaEval(
      'ai/ai.rego',
      {
        has_citations: true,
        has_approved_sources: true,
        injection_detected: false,
        review_state: 'approved',
      },
      'data.polis.ai.publish',
    ),
    true,
  );
  // Missing citations.
  assert.equal(
    opaEval(
      'ai/ai.rego',
      {
        has_citations: false,
        has_approved_sources: true,
        injection_detected: false,
        review_state: 'approved',
      },
      'data.polis.ai.publish',
    ),
    false,
  );
  // No approved sources (e.g. only non-official / non-legal sources).
  assert.equal(
    opaEval(
      'ai/ai.rego',
      {
        has_citations: true,
        has_approved_sources: false,
        injection_detected: false,
        review_state: 'approved',
      },
      'data.polis.ai.publish',
    ),
    false,
  );
  // Injection detected → never publish.
  assert.equal(
    opaEval(
      'ai/ai.rego',
      {
        has_citations: true,
        has_approved_sources: true,
        injection_detected: true,
        review_state: 'approved',
      },
      'data.polis.ai.publish',
    ),
    false,
  );
  // Not yet approved.
  assert.equal(
    opaEval(
      'ai/ai.rego',
      {
        has_citations: true,
        has_approved_sources: true,
        injection_detected: false,
        review_state: 'under_review',
      },
      'data.polis.ai.publish',
    ),
    false,
  );
});

test('polis conversation creation requires service-level trust (M2 §13)', () => {
  assert.equal(
    opaEval(
      'polis/access.rego',
      { actor: { type: 'service' }, action: 'create_conversation' },
      'data.polis.polis_access.allow',
    ),
    true,
  );
  assert.equal(
    opaEval(
      'polis/access.rego',
      { actor: { type: 'user' }, action: 'create_conversation' },
      'data.polis.polis_access.allow',
    ),
    false,
  );
});

test('contribute allow_submit requires a known non-anonymous identity level (M6 §21)', () => {
  assert.equal(
    opaEval(
      'contribute/access.rego',
      { identity_level: 'casual' },
      'data.polis.contribute.allow_submit',
    ),
    true,
  );
  assert.equal(
    opaEval(
      'contribute/access.rego',
      { identity_level: 'anonymous' },
      'data.polis.contribute.allow_submit',
    ),
    false,
  );
});

test('contribute allow_review requires the reviewer role (M6 §19)', () => {
  assert.equal(
    opaEval('contribute/access.rego', { role: 'reviewer' }, 'data.polis.contribute.allow_review'),
    true,
  );
  assert.equal(
    opaEval(
      'contribute/access.rego',
      { role: 'contributor' },
      'data.polis.contribute.allow_review',
    ),
    false,
  );
});

test('contribute auto_publish blocks political_agreement even when approved (M6 §22 / ADR-007)', () => {
  assert.equal(
    opaEval(
      'contribute/access.rego',
      { contribution_class: 'civic', review_state: 'approved' },
      'data.polis.contribute.auto_publish',
    ),
    true,
  );
  assert.equal(
    opaEval(
      'contribute/access.rego',
      { contribution_class: 'political_agreement', review_state: 'approved' },
      'data.polis.contribute.auto_publish',
    ),
    false,
  );
  assert.equal(
    opaEval(
      'contribute/access.rego',
      { contribution_class: 'civic', review_state: 'pending' },
      'data.polis.contribute.auto_publish',
    ),
    false,
  );
});

test('pilot redaction denies missing reason (M9 §30.10)', () => {
  assert.equal(
    opaEval(
      'pilot/redaction.rego',
      { action: 'redact', reason: '', actor_authority: 'project_governance' },
      'data.polis.pilot.allow_redaction',
    ),
    false,
  );
});

test('pilot redaction denies partner-alone request (M9 §30.10)', () => {
  assert.equal(
    opaEval(
      'pilot/redaction.rego',
      { action: 'redact', reason: 'privacy', actor_authority: 'partner' },
      'data.polis.pilot.allow_redaction',
    ),
    false,
  );
});

test('pilot redaction allows project governance with reason (M9 §30.10)', () => {
  assert.equal(
    opaEval(
      'pilot/redaction.rego',
      {
        action: 'redact',
        reason: 'personal data in screenshot',
        actor_authority: 'project_governance',
      },
      'data.polis.pilot.allow_redaction',
    ),
    true,
  );
});
test('representative access allows verified_official with active mandate + accepted charter (M-RA)', () => {
  assert.equal(
    opaEval(
      'representative/access.rego',
      {
        identity_level: 'verified_official',
        mandate_holder: { status: 'active' },
        charter: { status: 'accepted' },
      },
      'data.polis.representative.access.allow',
    ),
    true,
  );
  // charter pending → denied (charter required before publishing)
  assert.equal(
    opaEval(
      'representative/access.rego',
      {
        identity_level: 'verified_official',
        mandate_holder: { status: 'active' },
        charter: { status: 'pending' },
      },
      'data.polis.representative.access.allow',
    ),
    false,
  );
});

test('representative status allow_terminal requires an approved resolution review (M-RA)', () => {
  assert.equal(
    opaEval(
      'representative/status.rego',
      { resolution_review_state: 'approved' },
      'data.polis.representative.status.allow_terminal',
    ),
    true,
  );
  assert.equal(
    opaEval(
      'representative/status.rego',
      { resolution_review_state: 'draft' },
      'data.polis.representative.status.allow_terminal',
    ),
    false,
  );
});

test('identity access allows stub mode and oidc with verified email (M10)', () => {
  assert.equal(
    opaEval('identity/access.rego', { mode: 'stub' }, 'data.polis.identity.access.allow'),
    true,
  );
  assert.equal(
    opaEval('identity/access.rego', { mode: 'oidc', email_verified: true }, 'data.polis.identity.access.allow'),
    true,
  );
  assert.equal(
    opaEval('identity/access.rego', { mode: 'oidc', email_verified: false }, 'data.polis.identity.access.allow'),
    false,
  );
});
