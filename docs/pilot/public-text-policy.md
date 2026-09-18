# Public text policy (owner decisions of 2026-09-16)

Normative for the Vrsar pilot. Where this file and `trace-api-contract.md`,
`minimal-backend-plan.md` or `DESIGN.md` disagree, this file wins until those
are updated.

## Decisions

- D1 The resident's report text is public verbatim from the moment of filing,
  after a synchronous automated compliance pass that runs inside the filing
  request. A case whose text the pass holds still has a public shell; the shell
  shows a hold reason category instead of the text. An official releases the
  text as filed, releases a redacted version (a logged public event), or closes
  the case with a public reason. Held and closed counts sit on the place ledger
  next to the other states, so removals show up as numbers on the office's own
  page. The hash of the original text is public in every case.
- D2 There is no independent reviewer. The responsible official publishes the
  commitment directly, under their own name and title, with a date. Public
  visibility is the gate. The `reviewer` role, the review routes, the
  self-review check and `TRACE_REVIEWER_CITIZEN_IDS` are removed.
- D3 A completion claim is checked by the public. The filer (reopen key) can
  dispute it with a public text, which moves the case to `disputed`. Followers
  can mark "not fixed", a deduplicated count like "also affected". Abuse limits
  apply (below).
- D4 A case can carry one soft label, `form-letter`, when the text looks like a
  campaign or machine-written form. It never blocks, never highlights spans, is
  shown as one chip with a one-line explanation, and the filer can appeal it.

Constraints: no human gate on any report; only the municipality and the public
are in the loop; an LLM is a filter that produces logged events with reasons,
never a decision-maker; Intrface is not a reviewer. The LLM step must run on an
EU-hosted model with no training on the data, processing on behalf of the
municipality.

## Publicity modes

`PilotConfig.publicTextMode` controls when report text may become public. It
defaults to `open`.

| mode | at filing | shell text | release |
| --- | --- | --- | --- |
| `open` | public verbatim after the compliance pass | text, or hold reason | allowed |
| `release` | held with reason `pending-release` | hold reason until released | allowed; release is the publish act |
| `shell` | held with reason `policy` | never | refused with `409 release_not_permitted` |

`holdReasonAtFiling(mode, assessment)` applies this order:

1. `confidential` wins in every mode.
2. In `open` mode, `personal-data` wins over `abuse`; otherwise the result is
   `null`.
3. In `release` mode, `personal-data` wins over `abuse`; otherwise the result is
   `pending-release`.
4. In `shell` mode, the result is `policy`.

The compliance pass and the `form-letter` check run in every mode. The service
logs their signals and labels even when policy never allows the text to appear.

## Process states

`TRACE_STATUSES` becomes:

| status | meaning | shell state |
|---|---|---|
| `open` | filed, no office yet | `received` |
| `assigned` | an office accepted responsibility | `assigned` |
| `answered` | the official published a commitment | `answered` |
| `resolved` | the office reported completion with evidence | `resolved` |
| `disputed` | the filer disputed the completion | `disputed` |
| `closed` | closed with a public reason | `closed` |

`ShellState` is the same six words. `in-review`, `published`,
`commitment-pending-review`, `returned` and `resolution-pending-review` are
gone. Migration mapping for existing rows: `commitment-pending-review` and
`returned` → `assigned` (the commitment text stays on the record and the
official submits again); `published` → `answered`; `resolution-pending-review`
→ `answered`.

Text visibility is orthogonal to process state:

| `textStatus` | shell `text` | `holdReason` | `removedReason` |
| --- | --- | --- | --- |
| `public` | narrative as filed | null | null |
| `held` | null | one of `personal-data`, `abuse`, `off-topic`, `other`, `pending-release`, `policy`, `notices`, `confidential` | null |
| `redacted` | the official's redacted version | null | null |
| `removed` | null | null | `filer` or `retention` |

The first four hold reasons are assessment reasons. The last four are
system-owned. The official hold route and the public notice route reject
system-owned reasons with `400 invalid_request`.

Transitions (all by `official` unless stated):

| command | from | to | notes |
|---|---|---|---|
| `assign` | `open` | `assigned` | unchanged |
| `commitment` | `assigned` | `answered` | publishes the snapshot at once |
| `resolution` | `answered`, `disputed` | `resolved` | evidence required; resolves the snapshot |
| `reopen` | `disputed` | `answered` | office accepts the dispute and will redo |
| `dispute` (filer, reopen key) | `resolved` | `disputed` | public text; at most 3 per case |
| `close` | `open`, `assigned` | `closed` | existing `CloseInput` |
| `hold` | any but `closed` | same | `textStatus` → `held` with an assessment reason; refused with `409 text_removed` after removal |
| `release` | any but `closed` | same | `textStatus` → `public`, or `redacted` when `redactedText` is given; refused with `409 release_not_permitted` in `shell` mode or `409 text_removed` after removal |
| `label` | any | same | set or clear `form-letter` |

