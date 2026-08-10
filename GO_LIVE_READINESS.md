# Go-live readiness

**Decision: NO-GO**

**Assessment date:** 2026-08-10 UTC

**Current exposure:** none. The maximum surface before Task 18, after its own runbook gates pass, is the isolated public-read pilot.

This ledger is a current status record, not launch approval. Keep every private or state-changing partner path closed until all critical gates below pass and Task 18 records an independent signed decision.

## Workflow release status

| Stage | Current proof | Release status |
| --- | --- | --- |
| Accepted charter | Source contracts exist; no approved real-partner charter, legal decision, or named owners | Blocked |
| Signed proof | Active-proof consumption is fail closed; real TSA and institutional signer evidence is absent | Blocked |
| Commitment | Trusted representative, charter, scope, proof, transaction, and required-audit checks pass locally | Not deployed or partner-accepted |
| Evidence | Restricted evidence persistence and audit behavior pass locally | Not deployed or partner-accepted |
| Independent review | Relational reviewer rights, separation of duties, transactional claim, and audit rollback pass locally | No production reviewer binding or acceptance run |
| Public status | Terminal status follows an approved independent review in local tests | No deployed end-to-end proof |

## Task gates

| Task | Status | Evidence or blocker |
| --- | --- | --- |
| 8 — trusted identity and reviewer rights | Done | Adversarial identity, rights, self-review, and required-audit tests passed |
| 9 — sensitive entrypoint decomposition | Done | Independent review found no route, startup, export, or import-cycle regression |
| 10 — workflow authorization and audit gates | Done | Exact public-edge allowlist; transactional representative/review writes; active-proof requirement; clean adversarial re-review |
| 11 — migration and recovery | In progress | Manifest-v3 local clean-snapshot drill passed; partner off-host backup/restore and human review are missing |
| 12 — production OIDC and role mapping | Pending | Blocked by Task 11 and missing selected IdP configuration, test subjects, and production role bindings |
| 13 — Paperless ingestion | Pending | Blocked by Task 12 and missing reviewed partner provider/storage configuration |
| 14 — TSA and institutional signing | Pending | Blocked by Task 13 and missing provider contracts, trust material, key custody, and recovery evidence |
| 17 — partner release candidate | Pending | Blocked by Task 14 and missing real charter, owners, legal/security approvals, immutable image, DNS, monitoring, and provider evidence |
| 18 — independent launch audit | Pending | Blocked by Task 17; no signed go/no-go report or deployed acceptance run exists |

## Release gates

| Gate | State | Required evidence before GO |
| --- | --- | --- |
| Repository and immutable source | Blocked | Approved main-repository commit, clean checkout, immutable image digest, source publication decision |
| Identity | Blocked | Selected persistent OIDC issuer/client, negative-path acceptance, session restart proof, explicit citizen/official/reviewer bindings |
| Authorization and audit | Source-ready | Exact release-candidate rerun and deployed negative tests; no forged authority, self-review, or unaudited sensitive commit |
| Privacy and legal | Blocked | Approved charter scope, retention, redaction, disclosure, complaint handling, and result-independence decisions |
| Proof and signatures | Blocked | Reviewed signer and RFC3161 trust chains, key custody/rotation owner, outage and invalid/expired response evidence |
| Backup and restore | Blocked | Encrypted off-host snapshot from the partner database, nominated disposable restore, raw manifest/check/retention evidence, destruction record, named human operator and reviewer |
| Monitoring and paging | Blocked | Live HTTPS, latency/status, restart, disk, certificate, backup-age, log-sink, and paging evidence with named owners |
| Incident and rollback | Blocked | Named incident owner, exercised ingress closure and immutable-image rollback, compatible-schema decision, recovery approval path |
| Provider sandbox acceptance | Blocked | OIDC, Paperless, TSA, signer, artifact storage, and proof verification acceptance against the selected providers |
| Partner workflow acceptance | Blocked | Exact accepted charter → signed proof → commitment → evidence → distinct authorized review → public status run |
| Independent release audit | Blocked | Reproduction by the Task 18 reviewer, negative and outage cases, signed dated decision, no critical finding |

## Task 11 evidence

The local recovery evidence lineage is retained in full:

