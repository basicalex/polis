# Open-by-default contract

[public-read] This is the canonical public contract for what Polis Interface publishes, what anyone can verify, what is demonstration-only, and what is not live yet.

## The promise

[public-read] Polis Interface is open by DEFAULT, not by request: the rules governing claims, evidence, AI behavior, rewards, and audit are themselves published, reviewable, re-runnable code, and changes to those rules are themselves audited.

## Published by default
[public-read] The following are public-read with no auth:

- [public-read] Policy-as-code Rego source + OPA tests: `packages/policy-rules/access/access.rego`, `packages/policy-rules/ai/ai.rego`, `packages/policy-rules/rewards/rewards.rego`, `packages/policy-rules/contribute/access.rego`, `packages/policy-rules/polis/access.rego`, `packages/policy-rules/vault/access.rego`, `packages/policy-rules/pilot/redaction.rego`, `packages/policy-rules/test/policy.test.mjs`.
- [public-read] Append-only, hash-chained audit trail (§26.3) exposed via a **public/redacted audit view** (§26.4) at route `/audit` (`apps/web/src/pages/audit/index.astro`): the public read path returns only `visibility=public`, target-scoped rows, aggregated/redacted for sensitive categories; private document-access and private-flow events (e.g. future identity, vault, reward-payout events) are never exposed unredacted. All rows use `hash` + `previousHash` linkage with no UPDATE/DELETE semantics.
- [public-read] Proof manifests + hash verification: routes `/proofs`, `/verify`; API `POST /api/v1/verify/hash`.
- [public-read] Methodology, evidence rules, and scoring: `docs/public-methodology/evidence-rules.md`, `docs/public-methodology/scoring.md`, and route `/methodology`.
- [public-read] Seeded governance graph: route `/governance/[jurisdiction]`; public data covers jurisdictions, processes, institutions, roles, domains, laws, budget lines, controls, and claims.
- [public-read] Pilot charter + results: `data/pilot/charter.json` and `/pilot/results`.

## Verifiable by anyone

- [verifiable] Hash-verify any document or proof: submit the claimed bytes and expected digest to `POST /api/v1/verify/hash`, or use `/verify`, and compare the returned hash result with the published proof manifest.
- [verifiable] Check public audit-view integrity: read `/audit` (public, target-scoped rows), then verify each visible row's `previousHash` linkage and that the trail is append-only (no UPDATE/DELETE). The full chain also contains restricted/private rows that are not exposed publicly.
- [verifiable] Re-run any policy decision: inspect committed Rego in `packages/policy-rules/`, then run the same input through `opa eval` against the relevant module; the rule code, not a private assertion, decides the result.
- [verifiable] Inspect proof manifests: read `/proofs`, compare manifest document hashes with `/verify`, and confirm the manifest references match the published evidence or claim.

## Demonstration-only (stub) surfaces
[demonstration/stub] DEMONSTRATION ONLY means mechanism preview, not evidence of a live capability.

- [demonstration/stub] Assistant: deterministic RAG over seeded/public content; no real LLM and no external AI provider.
- [demonstration/stub] Deliberate: mechanism preview only; no live Polis instance.
- [demonstration/stub] Contribute/review: demo workflow for evidence and graph review; not a production civic intake channel.
- [demonstration/stub] Rewards eligibility: demo eligibility rules and review states; no payment, token, or payout provider.
- [demonstration/stub] Timestamps/signatures: RFC3161-stub and test-key signatures; mechanism demonstration only, not active trust-service evidence.

## Explicit limits — what is NOT live yet

- [not yet live] No production public authority is connected.
- [not yet live] No upstream/live Polis instance is connected.
- [not yet live] No external AI model is used.
- [not yet live] No Paperless backend is processing documents.
- [not yet live] No active timestamp provider is connected.
- [not yet live] No active signature provider is connected.
- [not yet live] No active identity provider is connected.
- [not yet live] No active payment provider is connected.
- [not yet live] This limit list is the credibility moat: stubs demonstrate mechanisms; they are never evidence of live institutional, AI, document-processing, trust-service, identity, or payment capability.

## Change accountability

[public-read] `GOVERNANCE.md` defines the change policy; [verifiable] material deployment changes to proof semantics, evidence scoring, AI behavior, reward rules, access control, retention, or audit visibility must update the published policy and implementation, or otherwise make the changed rules accountable to affected users.

## Relationship to root docs

[public-read] This document is the public-facing expression of `TRANSPARENCY.md` + `GOVERNANCE.md`; see `public-information-architecture.md` for where it surfaces and `launch-narrative.md` for how it is communicated.
