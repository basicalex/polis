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

| `textStatus` | shell `text` | `holdReason` |
|---|---|---|
| `public` | narrative as filed | null |
| `held` | null | one of `personal-data`, `abuse`, `off-topic`, `other` |
| `redacted` | the official's redacted version | null |

Transitions (all by `official` unless stated):

| command | from | to | notes |
|---|---|---|---|
| `assign` | `open` | `assigned` | unchanged |
| `commitment` | `assigned` | `answered` | publishes the snapshot at once |
| `resolution` | `answered`, `disputed` | `resolved` | evidence required; resolves the snapshot |
| `reopen` | `disputed` | `answered` | office accepts the dispute and will redo |
| `dispute` (filer, reopen key) | `resolved` | `disputed` | public text; at most 3 per case |
| `close` | `open`, `assigned` | `closed` | existing `CloseInput` |
| `hold` | any but `closed` | same | `textStatus` → `held` with reason |
| `release` | any but `closed` | same | `textStatus` → `public`, or `redacted` when `redactedText` is given |
| `label` | any | same | set or clear `form-letter` |

`hold` is also issued by the compliance pass at filing (actor role `system`).

## Public shell

`CaseShell` gains, and `CASE_SHELL_HASH_FIELDS` must include, these fields:

```
text: string | null            // narrative as filed, or redacted, or null when held
location: string | null        // the filed location string, same visibility as text
textStatus: 'public' | 'held' | 'redacted'
holdReason: 'personal-data' | 'abuse' | 'off-topic' | 'other' | null
textSha256: string             // sha256 of the narrative as filed, always present
labels: string[]               // [] or ['form-letter']
notFixedCount: number
disputeCount: number
```

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
disputes: Array<{ text: string | null; textStatus: 'public' | 'held'; holdReason: HoldReason | null; createdAt: string }>
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
| `voice` | `report-filed` (resident); `text-held` (system or official, `reason`); `text-released` (official, `redacted: boolean`); `label-set` / `label-cleared` (system or official, `label`) |
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
(`[A-ZŠĐČĆŽ]{2}[ -]?\d{3,4}[ -]?[A-ZŠĐČĆŽ]{1,2}`), and a term list from
`TRACE_HOLD_TERMS` (comma-separated, optional) merged with a short built-in
list. Personal-data hits give `hold: 'personal-data'`; term hits give `abuse`.
`formLetter` is true when `normalizedSha256` matches any recent hash.
Normalization: NFKC, lowercase, strip punctuation, collapse whitespace.

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

## Attention and abuse limits

`AttentionInput.kind` gains `'not-fixed'`, accepted only while the state is
`resolved` or `disputed`, deduplicated by the existing follower-key hash and
counted into `notFixedCount`. Disputes are limited to 3 per case; the 4th
returns `409 dispute_limit`. Label appeal: `FilerMessageInput` gains
`kind?: 'append' | 'label-appeal'`; an appeal is a private message to the
office, the official clears the label with `label`.

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
- O2 `POST /internal/ai/compliance` in ai-gateway (Python), EU-hosted model.
- O3 Demo store and `/demo/*` pages, `public-release.ts`, non-pilot pages,
  and the pitch deck still describe the reviewer; they follow in a later wave.
- O4 Croatian strings for the new states go to the native editor before release.
