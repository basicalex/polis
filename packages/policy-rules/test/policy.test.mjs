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

test('rewards denies political_agreement even when approved (ADR-007)', () => {
  assert.equal(
    opaEval(
      'rewards/rewards.rego',
      { action: 'political_agreement', review_state: 'approved' },
      'data.polis.rewards.eligible',
    ),
    false,
  );
});

test('rewards grants eligible for approved civic effort', () => {
  assert.equal(
    opaEval(
      'rewards/rewards.rego',
      { action: 'evidence', review_state: 'approved' },
      'data.polis.rewards.eligible',
    ),
    true,
  );
  assert.equal(
    opaEval(
      'rewards/rewards.rego',
      { action: 'evidence', review_state: 'draft' },
      'data.polis.rewards.eligible',
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
