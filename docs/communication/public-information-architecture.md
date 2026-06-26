# Public information architecture

## Purpose & audience

The public portal serves citizens, journalists, researchers, partner institutions, and contributors. Its single job: make open governance legible and self-verifiable.

- Citizens need to understand institutions, processes, roles, evidence, and participation paths [public-read].
- Journalists need claims, evidence links, audit history, pilot results, and plain limits they can check without asking for access [public-read] [verifiable].
- Researchers need methodology, evidence rules, scoring rules, seeded graph data, and policy-as-code references [public-read] [verifiable].
- Partner institutions need a credible public surface showing the pilot charter, governance duties, redaction boundaries, and what is not live yet [public-read] [not yet live].
- Contributors need contribution routes, review expectations, Rego policy source, and audited rule-change context [public-read] [verifiable] [demonstration/stub].

Voice: concise, evidence-first, terminal-mono, zero hype. Use §28 framing: “open public intelligence for better governance”; “map institutions, documents, processes, and failure modes”; “replace bad incentives with transparent, assistive, reliable systems.” Do not imply that production government systems, live Polis, external AI, Paperless, active identity, payment, timestamp, or signature providers are connected [not yet live].

## Narrative arc

| stage | intent | existing page(s) | what it must show | current gap |
| --- | --- | --- | --- | --- |
| 1. Problem / why | Explain why the portal exists before showing features [public-read]. | `index`, `issues/[issueId]`, `pilot/results`, `partners` | The concrete §34 demo problem: repeated document handoffs across offices; public process map; roles/institutions involved; why verifiable public proof matters [public-read] [verifiable]. | `index` should lead with trust and legibility, not app inventory. `issues/[issueId]` must frame the civic problem with evidence and limits before deliberation [public-read] [demonstration/stub]. |
| 2. How it works | Show the mechanism: governance graph + evidence rules + public-code obligation [public-read] [verifiable]. | `methodology`, `source`, `governance/[jurisdiction]/index`, `governance/[jurisdiction]/processes/[processId]`, `governance/[jurisdiction]/institutions/[institutionId]`, `governance/[jurisdiction]/roles/[roleId]`, `governance/[jurisdiction]/[domain]/index` | How jurisdictions, processes, institutions, roles, domains, laws, budget lines, controls, and claims fit together; how claims require evidence; where rules live [public-read] [verifiable]. | Missing a plain “how the system works” bridge from the homepage to graph pages and methodology [content gap]. |
| 3. See the evidence | Let visitors inspect public claims, source references, proofs, audit rows, and pilot outcomes [public-read] [verifiable]. | `proofs`, `audit/index`, `transparency`, `methodology`, `pilot/results`, `contributions/[id]`, `contributors/[id]` | Proof manifests; append-only hash-chained audit trail; methodology; evidence-rules; scoring; pilot charter/results; contribution provenance [public-read] [verifiable]. | `transparency` is a thin stub and should become the canonical “open by default” explainer [content gap]. Audit/proof pages need stronger cross-links to methodology and limits [content gap]. |
| 4. Verify it yourself | Convert trust into user action: hash check, proof inspection, audit-chain inspection, Rego review [verifiable]. | `verify`, `proofs`, `audit/index`, `source`, `security`, `methodology` | `/verify` hash check; `POST /api/v1/verify/hash`; proof manifest inspection; audit `hash` / `previousHash` linkage; policy-as-code source in `packages/policy-rules`; OPA tests in `packages/policy-rules/test/policy.test.mjs` [public-read] [verifiable]. | Missing a dedicated “how verification works” explainer with copy-paste commands and expected outcomes [content gap]. Missing public policy-as-code browser/index [build gap]. |
| 5. Participate | Offer safe public participation without implying live production authority [public-read] [demonstration/stub]. | `deliberate`, `contribute/evidence`, `contribute/graph-edit`, `contribute/review`, `contribute/maps`, `rewards`, `assistant`, `partners` | Deliberation is demo-only because there is NO live Polis [demonstration/stub] [not yet live]. Assistant is deterministic RAG with NO external AI model [demonstration/stub] [not yet live]. Contribution/review and rewards eligibility are demo flows [demonstration/stub]. Partner pilots require charter, review roles, redaction rules, and measured results [public-read] [not yet live]. | Participation routes need persistent stub badges and a shared “what is live vs. demo” limit block [content gap]. |

