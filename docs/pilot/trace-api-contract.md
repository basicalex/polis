# Pre-partner trace API contract

Date: 2026-09-05. Updated 2026-09-16. Implementation contract for an isolated, unofficial Vrsar example. This is not municipal authorization. Use synthetic reports and controlled test identities. The existing public-release demo stays read-only and unchanged.

Policy source: docs/pilot/public-text-policy.md (2026-09-16)

## Boundary

One municipality (`vrsar-orsera`), one initial category (`public-lighting`), and one configured responsible office. Public municipal facts are configuration with cited sources, not proof of partnership. No real official's name is a test identity.

The platform BFF exposes `/api/trace/*`; the bounded trace service accepts only trusted internal requests. Reuse verified identity sessions and existing internal actor-header conventions. Authentication failure is 401, wrong role 403, inaccessible private records 404. Reject client identity, role, and municipality authority fields. The configured municipality is server-owned.

Anonymous reads expose config, public case shells, public records, and public events. All private and authentication responses are `Cache-Control: no-store`. No bearer token or reopen key may enter query strings, analytics, public receipts, or logs.

## Roles

`TraceRole` is `'resident' | 'official' | 'gateway' | 'system'`.

| role | authority |
| --- | --- |
| `resident` | Files a report. The filer may dispute a completion claim with the reopen key. |
| `official` | Assigns the office; publishes signed commitments and completion reports; closes cases; and holds, releases, redacts, or labels text. |
| `gateway` | Creates channel cases and appends channel messages through the trusted internal boundary. |
| `system` | Records the filing-time compliance hold and the standing resolved event. |

There is no reviewer role, review route, or self-review check. Official assignment is operator-controlled and never supplied by a browser.

## Process states

`TRACE_STATUSES` is:

| status | meaning | shell state |
| --- | --- | --- |
| `open` | filed, no office yet | `received` |
| `assigned` | an office accepted responsibility | `assigned` |
| `answered` | the official published a commitment | `answered` |
| `resolved` | the office reported completion with evidence | `resolved` |
| `disputed` | the filer disputed the completion | `disputed` |
| `closed` | closed with a public reason | `closed` |

`ShellState` is the same six shell-state words. `in-review`, `published`, `commitment-pending-review`, `returned`, and `resolution-pending-review` are removed. Migration maps `commitment-pending-review` and `returned` to `assigned`, `published` to `answered`, and `resolution-pending-review` to `answered`.

Text visibility is separate from process state:

| `textStatus` | shell `text` | `holdReason` | `removedReason` |
| --- | --- | --- | --- |
| `public` | narrative as filed | null | null |
| `held` | null | one of `personal-data`, `abuse`, `off-topic`, `other`, `pending-release`, `policy`, `notices`, `confidential` | null |
| `redacted` | the official's redacted version | null | null |
| `removed` | null | null | `filer` or `retention` |

The first four hold reasons are assessment reasons. The last four are
system-owned. Official holds and public notices reject system-owned reasons
with `400 invalid_request`.

## Commands and transitions

All commands are by `official` unless the table says otherwise.

| command | from | to | notes |
| --- | --- | --- | --- |
| `assign` | `open` | `assigned` | unchanged |
| `commitment` | `assigned` | `answered` | publishes the snapshot at once |
| `resolution` | `answered`, `disputed` | `resolved` | evidence required; resolves the snapshot |
| `reopen` | `disputed` | `answered` | office accepts the dispute and will redo |
| `dispute` (filer, reopen key) | `resolved` | `disputed` | public text; at most 3 per case |
| `close` | `open`, `assigned` | `closed` | existing `CloseInput` |
| `hold` | any but `closed` | same | `textStatus` becomes `held`; after removal returns `409 text_removed` |
| `release` | any but `closed` | same | `textStatus` becomes `public`, or `redacted` when `redactedText` is given; returns `409 release_not_permitted` in `shell` mode or `409 text_removed` after removal |
| `label` | any | same | set or clear `form-letter` |

`hold` may also be issued by the synchronous filing-time compliance pass with actor role `system`. The pass runs before insert for web and channel creation and on dispute text. A hold leaves the public shell visible with its reason and original-text hash.

## Data and transactions

Use additive Postgres tables for trace records, private contact material, append-only events, command idempotency, and private attachments. Do not migrate or repurpose the older complaint, claim, or commitment models.

Every successful command locks its record and atomically writes state, event, and idempotency result. Events carry a per-record sequence, previous hash, and canonical event hash. Corrections append; no update/delete event API exists. Verification must detect changed payloads, broken links, omitted sequence entries, and record/event state mismatch where applicable. Call the trail `hash-linked`, not immutable. A separate remote audit call cannot substitute for the authoritative transactional record event.

