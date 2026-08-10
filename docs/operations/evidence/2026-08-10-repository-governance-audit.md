# Repository governance audit — 2026-08-10

Scope: read-only GitHub API evidence for `basicalex/polis`; no repository or
GitHub setting changed.

- Observed UTC: `2026-08-10T07:52:29Z`
- Remote HEAD: `2c8bc86ab2de1eba57fede1aaf621c36b3626653`
- Candidate CI evidence: run `31366532706` at `e4e05719348024ca51fc6eda17927073fd2e6927` — `success`
- Raw normalized evidence: `[`2026-08-10-repository-governance-audit.json`](2026-08-10-repository-governance-audit.json)`
- Raw evidence SHA-256: `545ad35885cbdbbad6a005c9808e289a24d7a32db3c3aca6cd34478b78810a70`

## Current state

| Control | Observed state | Readiness meaning |
| --- | --- | --- |
| Visibility | Public | Must be an explicit owner/privacy decision |
| Default branch | `main` | Expected |
| Main branch protection | Disabled (`404 Branch not protected`) | No required review/check enforcement |
| Repository rulesets | None | No ruleset supplies equivalent protection |
| Secret scanning | Disabled | Repository-host detection is absent |
| Push protection | Disabled | GitHub does not block recognized secrets before push |
| Non-provider patterns | Disabled | Broader secret patterns are not checked by GitHub |
| Secret validity checks | Disabled | GitHub validity checks are absent |
| Vulnerability alerts | Disabled | GitHub dependency alerting is absent |
| Dependabot security updates | Disabled | No automated security-update proposals |
| Actions | Enabled; all actions allowed | No repository allowlist |
| Action SHA pinning | Not required | Mutable action tags remain permitted |
| Workflow token default | Read-only | Good least-privilege default |
| Workflow PR approval | Disabled | Workflows cannot approve pull requests |

The green OSV and gitleaks jobs prove the exact candidate's CI checks. They do
not enforce that later pushes must pass those jobs and do not replace host-side
secret/vulnerability controls.

## Required owner decisions before repository GO

1. Confirm that public visibility is intentional for the partner release.
2. Approve a `main` ruleset/branch-protection policy. At minimum decide:
   - pull request required or not;
   - number and identity class of human reviewers;
   - exact required checks (`dependency + secret scan` and
     `build · lint · test (ts + python)` are the current job names);
   - strict/up-to-date branch behavior;
   - linear history, force-push, and deletion rules;
   - named emergency bypass owner and auditable procedure, or no bypass.
3. Approve enabling vulnerability alerts and Dependabot security updates.
4. Approve enabling secret scanning, push protection, non-provider patterns,
   and validity checks. A named human must disposition any alerts for the four
   reviewed development/test fixtures; agents must not dismiss alerts as proof
   of safe historical key use.
5. Decide whether Actions should be restricted and SHA pinning required. The
   current workflow uses version tags and GitHub warns that several actions
   declare Node 20 and are being forced onto Node 24. Source changes and a green
   replacement candidate are required before enforcing a policy that the
   current workflow does not meet.

## Boundary

These settings are remote governance changes, not ordinary source edits. No
change is authorized by this audit. Do not enable, disable, dismiss, bypass, or
weaken a control without explicit repository-owner approval. Task 11 recovery
and Tasks 12–18 remain NO-GO while their separate human/provider gates are
missing.
