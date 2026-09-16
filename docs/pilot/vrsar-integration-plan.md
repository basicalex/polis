# Vrsar-Orsera: integration and delivery plan

Written 2026-09-12. Planning document. No municipal agreement exists; the NO-GO in `GO_LIVE_READINESS.md` stands. Everything below is what Polis prepares so the handover needs nothing from the municipality except a decision and a paste.

Companion files: `vrsar-website-stack.md` (what vrsar.hr is built on), `vrsar-announcement-post.html` (paste-ready post).

## Shape of the delivery

The municipality's site is a WordPress install with the Classic Editor and no form plugin. Polis does not integrate into it. The site only points at Polis:

- One news post announces the three channels (paste, no code).
- One permanent page under `/za-gradane/` keeps the same block (paste, no code).
- Both link to the Vrsar place ledger on Polis and print one phone number.

Polis carries the whole interface: the ledger, the case, the case number, the SMS and voice intake. This matches the Where → Intent → Interface thesis: the citizen lands on the place, states the problem, gets a number. No account.

## Public entry: the place ledger

`https://polis.intrface.eu/vrsar` (slug pending D1) must exist before the post goes out. It shows:

- the public shell of every case (number, area, category, track, clock, state), newest first;
- a search box that takes a case number;
- one primary action: file a report (web form: what, where, optional photo, optional contact);
- the phone number with `tel:` and `sms:` links, repeated at the bottom.

Filing on the web returns the case number and a private reopen key in the URL fragment, per the 2026-09-11 decisions. Web filing is the same intake pipeline as SMS and voice; only the transport differs.

## Phone intake (Telnyx)

Telnyx is transport only. Polis owns the case, the routing, the privacy boundary, and every reply.

### Components

| Part | Role |
| --- | --- |
| Telnyx Messaging Profile + one Croatian number | inbound SMS webhook, outbound replies |
| Telnyx Call Control application on the same number | answer, play prompt, record, speak case number, hang up |
| `services/phone-intake-service` (new, bounded) | verifies webhook signatures, normalizes SMS and transcripts, calls the intake pipeline, sends replies |
| Relay store (isolated table, encrypted at rest) | `relay_token ↔ phone number`, TTL, never joined into trace records |
| Intake pipeline (existing trace-service, new server-side channel path) | creates the record, assigns the case number, emits the public shell |

### SMS flow

1. Telnyx posts `message.received` to the webhook. The service verifies `telnyx-signature-ed25519` and `telnyx-timestamp`, rejects anything older than a few minutes.
2. Sender number is hashed with a keyed HMAC into a relay token. The number itself is written only to the relay store, with a TTL.
3. If the relay token has an open case within a window (default 72 hours) and the text does not start with `NOVA`, the text is appended to that case. Otherwise a new case is created. A text that starts with the case number goes to that case at any time, window or not.
4. The case is created with channel `sms`, the raw text as the private narrative, and the public shell only.
5. Reply within seconds: `Prijava je zaprimljena. Broj predmeta: VRS-1842.` Second line for reopen: `Stanje: polis.intrface.eu/vrsar/VRS-1842`.
6. Status changes that the institution publishes trigger an SMS through the relay token. Officials never see the number.
7. `STOP` unsubscribes from further messages; the case stays.

### Voice flow

1. `call.initiated` → answer → `speak` (Croatian TTS, then a short Italian line): "Opišite problem i mjesto nakon signala. Ako ne navedete svoje ime, prijava se vodi anonimno. Kada završite, pričekajte broj predmeta ili poklopite."
2. `record_start`, stop on 3 seconds of silence, `#`, or 120 seconds.
3. On `call.recording.saved`: download, transcribe, create the case exactly as an SMS case, channel `voice`.
4. If the caller is still on the line: `speak` the case number twice, digit by digit, then hang up. If the caller already hung up and the number is mobile: send the case number by SMS through the relay.
5. Delete the recording from Telnyx after transcription. Keep the transcript as private narrative; keep the audio only if the case needs it and the retention rule allows.

### Privacy rule

`phone number ≠ citizen identity ≠ case data.`

- Trace records store `relay_token`, never the number.
- The relay store is a separate schema with its own key, encrypted, purged 30 days after case closure.
- Numbers never appear in logs, error messages, public projections, exports, or analytics.
- Telnyx message and call detail records are set to the shortest retention Telnyx allows, and a DPA is signed. Telnyx EU data residency to be confirmed (R2).
- Classification (category, settlement, track, duplicate hint) runs institution-side as an aid to the queue, never as a public gate, and is rule-based first. This keeps the pre-partner decision to cut AI from the public surface.

### Number and regulatory questions to close first

- R1 Telnyx availability of a Croatian number that supports two-way SMS and voice on the same number. Croatian local numbers may carry voice only; a mobile-type number or a separate SMS number may be needed. Verify in the Telnyx portal before anything else.
- R2 Telnyx EU processing and data-retention settings; DPA.
- R3 Croatian speech-to-text quality. Telnyx transcription engines may not cover Croatian well; fallback is downloading the recording and running an open model in Polis infrastructure, which also fits the open-source claim.
- R4 Legal basis for processing the phone number (relay only) under GDPR Art. 6; the municipal odluka alone is not enough (2026-09-11 note). Pending user call D5 on the legal-basis path.
- R5 ZLPRS čl. 26: the 30-day duty to answer applies once the municipality adopts the channel; the clock on the public shell must match it.

## Phases

| Phase | Deliverable | Who | Gate |
| --- | --- | --- | --- |
| P0 (done) | Stack notes, post draft, this plan | this session | Croatian editor review of the post |
| P1 | Vrsar place ledger route, web filing without account, case number and reopen key | Opus frontend subagent + omp for the record path | user approves D1–D3 |
| P2 | `phone-intake-service`: Telnyx webhooks, relay store, SMS and voice flows, feature-flagged; tested with a Telnyx test number | omp workers, contract from this session | R1–R3 closed |
| P3 | Handover pack: post HTML, page HTML, poster with QR and number, SMS copy sheet, privacy note | this session + editor | municipal agreement signed |
| P4 | Municipality pastes the post and page; Polis switches the number live | municipality | release approval per `GO_LIVE_READINESS.md` |

## Decisions needed

- D1 Place slug: `polis.intrface.eu/vrsar` or `polis.intrface.eu/hr/vrsar-orsera`. Recommendation: `/vrsar`, short enough to say on a phone and print on a poster.
- D2 Case prefix: `VRS`. Recommendation: keep, it matches the copy already reviewed.
- D3 Decided 2026-09-16. Follow-up window for SMS append: 72 hours, set by `CHANNEL_APPEND_WINDOW_HOURS` (default 72). The keyword `NOVA`, in capitals, forces a new case.
- D4 Decided 2026-09-16. Relay retention after closure: 30 days, set by `CHANNEL_CLOSED_RETENTION_DAYS` (default 30). The post says "briše se nakon zatvaranja predmeta".
- D5 Legal-basis path for the relay number (consent line in the auto-reply vs. legitimate interest documented by the municipality). Blocks P2 go-live, not P2 engineering.
- D6 Formal address in citizen copy: the post uses the formal plural ("Prijavite"), the app uses the singular imperative ("Podnesi prijavu"). Recommendation: formal plural on every surface the municipality signs, singular only inside the app.
