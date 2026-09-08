# Pre-partner readiness record

**Date:** 2026-09-05
**Status:** **Passed — controlled automated software validation.** All controlled automated check slots are fulfilled. This is not human acceptance, real-municipality approval, or launch authorization.

## Purpose and boundary

This record tracks controlled, synthetic pre-partner engineering evidence. It covers no real partner, real resident report, municipal intake, municipal account, outreach, public deployment, or municipal-system connection. The local test intake is functional and open after its controlled closure check; it is not a real or municipal intake.

Two decisions remain separate:

1. **Controlled automated software validation.** The bounded synthetic runtime and automated checks passed as recorded in the [evidence ledger](prepartner-evidence-2026-09-05.md).
2. **Human and authorized real-municipality acceptance.** This still needs a named partner, signed and approved charter and scope, legal, privacy, and security decisions, named human owners, independent release review, and explicit approval.

The real-municipality decision remains **blocked / NO-GO** under [`GO_LIVE_READINESS.md`](../../GO_LIVE_READINESS.md). Automated pre-partner validation does not amend it or claim a signed charter or public-launch authorization.

## Controlled configuration

| Field | Controlled entry |
| --- | --- |
| Municipality configuration | `vrsar-orsera` — `Općina Vrsar-Orsera` / `Comune di Orsera` / `Municipality of Vrsar-Orsera` |
| Category | `public-lighting` — `Javna rasvjeta` / `Illuminazione pubblica` / `Public lighting` |
| Responsible office configuration | `communal-system` — `Jedinstveni upravni odjel / Odsjek za komunalni sustav` / `Ufficio amministrativo unico / Sezione per il sistema comunale` / `Unified Administrative Department / Communal System Section` |
| Routing status | `inferred-test-only` |
| Independent reviewer | Unassigned human owner; test role must remain distinct from the office role |
| Data and accounts | Synthetic only; four controlled test identities |
| Content languages | Croatian (HR), Italian (IT), and English (EN) test UI |

The Vrsar-Orsera configuration and its official-source basis are recorded in [Vrsar-Orsera research notes](vrsar-source-notes.md). The [local pre-partner runbook](local-prepartner-runbook.md) defines the controlled runtime. The [source manifest](prepartner-source-manifest-2026-09-05.json) records the uncommitted source set. These records establish public context and controlled software scope only; they do not establish participation, approval, routing, a service commitment, or a delivery destination.

## Privacy and approval boundary

The original report subject, narrative, contact data, and attachments stay restricted. A public record may contain only separately drafted, independently approved public material. Redaction does not make the original narrative public.

Publishing a commitment does not resolve a record. `resolved` needs separate evidence and independent review. Office staff cannot approve their own commitment, evidence, publication, or terminal resolution. The state rules and resolution-return behavior follow the [trace API contract](trace-api-contract.md).

Local captured SMTP is not external delivery evidence. The automated authentication scope validates TLS-sourced OIDC claims; it does not verify ID-token signatures.

## Verification ledger

| Check | Current evidence | Status |
| --- | --- | --- |
| Source base, hash manifest, and code state | E10 links the 111-file manifest, base, branch, and fingerprint. | Recorded; uncommitted working tree, no CI, commit, push, deployment, or signed artifact |
| Durable persistence | E7 records fresh local encrypted recovery; E13 records cold start. | Passed — automated, local; off-host recovery unrun |
| Restart | E8 records session, private/public state, and logout checks across restart. | Passed — automated, local |
| Concurrency | E4 and E11 record targeted and final whole-workspace test results. | Passed — controlled automated validation |
| Idempotency | E4 and E11 record targeted and final whole-workspace test results. | Passed — controlled automated validation |
| Privacy boundary | E5 and E6 record automated review and browser checks. | Passed — controlled automated validation; human legal/privacy decision unrun |
| Role separation | E2, E5, and E6 record controlled roles and automated review. | Passed — controlled automated validation |
| Backup and recovery | E7 records fresh local encrypted recovery and tamper detection. | Passed — automated, local; off-host recovery unrun |
| Mail delivery | E2 and E6 record controlled local captured SMTP. | Passed — automated, local; external provider acceptance unrun |
| Login | E6 and E8 record browser authentication, session, and logout checks. | Passed — automated, local |
| Monitoring | E15 records an owned-process readiness probe. | Passed — automated, local; external paging unrun |
| Intake closure and fail-closed behavior | E14 records health, closed intake, cleanup, and reopened intake checks. | Passed — automated, local; no real or municipal intake |
| Croatian (HR) content | E6 and E9 record functional and narrow visual coverage. | Passed — automated; native editorial approval unrun |
| Italian (IT) content | E6 records functional coverage. | Passed — automated, functional; no Italian screenshot claim; native editorial approval unrun |
| English content | E6 and E9 record functional and narrow visual coverage. | Passed — automated; English is a test-convenience language |
| Mobile behavior | E6 and E9 record phone coverage and narrow public-receipt review. | Passed — automated; human usability unrun |

E11 records final whole-workspace build and typecheck exit 0, 425 workspace tests passed with 0 failures and 0 skips, operations 13 passed, catalog 9 passed, and 19 services valid. Local public-release QA passed again under local Wrangler preview only; it did not deploy anything. The [evidence ledger](prepartner-evidence-2026-09-05.md) records commands, safe artifact names, and scope limits.

## Ownership and remaining limits

| Responsibility | Human owner | Backup owner |
| --- | --- | --- |
| Controlled-run operator | Unassigned | Unassigned |
| Security and privacy decision | Unassigned | Unassigned |
| Backup and recovery | Unassigned | Unassigned |
| Independent acceptance review | Unassigned | Unassigned |
| Real-municipality release approval | Unassigned | Unassigned |

Human usability validation, native HR and IT editorial approval, legal and privacy decisions, off-host recovery, external provider acceptance, contracts, real owners, signed charter and scope, municipal agreement, and independent real-release approval remain unrun. This record supplies no real-release evidence.
