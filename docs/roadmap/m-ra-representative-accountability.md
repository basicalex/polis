# Polis Interface — M-RA: Representative Accountability

Companion to [`polis_interface_full_system_spec.md`](../../polis_interface_full_system_spec.md) and
to [`docs/architecture/representative-accountability.md`](../architecture/representative-accountability.md)
(architecture + invariants + data model; this doc owns the build plan). M-RA is a **parallel
capability track**, not part of the M10–M15 productionization sequence: its public-read surfaces
need no auth and none of M10–M15, exactly like the other trust anchors. It extends §11 (graph
ontology), §19 (contribution/review), §21 (identity), §26 (audit), §28 (communication).

## Goal

Office-holders publish their positions and commitments as **audited, evidence-anchored objects in
the existing graph**, tracked against reality, so political self-interest is routed through public
accountability. A politician gains standing only by filing checkable claims and surviving
follow-through review — never by self-declaring completion. No persuasion/targeting/GOTV is built.

**Spec refs:** §11 (graph: roles/mandates), §12 (evidence), §15 (proof), §19 (contribution/review
adjudication), §21 (identity: `verified_official`), §26 (audit), §28 (communication). Proposes a
new spec section (e.g. §31 Representative Accountability) for full spec integration; this doc is
the pre-spec engineering plan.

## Invariants (inherited + M-RA-specific)

Carries every cross-cutting invariant from `m2-m9-detail-plans.md` / `productionization-overview.md`
(§23 public edge, Drizzle source of truth, §26.3 append-only hash-chained audit, OPA/Rego
policy-as-code, stack split, project TS rules, ports). M-RA adds (see architecture doc for full
rationale):

1. **Follow-through is never self-reported** — terminal commitment status requires an approved
   resolution claim through the §19 review queue; the office-holder cannot set `delivered`.
2. **Status is append-only, latest-row-wins** — `commitment_status_events`, mirroring
   `reviews` / `ai_review_queue` / `proof_supersessions`; `overdue` is system-derived.
3. **The scorecard is pure fact, never a grade** — counts by status, every number deep-linked to
   evidence; no ranking/score/win-probability.
4. **Publication requires a verified, active mandate-holder with an accepted charter** —
   `verified_official` (§21) holding an `active` `mandate_holders` row with an accepted
   `mandate_holder_charters` row, whose scope covers the commitment's process/jurisdiction.
5. **No persuasion primitive, ever** — no targeting/messaging/GOTV/donor/opponent tooling in this
   product (firewall; separate entity if ever wanted).

## Services & packages

No new service — extends two existing ones (idiomatic: the repo prefers extending over spawning).

- **`services/governance-graph-api` (:8100)** — new read routes for mandate-holders, commitments,
  and the mandate-holder projection + scorecard (reads, like the existing §11 graph reads).
- **`services/contribution-service` (:8450)** — the commitment/resolution **write + review** path.
  A commitment is a `'claim'` `submission` (type already exists) plus a `commitments` row; a
  resolution is another `'claim'` submission. Status events are produced on review approval — the
  existing §19 path, scoped to a new subject.
- **`packages/db`** — schema migration: `mandate_holders`, `mandate_holder_charters`,
  `commitments`, `commitment_status_events`.
- **`packages/policy-rules`** — `representative/access.rego`, `representative/status.rego` + tests.
- **`apps/web`** — public read surfaces (`/mandate-holders`, `/mandate-holders/:id`,
  `/commitments/:id`, scorecard module), `[accountability, not endorsement]` tag.
- **`apps/admin`** — official drafting surface (file commitments, file resolutions, answer
  questions). Demonstration until **M10** (real `verified_official` identity); public reads are live.
- **`services/platform-api` (:8080, BFF)** — public route proxy + auth gate for drafting routes.

## Schema (`packages/db`, migration `0009_mandate_holder_v0.sql`)

Four tables. `commitments` spreads `universal()` for audit/ownership (its generic `status` is
unused for the lifecycle — effective status is derived). `mandate_holders` and
`mandate_holder_charters` inline a constrained lifecycle `status` instead of `universal()` —
`universal()`'s generic `status` is a plain nullable column with no default/notNull, so it cannot
carry the lifecycle (mirrors `submissions`). The append-only `commitment_status_events` uses
explicit `created_at` columns (mirroring `reviews` / `proof_revocations` — `universal()`'s
`updated_at` would break append-only and its `status` would duplicate the event status).

```
mandate_holders
  id pk, citizen_id (→ citizens), role_id (→ roles), jurisdiction_id (→ jurisdictions),
  display_name text notNull, starts_at timestamptz notNull, ends_at timestamptz (null = current),
  status text notNull default 'active',   -- CHECK active|ended|revoked (inlined; NOT universal())
  created_at/updated_at/created_by_user_id/audit_correlation_id  -- inlined audit columns

mandate_holder_charters                       -- accepted charter must precede any commitment
  id pk, mandate_holder_id (→ mandate_holders) notNull,
  charter_doc jsonb, status text notNull default 'pending',   -- CHECK pending|accepted|withdrawn
  created_at/updated_at/audit_correlation_id  -- inlined; NOT universal()

commitments
  id pk, claim_id (→ claims) notNull,          -- claim.claimType = proposal_assertion|public_statement (existing)
  mandate_holder_id (→ mandate_holders) notNull,
  process_id (→ processes), jurisdiction_id (→ jurisdictions),
  success_criterion text notNull, due_at timestamptz,
  + universal()   -- effective status DERIVED from commitment_status_events; not stored here
  index(mandate_holder_id), index(due_at)

commitment_status_events                       -- append-only; latest row per commitment wins
  id pk, commitment_id (→ commitments) notNull,
  status text notNull,                         -- CHECK proposed|in_progress|delivered|partial|not_delivered|overdue
  resolution_claim_id (→ claims),              -- required non-null for terminal delivered|partial|not_delivered
  decided_by text, decided_at timestamptz notNull defaultNow(),
  created_at timestamptz notNull defaultNow(), audit_correlation_id text
  -- explicit append-only columns; NO universal() (updated_at/status would break append-only); mirrors reviews/proof_revocations
  index(commitment_id)
```

