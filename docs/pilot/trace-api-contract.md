# Pre-partner trace API contract

Date: 2026-09-05. Implementation contract for an isolated, unofficial Vrsar example. This is not municipal authorization. Use synthetic reports and controlled test identities. The existing public-release demo stays read-only and unchanged.

## Boundary

One municipality (`vrsar-orsera`), one initial category (`public-lighting`), one configured responsible office, three mutually exclusive roles: `resident`, `official`, `reviewer`. Official/reviewer assignments are operator-controlled, never supplied by a browser. Public municipal facts are configuration with cited sources, not proof of partnership. No real official's name is a test identity.

The platform BFF exposes `/api/trace/*`; the new bounded trace service accepts only trusted internal requests. Reuse verified identity sessions and existing internal actor-header conventions. Authentication failure is 401, wrong role 403, inaccessible private records 404. Reject client identity/role/municipality authority fields. The configured municipality is server-owned.

Anonymous reads are config and reviewed public records only. All private responses and authentication responses are `Cache-Control: no-store`. No bearer token in query strings, analytics, public receipts, or logs.

## States

- `open`: resident filed a private report.
- `assigned`: the official accepted responsibility for the configured office.
- `commitment-pending-review`: the official proposed a public summary and a measurable commitment with a due date.
- `returned`: a reviewer returned the commitment with required private feedback; the official can revise and resubmit.
- `published`: independent review approved the public summary and commitment. This does NOT mean the reported problem is fixed.
- `resolution-pending-review`: the official submitted completion evidence for independent review. The public record retains the previously approved commitment/status until review.
- `resolved`: a distinct reviewer approved the completion evidence.

Returning resolution evidence restores `published` and records required private feedback. Resubmission is allowed. No official may approve publication or resolution. A reviewer cannot review any record they filed or materially acted on as an official, even if their configured role later changes. A role mapping cannot grant official and reviewer simultaneously.

## Data and transactions

Use additive Postgres tables for trace records, private report material, append-only events, command idempotency, and private attachments. Do not migrate or repurpose the older complaint/claim/commitment models.

Every successful command locks its record and atomically writes state, event, and idempotency result. Events carry a per-record sequence, previous hash, and canonical event hash. Corrections append; no update/delete event API. Verification must detect changed payloads, broken links, omitted sequence entries, and record/event state mismatch where applicable. Call the trail `hash-linked`, not immutable. A separate remote audit call cannot substitute for the authoritative transactional record event.

Every write accepts `Idempotency-Key` (UUID) and, except creation, `expectedVersion` (integer). Same actor/key and same request returns the original result without new events; same key with different input is 409. A stale version is 409 with a stable error code. Scope replay authorization to the current authenticated actor and record access. Generate identifiers and timestamps on the server.

Private fields: original subject, narrative, location detail, resident identity/contact, raw upload bytes, staff/reviewer private feedback, internal actor identifiers. They never appear in public serialization, public event descriptions, public exports, client error responses, or application logs. Authorized private views and protected backups are separate channels. A separate public summary, commitment, and public evidence note/links must be deliberately drafted and independently approved before publication. Public event history uses a strict allowlist with role labels and milestone timestamps, not copies of private event payloads.

## Endpoints

All paths below start with `/api/trace`. Handler errors use `{ "error": "stable_code", "message": "safe explanation" }`. Shared runtime and transport errors may omit `message`; clients translate the stable error code into HR/IT/EN and use a localized generic fallback for unknown codes. Lists use `{ "records": [...] }`; a record response uses `{ "record": ... }`.

