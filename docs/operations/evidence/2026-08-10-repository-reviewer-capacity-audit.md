# Repository reviewer-capacity audit — 2026-08-10

## Scope

A read-only GitHub collaborators API query checked whether the repository can
currently enforce one distinct human approval on `main`. No invitation,
permission, branch rule, repository setting, or source file was changed by the
query.

- Repository: `basicalex/polis`
- Observed UTC: `2026-08-10T08:18:57Z`
- Normalized evidence: [`2026-08-10-repository-reviewer-capacity-audit.json`](2026-08-10-repository-reviewer-capacity-audit.json)
- Evidence SHA-256: `babdbb32b9c25425f64712bd89a10aea105cf16f85b0a0caef97b52ea6a55191`

## Result

The API returned one collaborator with administrator permission and no second
collaborator with verified write or maintain permission. A distinct human pull-
request reviewer is therefore not evidenced. The repository cannot truthfully
claim separation between the sole current administrator/author and a required
human reviewer.

Do not enable a no-bypass one-approval rule and then claim it is operable. First
a repository owner must name and invite a second accountable human reviewer,
that person must accept, and a read-only permissions recheck must confirm the
effective role. The owner must also decide whether the reviewer is authorized
to assess security-sensitive workflow and recovery evidence.

## Release meaning

This is a repository-governance blocker, not permission to add a guessed person,
weaken review requirements, create an agent reviewer, or bypass a branch rule.
Green CI and independent agent evidence reviews do not substitute for the named
human required by the production gate. Overall status remains **NO-GO**.