`hold` is also issued by the compliance pass at filing (actor role `system`).

## Public shell

`CaseShell` gains, and `CASE_SHELL_HASH_FIELDS` must include, these fields:

```
text: string | null
location: string | null
textStatus: 'public' | 'held' | 'redacted' | 'removed'
holdReason: 'personal-data' | 'abuse' | 'off-topic' | 'other' | 'pending-release' | 'policy' | 'notices' | 'confidential' | null
removedReason: 'filer' | 'retention' | null
textSha256: string
labels: string[]
closedPublicReason: string | null
filedAt: string
clockDueAt: string
followerCount: number
alsoAffectedCount: number
notFixedCount: number
disputeCount: number
noticeCount: number
testEnvironment: boolean
```

The full canonical hash order is `caseNumber`, `municipalityId`, `area`,
`category`, `track`, `state`, `text`, `location`, `textStatus`, `holdReason`,
`removedReason`, `textSha256`, `labels`, `closedPublicReason`, `filedAt`,
`clockDueAt`, `followerCount`, `alsoAffectedCount`, `notFixedCount`,
`disputeCount`, `noticeCount`, `testEnvironment`.

`area`, `category`, `track`, `state`, `closedPublicReason`, `filedAt`,
`clockDueAt`, `followerCount`, `alsoAffectedCount` stay. `contactEmail` and
attachments stay private. Photos stay private in this wave (open item O1).

## Public record (the office's answer)

`PublicRecord` loses `publicSummary`. It carries:

```
commitment: string
dueDate: string
signedBy: { name: string; title: string }
status: 'answered' | 'resolved' | 'disputed'
evidenceNote: string | null
evidenceUrls: string[]
publishedAt: string
resolvedAt: string | null
disputes: Array<{ text: string | null; textStatus: 'public' | 'held' | 'removed'; holdReason: HoldReason | null; createdAt: string }>
events: PublicEvent[]
receiptHash: string
```

The snapshot is created by `commitment` and updated by `resolution`, `dispute`
and `reopen`. `trace_public_snapshots.public_summary` loses NOT NULL and is no
longer written; `signed_by_name` and `signed_by_title` are added.

`CommitmentInput` gains `signedBy: { name (1..120), title (1..120) }` and loses
`publicSummary`. `ResolutionInput` gains the same `signedBy`.

## Public events

`TraceRole` becomes `'resident' | 'official' | 'gateway' | 'system'`. The five
stage ids stay; their meaning is:

| stage | events (action, actorRole) |
|---|---|
| `voice` | `report-filed` (resident); `text-held` (system or official, `reason`); `text-released` (official, `redacted: boolean`); `text-removed` (resident or system, `reason: 'filer' \| 'retention'`); `label-set` / `label-cleared` (system or official, `label`) |
| `responsibility` | `office-assigned` (official) |
| `response` | `commitment-published` (official, `signedBy.name`) |
| `check` | `completion-reported` (official); `completion-disputed` (resident); `case-reopened` (official) |
| `receipt` | `case-resolved-standing` (system) — written by `resolution` and meaning "reported complete and not disputed" |

`case-closed` (official, `publicReason`) may occur in `voice` or
`responsibility`. `#publicMilestones` must no longer require any review event;
it builds the trail from the events that exist.

## Compliance pass (`services/trace-service/src/compliance.ts`)

```
assessText(input: {
  text: string;
  location: string | null;
  municipalityId: string;
  recentNarrativeHashes: string[];   // normalized-text sha256 of cases filed in the last 30 days in this municipality
}, deps: { gatewayUrl: string | null; holdTerms: string[]; fetch?: typeof fetch })
  → Promise<{
      hold: HoldReason | null;
      formLetter: boolean;
      signals: string[];           // e.g. 'local:email', 'local:oib', 'local:plate', 'local:hold-term', 'local:duplicate', 'gateway:hold', 'gateway:form-letter', 'gateway:skipped'
      normalizedSha256: string;
    }>
```

