# Task 11 corrected release-candidate validation — 2026-08-10

## Scope

This evidence validates the exact committed Tasks 7–11 repository candidate and
its GitHub Actions run. It does not claim a production backup, restore,
deployment, provider acceptance, or human release decision.

- Candidate commit: `e4e05719348024ca51fc6eda17927073fd2e6927`
- Candidate tree: `2ee908f03e6a8eb3ce0930d303620ea4cb3c730c`
- Security-remediation commit: `20beaab122123ec414c70e01ff205361b9c6cbe6`
- Base commit: `f006ea5092244ff423de1655f603be6460065939`
- Detached checkout: `/home/ceii/dev/polis-release-candidates/e4e05719348024ca51fc6eda17927073fd2e6927`
- Local validation: `2026-08-10T07:26:10Z` through `2026-08-10T07:31:44Z`
- Runtime: Bun `1.3.14`, Node `v26.1.0`, Linux x86_64
- Local transcript: [`2026-08-10-task11-corrected-release-candidate-validation.log`](2026-08-10-task11-corrected-release-candidate-validation.log)
- Local transcript SHA-256: `5846576a912fe9411a0a9891e76c248896ed90b1f765c08ea2464347bdee9ab4`
- GitHub Actions metadata:
  [`2026-08-10-task11-github-actions-run-31366532706.json`](2026-08-10-task11-github-actions-run-31366532706.json)
- Metadata SHA-256: `e50cbeef36b9fd3ea9774568f92c4cc41fa7546b4061900cb527638157e196de`

Historical candidate `d1ab6754b7350f4fde69339115b73f954766bf64`
contains the broken OSV action reference and vulnerable lock state. It remains
superseded and must not be used for the partner drill.

## Local result

The detached checkout began and ended at the exact candidate commit and tree
with zero tracked, staged, or untracked status paths. All checks passed:

- frozen Bun install;
- dependency-ordered workspace build, including admin, vault, verifier, and web;
- workspace typecheck, including zero errors, warnings, or hints across 88 Astro
  files;
- 326 tests across 26 packages and apps;
- ESLint and Prettier;
- 18-service catalog check;
- 15 ops contract tests;
- v1 smoke;
- Drizzle generation with no schema changes;
- exact OSV v2.0.0 action image: 629 Bun and 41 uv packages, no issues;
- gitleaks 8.24.3 full-history scan with redaction: no leaks;
- `git diff --check`.

A separate read-only agent recomputed transcript SHA-256
`5846576a912fe9411a0a9891e76c248896ed90b1f765c08ea2464347bdee9ab4`, reproduced the exact ancestry, SHA, tree, clean status,
counts, scan results, and NO-GO wording, classified the validation evidence as
not containing credential values or private-key material, and returned
`CLEAN`. This is an independent source-evidence review, not the named human
recovery review.

## Remote result

GitHub Actions run
[`31366532706`](https://github.com/basicalex/polis/actions/runs/31366532706)
was triggered by the push of exact candidate `e4e05719348024ca51fc6eda17927073fd2e6927` to `main`.
It completed with conclusion `success`:

| Job | Job ID | Started UTC | Completed UTC | Conclusion |
| --- | ---: | --- | --- | --- |
| Dependency and secret scan | `93386001862` | `2026-08-10T07:36:17Z` | `2026-08-10T07:36:37Z` | `success` |
| Build, lint, and test (TypeScript and Python) | `93386001949` | `2026-08-10T07:36:17Z` | `2026-08-10T07:38:13Z` | `success` |

The security job successfully completed checkout, the corrected OSV dependency
scan, gitleaks secret scan, and cleanup. The verification job successfully
completed dependency installation, Python sync, lint, build/typecheck/tests and
smoke, Ruff, and pytest.

GitHub emitted non-failing notices that several actions still declare a Node 20
runtime and were forced onto Node 24 by the runner. The notices did not skip or
fail a step, but action-runtime maintenance remains a later repository concern.

## Signing-fixture boundary

The four committed gitleaks fingerprints are limited to two compose
contract-test token fixtures and two repository-labelled development/test
signing keys. Independent agent review confirmed the exact historical
fingerprints and successful scans. A named human key-custody owner must still
confirm that the signing keys were never used outside tests. Neither repository
labels nor scans can supply that human fact.

## Release meaning

The corrected candidate now passes the local and remote repository CI gates.
Task 11 remains incomplete and release status remains **NO-GO**. Before the
candidate may be used for production recovery evidence, a named operator must
approve its exact SHA and a distinct named human must independently review the
partner off-host backup and exact-snapshot disposable restore. Required partner
database URLs, encrypted off-host restic configuration, provider check and
retention evidence, destructive-target approval, target-destruction record, and
human sign-off remain absent.
