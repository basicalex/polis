# Minimal pilot backend plan

Status: **planning document only.** No partner has signed, no deployment is
authorized, and the NO-GO decision in `GO_LIVE_READINESS.md` (2026-08-10)
stands. This document exists so that when a partner signs, the build starts
from a decided shape instead of a debate. Written 2026-08-26.

## Scope

One real municipality, one report category, one responsible office, one
independent reviewer. The loop the backend must carry is exactly the loop the
public demo already shows: a resident files a report, the office accepts
responsibility, the office files a commitment, an independent reviewer accepts
or returns it, and a public receipt is published. Nothing else.

## The case object

The demo store (`apps/web/src/lib/demo-store.mjs`) models the whole loop as
one record with one status field:

```
open → assigned → commitment-pending-review → returned | published
```

with an append-only event trail spanning the five stages (voice,
responsibility, response, check, receipt). The pilot backend adopts this shape
as its primary object: one `trace_records` table (record id, category,
subject, narrative, origin, status, timestamps) plus one `trace_events` table
(record id, stage, actor, action, note, created at, hash link to the previous
event).

This is a deliberate departure from `packages/db/src/schema.ts`, which spreads
the same loop across separate `complaintCases`, `claims`, `commitments`,
`commitmentStatusEvents`, `submissions`, and `reviews` tables with no shared
case identifier — the exact gap `docs/reviews/prime/2026-08-14-baseline.md`
(point 2) flags. The pilot does not migrate that schema; it adds the unified
object for the pilot loop and leaves the old tables untouched. If the pilot
succeeds, the old model is projected into the new one, not the reverse.

Rules enforced in the data layer, not the UI (same as the demo store):

- A commitment enters `commitment-pending-review`. Only the reviewer role can
  move it to `published` or `returned`. Officials never set terminal status.
- A return requires a note.
- Events append; nothing is edited or deleted. Corrections are new events.
- The public projection exposes the record status, the event trail, the
  responsible office, and the commitment text. It never exposes the
  resident's identity or contact data.

## Reuse map

| Existing service | Role in the pilot | Condition |
| --- | --- | --- |
| `platform-api` | BFF fronting the public site and the queue surfaces | trimmed to pilot routes |
| `citizen-identity-service` | resident sessions via magic link; staff/reviewer via OIDC | real code today; needs SMTP for magic links and a production OIDC issuer — both open gates |
| `contribution-service` | commitment filing and review decisions | filing-status fix landed 2026-08-26: commitments now file as pending and only reviewer approval promotes them |
| `audit-service` | append-only hash-chained log backing the public receipt | as is |

Role authorization (who is an official, who is the reviewer) is a static
config for one municipality — a mapped OIDC role or an allowlist — not a
general permissions system.

Known gap: `governance-graph-api` reads commitment rows directly without
checking submission status, so it would show unreviewed commitments if used
as the public read path. The pilot's public projection must read through the
review gate (or through the new case object), not through that service.

## Cut for the pilot

Not deployed, not integrated, not blocking: `rewards-service`, `ai-gateway`,
`vc-issuer-service`, `citizen-vault-service`, `document-signing-service`,
the cryptographic proof stack (`canonicalization-service`,
`timestamp-service`, `signature-service`, `proof-service`), `polis-bridge-service`,
`paperless-adapter`, `complaints-service` (the pilot's case object replaces it
for this loop), and initially `governance-graph-api`. Evidence attachments in
the pilot are links and plain uploads with a size cap, not proof-registered
documents. `hash-linked`, not `immutable`, remains the only claim made about
the trail.

## What this document does not decide

These gates come from `GO_LIVE_READINESS.md` and
`docs/partners/pilot-charter-template.md` and stay open until a real partner
signs a charter:

- named operational owners and backups (deployment, security/incident,
  backup, restore, DNS/TLS) — real people, not project roles;
- a production OIDC provider and role mapping;
- legal and privacy review: resident reports are personal data under GDPR;
  the municipality is the controller, Polis the processor; a processing
  agreement, retention terms, and a redaction path are required before the
  first real report;
- dated backup and restore evidence;
- monitoring and an incident/rollback procedure;
- an independent go/no-go review of the deployment.

The independent reviewer for the pilot must be named in the charter and must
not report to the office whose commitments they review. Recruiting and
coordinating this person is part of the pilot offer, not the municipality's
problem to solve alone.

## Appendix: charter worksheet (hypothetical, unsigned)

The fields below follow `docs/partners/pilot-charter-template.md`, filled
hypothetically for a small Istrian municipality to make the eventual charter
conversation a one-sitting exercise. **Nothing here is agreed, offered, or
implied.** Općina Vrsar is a pilot target only; its name never implies
engagement, authorization, transferred data, deployment, or outcome.

- Partner: _unsigned_ (target profile: općina, ~2,000 residents, existing
  municipal website able to host an embed).
- Scope: one category (e.g. public lighting or local roads), one office.
- Duration: 6 months from first published receipt, then a written
  continue/sunset decision.
- Success measures: number of published receipts; share of filed reports
  reaching a terminal status inside the pilot window; a statement from the
  office on inbound-channel load. No invented baselines.
- Data categories: report subject and narrative (public after redaction
  check), resident contact (private, retention-bound), staff and reviewer
  identity (public on the record by role, name per charter decision).
- Retention: resident contact data deleted 90 days after the pilot's sunset;
  public records archived read-only.
- Rollback trigger: any personal-data exposure on the public projection, or
  the partner's written request. Rollback is: public site to static archive,
  filing closed, data export delivered.
- Sunset terms: public records stay readable at a permanent address or are
  handed to the municipality as a static archive; the municipality chooses.
- Owner fields (deployment, security, backup, restore, DNS/TLS): _blank —
  must be named people before launch; the launch gate in the template
  requires it._