## Route hierarchy & entry points

Primary navigation should lead with trust anchors, then public understanding, then participation. Existing routes only:

1. `transparency` — canonical open-by-default surface [public-read].
2. `methodology` — evidence-rules, scoring, and how claims are evaluated [public-read] [verifiable].
3. `audit/index` — public/redacted audit view (§26.4); only `visibility=public`, target-scoped rows are exposed [public-read] [verifiable].
4. `verify` + `proofs` — hash verification and proof manifest inspection [public-read] [verifiable].
5. `source` — repository, policy-as-code, OPA tests, public-code obligation [public-read] [verifiable].
6. `governance/[jurisdiction]/index` — seeded governance graph entry [public-read].
7. `issues/[issueId]` — concrete civic problem and process map [public-read] [demonstration/stub].
8. `pilot/results` — pilot charter and measured results [public-read] [demonstration/stub] [not yet live].
9. `deliberate`, `assistant`, `contribute/evidence`, `contribute/graph-edit`, `contribute/review`, `contribute/maps`, `rewards` — demo participation surfaces [public-read] [demonstration/stub].
10. `security`, `privacy`, `docs`, `partners` — supporting institutional and operator context [public-read].

Landing hierarchy for `index`:

1. Promise: open public intelligence for better governance [public-read].
2. Proof strip: `transparency`, `methodology`, `audit/index`, `verify`, `proofs`, `source` [public-read] [verifiable].
3. Concrete §34 demo: municipal document requirement map and public verifier [public-read] [demonstration/stub].
4. Graph preview: jurisdiction → process → institutions → roles → documents → claims [public-read].
5. Verify-yourself module: hash check, proof manifest, audit-chain linkage, Rego source review [verifiable].
6. Limits module: no production authority, no live Polis, no external AI, no Paperless backend, no active timestamp/signature/identity/payment provider [not yet live].
7. Participation module: deliberate, contribute, review, rewards, assistant, partners, all clearly labeled where demo-only [demonstration/stub].

`index` reframe: the homepage should stop reading as a feature directory. It should read as a trust dossier: what is public, how it is verified, what is demonstrably stubbed, and where a first-time visitor can inspect the mechanism themselves [public-read] [verifiable] [demonstration/stub] [not yet live].

Entry-point rules:

- Every public page should expose one of four next actions: read the rule, inspect the evidence, verify the proof, or understand the limit [public-read] [verifiable] [not yet live].
- Trust-anchor pages should link laterally: `transparency` → `methodology` → `audit/index` → `verify` → `proofs` → `source` → back to `transparency` [public-read] [verifiable].
- Governance graph pages should never stand alone; each jurisdiction/process/institution/role/domain page should point to the relevant claim evidence, methodology, audit events, and verification route [public-read] [verifiable].
- Demo participation pages should start with their limit before their interaction: NO live Polis on `deliberate`; NO external AI on `assistant`; demo-only contribution/review on `contribute/evidence`, `contribute/graph-edit`, `contribute/review`, `contribute/maps`; demo-only rewards eligibility on `rewards` [demonstration/stub] [not yet live].

## The transparency.astro upgrade

`apps/web/src/pages/transparency.astro` should become the canonical open-by-default surface. It expresses the contract owned by `open-by-default-contract.md` and should link to this IA plus `launch-narrative.md`.

Required sections:

1. What is public by default: Rego source and OPA tests in `packages/policy-rules`; append-only hash-chained audit trail; proof manifests and `/proofs`; `POST /api/v1/verify/hash`; methodology, evidence-rules, scoring; seeded governance graph; pilot charter/results [public-read] [verifiable].
2. What anyone can verify: hash any document/proof; inspect proof manifest; check audit `hash` / `previousHash`; re-run policy decisions with `opa eval` against committed Rego [verifiable].
3. What is demonstration-only: assistant deterministic RAG with NO real LLM; deliberate with NO live Polis; contribute/review demo; rewards eligibility demo; RFC3161/test-key timestamp/signature stubs [demonstration/stub] [not yet live].
4. What is not live: NO production authority connected; NO live Polis; NO external AI model; NO Paperless backend; NO active timestamp/signature/identity/payment provider [not yet live].
5. Why this is the moat: rules governing claims, evidence, AI, rewards, access, proofs, and audit are published, reviewable, re-runnable code; changes to those rules are audited [public-read] [verifiable].
6. Where to go next: `methodology`, `audit/index`, `verify`, `proofs`, `source`, `governance/[jurisdiction]/index`, `pilot/results` [public-read] [verifiable].

