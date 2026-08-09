# Partner workflow release gates

This ledger controls the first writable partner deployment. It does not widen the isolated public-read pilot.

## Boundary

The only release workflow is:

`accepted charter → signed proof → commitment → evidence → independent review → public status`

`DEPLOYMENT_PROFILE=pilot` and `PUBLIC_EDGE=true` remain read-only. The platform edge uses an exact allowlist: operational endpoints, governance/issue/proof reads, stateless proof verification, and the two pilot read endpoints. Every unlisted route returns a pure `405 public_edge` response before authentication or upstream work. No writable partner profile exists yet.

AI, upstream Polis mutation/sync, complaints, rewards, vault, verifiable credentials, graph edits, questions, answers, proof revocation, and proof supersession are outside this release. Keep them undeployed or edge-blocked. Do not treat their presence in the development stack as release approval.

## Mutation ledger

| Mutation | Trusted authority and separation | Local commit and audit rule | Release disposition |
|---|---|---|---|
| OIDC login/session issue | Task 12 must bind issuer + subject to an approved citizen; email must not grant staff or office authority | Task 12 must make identity/link/session state transactional and audit-required | Closed |
| Charter signing request | Verified session; service rechecks active holder ownership, official identity, charter scope, and idempotency key | Task 14 must prove retry-safe provider distribution and required audits | Closed |
| Documenso webhook/reconcile | Verified provider secret or named internal worker; provider state is evidence, not caller assertion | Task 14 must prove one artifact, active proof, acceptance, and audit across retry/concurrency | Closed |
| Proof manifest/activation | Named signing/ingestion service only; issuer provenance is not caller authority | Task 14 must require valid signature + timestamp, active status, retry recovery, and audit | Internal and closed to release callers |
| Commitment publication | Trusted holder actor; active accepted signature-backed charter covering scope | Claim, commitment, initial status, submission, evidence, and required completion audit share one local transaction | Closed pending Task 10 verification and Task 14 proof |
| Evidence/resolution submission | Trusted contributor/holder actor; terminal resolution remains pending | Submission/evidence writes and required completion audit share one local transaction | Closed pending Task 10 verification |
| Independent review | Trusted staff actor with active normalized `review_contribution` right; contributor cannot review own submission | Review, submission status, applied state, and required completion audit share one transaction; Task 10 must prevent concurrent double decisions | Closed pending approved partner role in Task 17 |
| Public status | Only an applied approved terminal-resolution review may append the public commitment status | No separate caller write; it commits with the review transaction | Read only |

A required audit call has a bounded deadline and treats timeout, throw, and every non-2xx response as unavailable. A required-audit failure returns `503 audit_unavailable` and leaves authoritative local state unchanged. Because the audit service is a separate database boundary, a successful remote audit followed by a local commit failure can leave an orphan audit event; no local sensitive write may commit without an accepted required audit. Task 11 must verify both chains during recovery.

## Evidence gates

A route moves from **Closed** only when its owning task records:

1. forged actor and missing-right denial;
2. self-review or equivalent separation denial;
3. audit timeout, throw, and non-2xx with unchanged authoritative state;
4. database fault and concurrent retry behavior;
5. exact route order and public-edge closure;
6. active-provider or signed-proof evidence where the route depends on an external provider;
7. named operator, rollback owner, and partner/legal approval where required.

Tasks 10–14 create local and provider evidence. Task 17 binds one approved partner and creates the separate release candidate. Task 18 is the independent go/no-go audit. Until Task 18 passes, only the public-read pilot may be exposed.