| Method | Path | Access | Request / result |
| --- | --- | --- | --- |
| GET | `/config` | public | `{ municipality, category, office, testEnvironment: true, intakeOpen, sources }`; configuration has HR/IT/EN display labels and official source URLs. |
| GET | `/session` | signed in | `{ actorId, role, municipalityId }`; email may be absent or null. Role comes from server mapping, not browser claims. |
| GET | `/records` | signed in | Resident sees their own records. Official/reviewer sees this municipality's work queue. Never cross-municipality records. |
| POST | `/records` | resident | `{ subject, narrative, location, contactEmail? }`; category and municipality fixed server-side. Returns 201 record. |
| GET | `/records/:id` | owner or configured staff/reviewer | Private record and private event history. |
| POST | `/records/:id/assign` | official | `{ expectedVersion }`; assigned office is server configuration, not arbitrary client authority. |
| POST | `/records/:id/commitment` | official | `{ expectedVersion, publicSummary, commitment, dueDate }`; only assigned/returned state. |
| POST | `/records/:id/review` | reviewer | `{ expectedVersion, decision: "accept" | "return", note }`; required note for return. Accept explicitly attests to privacy review of the proposed public text. |
| POST | `/records/:id/resolution` | official | `{ expectedVersion, evidenceNote, evidenceUrls }`; only published state, evidence required. URLs are HTTPS, no embedded credentials; never fetch remote URLs server-side. |
| POST | `/records/:id/resolution-review` | reviewer | `{ expectedVersion, decision: "accept" | "return", note }`; return requires a private note. |
| POST | `/records/:id/attachments` | owner/official | `{ expectedVersion, filename, contentType, base64 }`; private only, bounded bytes and allowed types, SHA-256 receipt. No HTML/SVG/executable uploads. |
| GET | `/records/:id/attachments/:attachmentId` | authorized private record reader | Download only, attachment disposition, nosniff, no-store. |
| GET | `/public/records` | public | Reviewed public projections only, no pagination-free unbounded database dump. |
| GET | `/public/records/:id` | public | Approved summary, office, approved commitment/due date, approved evidence when resolved, public status, sanitized public events, public receipt hash. Unpublished records return 404. |

## Response shape

Private record fields: `id`, `municipalityId`, `category`, `status`, `version`, `subject`, `narrative`, `location`, `contactEmail`, `office`, `publicSummary` (proposal), `commitment` (proposal), `dueDate`, `evidenceNote` (proposal), `evidenceUrls` (proposal), `createdAt`, `updatedAt`, `events`, `attachments`. Actor ownership fields may be available privately for authorization but are never public.

An event exposes privately: `id`, `sequence`, `stage`, `action`, `actorRole`, `note`, `createdAt`, `previousHash`, `hash`. Stages are `voice`, `responsibility`, `response`, `check`, `receipt`. Private event payloads may contain original command data for integrity verification, but public output uses a separate projection.

Public fields: `id`, `municipalityId`, `category`, `office`, `status` (`published` or `resolved`), approved `publicSummary`, approved `commitment`, `dueDate`, approved `evidenceNote`/`evidenceUrls` only after resolution approval, `publishedAt`, `resolvedAt`, sanitized `events`, `receiptHash`, `testEnvironment: true`. While resolution review is pending or returned, public state stays at the last approved publication. Do not derive public fields from unapproved mutable proposal fields.

Bound and validate every string, list and upload. Reject unknown authority fields. Dates must be valid date-only values, not merely strings. Service configuration must fail closed if required internal credentials or role mapping are absent or contradictory.

## Public receipt hash

`receiptHash` is lowercase hexadecimal SHA-256 of UTF-8 canonical JSON. Sort object keys lexicographically at every depth and preserve array order. Hash only `id`, `municipalityId`, `category`, `office`, `status`, `publicSummary`, `commitment`, `dueDate`, `evidenceNote`, `evidenceUrls`, `publishedAt`, `resolvedAt`, `events`, and `testEnvironment`; exclude `receiptHash` itself. The exported `buildReceiptHashMaterial`, `computeReceiptHash`, and `verifyReceiptHash` helpers implement this format. Matching a hash checks the supplied public record's consistency, not the truth of the report or the authenticity of a municipal decision.

## Isolated operation

A dedicated launcher uses a new loopback PostgreSQL database and explicit environment, with Bun automatic `.env` loading disabled. Never use the repository's existing `.env` or a production database by default. The test runtime may use locally captured SMTP delivery and a local OIDC acceptance fixture; neither is an actual municipal identity provider. The browser receives no magic token bypass or arbitrary role selector.

Intake can be closed through operator configuration: new reports are rejected with 503 `intake_closed`, while private reads, authorized follow-up, and published receipts remain available. Health/readiness checks must reflect database availability. Structured operational logging must omit tokens, report content, and contact information.

Recovery drills use only newly created test resources, verify ownership before cleanup, and compare full record/event/attachment state after restore. Do not call a local restore off-host evidence. No public deployment, DNS change, production SMTP/OIDC action, municipal outreach, or real resident intake is authorized by this contract.
