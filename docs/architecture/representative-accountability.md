# Representative Accountability — architecture

Companion to [`docs/roadmap/m-ra-representative-accountability.md`](../roadmap/m-ra-representative-accountability.md).
Grounded in `polis_interface_full_system_spec.md` §11 (graph ontology), §12 (evidence),
§15 (proof), §19 (contribution/review), §21 (identity), §26 (audit), §28 (communication).
This document is the public-facing design expression; the milestone doc owns the build plan.

## Purpose

Polis Interface's backbone is the **Citizen Trust + Positive Policy Engine**: the governance
graph (§11), evidence vault (§12), proof architecture (§15), contribution/review adjudication
(§19), append-only hash-chained audit (§26), and policy-as-code. The Representative
Accountability (M-RA) layer extends that backbone so an elected or appointed office-holder can
publish their positions and commitments as **audited, evidence-anchored objects in the same
graph**, tracked against reality. It adds no persuasion, targeting, or electoral-optimization
capability (see [Firewall](#firewall--explicit-non-goals)).

## The principle

**Legitimacy-by-evidence, not legitimacy-by-assertion.** The representative surface is a
read-derivation of the trust graph plus one new node type (`commitment`). A politician gains
standing on this platform only by making claims that survive evidence-checking and by
follow-through that is *adjudicated, not self-declared*. The citizen trust engine and the
representative surface are **non-decouplable**: the surface inherits its credibility entirely
from the engine, because the politician's only path to visibility is to bind themselves to
checkable, follow-through-tracked reality.

### Why this preserves — and extends — the moat

The strategic intent (operator-approved): give office-holders something useful to them — a
public platform to show their work and accrue legitimacy — as the entry vector, while the design
ensures that value flows back to the population. Self-interest is harnessed as the mechanism that
delivers accountability: the politician cannot extract benefit here without filing evidence-anchored
commitments and surviving public follow-through review. This is "open politics" in the sense the
project was founded for — governance that serves the public, not the office-holder — achieved by
coupling, not by refusing to serve representatives.

## Non-decoupling contract

Architectural rules that make the coupling load-bearing rather than rhetorical:

1. **No parallel content store.** A representative's positions and commitments live in the same
   `claims` / `evidence_links` / `commitments` tables as every other public claim. There is no
   separate "campaign content" table that can bypass the evidence layer.
2. **Every public object is a graph object.** A platform page is a projection
   (`mandate-holder → claims, commitments, evidence, audit, answered questions`), rendered read-only
   from existing graph entities. It is not a free-form page the official edits at will.
3. **The audit chain is shared and neutral.** Commitment publication and every status transition
   append to the same §26.3 hash-chained `audit_events` as citizen contributions. The
   representative surface has no private or side-channel audit.
4. **Follow-through is adjudicated through the public review queue (§19), not self-reported.**
   See [Follow-through mechanism](#follow-through-mechanism).
5. **The system holds no partisan state.** There is no field, table, or policy that records a
   preferred candidate, party, or electoral outcome. Neutrality is a structural absence, not a
   promise.

## Load-bearing invariants

If any is violable, the strategy breaks. These are hard constraints for every phase:

1. **Follow-through is never self-reported.** An office-holder cannot set a commitment to
   `delivered`. They file a resolution *claim*; evidence is contributed; the review queue +
   policy-as-code adjudicate the status.
2. **Status is append-only and tamper-evident.** Lifecycle transitions are rows in
   `commitment_status_events` (latest-row-wins, mirroring `reviews` / `ai_review_queue` /
   `proof_supersessions`); each transition is an audited §26.3 event. No UPDATE/DELETE.
3. **The scorecard is pure fact, never a grade.** A public roll-up (counts of commitments by
   status) where every number deep-links to the underlying evidence and audit. No ranking, no
   score, no "performance rating", no win-probability.
4. **Publication requires a verified, active mandate-holder with an accepted charter.** Only a
   `verified_official` (§21) holding an active `mandate_holders` row, with an accepted
   `mandate_holder_charters` row, may file. Mandate scope bounds what they may claim about
   (jurisdiction / process).
5. **No persuasion primitive, ever, in this product.** See [Firewall](#firewall--explicit-non-goals).

## Data model

Drizzle schema (`packages/db/src/schema.ts`) is the source of truth. Snake-case columns,
camel-case wire via mappers, `pkId()` + `universal()` helpers, `enumCheck()` constraints — all
idiomatic to the existing schema.

### Terminology (decided)

**`mandate-holder`** is the term for the office-holder record + surface: table `mandate_holders`,
routes/types use `mandate-holder` / `mandate_holder`. This is **distinct from the existing
`mandates` table** (the legal-basis concept) and from `roles` (the position). Scope is **any
`verified_official`** (not local-council only).

### Reused unchanged

| Existing | Role in M-RA |
|---|---|
| `mandates` (legal basis) + `roles` (position in an institution under a mandate) + `institutions` + `jurisdictions` + `processes` | The office an office-holder occupies. `roles.mandateId` already links a role to its legal mandate. |
| `claims` (`claimType`, `subjectType`, `subjectId`, `reviewState`, `confidenceState`, `visibility`) | A politician's **position** is a claim. No new table. |
| `evidence_links` + `sources` + `documents` + `proof_manifests` | Evidence backing a position or a commitment's resolution. Hash-verifiable via `/verify`. |
| `submissions` (`type` includes `'claim'`) + `reviews` (append-only, latest-wins) | The adjudication path: a position or resolution claim flows as a `'claim'` submission through the review queue. `contributionClass` is the policy hook (cf. ADR-007 `political_agreement`). |
| `citizens` (`identity_level` CHECK-constrained to `IDENTITY_AUTH_LEVELS` = `verified_resident` \| `verified_official`; office-holder = `verified_official`) | The office-holder's identity tier. |
| `audit_events` (§26.3, hash-chained) + `audit_event_redactions` | Every commitment and status transition is audited; private constituent data is redacted (§26.4). |
| `issues` / `conversations` (§13) | Public Q&A on a commitment. |

### New — four tables (migration `0009_mandate_holder_v0.sql`)

1. **`mandate_holders`** — binds a specific person to a role + jurisdiction for a period. This is
   the one binding the existing ontology lacks (`mandates` is the legal-basis concept, `roles` is
   the position; neither records *who holds it, when*).
   `citizen_id`, `role_id`, `jurisdiction_id`, `display_name`, `starts_at`, `ends_at` (null = current),
   plus inlined explicit audit columns and a constrained lifecycle `status` (`active` | `ended` |
   `revoked`, CHECK-constrained, default `active`). It does **not** spread `universal()` —
   `universal()`'s generic `status` is a plain nullable column with no default/notNull, so it
   cannot carry the lifecycle; this mirrors `submissions`.
2. **`mandate_holder_charters`** — an accepted charter must precede any commitment. Inlines its
   own lifecycle `status` (`pending` | `accepted` | `withdrawn`) for the same reason as
   `mandate_holders`. `charter_doc` (jsonb) carries the charter terms. Enforcement is in
   `representative/access.rego` (tested skeleton now; wired into the write route in Phase 2).
3. **`commitments`** — the promise object. References a `claim_id` whose `claimType` is an
   **existing** `CLAIM_TYPES` value (`proposal_assertion` for a pledge, or `public_statement`) —
   no new `CLAIM_TYPES` value is introduced (a dedicated `commitment` type, if ever wanted, is a
   separate `CLAIM_TYPES` CHECK-enum migration, not part of this milestone). Scoped to a
   `process_id` / `jurisdiction_id`, filed by a `mandate_holder_id`, with `success_criterion`
   (text), `due_at` (timestamptz), `…universal()` (effective status is derived from
   `commitment_status_events`, not stored here — the generic `universal().status` is unused for
   the lifecycle). A commitment is an existing claim + a follow-through dimension.
4. **`commitment_status_events`** — append-only lifecycle (latest-row-wins). Uses **explicit
   append-only columns, not `universal()`** — `universal()`'s `updated_at` would contradict
   append-only and its `status` would duplicate the event status (mirrors `reviews` /
   `proof_revocations`): `commitment_id`, `status` (`proposed` | `in_progress` | `delivered` |
   `partial` | `not_delivered` | `overdue`), `resolution_claim_id` (required non-null for terminal
   `delivered`/`partial`/`not_delivered`), `decided_by`, `decided_at`, `created_at`,
   `audit_correlation_id`. Effective status = latest event.

`commitments` spreads `universal()`; `mandate_holders` and `mandate_holder_charters` inline their
lifecycle `status`; `commitment_status_events` is append-only (no `universal()`). All use
`pkId()`, `enumCheck()`, and targeted indexes.

## Follow-through mechanism

The hook that converts political self-interest into public accountability:

1. Office-holder files a **commitment** (a `claim` submission + `commitments` row) with a
   verifiable `success_criterion` and `due_at`.
2. To close it, the office-holder files a **resolution claim** (another `'claim'` submission)
   asserting the criterion was met, attached to evidence.
3. Citizens contribute evidence **for or against** the resolution (existing `contribute/evidence`
   flow). Reviewers + policy-as-code (`representative/status.rego`) adjudicate.
4. An approved resolution produces a terminal `commitment_status_events` row
   (`delivered` / `partial` / `not_delivered`); `overdue` is system-derived when `due_at` passes
   with no terminal event. Each transition is a §26.3 audit event.
5. The office-holder never writes a terminal status themselves. Completion is an audited,
   reviewable claim — exactly the §19 path reused, scoped to a new subject.

## Surfaces

- **Public read (no auth, ships now):** `/mandate-holders` index, `/mandate-holders/:id` (the
  platform-as-projection: claims, commitments with effective status, evidence, audit, answered
  questions), `/commitments/:id` (detail + status timeline + resolution evidence), and a
  **scorecard** module (pure counts, every number deep-linked).
- **Official drafting (behind identity):** `apps/admin` — file/edit commitments, file resolution
  claims, answer public questions. Uses `verified_official` identity; dev stub now, M10 real
  identity later.
- **Capability tag:** every mandate-holder surface carries `[accountability, not endorsement]`
  alongside the existing `[public-read]` / `[verifiable]` tags. The system favors no official;
  any `verified_official` with an active mandate-holder + accepted charter may publish.

## Policy (`packages/policy-rules`)

- **`representative/access.rego`** — `allow`: the citizen is `verified_official` **and** holds an
  `active` `mandate_holders` row **and** has an `accepted` charter.
- **`representative/status.rego`** — `allow_terminal`: terminal status transitions require an
  approved resolution claim; the office-holder cannot self-assign `delivered`; `overdue` is
  non-discretionary.
- **Anti-endorsement rule** — no policy output is a ranking, grade, or comparative score across
  officials. The scorecard is a fact projection, not an evaluation.

All three ship with real `opa eval` decision tests in `packages/policy-rules/test/`, per repo
convention. Phase 1 ships the modules + tests only; wiring into a write route is Phase 2.

## Relationship to M10–M15 and the public launch

- **Public read surfaces need no auth and none of M10–M15** — they are trust anchors, exactly like
  `/transparency`, `/audit`, `/verify`. They can ship on the read-only public-edge track in
  parallel with productionization.
- **Official drafting needs `verified_official` identity.** Dev runs on the existing identity stub
  (`IDENTITY_DEV_TOKENS`); production drafting gates on **M10** (real OIDC). Until M10, the
  drafting surface is demonstration-only (labeled), while public reads are live.
- Composes with **M2** (deliberation on commitments) and **M9/M15** (chartered pilot officials).

## Firewall — explicit non-goals

None of the following is built in this product, on this brand, or against this audit chain:
microtargeting, message/persuasion generation, GOTV tooling, donor or fundraising features,
opponent research, win-probability or electoral-scoring models. If any is ever wanted it must be a
**separate legal entity, separate brand, separate data store**, with the relationship publicly
disclosed — and it must never share this audit trail, because doing so destroys the trail's
evidentiary value. This firewall is a load-bearing wall, not a preference.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Surface read as endorsement of a featured official | Neutrality by structural absence; any verified official may publish; `[accountability, not endorsement]` tag; no ranking. |
| Commitments gamed / never resolved | Follow-through-not-self-reported invariant; `overdue` is system-derived and public; scorecard shows outstanding counts. |
| Private constituent data exposed in commitment evidence | §26.4 redaction; commitment evidence defaults to `restricted`/`private` visibility where it identifies constituents. |
| Political pressure to alter or delete the record | Append-only §26.3 audit; no UPDATE/DELETE on commitments or status events. |
| "AI will run the state" perception | Officials remain the actors; policy-as-code only adjudicates evidence status; humans accountable (§28 guardrail). |

## Decisions (resolved)

- **Terminology:** `mandate-holder` (table `mandate_holders`; routes/types use `mandate-holder` /
  `mandate_holder`). Distinct from `mandates` (legal basis).
- **Scope:** any `verified_official` (not local-council only).
- **Charter enforcement:** an accepted `mandate_holder_charters` row must precede any commitment
  (publish-requires-charter). Phase 1 seeds it accepted; `representative/access.rego` ships as a
  tested skeleton wired into the write route in Phase 2.
