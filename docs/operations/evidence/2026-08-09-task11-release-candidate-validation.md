# Task 11 release-candidate validation — 2026-08-09

## Scope

This run validates the committed Tasks 7–11 candidate, not the later `origin/main` commits and not a production deployment.

- Candidate commit: `d1ab6754b7350f4fde69339115b73f954766bf64`
- Candidate tree: `62c727eebb9d27f21d8422c5c16b390ae8b79bb0`
- Live repository check: remote `main` resolved to `f006ea5092244ff423de1655f603be6460065939` and contains the candidate
- Checkout: `/home/ceii/dev/polis-release-candidates/d1ab6754b7350f4fde69339115b73f954766bf64`
- Completion time: `2026-08-09T10:45:46Z`
- Runtime: Bun `1.3.14`, Node `v26.1.0`, Linux `7.0.8-1-cachyos` x86_64
- Sanitized transcript: [`2026-08-09-task11-release-candidate-validation.log`](2026-08-09-task11-release-candidate-validation.log)
- Sanitized transcript SHA-256: `26b3e85b64d87b68b8d512dacda86cc7251782521a92b7ad2bb55920ba1a3eda`

## Result

The exact candidate checkout remained clean (`git status --porcelain=v1` returned zero paths) and at the nominated commit after validation.

Builds passed after building workspace prerequisites in dependency order:

- `@polis/domain` prerequisite
- `@polis/db`
- `@polis/service-runtime`
- `@polis/platform-api`
- `@polis/contribution-service`
- `@polis/complaints-service`
- `@polis/document-signing-service`

Package and policy tests passed 173/173:

| Package | Passed |
| --- | ---: |
| `@polis/service-runtime` | 17 |
| `@polis/platform-api` | 23 |
| `@polis/contribution-service` | 35 |
| `@polis/complaints-service` | 17 |
| `@polis/document-signing-service` | 37 |
| `@polis/db` | 19 |
| `@polis/policy-rules` | 25 |

Additional checks:

- `bun run ops:test`: 15/15
- `bun run service-catalog:check`: 18 services valid; generated docs current
- `git diff --check`: passed

## Execution note

The first isolated platform build ran before `@polis/db` and stopped because the dependency output did not yet exist in the fresh checkout. No source changed. The complete sequence was rerun with `@polis/domain` and `@polis/db` first, after which every listed build and check passed. The transcript retains both the ordering failure and the corrected run.

## Credential-pattern classification

A tracked, non-binary candidate-tree scan found 37 PostgreSQL credential-URL pattern matches and left none unclassified:

- 12 explicit `CHANGE_ME` placeholders in `.env.example` and `polis_interface_v1_agent.env.example`
- 8 test or disposable-drill fixtures in `infra/compose/*contract.test.mjs`, `packages/db/src/index.test.ts`, `services/platform-api/src/index.test.ts`, and `scripts/ops/clean-db-drill.sh`
- 17 local-development defaults in `infra/compose/docker-compose.yml` and `packages/db/drizzle.config.ts`

These are examples, fixtures, or local-development values, not partner or production credentials. A second independent read-only agent review reproduced the exact 37-match definition and 12/8/17 breakdown, found zero unclassified values and no plausible live partner or production secret, and returned `CLEAN`. The separate pending-evidence scan found no private-key blocks, provider tokens, JWTs, bearer values, credential assignments, or credential-bearing URLs in the three pending evidence files. Production configuration remains missing and must be installed outside chat before the off-host drill.

## Independent evidence check

A separate read-only agent review on 2026-08-09 returned `CLEAN`. It independently matched the commit and tree, confirmed the clean checkout, recomputed the transcript hash, located every stated build and test result, checked the disclosed dependency-order failure, found no obvious secret-bearing content, and confirmed that the report preserves **NO-GO**. This source-evidence check is not the named independent human recovery review required by Task 11.

## Superseding CI and security finding

Later inspection of GitHub Actions run `31309114693` found that the repository's
OSV action reference could not start, and exact local scans of this candidate's
lock state found the dependency advisories recorded in
`2026-08-09-task11-ci-security-remediation-preflight.md`. Candidate
`d1ab6754b7350f4fde69339115b73f954766bf64` therefore cannot satisfy the
repository gate unchanged and must not be used for the partner drill. The
unstaged remediation is based on later `main`, has transcript SHA-256
`c69f6693daf187fc6faae3027e1a0bd3a0183fb6f86a87fc37bb12087f064ddf`, and is not yet an immutable replacement candidate.

## Release meaning

This is post-commit source validation for the exact superseded candidate. It
does not replace a corrected immutable candidate, successful remote security
job, encrypted off-host backup, exact-snapshot disposable restore, provider
evidence, target-destruction record, named recovery operator, or independent
human review required to complete Task 11. Release status remains **NO-GO**.