Local checks always run: e-mail, phone (`+385` and `09x` forms), OIB (11 digits
passing ISO 7064 MOD 11,10), Croatian licence plates
(`[A-ZŠĐČĆŽ]{2}[ -]?\d{3,4}[ -]?[A-ZŠĐČĆŽ]{1,2}`), a term list from
`TRACE_HOLD_TERMS` (comma-separated, optional) merged with a short built-in
list, confidential-report terms from `TRACE_CONFIDENTIAL_TERMS`
(comma-separated, optional), and special-category terms. The special-category
check covers third-party health, ethnicity, religion, sexual orientation,
political, and union data. It holds the text for a human under
`personal-data`. A confidential-report hit uses `confidential`, which wins over
every other result. Other personal-data hits give `personal-data`; hold-term
hits give `abuse`. `formLetter` is true when `normalizedSha256` matches any
recent hash. Normalization uses NFKC, lowercase, stripped punctuation, and
collapsed whitespace.

When `TRACE_AI_COMPLIANCE_URL` is set, POST
`{ text, location, language: 'hr' }` to `<url>/internal/ai/compliance` with
`internalHeaders()` and a 5 s timeout; expected reply
`{ hold: HoldReason | null; formLetterScore: number; note?: string }`. A 404,
timeout or malformed reply adds `gateway:skipped` and the local result stands
(fail open, logged). A gateway `hold` wins over a local null;
`formLetterScore >= 0.8` sets `formLetter`. The gateway endpoint itself is a
separate task (O2); trace-service must work without it.

The pass runs inside `create` and `createChannelCase` before the insert, and on
`dispute` text. The existing asynchronous AI intake (category and duplicate
proposals) is unchanged.

### Model provider for the compliance pass (O2)

The gateway half of the pass is not built. Trace-service ships with the local
checks only. Before `TRACE_AI_COMPLIANCE_URL` points at a real model in any
shipped profile, the provider must meet all of these:

- P1 Inference inside the EU. The pass reads the raw text, and the text it is
  meant to hold (third-party personal data, whistleblower reports) is exactly
  the text that must not leave the EU. Minimisation cannot apply here.
- P2 A processor agreement (GDPR Art. 28) with the municipality as controller
  that covers special-category data (Art. 9), no training on the data, and no
  retention of prompts or outputs.
- P3 The reply is a hold reason or nothing. It never removes text and never
  closes a case. Every reply is a logged event with its reason, and an error
  or timeout fails open to the local result, as the contract above says.
- P4 Shadow first. The reply is logged as a signal but not applied until its
  holds have been compared with the office's release decisions on real
  filings. Only then may a gateway hold win over a local null.
- P5 A Croatian and Italian test set of abuse, personal-data and form-letter
  texts with measured precision and recall before the shadow period ends.

Candidate noted 2026-09-17: TypeSafe AI's Jev through Vercel AI Gateway. Its
typed Choice, Boolean and Score outputs match the reply contract with no
taxonomy work, and the gateway has per-request no-retention and no-training
flags. It is blocked on P1 and P2: the model listing publishes no inference
region, and the provider terms as published do not cover special-category
data. Re-check when either changes. The category and routing classifier is a
separate, later item; this pass comes first.

## Erasure

`POST /internal/trace/cases/:caseNumber/erase-text` accepts `{ reopenKey }` and
authenticates like a dispute. It removes public text and location, sets
`textStatus` to `removed` and `removedReason` to `filer`, blanks the filer's
dispute texts in the snapshot, and writes `text-removed` at stage `voice` with
actor role `resident`. It works in every process state, including `closed`.
A repeat call is idempotent and returns the unchanged public shell.

The office's public commitment and resolution remain. The private case file
also remains under the office's archive rules. `textSha256` stays public.

## Public notices

`POST /internal/trace/public/cases/:caseNumber/notice` accepts
`{ followerKey, reason, note? }`. `reason` must be one of the four assessment
hold reasons. `note` is optional and at most 600 characters. The service
deduplicates by the existing follower-key hash with attention kind `notice`.

The first notice from a key increments `noticeCount` and writes a private
message with kind `notice`, `noticeReason` set to the reason, and body set to
the note or an empty string. At three notices, public or redacted text becomes
held with reason `notices`. The system writes the existing `text-held` event.
A repeat notice from the same key changes nothing. Both paths return the public
shell. `noticeCount` is for the office UI; the public web does not render it.

## Retention

Resolution and closure set `trace_records.terminal_at`. Reopen and dispute
clear it. `runRetention(now, batchSize)` processes locked rows in batches with
`FOR UPDATE SKIP LOCKED`. Once `terminal_at` plus
`publicTextRetentionDays` is earlier than `now`, it removes public text and
location, blanks dispute texts, sets `removedReason` to `retention`, and writes
`text-removed` at stage `voice` with actor role `system`. It skips text already
removed.

