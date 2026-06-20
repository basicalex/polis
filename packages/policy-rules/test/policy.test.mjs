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

test('ai publish requires citations AND approved review (ADR-005)', () => {
  assert.equal(
    opaEval(
      'ai/ai.rego',
      { has_citations: true, review_state: 'approved' },
      'data.polis.ai.publish',
    ),
    true,
  );
  assert.equal(
    opaEval(
      'ai/ai.rego',
      { has_citations: false, review_state: 'approved' },
      'data.polis.ai.publish',
    ),
    false,
  );
  assert.equal(
    opaEval('ai/ai.rego', { has_citations: true, review_state: 'draft' }, 'data.polis.ai.publish'),
    false,
  );
});
