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
configuration, one report category, one responsible office, and one
synchronous automated compliance pass. Synthetic accounts and data, operated
only by controlled test operators, supply that configuration. It has no real
municipality partner; no municipal agreement, signed charter, public release,
or real municipality authorization is implied.

The controlled environment may exercise a real server, persistence,
authentication, authorization, public visibility, hold and release controls,
security controls, backups/recovery, mail/login, and monitoring. Any result
proves pre-partner engineering only. It does not change the municipal **NO-GO**
in `GO_LIVE_READINESS.md`, authorize a real-municipality release, or satisfy a
real charter, legal/privacy, named-owner, external-release, or explicit
authorization gate.

Report text is public at filing after a synchronous automated compliance pass.
A held report keeps a public shell with its hold reason and original-text hash.
An official may release the text as filed or publish a redacted version; each
action is a logged public event. Contact data and attachments stay restricted.

The responsible official publishes a commitment under their name and title.
The office reports completion with evidence. The filer may dispute that claim,
followers may mark it not fixed, and the official may reopen the work. A
`form-letter` label is a soft public label, never a block.

This pre-partner gate excludes rewards, vault, Paperless, and the
cryptographic/proof stack. AI may only filter text or propose intake fields; it
does not decide publication, case state, responsibility, or truth.
Vrsar-Orsera (Općina Vrsar-Orsera) is a sourced example configuration for the
communal unit, documented from official sources in [Vrsar source notes](vrsar-source-notes.md). It
does not imply participation, real data, named people, incident, agreement,
authorization, or result.

## Historical partner-scope baseline

## Scope

One real municipality, one report category, and one responsible office. The
loop the backend must carry is exactly the loop the public demo is moving
toward: a resident files a report, its text publishes unless held, the office
accepts responsibility, the official publishes a signed commitment and
completion evidence, and the public can dispute or mark the result not fixed.

## The case object

The demo store (`apps/web/src/lib/demo-store.mjs`) models an older
commitment-publication loop. The pilot case object uses:

```
open → assigned → answered → resolved
resolved → disputed → answered | resolved
```

Text visibility is separate: `public`, `held`, or `redacted`. Hold, release,
redaction, label, dispute, reopen, and closure actions append public events.
The state names and transition rules follow the
[trace API contract](trace-api-contract.md).
The two paths share an append-only event trail spanning the five stages
(voice, responsibility, response, check, receipt). The pilot backend adopts
this shape as its primary object: one `trace_records` table (record id,
category, restricted subject, report narrative, filed location, text status,
hold reason, origin (`web`, `sms`, or `voice`), public case number, reopen-key
hash, process status, timestamps) plus one `trace_events` table (record id,
stage, actor, action, note, created at, hash link to the previous event).
Resident contact data and attachments remain restricted.

This is a deliberate departure from `packages/db/src/schema.ts`, which spreads
the same loop across separate `complaintCases`, `claims`, `commitments`,
`commitmentStatusEvents`, `submissions`, and `reviews` tables with no shared
case identifier — the exact gap `docs/reviews/prime/2026-08-14-baseline.md`
(point 2) flags. The pilot does not migrate that schema; it adds the unified
object for the pilot loop and leaves the old tables untouched. If the pilot
succeeds, the old model is projected into the new one, not the reverse.

Rules enforced in the data layer, not the UI:

- `commitment` moves `assigned` to `answered` and publishes the official's
  signed commitment at once.
- `resolution` moves `answered` or `disputed` to `resolved` with evidence.
  The filer may dispute a completion claim with the reopen key; followers may
  add one deduplicated `not-fixed` signal; the office may reopen the work.
- Events append; nothing is edited or deleted. Corrections are new events.
- The public projection exposes the filed or redacted text, or a public hold
  reason when text is held. It exposes signed commitments, evidence, status,
  disputes, labels, and public events. Resident identity, contact data,
  attachments, and private messages never enter it.

## Reuse map

| Existing service | Role in the pilot | Condition |
| --- | --- | --- |
| `platform-api` | BFF fronting the public site and the queue surfaces | trimmed to pilot routes |
| `citizen-identity-service` | resident sessions via magic link; staff via OIDC | real code today; needs SMTP for magic links and a production OIDC issuer — both open gates |
| `trace-service` | case creation, compliance, official commands, public checks, and public projections | bounded to the pilot policy and routes |
| `audit-service` | append-only hash-chained log backing the public receipt | as is |

Official authorization is static config for one municipality — a mapped OIDC
role or an allowlist — not a general permissions system.

Known gap: `governance-graph-api` reads commitment rows directly without
checking the pilot case policy, so it is not the public read path. The pilot's
public projection reads through the new case object.

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

The case shell and report text are public from creation unless the compliance
pass holds the text.

## What this document does not decide

These gates come from `GO_LIVE_READINESS.md` and
`docs/partners/pilot-charter-template.md` and stay open until a real partner
signs a charter:

- named operational owners and backups (deployment, security/incident,
  backup, restore, DNS/TLS) — real people, not project roles;
- a production OIDC provider and role mapping;
- legal and privacy review: resident contact data and held report text are
  personal data under GDPR; the municipality is the controller and Polis the
  processor; a processing agreement, retention terms, automated compliance,
  and official hold/release/redaction controls are required before the first
  real report;
- dated backup and restore evidence;
- monitoring and an incident/rollback procedure;
- an independent go/no-go review of the deployment.

The charter must name the official role, the public-text controls, and the
external release owner. Intrface is not a reviewer and does not decide whether
a report, commitment, or completion claim is true.

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
- Data categories: report text and filed location (public unless held, or
  redacted by a logged official action); resident contact and attachments
  (restricted, retention-bound); signed commitment, evidence, status,
  disputes, labels, and public events; official name and title (public).
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
