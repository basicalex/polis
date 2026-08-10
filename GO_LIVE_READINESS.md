# Go-live readiness

**Decision: NO-GO**  
**Assessment date:** 2026-08-09 UTC  
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

### Current off-host preflight — 2026-08-09 UTC

- A Taskmaster recheck matches this ledger: Tasks 7–10 are done, Task 11 is in progress and is the only dependency-ready task, and Tasks 12–14, 17, and 18 are pending.
- The reviewed 93-path release scope was committed from base HEAD `04993ec9dcb541b9ac5732714cbaf60e140f88b7` as candidate `d1ab6754b7350f4fde69339115b73f954766bf64` (`prepare fail-closed partner pilot release gates`).
- The candidate has a clean checkout at `/home/ceii/dev/polis-release-candidates/d1ab6754b7350f4fde69339115b73f954766bf64`; its HEAD matches the immutable candidate commit and tree `62c727eebb9d27f21d8422c5c16b390ae8b79bb0`, and its worktree is clean. A live read-only `git ls-remote` check matched remote `main` to `f006ea5092244ff423de1655f603be6460065939` and confirmed that it contains the candidate.
- Later `origin/main` commits `b8bef385755f25d7f9f524116f1b6e384d0d82b3`, `c0fd2a72452de90e6d5bf65bd0043cea6bd1de4f`, `a35a7734eb0d03659a879b224ec3b185aeaa52fd`, and `f006ea5092244ff423de1655f603be6460065939` change only `README.md`, `infra/compose/docker-compose.yml`, and `.omp/RULES.md` relative to the reviewed candidate. They are outside that candidate. Including them in a replacement candidate requires a separate scope review, validation, and operator approval.
- `.env.pilot` is absent.
- `RESTIC_REPOSITORY`, `RESTIC_PASSWORD_FILE`, `SOURCE_DATABASE_URL`, `PRODUCTION_DATABASE_URL`, and `RESTORE_TARGET_DATABASE_URL` are unset in the operator environment.
- The pre-commit release-scope review found 94 changed/untracked paths: 93 belonged to the accepted Tasks 7–11 source, Taskmaster state, and complete recovery-evidence lineage; the sole exclusion was the then-untracked unrelated `.omp/RULES.md`.
- No required source or evidence file was ignored or missing; generated `dist`, `node_modules`, and `__pycache__` artifacts remained excluded.
- The resulting 93-path candidate tree passed fresh builds for service-runtime, platform-api, contribution-service, complaints-service, document-signing-service, and database packages; their tests plus policy tests passed 173/173. Ops contracts passed 15/15, and the service catalog and diff checks passed.
- A scoped release-content scan found no missing paths, symlinks, binary files, private-key blocks, provider tokens, JWTs, or live credentials. A fresh tracked non-binary candidate-tree scan classified all 37 PostgreSQL credential-URL pattern matches: 12 explicit `CHANGE_ME` examples, 8 test or disposable-drill fixtures, and 17 local-development defaults; none remained unclassified. A separate read-only agent reproduced that definition and breakdown and returned `CLEAN`. Only the three operator shell scripts are executable.
- Candidate creation and local validation do not satisfy Task 11. Backup remains blocked until a named operator approves the exact candidate SHA for the drill and uses its separate clean checkout.
- The named Task 11 operator and independent human reviewer remain missing.
- No production/off-host connection or destructive operation was attempted during this preflight.

### Repository CI preflight — 2026-08-09 UTC

- GitHub Actions run [`31309114693`](https://github.com/basicalex/polis/actions/runs/31309114693) for current remote `main` commit `f006ea5092244ff423de1655f603be6460065939` concluded `failure`.
- Its build, lint, TypeScript/Python test, and smoke job passed. The dependency and secret-scan job failed during setup before either scan ran because `google/osv-scanner-action@v2.0.0` resolves to a root manifest without a required `runs` section.
- No standalone GitHub Actions run exists for candidate `d1ab6754b7350f4fde69339115b73f954766bf64`. Because that candidate contains the broken action reference and vulnerable lock state, it is superseded and must not be used for the partner drill; a corrected immutable candidate is required.
- The unstaged local correction points to `google/osv-scanner-action/osv-scanner-action@v2.0.0`; the exact referenced manifest was fetched read-only and contains a Docker `runs` definition. An independent read-only review returned `CLEAN` for this minimal path correction and the preflight wording.
- The first local run of that exact OSV v2.0.0 image exited `1` with 14 findings: 3 in `@astrojs/node` 9.5.5, 8 in Astro 5.18.2, 2 in esbuild versions 0.18.20 and 0.27.7, and 1 in sharp 0.34.5. The highest reported CVSS was 7.5.
- The unstaged remediation upgrades Astro to 7.2.0, `@astrojs/node` to 11.1.0, and `@astrojs/react` to 6.0.2, and pins transitive esbuild 0.28.2 and sharp 0.35.3 with root Bun overrides. The final exact OSV scan exited `0` after scanning 629 Bun packages and 41 uv packages with no issues. Full build, typecheck, 326/326 workspace tests, lint, 15/15 ops contracts, smoke, service catalog, no-change Drizzle generation, and diff checks passed locally.
- The first redacted full-history gitleaks 8.24.3 scan exited `2` with four findings: two explicit compose contract-test tokens and two keys that repository comments and paths label as test/development signing material. Four exact fingerprint suppressions now make the same local scan exit `0`. The fingerprint scope and labels still require independent review, and a human key owner must confirm the signing keys were never used outside tests; no agent may treat the labels or successful scan alone as that proof.
- Local evidence is `docs/operations/evidence/2026-08-09-task11-ci-security-remediation-preflight.md`; its transcript SHA-256 is `c69f6693daf187fc6faae3027e1a0bd3a0183fb6f86a87fc37bb12087f064ddf`. This is dirty-worktree preflight, not a release candidate or remote result.
- The workflow, dependency, lock, fingerprint, and test-timeout changes must be independently reviewed, explicitly approved for commit, bound to a replacement candidate, pushed only with approval, and followed by a successful GitHub Actions dependency and secret-scan job before the repository gate can pass.

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
- No commit, push, deployment, DNS change, or production connection has been made by this work.

## GO rule

Change this decision to GO only after Tasks 11–14 and 17 are done, Task 18 independently reproduces the full workflow and required negative cases, all owners approve, every linked artifact matches the exact release candidate, and no critical blocker remains. Deployment still requires explicit operator approval.