**No new `CLAIM_TYPES` value.** A commitment references an existing claim of `claim_type`
`proposal_assertion` (a pledge) or `public_statement`. A dedicated `commitment` claim type, if
ever wanted, is a separate `CLAIM_TYPES` CHECK-enum migration and is explicitly out of scope here.

Effective commitment status = latest `commitment_status_events` row; `overdue` is derived
(non-discretionary) when `due_at` has passed and the latest event is non-terminal
(`proposed` | `in_progress`).

## API

**Public via BFF (`platform-api`, no auth — trust anchors):**
- `GET /api/v1/mandate-holders` — office-holders with active mandate-holders in a jurisdiction.
- `GET /api/v1/mandate-holders/:id` — the projection: claims, commitments (effective status),
  evidence links, audit links, answered questions.
- `GET /api/v1/commitments/:id` — detail + status timeline + resolution evidence + proof links.
- `GET /api/v1/mandate-holders/:id/scorecard` — pure-fact counts by status, deep-linked.

**Drafting via BFF (auth-gated, `verified_official` + active mandate-holder + accepted charter; demonstration until M10):**
- `POST /api/v1/mandate-holders/:id/commitments` — file a commitment (claim + commitments row).
- `POST /api/v1/commitments/:id/resolutions` — file a resolution claim (status set by review, not caller).

**Internal:** graph-api serves the read routes above from Postgres; contribution-service owns the
write/review path (extending its existing submission/review handlers) and emits status events on
approval. No new internal service contract beyond these.

## Policy (`packages/policy-rules`)

- `representative/access.rego` — `allow`: citizen is `verified_official` **and** holds an
  `active` `mandate_holders` row **and** has an `accepted` charter whose jurisdiction/process
  covers the commitment.
- `representative/status.rego` — terminal transitions require an approved resolution claim; caller
  cannot self-assign `delivered`; `overdue` derivation is non-discretionary.
- **Anti-endorsement rule** — no policy output is a ranking, grade, or comparative score across
  officials (structural absence; enforced by what the policy does *not* compute).
- Real `opa eval` decision tests in `packages/policy-rules/test/` for both modules.

## Audit (§26.3)

Public-visibility, hash-chained events (best-effort, never blocking):
`representative.holding.started`, `representative.holding.ended`,
`representative.commitment.published`, `representative.commitment.status_changed`.
Commitment evidence that identifies constituents defaults to `restricted`/`private` and is
redacted in the public §26.4 view.

## Web

- `apps/web`: `/mandate-holders` index, `/mandate-holders/[id]` projection, `/commitments/[id]`
  detail + timeline, scorecard module on the mandate-holder page. Every surface carries
  `[accountability, not endorsement]` + the existing `[public-read]`/`[verifiable]` tags, and
  cross-links to `/audit`, `/proofs`, `/verify`, `/methodology`.
- `apps/admin`: official drafting (commitments, resolutions, Q&A) — demonstration-labeled until M10.

## Acceptance

Each criterion maps 1:1 to a check; the negative (no-persuasion) one is a structural assertion.

- A `verified_official` with an active mandate-holder + accepted charter can publish a commitment
  as an evidence-anchored claim ✓
- The public reads commitments + effective status + scorecard **without auth** ✓
- An office-holder **cannot** set a commitment to `delivered` directly; a terminal status appears
  only after an approved resolution claim ✓
- Status history is append-only; `overdue` is system-derived when `due_at` passes ✓
- The scorecard contains only counts deep-linked to evidence/audit — no grade or ranking ✓
- **Negative:** no route, table, or policy computes targeting/messaging/GOTV/donor/win-probability
  (structural absence) ✓
- `scripts/phase-mra-acceptance.mjs` (mirrors `phase8/9-acceptance.mjs`) exercises the read path
  (Phase 1) + the file→review→status flow (Phase 2) against a seeded simulated mandate-holder ✓

## Phasing

1. **Model + read layer (Phase 1 — this plan)** — migration + 4 tables; graph-api + BFF read
   routes; web read surfaces; policy skeleton + tests; seed a simulated mandate-holder (Grad
   Primjer) with accepted charter + 2 commitments (one `delivered`, one `in_progress`).
2. **Adjudication** — resolution/review flow in contribution-service; `status.rego`; `overdue`
   derivation; status events on approval.
3. **Surfaces** — drafting surface (`apps/admin`, demonstration until M10); scorecard deep-links.
4. **Governance** — `access.rego` wired into the write route; charter enforcement; redaction
   defaults for constituent-identifying evidence; `[accountability, not endorsement]` tag.
5. **Pilot** — simulated official mandate, then a real chartered official (post-M10).

## Out of scope

- Real persistent official identity (M10) — drafting is demonstration until then; public reads ship now.
- Persuasion / messaging / targeting / GOTV / donor / opponent-research / win-optimization
  (firewall — separate entity if ever, never on this brand/audit).
- Multi-jurisdiction rollout; localization; on-chain anything.

## Depends on

- M1 (governance graph, audit chain, BFF proxy pattern) — hard.
- M6 (contribution/review) — hard, for the adjudication path.
- Composes with M2 (deliberation on commitments) and M9/M15 (chartered pilot).
- Official **drafting** gates on M10 (real `verified_official` identity); public reads do not.
