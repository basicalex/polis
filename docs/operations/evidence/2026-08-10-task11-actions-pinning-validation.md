# Task 11 GitHub Actions pinning validation — 2026-08-10

## Scope

This evidence validates the workflow-only commit that replaces mutable action
versions with reviewed immutable commits and moves every JavaScript action to a
Node 24 release. It does not change GitHub repository settings, approve a
recovery drill, or satisfy any production/provider/human gate.

- Candidate commit: `02b26c5c922359357af3b52b7ba74b903036b696`
- Candidate tree: `da949d75af5a3c35f183bc2c9f4fed62b0088db7`
- Parent: `a62edcbdf5f506aad845d2fd28f06687ef4653d4`
- Clean detached checkout: `/home/ceii/dev/polis-release-candidates/02b26c5c922359357af3b52b7ba74b903036b696`
- Normalized evidence:
  [`2026-08-10-task11-actions-pinning-validation.json`](2026-08-10-task11-actions-pinning-validation.json)
- Evidence SHA-256: `7dd9813d594676d631930455669111c7345d0b4b61546222321db12519fd2120`

Candidate `02b26c5c922359357af3b52b7ba74b903036b696` supersedes earlier nominated candidate
`e4e05719348024ca51fc6eda17927073fd2e6927` for any future operator approval. The earlier candidate's
local validation remains evidence for the unchanged product/lock state, but its
workflow still used mutable action references.

## Exact action references

| Action | Immutable commit | Version comment | Runtime |
| --- | --- | --- | --- |
| `actions/checkout` | `3d3c42e5aac5ba805825da76410c181273ba90b1` | v7.0.1 | Node 24 |
| `oven-sh/setup-bun` | `0c5077e51419868618aeaa5fe8019c62421857d6` | v2.2.0 | Node 24 |
| `actions/setup-node` | `820762786026740c76f36085b0efc47a31fe5020` | v7.0.0 | Node 24 |
| `actions/setup-python` | `5fda3b95a4ea91299a34e894583c3862153e4b97` | v7.0.0 | Node 24 |
| `open-policy-agent/setup-opa` | `b2b258e089860efaadaaf71bf6e3aecb4a3eeff1` | v2.4.0 | Node 24 |
| `google/osv-scanner-action/osv-scanner-action` | `98b584ee2ed2da3935ccce10e06739d54cdcd20b` | v2.0.0 | Docker |
| `gitleaks/gitleaks-action` | `e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e` | v3.0.0 | Node 24 |

Checkout appears in both jobs, so the workflow contains eight changed `uses:`
lines across seven unique actions. The exact release refs independently resolve
to the listed commits. Exact action manifests confirm each runtime and preserve
the used inputs: checkout `fetch-depth`, Bun `bun-version`, Node `node-version`,
Python `python-version`, OPA `version`, and OSV `scan-args`. Jobs, triggers,
permissions, commands, scan arguments, and the gitleaks token seam are unchanged.

The pinned gitleaks v3 action defaults to gitleaks core 8.24.3, matching the
local full-history evidence. The pinned OSV action manifest refers to its
upstream `ghcr.io/google/osv-scanner-action:v2.0.0` Docker image; this is an
upstream boundary retained from the already validated OSV action rather than an
immutable image-digest claim.

## Validation

Local static validation passed:

- PyYAML parse;
- all eight `uses:` values have an exact 40-hex commit;
- Prettier;
- `git diff --check`;
- actionlint 1.7.12, whose downloaded archive matched its published checksum.

A separate read-only agent independently resolved the release refs, fetched the
exact manifests, checked runtimes and used inputs, confirmed the one-file/eight-
line boundary, and returned `CLEAN`.

GitHub Actions run
[`31368674242`](https://github.com/basicalex/polis/actions/runs/31368674242)
completed `success` at exact head `02b26c5c922359357af3b52b7ba74b903036b696`:

| Job | Job ID | Started UTC | Completed UTC | Result |
| --- | ---: | --- | --- | --- |
| Build, lint, test (TypeScript and Python) | `93392535916` | `2026-08-10T08:07:18Z` | `2026-08-10T08:08:57Z` | `success` |
| Dependency and secret scan | `93392535925` | `2026-08-10T08:07:19Z` | `2026-08-10T08:07:36Z` | `success` |

Every recorded step completed successfully. A post-run check found zero
annotations for both jobs. The prior Node 20 forced-runtime notices are absent.

GitHub reports a 90-day maximum Actions artifact/log retention for this
repository. A sanitized transcript snapshot is retained at
[`2026-08-10-task11-actions-pinning-github-run-31368674242.log`](2026-08-10-task11-actions-pinning-github-run-31368674242.log), SHA-256
`dc31640c82d4706ec9f776bd26b7e8af5ff4a4a6d4f3ff40c69d5dcb9bc5d930`. Gitleaks 8.24.3 and targeted credential/private-key
patterns found no secret-looking value in the retained transcript. The durable
copy preserves review evidence after the provider log expires; it does not
replace the run URL or claim GitHub signature/provenance for the copied bytes.

## Release meaning

This closes the mutable action-reference and Node runtime warning in source and
proves the exact workflow remotely. Repository-side SHA-pinning enforcement,
branch/ruleset protection, secret scanning, push protection, vulnerability
alerts, and Dependabot security updates remain disabled pending explicit owner
approval. Task 11 still lacks human candidate approval, named recovery operator
and reviewer, off-host restic/database configuration, destructive-drill
approval, provider/retention/destruction evidence, and human signing-key-use
confirmation. Release status remains **NO-GO**.