Every write accepts `Idempotency-Key` (UUID) and, except creation, `expectedVersion` (integer). Channel and filer message appends are the explicit `expectedVersion` carve-out because their ordered append semantics do not overwrite a caller-supplied record version. Same actor/key and same request returns the original result without new events; same key with different input is 409. A stale version is 409 with a stable error code. Scope replay authorization to the current authenticated actor and record access. Generate identifiers and timestamps on the server.

The report narrative and filed location follow `PilotConfig.publicTextMode`.
`open` publishes them after the synchronous compliance pass. `release` holds
them with `pending-release` until an official release. `shell` holds them with
`policy` and never permits release. A release may restore the filed text or
publish a redacted version. Erasure removes both public fields but leaves the
original text hash public. Resident identity, contact data, raw upload bytes,
private messages, internal notes, and internal actor identifiers stay private.
They never appear in public serialization, public event descriptions, public
exports, client error responses, or application logs. Photos remain private in
this wave.

## Public shell

`CaseShell` gains, and `CASE_SHELL_HASH_FIELDS` includes:

```ts
text: string | null;
location: string | null;
textStatus: 'public' | 'held' | 'redacted' | 'removed';
holdReason:
  | 'personal-data'
  | 'abuse'
  | 'off-topic'
  | 'other'
  | 'pending-release'
  | 'policy'
  | 'notices'
  | 'confidential'
  | null;
removedReason: 'filer' | 'retention' | null;
textSha256: string;
labels: string[];
notFixedCount: number;
disputeCount: number;
noticeCount: number;
```

`area`, `category`, `track`, `state`, `closedPublicReason`, `filedAt`,
`clockDueAt`, `followerCount`, and `alsoAffectedCount` stay. The canonical hash
order places `removedReason` after `holdReason` and `noticeCount` after
`disputeCount`. `contactEmail` and attachments stay private. The public web
does not render `noticeCount`.

Case numbers use the configured prefix and a random six-digit suffix, for example `VRS-482113`. They are not sequential. The existing `trace_case_counters` table remains only for migration compatibility.

The reopen key appears only in a JSON body, never in a path or query. Only a case creation response returns it. An unknown case number and a wrong key return indistinguishable 404 responses.

Attention is a count, never a vote or queue order. `follow` and `also-affected` do not change staff priority. `not-fixed` is accepted only in `resolved` or `disputed`, uses the existing follower-key deduplication, and increments `notFixedCount`.

## Public record

`PublicRecord` has no `publicSummary`. It carries:

```ts
caseNumber: string;
commitment: string;
dueDate: string;
signedBy: { name: string; title: string };
status: 'answered' | 'resolved' | 'disputed';
evidenceNote: string | null;
evidenceUrls: string[];
publishedAt: string;
resolvedAt: string | null;
disputes: Array<{
  text: string | null;
  textStatus: 'public' | 'held' | 'removed';
  holdReason: HoldReason | null;
  createdAt: string;
}>;
events: PublicEvent[];
receiptHash: string;
```

The snapshot is created by `commitment` and updated by `resolution`, `dispute`, and `reopen`. `trace_public_snapshots.public_summary` loses `NOT NULL` and is no longer written; `signed_by_name` and `signed_by_title` are added.

`CommitmentInput` gains `signedBy: { name (1..120), title (1..120) }` and loses `publicSummary`. `ResolutionInput` gains the same `signedBy`.

## Public events

The five stage IDs stay. Their event allowlist is:

| stage | events (action, actorRole) |
| --- | --- |
| `voice` | `report-filed` (resident); `text-held` (system or official, `reason`); `text-released` (official, `redacted: boolean`); `text-removed` (resident or system, `{ reason: 'filer' \| 'retention' }`); `label-set` / `label-cleared` (system or official, `label`) |
| `responsibility` | `office-assigned` (official) |
| `response` | `commitment-published` (official, `signedBy.name`) |
| `check` | `completion-reported` (official); `completion-disputed` (resident); `case-reopened` (official) |
| `receipt` | `case-resolved-standing` (system), written by `resolution` and meaning "reported complete and not disputed" |

`case-closed` (official, `publicReason`) may occur in `voice` or `responsibility`. `#publicMilestones` builds the trail from events that exist and requires no review event.

`CaseMessage.kind` also accepts `notice`. Notice messages store their reason in
`noticeReason: HoldReason | null`, not in the message body.

## Routes

Trace-service internal routes are:

| method | path | who |
| --- | --- | --- |
| POST | `/internal/trace/records/:id/assign` | official |
| POST | `/internal/trace/records/:id/commitment` | official |
| POST | `/internal/trace/records/:id/resolution` | official |
| POST | `/internal/trace/records/:id/reopen` | official |
| POST | `/internal/trace/records/:id/close` | official |
| POST | `/internal/trace/records/:id/hold` | official, body `{ reason, note? }` |
| POST | `/internal/trace/records/:id/release` | official, body `{ redactedText?, note? }` |
| POST | `/internal/trace/cases/:caseNumber/erase-text` | reopen key, body `{ reopenKey }`; returns the public shell |
| POST | `/internal/trace/public/cases/:caseNumber/notice` | public, body `{ followerKey, reason, note? }`; returns the public shell |
| POST | `/internal/trace/records/:id/label` | official, body `{ label: 'form-letter', action: 'set' \| 'clear' }` |
| POST | `/internal/trace/cases/:caseNumber/dispute` | reopen key in body `{ reopenKey, text }` |
| POST | `/internal/trace/public/cases/:caseNumber/attention` | anyone, kinds `follow`, `also-affected`, `not-fixed` |

Removed: `/records/:id/review` and `/records/:id/resolution-review`. The AI
proposal decision route and `GET /records/:id/messages` are official-only.
Message reads include `noticeReason`. `GET /internal/trace/config` includes
`publicTextMode` and `publicTextRetentionDays`. Platform-api mirrors this table
under `/api/trace/…`; the web BFF allowlist mirrors platform-api.

Public and channel routes remain bounded:

| Method | Path | Access | Request / result |
| --- | --- | --- | --- |
| GET | `/api/trace/config` | public | Municipality, category, office, localized labels, sources, intake state, `publicTextMode`, and `publicTextRetentionDays`. |
| GET | `/api/trace/session` | signed in | `{ actorId, role, municipalityId }`; authority comes from server mapping. |
| POST | `/api/trace/public/cases` | public | Files `{ text, location?, photo? }`; runs compliance before insert; returns 201 `{ case, shell }`. |
| GET | `/api/trace/public/cases/:caseNumber` | public | Returns the public shell and public record when present. |
| POST | `/api/trace/public/cases/:caseNumber/attention` | public | Applies a deduplicated `follow`, `also-affected`, or `not-fixed` action. |
| POST | `/api/trace/cases/:caseNumber/private` | reopen key | Returns the filer's private case view. |
| POST | `/api/trace/cases/:caseNumber/messages` | reopen key | Appends a private filer message or label appeal. |
| POST | `/api/trace/cases/:caseNumber/dispute` | reopen key | Files public dispute text from a `resolved` case. |
| POST | `/api/trace/cases/:caseNumber/erase-text` | reopen key | Accepts `{ reopenKey }`; returns the public shell. |
| POST | `/api/trace/public/cases/:caseNumber/notice` | public | Accepts `{ followerKey, reason, note? }`; returns the public shell. |

Channel gateway routes use `x-polis-trace-gateway` with a configured gateway ID; a request carrying both that header and `x-polis-citizen` is rejected. Reopen routes authenticate only the key in the JSON body. Public case routes are anonymous behind the internal service boundary. Handler errors use `{ "error": "stable_code", "message": "safe explanation" }`.

The erase route allows 5 requests per IP per 10 minutes. The notice route
allows 10 requests per IP per 10 minutes. Either returns `429 rate_limited`
over its limit. A notice reason must be one of the four assessment hold
reasons; `note` is optional and at most 600 characters.

`PilotConfig.publicTextMode` is `open`, `release`, or `shell` and defaults to
`open`. `PilotConfig.publicTextRetentionDays` is an integer of at least 30 and
defaults to 730.

Bound and validate every string, list, and upload. Reject unknown authority fields. Dates must be valid date-only values. Service configuration fails closed when required internal credentials or the official role mapping are absent or contradictory.

## Public receipt hash

`receiptHash` is lowercase hexadecimal SHA-256 of UTF-8 canonical JSON. Sort object keys lexicographically at every depth and preserve array order. Hash the current public-record fields and sanitized events, excluding `receiptHash` itself. `caseNumber` is not part of the hashed fields, so existing receipt hashes remain valid. Matching a hash checks the supplied public record's consistency, not the truth of the report or the authenticity of a municipal decision.

## Isolated operation

A dedicated launcher uses a new loopback PostgreSQL database and explicit environment, with Bun automatic `.env` loading disabled. Never use the repository's existing `.env` or a production database by default. The test runtime may use locally captured SMTP delivery and a local OIDC acceptance fixture; neither is an actual municipal identity provider. The browser receives no magic-token bypass or arbitrary role selector.

Intake can be closed through operator configuration: new reports are rejected with 503 `intake_closed`, while reads and authorized follow-up remain available. Health and readiness checks reflect database availability. Structured operational logging omits tokens, report content, and contact information.

Recovery drills use only newly created test resources, verify ownership before cleanup, and compare full record, event, and attachment state after restore. Do not call a local restore off-host evidence. No public deployment, DNS change, production SMTP/OIDC action, municipal outreach, or real resident intake is authorized by this contract.
