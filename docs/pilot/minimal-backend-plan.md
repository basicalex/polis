# Minimal pilot backend plan

Status: **planning document only.** No partner has signed, no real-municipality
deployment is authorized, and the NO-GO decision in `GO_LIVE_READINESS.md`
(2026-08-10) stands. The historical material sets out the post-charter shape.
The dated pre-partner decision below authorizes bounded engineering, not a
release. Written 2026-08-26.

## 2026-09-05 decision: synthetic pre-partner engineering

The historical partner-planning material below remains a record of the
post-charter shape. Before any agreement, the authorized scope is instead one
synthetic, controlled engineering configuration: one municipality
configuration, one report category, one responsible office, and one distinct
independent reviewer. Synthetic accounts and data, operated only by controlled
test operators, supply that configuration. It has no real municipality
partner; no municipal agreement, signed charter, public release, or real
municipality authorization is implied.

The controlled environment may exercise a real server, persistence,
authentication, authorization and role separation, security controls,
backups/recovery, mail/login, and monitoring. Any result proves
pre-partner engineering only. It does not change the municipal **NO-GO** in
`GO_LIVE_READINESS.md`, authorize a real-municipality release, or satisfy a
real charter, legal/privacy, named-owner, independent-release, or explicit
authorization gate.

Original report subject and narrative, resident contact data, and attachments
are restricted. A public entry is separately drafted; independently approved
public summary, commitment, evidence, and status are the only material that
may publish. A redaction check never makes the original subject or narrative
public.

Independent approval may publish a commitment, but publication does not make a
record `resolved`. A `resolved` status requires separate evidence and
independent review. The responsible office cannot self-approve any
review-controlled record or terminal resolution.

This pre-partner gate excludes AI, rewards, vault, Paperless, and the
cryptographic/proof stack. It makes no source or service-implementation claim.

Vrsar-Orsera (Općina Vrsar-Orsera) is a sourced example configuration for the
communal unit, documented from official sources in [Vrsar source notes](vrsar-source-notes.md). It
does not imply participation, real data, named people, incident, agreement,
authorization, or result.

## Historical partner-scope baseline

## Scope

One real municipality, one report category, one responsible office, one
independent reviewer. The loop the backend must carry is exactly the loop the
public demo already shows: a resident files a report, the office accepts
responsibility, the office files a commitment, an independent reviewer accepts
or returns it, and a public receipt is published. Nothing else.

## The case object

The demo store (`apps/web/src/lib/demo-store.mjs`) models the historical
commitment-publication loop as one record with one status field:

```
open → assigned → commitment-pending-review → returned | published
```

It does not model a `resolved` status. The pre-partner plan requires a separate
resolution transition after publication:

```
published → resolution-pending-review → resolved
resolution review return → published + private feedback event
```

The state names and return rule follow the [trace API contract](trace-api-contract.md).
The two paths share an append-only event trail spanning the five stages
(voice, responsibility, response, check, receipt). The pilot backend adopts
this shape as its primary object: one `trace_records` table (record id,
category, restricted original subject, restricted original narrative, origin,
status, timestamps) plus one `trace_events` table (record id, stage, actor,
action, note, created at, hash link to the previous event). Resident contact
data and attachments remain restricted.

This is a deliberate departure from `packages/db/src/schema.ts`, which spreads
the same loop across separate `complaintCases`, `claims`, `commitments`,
`commitmentStatusEvents`, `submissions`, and `reviews` tables with no shared
case identifier — the exact gap `docs/reviews/prime/2026-08-14-baseline.md`
(point 2) flags. The pilot does not migrate that schema; it adds the unified
object for the pilot loop and leaves the old tables untouched. If the pilot
succeeds, the old model is projected into the new one, not the reverse.

Rules enforced in the data layer, not the UI (same as the demo store):

- A commitment enters `commitment-pending-review`. Only a distinct independent
  reviewer can move it to `published` or `returned`; the office cannot
  self-approve any review-controlled record.
- `published` means the commitment may be public, not that the record is
  `resolved`. The office may file resolution evidence but cannot approve it.
  Only the distinct independent reviewer can move
  `resolution-pending-review` to `resolved`. A resolution review return
  restores `published`, appends a required private feedback event, and permits
  resubmission.
- Events append; nothing is edited or deleted. Corrections are new events.
- The public projection exposes only independently approved public summary,
  commitment, evidence, and status. It never exposes original subject or
  narrative, resident identity or contact data, or attachments.

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
for this loop), and initially `governance-graph-api`. Evidence attachments are
restricted links or plain uploads with a size cap, not proof-registered
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
  agreement, retention terms, and a public-summary approval path are required
  before the first real report. Redaction does not make an original subject or
  narrative public;
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
implied.** Općina Vrsar-Orsera is a sourced example configuration, documented
from official sources in [Vrsar source notes](vrsar-source-notes.md), not a
partner; its name never
implies engagement, authorization, transferred data, deployment, or outcome.

- Partner: _unsigned_ (target profile: općina, ~2,000 residents, existing
  municipal website able to host an embed).
- Scope: one category (e.g. public lighting or local roads), one office.
- Duration: 6 months from first published receipt, then a written
  continue/sunset decision.
- Success measures: number of published receipts; share of filed reports
  reaching a terminal status inside the pilot window; a statement from the
  office on inbound-channel load. No invented baselines.
- Data categories: original report subject and narrative, resident contact,
  and attachments (restricted, retention-bound); separately drafted public
  summary, commitment, evidence, and status (public only after independent
  approval); staff and reviewer identity (public by role, name per charter
  decision).
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
