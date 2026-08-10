# Task 11 CI security remediation preflight — 2026-08-09

## Classification

This is local preflight evidence from a dirty working tree based on
`f006ea5092244ff423de1655f603be6460065939`. It is not an immutable release
candidate, a remote CI result, a deployment result, or operator approval.

## Findings that triggered the work

GitHub Actions run `31309114693` passed the build, lint, test, and smoke job but
the security job failed during action setup. The workflow referenced
`google/osv-scanner-action@v2.0.0`; that tag's repository-root action metadata
has no `runs` section. The same-version nested action at
`google/osv-scanner-action/osv-scanner-action@v2.0.0` has Docker action metadata.
An independent read-only review returned `CLEAN` for that path correction.

Running the corrected OSV v2.0.0 image locally against the original locks found
14 advisories: 3 for `@astrojs/node` 9.5.5, 8 for Astro 5.18.2, 2 for esbuild
0.18.20/0.27.7, and 1 for sharp 0.34.5. A redacted gitleaks 8.24.3 full-history
scan found four repository-labelled test/development fixtures.

## Local remediation under review

- Correct the OSV action path without changing the action version.
- Upgrade Astro to 7.2.0, `@astrojs/node` to 11.1.0, and `@astrojs/react` to
  6.0.2 across the root, four apps, and the UI peer contract.
- Use root Bun overrides for esbuild 0.28.2 and sharp 0.35.3. The esbuild
  override also replaces the old copy under drizzle-kit's archived loader;
  `drizzle-kit generate` completed and reported no schema changes.
- Add four exact `.gitleaksignore` fingerprints: two compose contract-test
  token fixtures and two signing keys that their repository paths/comments
  explicitly label test/development-only. Production signing remains closed.
  A human key owner must still confirm that those keys were never used outside
  tests; the ignore file does not prove that fact.
- Raise time budgets only for process-heavy fail-closed tests: the identity
  direct-startup assertion now allows 10 seconds, and two restore-contract
  tests use a shared 20-second test timeout. The first combined validation run
  exposed both timing failures under load. Production and operator code did
  not change for these corrections.

No migration, environment variable, service, public route, API contract, or
production configuration was added.

## Validation

The attached transcript records the initial timing failures, their narrow test
corrections, and the passing reruns. Final local results:

- `bun install --frozen-lockfile`: pass, no lock change.
- Dependency-ordered full build: pass, including all four Astro applications.
- Full workspace typecheck: pass; Astro checks reported zero errors, warnings,
  or hints in 88 files across the four apps.
- Full workspace tests after the identity timeout correction: 326/326 pass.
- ESLint and Prettier: pass.
- Service catalog: 18 services valid and generated documentation current.
- Ops contracts after the two explicit slow-test budgets: 15/15 pass.
- `bun run v1:smoke`: pass.
- `drizzle-kit generate`: pass; no schema changes.
- `git diff --check`: pass.
- Exact OSV v2.0.0 image: exit 0; 629 Bun packages and 41 uv packages scanned;
  no issues found.
- Gitleaks 8.24.3 full-history scan with redaction: exit 0; no leaks found after
  the four exact reviewed-scope fingerprints.
- Gitleaks 8.24.3 directory scan over the 16 intended modified/new files: exit
  0; no leaks found. This separately covers untracked evidence that Git-history
  mode cannot see before commit.

Transcript:
`docs/operations/evidence/2026-08-09-task11-ci-security-remediation-preflight.log`

Transcript SHA-256: `c69f6693daf187fc6faae3027e1a0bd3a0183fb6f86a87fc37bb12087f064ddf`

## Remaining repository gate

The working tree is still unstaged. This remediation must receive independent
scope/security review, explicit commit approval, an immutable replacement
candidate, explicit push approval, and a successful GitHub Actions security
job. Local scan success does not replace those gates. Task 11 also still needs
the partner off-host recovery drill and named independent human recovery
review. Status remains **NO-GO**.