- initial dirty-worktree mechanics: `docs/operations/evidence/2026-08-09-task11-local-recovery-drill.md`
- historical clean-checkout manifest v2: `docs/operations/evidence/2026-08-09-task11-clean-snapshot-recovery-drill.md`
- current clean-checkout manifest v3: `docs/operations/evidence/2026-08-09-task11-manifest-v3-local-recovery-drill.md`
- exact release-candidate source validation: `docs/operations/evidence/2026-08-09-task11-release-candidate-validation.md`

The initial report records the limitations that drove the clean-checkout and version guards; it is not release evidence. The v3 drill proves that current tooling emits and restores manifest v3, classifies the local repository as `local-test`, records `productionEligible:false`, and preserves the migration/audit/digest checks. All three runs used local encrypted restic storage, synthetic data, and no human reviewer. None satisfies the production gate.

The future off-host operator report must use `docs/operations/recovery-drill-report-template.md`.

### Current off-host preflight — 2026-08-10 UTC

- A Taskmaster recheck matches this ledger: Tasks 7–10 are done, Task 11 is in progress and is the only dependency-ready task, and Tasks 12–14, 17, and 18 are pending.
- The historical 93-path Tasks 7–11 candidate `d1ab6754b7350f4fde69339115b73f954766bf64` is superseded. It contains the broken OSV action reference and vulnerable lock state and must not be used for the partner drill.
- The corrected immutable candidate is `e4e05719348024ca51fc6eda17927073fd2e6927`, tree `2ee908f03e6a8eb3ce0930d303620ea4cb3c730c`. Its two new commits are security remediation `20beaab122123ec414c70e01ff205361b9c6cbe6` and evidence `e4e05719348024ca51fc6eda17927073fd2e6927` on base `f006ea5092244ff423de1655f603be6460065939`.
- The corrected candidate has a clean detached checkout at `/home/ceii/dev/polis-release-candidates/e4e05719348024ca51fc6eda17927073fd2e6927`. Exact-candidate validation began and ended with the nominated SHA/tree and zero status paths. Frozen install, dependency-ordered build, typecheck, 326 tests, lint, 18-service catalog, 15 ops contracts, smoke, no-change Drizzle generation, OSV, gitleaks, and diff checks passed. An independent read-only evidence review returned `CLEAN`.
- Corrected candidate `e4e05719348024ca51fc6eda17927073fd2e6927` is contained in remote `main`. GitHub Actions run [`31366532706`](https://github.com/basicalex/polis/actions/runs/31366532706) completed `success` for that exact head: dependency and secret scan job `93386001862` and build, lint, TypeScript/Python test, and smoke job `93386001949` both passed.
- Current candidate evidence is `docs/operations/evidence/2026-08-10-task11-corrected-release-candidate-validation.md`. Its local transcript SHA-256 is `5846576a912fe9411a0a9891e76c248896ed90b1f765c08ea2464347bdee9ab4`; GitHub Actions metadata SHA-256 is `e50cbeef36b9fd3ea9774568f92c4cc41fa7546b4061900cb527638157e196de`.
- GitHub emitted non-failing notices that several actions declare Node 20 and were forced onto Node 24. No step was skipped or failed; action-runtime maintenance remains open but is not a current repository-gate failure.
- The exact gitleaks fingerprints and fixture classifications received independent read-only review. A named human key-custody owner must still confirm that the two development/test signing keys were never used outside tests; repository labels and passing scans cannot prove that fact.
- `.env.pilot` is absent. `RESTIC_REPOSITORY`, `RESTIC_PASSWORD_FILE`, `SOURCE_DATABASE_URL`, `PRODUCTION_DATABASE_URL`, and `RESTORE_TARGET_DATABASE_URL` are unset in the operator environment.
- Candidate creation, local validation, push, and green remote CI satisfy the repository CI gate only. Task 11 remains blocked until a named operator approves exact candidate `e4e05719348024ca51fc6eda17927073fd2e6927`, runs the production-eligible off-host backup and exact-snapshot disposable restore from its clean checkout, retains provider/retention/destruction evidence, and obtains named independent human review.
- No production/off-host connection or destructive operation was attempted during candidate validation.

### Repository CI evidence — 2026-08-10 UTC

- Historical run [`31309114693`](https://github.com/basicalex/polis/actions/runs/31309114693) at commit `f006ea5092244ff423de1655f603be6460065939` failed during OSV action setup before dependency or secret scanning; its build/lint/test/smoke job passed.
- The correction uses `google/osv-scanner-action/osv-scanner-action@v2.0.0`, upgrades Astro to 7.2.0, `@astrojs/node` to 11.1.0, and `@astrojs/react` to 6.0.2, and pins transitive esbuild 0.28.2 and sharp 0.35.3 through reviewed Bun overrides.
- Initial exact local OSV v2.0.0 scanning found 14 advisories with highest reported CVSS 7.5. The corrected candidate's local and remote dependency scans pass; the local exact image scanned 629 Bun and 41 uv packages with no issues.
- Initial redacted gitleaks 8.24.3 full-history scanning found four repository-labelled contract-test/development fixtures. Four exact historical fingerprints, with no broad path or rule suppression, make local and remote scans pass. Human key-use confirmation remains required.
- Dirty-worktree remediation evidence remains at `docs/operations/evidence/2026-08-09-task11-ci-security-remediation-preflight.md`, transcript SHA-256 `c69f6693daf187fc6faae3027e1a0bd3a0183fb6f86a87fc37bb12087f064ddf`. The exact committed candidate and remote result supersede that preflight for the repository CI gate.

### Repository governance evidence — 2026-08-10 UTC

- A read-only GitHub API audit found that `basicalex/polis` is public and `main` is its default branch. Public visibility still needs an explicit repository-owner/privacy decision for the partner release.
- `main` has no branch protection and the repository has no rulesets. Green CI exists but is not enforced for later pushes; no required pull request, human review, status checks, linear history, force-push restriction, or deletion restriction is currently evidenced.
- GitHub secret scanning, push protection, non-provider pattern scanning, secret validity checks, vulnerability alerts, and Dependabot security updates are disabled.
- Actions are enabled with all actions allowed and SHA pinning not required. Workflow-token permissions default to read-only and workflows cannot approve pull requests; those two controls are correctly least-privileged.
- Evidence is `docs/operations/evidence/2026-08-10-repository-governance-audit.md`; normalized API evidence SHA-256 is `545ad35885cbdbbad6a005c9808e289a24d7a32db3c3aca6cd34478b78810a70`. No remote setting was changed.
- The repository CI gate passes for candidate `e4e05719348024ca51fc6eda17927073fd2e6927`. The broader repository governance gate remains **NO-GO** until a repository owner approves and applies a reviewed enforcement policy, dispositions any host-side secret alerts without treating labels as key-use proof, and verifies the effective settings. Action-runtime/SHA-pinning source changes, if selected, require another immutable candidate and green run.

## Ownership still required

Do not fill these fields with agents, guesses, or vendor defaults.

| Duty | Named owner | Backup owner | Evidence |
| --- | --- | --- | --- |
| Partner accountable executive | Missing | Missing | Missing |
| Deployment and release approval | Missing | Missing | Missing |
| DNS and TLS | Missing | Missing | Missing |
| Secret custody and rotation | Missing | Missing | Missing |
| Identity and role mapping | Missing | Missing | Missing |
| Privacy and legal approval | Missing | Missing | Missing |
| Signing key custody and TSA | Missing | Missing | Missing |
| Backup and restore | Missing | Missing | Missing |
| Monitoring and paging | Missing | Missing | Missing |
| Incident command and rollback | Missing | Missing | Missing |
| Pilot exit and data disposition | Missing | Missing | Missing |
| Independent release review | Missing | Missing | Missing |

## Rollback boundary

Until GO, keep the private partner profile undeployed and the public-read profile fail closed. A release rollback may return only to a reviewed immutable image compatible with the current schema. Do not reverse live migrations, run an older image against an unreviewed newer schema, delete database volumes, or treat backup restoration as routine rollback. Close ingress first; verify a nominated snapshot in a disposable target before any recovery decision.

## Known limitations

- No writable production profile has passed its gates.
- No real partner, human operator, or independent reviewer is bound.
- No production credentials or provider contracts are present in the repository.
- AI, upstream Polis mutation or sync, complaints, rewards, vault, verifiable credentials, graph edits, questions/answers, revocation, and supersession remain outside the enabled first-partner release surface.
- The Task 11 local evidence is not off-host or production evidence.
- Repository CI is green, but branch/ruleset enforcement and GitHub host-side secret/vulnerability controls are absent pending owner decisions.
- No deployment, DNS change, production connection, backup, restore, or destructive operation has been made by this work. The reviewed candidate commit and push are source-control evidence only.

## GO rule

Change this decision to GO only after Tasks 11–14 and 17 are done, Task 18 independently reproduces the full workflow and required negative cases, all owners approve, every linked artifact matches the exact release candidate, and no critical blocker remains. Deployment still requires explicit operator approval.