`publicTextRetentionDays` is an integer of at least 30 and defaults to 730.
`bun run retention` runs the job. `TRACE_RETENTION_INTERVAL_MINUTES` controls
the in-process interval; unset or `0` disables it.

## Confidential reports

The compliance pass holds whistleblower-looking text with reason
`confidential` for a human. The public shell shows that reason but not the
text. The resident must use the municipality's confidential officer for a
protected internal report. This platform is not that internal reporting
channel.

## Attention and abuse limits

`AttentionInput.kind` gains `'not-fixed'`, accepted only while the state is
`resolved` or `disputed`, deduplicated by the existing follower-key hash and
counted into `notFixedCount`. Disputes are limited to 3 per case; the 4th
returns `409 dispute_limit`. Label appeal: `FilerMessageInput` gains
`kind?: 'append' | 'label-appeal'`; an appeal is a private message to the
office, the official clears the label with `label`.

The public `erase-text` route is limited to 5 requests per IP per 10 minutes.
The public `notice` route is limited to 10 requests per IP per 10 minutes.
Over the limit returns `429 rate_limited`.

platform-api adds a per-IP fixed window on the public trace routes, reusing the
limiter in `public-edge.ts`: `POST /public/cases` 5 per 10 min,
`POST /public/cases/:caseNumber/attention` 30 per min,
`POST /cases/:caseNumber/dispute` 5 per 10 min. Over the limit returns
`429 rate_limited`.

## Routes

trace-service internal routes, after the change:

| method | path | who |
|---|---|---|
| POST | `/internal/trace/records/:id/assign` | official |
| POST | `/internal/trace/records/:id/commitment` | official |
| POST | `/internal/trace/records/:id/resolution` | official |
| POST | `/internal/trace/records/:id/reopen` | official |
| POST | `/internal/trace/records/:id/close` | official |
| POST | `/internal/trace/records/:id/hold` | official, body `{ reason, note? }` |
| POST | `/internal/trace/records/:id/release` | official, body `{ redactedText?, note? }` |
| POST | `/internal/trace/records/:id/label` | official, body `{ label: 'form-letter', action: 'set' | 'clear' }` |
| POST | `/internal/trace/cases/:caseNumber/dispute` | reopen key in body `{ reopenKey, text }` |
| POST | `/internal/trace/public/cases/:caseNumber/attention` | anyone, kinds `follow`, `also-affected`, `not-fixed` |
| POST | `/internal/trace/cases/:caseNumber/erase-text` | reopen key in body `{ reopenKey }` |
| POST | `/internal/trace/public/cases/:caseNumber/notice` | anyone, body `{ followerKey, reason, note? }` |

Removed: `/records/:id/review`, `/records/:id/resolution-review`. The AI
proposal decision route and `GET /records/:id/messages` are official-only.
platform-api mirrors this table under `/api/trace/…` and the web BFF allowlist
in `apps/web/src/lib/pilot/vrsar/proxy.ts` mirrors platform-api.

## Web

Resident side (`/<place>`, `/<place>/zapis`, `/<place>/zapis/<n>`,
`/<place>/prijava`, `/<place>/prijava/<n>`, and the `/pilot/vrsar/zapis`
shell): the case page shows the text or the hold notice, the location, the
label chip with its explanation and an appeal link when the reopen key is in
the URL fragment, the office answer signed by name and title, the completion
report with evidence, a dispute form for the filer, "nije popravljeno" for
followers while resolved, and the trail. The ledger lists the six states plus
held and closed counts in the strip, with a text excerpt per row. The filing
screen says the text is public at once and asks the filer not to include other
people's names or contact details.

Staff side (`/pilot/vrsar/...`): the review queue and reviewer login are gone;
the official's case view gains hold, release with optional redaction, label
set/clear, reopen, and the commitment and resolution forms ask for the signing
name and title.

## Open items

- O1 Photos stay private until an image compliance pass exists.
- O2 `POST /internal/ai/compliance` in ai-gateway (Python). Provider
  requirements P1–P5 are under "Model provider for the compliance pass".
- O3 Demo store and `/demo/*` pages, `public-release.ts`, non-pilot pages,
  and the pitch deck still describe the reviewer; they follow in a later wave.
- O4 Croatian strings for the new states go to the native editor before release.
- O5 `textSha256` stays public after erasure. The DPO must sign off that a
  SHA-256 hash of removed text is acceptable.
- O6 Before release, the municipality must confirm in writing the controller
  name and address, DPO contact, confidential contact, and retention period.
  The values in `apps/web/src/content/places.ts` are placeholders.
