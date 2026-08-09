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

The initial report records the limitations that drove the clean-checkout and version guards; it is not release evidence. The v3 drill proves that current tooling emits and restores manifest v3, classifies the local repository as `local-test`, records `productionEligible:false`, and preserves the migration/audit/digest checks. All three runs used local encrypted restic storage, synthetic data, and no human reviewer. None satisfies the production gate.

The future off-host operator report must use `docs/operations/recovery-drill-report-template.md`.

### Current off-host preflight — 2026-08-09 UTC

- The reviewed release scope was prepared from base HEAD `04993ec9dcb541b9ac5732714cbaf60e140f88b7`. This in-commit ledger cannot self-record its resulting commit SHA; the operator must record and approve the exact candidate SHA after creation.
- The main worktree contains the preserved untracked `.omp/RULES.md`, so release backup must run from a separate clean checkout of the approved candidate commit.
- `.env.pilot` is absent.
- `RESTIC_REPOSITORY`, `RESTIC_PASSWORD_FILE`, `SOURCE_DATABASE_URL`, `PRODUCTION_DATABASE_URL`, and `RESTORE_TARGET_DATABASE_URL` are unset in the operator environment.
- A read-only release-scope review found 94 changed/untracked paths: 93 belong to the accepted Tasks 7–11 source, Taskmaster state, and complete recovery-evidence lineage; the sole exclusion is the pre-existing unrelated `.omp/RULES.md`.
- No required source or evidence file is ignored or missing; generated `dist`, `node_modules`, and `__pycache__` artifacts remain excluded.
- The current 93-path source view passed fresh builds for service-runtime, platform-api, contribution-service, complaints-service, document-signing-service, and database packages; their tests plus policy tests passed 173/173. Ops contracts passed 15/15, and the service catalog and diff checks passed.
- A scoped release-content scan found no missing paths, symlinks, binary files, private-key blocks, provider tokens, JWTs, or live credentials. Database-URL matches were limited to explicit `CHANGE_ME` examples, test fixtures, and runtime variable interpolation. Only the three operator shell scripts are executable.
- Creating a candidate commit does not approve it or satisfy Task 11. Backup remains blocked until a named operator approves its exact SHA and uses a separate clean checkout.
- The named Task 11 operator and independent human reviewer remain missing.
- No production/off-host connection or destructive operation was attempted during this preflight.

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
