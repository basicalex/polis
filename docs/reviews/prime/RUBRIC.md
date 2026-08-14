# Outside examiner rubric — polis compression plan

You are an outside examiner. You are reviewing the polis repo, which is your
current working directory. You have read-only access: read files, run
read-only commands, and write nothing. Your only output is the report text —
print it as your final response, in the exact structure given at the end.

Re-read the repo fresh each time. Do not assume anything from prior runs.
Ground every claim in a file you actually opened, and cite paths
(e.g. `README.md`, `DESIGN.md`, `apps/...`). If you cannot verify a claim,
say so instead of guessing.

## What you are grading

Polis agreed to a six-point compression plan. Grade progress on each point.

1. **One canonical golden path.** The product tells one story: a resident
   reports → the institution is identified → public acknowledgment → an
   official response or commitment → evidence attached → independent review →
   a public record with receipts. Check that README, homepage copy, and the
   main app flows all walk this same path, in this order, with no competing
   flagship flows.

2. **One public accountability "case" object.** Complaints, claims,
   commitments, proofs, and audit events compose into one case timeline —
   one object a resident can follow, not five parallel record types with
   separate pages. Look for the data model and the UI that renders it.

3. **Navigation cut to ~4 items.** Roughly: Raise an issue / Public issues /
   Officials and commitments / About. Trust affordances (verification,
   methodology, transparency) appear in context, not as top-level pillars.
   Count the real navigation in the resident-facing app.

4. **DESIGN.md as product contract.** DESIGN.md is filled in and reads as the
   contract for the resident surface: calm, phone-usable, minimal. Check that
   the built UI matches what DESIGN.md promises.

5. **Deployment consolidation below 18 services.** This point is parked, but
   watch for growth: count deployable services/apps (infra, compose files,
   service dirs) and flag any increase.

6. **Commitment filing status contradiction resolved.** The repo at one point
   said commitment filing was both approved and pending in different places.
   Check whether one consistent status now holds everywhere it is mentioned.

## Drift to flag

Beyond the six points, flag:

- **New surface area:** new apps, pages, record types, or top-level docs that
  widen the product instead of compressing it.
- **New pillars:** trust or governance features promoted to primary
  navigation or homepage real estate.
- **Story divergence:** README, homepage, admin surface, and verifier surface
  telling different stories about what polis is or how the golden path works.

## Required report structure

Produce exactly this structure so successive reports diff cleanly:

```
# Prime review — polis compression plan

## Status per point

### 1. Canonical golden path — <DONE | ON TRACK | DRIFTING | STALLED>
<2–5 sentences with file citations.>

### 2. One case object — <status>
...

### 3. Navigation ~4 items — <status>
...

### 4. DESIGN.md as contract — <status>
...

### 5. Service count (parked) — <status, with the count>
...

### 6. Filing status contradiction — <status>
...

## Drift flags

<Bullet list. Each: what appeared, where (file paths), why it is drift.
Write "None found." if none.>

## Top risks

<At most 3, ordered. Each: the risk, the evidence, what it threatens.>
```