Presentation: compact panels on `#0B0F14`, monospace, status labels for [public-read], [verifiable], [demonstration/stub], [not yet live]. No marketing hero without proof links.

## Gaps & recommendations

| recommendation | type | why |
| --- | --- | --- |
| Add a “how verification works” explainer reachable from `verify`, `proofs`, `audit/index`, and `transparency` [verifiable]. | Content gap | First-time visitors need a plain sequence: hash check → proof manifest → audit-chain linkage → Rego review. |
| Add a public policy-as-code index for `packages/policy-rules` modules: `access/`, `ai/ai.rego`, `rewards/rewards.rego`, `contribute/access.rego`, `polis/access.rego`, `vault/access.rego`, `pilot/redaction.rego`, and `test/policy.test.mjs` [public-read] [verifiable]. | Build gap | `source` can link to the repo, but a civic visitor needs a browsable map of which rules govern claims, AI, rewards, contribution, vault, Polis, and redaction. |
| Add persistent limit labels on `assistant`, `deliberate`, `contribute/evidence`, `contribute/graph-edit`, `contribute/review`, `contribute/maps`, and `rewards` [demonstration/stub] [not yet live]. | Content gap | Demo routes must not imply live external AI, live Polis, production review, or active rewards/payment capability. |
| Expand `transparency` into the canonical open-by-default contract surface [public-read] [verifiable]. | Content gap | `TRANSPARENCY.md` has the correct claims; the public web surface is currently under-built. |
| Add a “live vs. demo” route or reusable public block linked from `index`, `transparency`, `assistant`, `deliberate`, `rewards`, and `pilot/results` [public-read] [demonstration/stub] [not yet live]. | Content gap | The credibility moat depends on saying what is not live as plainly as what is public. |
| Add cross-links from graph pages to methodology, evidence, audit, and verification surfaces [public-read] [verifiable]. | Build gap | Governance graph pages should not be dead-end maps; each claim/process should lead to evidence and verification. |
| Add a pilot charter/results explainer on `pilot/results` using §30.10 and §27/§28 language [public-read] [demonstration/stub] [not yet live]. | Content gap | Partner institutions need purpose, jurisdiction, data categories, retention, review roles, escalation paths, publication rules, rollback conditions, redaction limits, and measured outcomes. |
| Add contribution provenance summaries on `contributors/[id]` and `contributions/[id]` [public-read] [verifiable] [demonstration/stub]. | Build gap | Public contribution pages should show what was submitted, reviewed, accepted/rejected, and how it affected graph/evidence state. |

## Read-only public launch implications

- Public surfaces require no auth: `index`, `transparency`, `methodology`, `audit/index`, `verify`, `proofs`, `source`, `governance/[jurisdiction]/index`, `governance/[jurisdiction]/processes/[processId]`, `governance/[jurisdiction]/institutions/[institutionId]`, `governance/[jurisdiction]/roles/[roleId]`, `governance/[jurisdiction]/[domain]/index`, `issues/[issueId]`, `pilot/results`, `security`, `privacy`, `docs`, `partners`, `contributors/[id]`, and `contributions/[id]` are read-only public entry points [public-read].
- Verification must work without an account: `/verify`, proof manifest inspection, audit-chain inspection, and policy source review are self-serve [verifiable].
- Stubbed interactivity stays labeled: `assistant`, `deliberate`, `contribute/evidence`, `contribute/graph-edit`, `contribute/review`, `contribute/maps`, and `rewards` may be visible, but must say deterministic/demo/no-live-provider where applicable [public-read] [demonstration/stub] [not yet live].
- Public launch must not wait for M10–M15 production integrations: no auth is needed for public-read trust surfaces; private flows remain separate [public-read] [not yet live].
- The launch promise is not “everything is open.” The promise is: public claims, public proof semantics, public audit semantics, evidence rules, AI behavior, reward rules, and change rules are reviewable; private documents and production integrations are not exposed by default [public-read] [verifiable] [not yet live].
