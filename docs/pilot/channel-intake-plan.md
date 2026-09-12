# Channel intake plan

## Current scope

The channel path accepts municipal reports by SMS or voice. The local and pilot runtime uses stub channel and speech-to-text providers. A non-stub channel or speech-to-text provider is blocked unless `CHANNEL_PROCESSING_AGREEMENT=true`.

The public edge forwards raw Telnyx SMS and voice webhooks to `channel-gateway`. Telnyx mode verifies the Ed25519 signature and timestamp before it accepts an event. Stub injection is available only with `CHANNEL_PROVIDER=stub` and `CHANNEL_ALLOW_STUB_INJECTION=true`.

## SMS flow

1. `channel-gateway` normalizes the sender to E.164, seals the number with AES-256-GCM, and indexes it by a municipality-scoped, peppered HMAC hash.
2. `STOP`, `STOJ`, or `PREKID` blocks the hashed number. `START`, `POČNI`, or `POCNI` reopens the channel.
3. The gateway seals the SMS body while it waits for processing. A new report creates a Trace case. A later message from the same number appends to its open case. A case prefix such as `VRS-1842` selects that open case when the number has more than one.
4. Trace returns a case number and a reopen reference. The gateway keeps the number-to-case link and sends a Croatian confirmation through its outbox.
5. Trace creates a sequential case number and a public shell. The shell has state, category, area, dates, and counts, but no report narrative.

Inbound and outbound caps apply per hashed number and per case. Provider-wide outbound caps also bound relay volume.

## Voice flow

1. An inbound call creates a Trace case. The gateway speaks the formal Croatian prompt and reads the case number back with the configured Croatian voice.
2. After the prompt, the gateway records a single-channel WAV clip with a bounded length.
3. On `call.recording.saved`, the gateway fetches the clip and asks the provider to delete its copy.
4. Before transcription, the gateway applies pitch and formant shift, 1% timing jitter, a 3.4 kHz low-pass filter, and 8 kHz output sampling. It then discards the original bytes.
5. The speech-to-text provider receives only the distorted clip and a Croatian language hint. Trace stores the returned text as a private `transcript` message. The default `CHANNEL_AUDIO_SINK=discard` keeps no audio after transcription.
6. The gateway sends the case confirmation and retains only its bounded case link and delivery state.

Distortion reduces casual voice recognition. It does not make a speaker unrecognisable to a determined party that has a reference sample. Do not describe it as anonymisation.

## Privacy boundary

The design keeps three records apart: **number ≠ identity ≠ case**.

- The phone number exists only in `channel-gateway`, sealed with AES-256-GCM. Its lookup key is a peppered HMAC hash scoped to the municipality.
- The identity service holds legal or account identity. Channel intake does not send it a phone number or join a caller to an account.
- `trace-service` and municipal staff receive a case number and gateway reference, never the phone number. Staff can read the typed report or voice transcript and the case workflow needed to handle it.
- The public receives only the narrative-free case shell unless a separate reviewed publication flow creates a public record.

AI intake may propose category, location, responsible office, and a possible duplicate. The proposal stays unpublished. An official or reviewer decides it, and that decision is audited. The AI trace stores the report text only as a SHA-256 hash, not as raw prompt text.

## Retention

- Delete phone numbers and their contact-data links no later than 90 days after pilot sunset. Run and record the gateway purge until no expired phone-vault row remains.
- The gateway asks the provider to delete each source recording after fetch, overwrites the fetched original bytes after distortion, and never stores original audio.
- The default audio sink retains no distorted audio after transcription. Any non-default sink needs a written purpose, access rule, and shorter explicit retention period before use.
- Voice transcripts and SMS reports remain private case messages under the municipality's case-retention schedule. Public shells contain no narrative.
- Keep public case shells only under the pilot charter's public archive decision.

## Telnyx go-live checklist

Do not set `CHANNEL_PROVIDER=telnyx` until every item has an owner and dated evidence.

- [ ] Sign the GDPR controller/processor agreement between the municipality and Polis.
- [ ] Sign the Telnyx DPA and configure the Telnyx EU region.
- [ ] Complete Telnyx registration for the `+385` sender and receiving number.
- [ ] Sign the speech-to-text vendor DPA and record its region, retention, and deletion settings.
- [ ] Sign the AI provider DPA before any channel report reaches that provider.
- [ ] Record the lawful basis for call recording and approve the spoken recording notice.
- [ ] Name the controller contact, processor contact, privacy owner, security owner, channel operator, incident owner, and deletion owner.
- [ ] Receive one live `call.recording.saved` payload, verify its signature and fields, and retain redacted evidence of the check.
- [ ] Confirm that the selected Azure `hr-HR` voice is available on the Telnyx account.
- [ ] Obtain native Croatian sign-off for the SMS, call prompt, readback, stop, error, and status copy.
- [ ] Verify rate caps per hashed number and per case, STOP/STOJ/PREKID blocking, webhook spoof rejection, provider recording deletion, and the 90-day sunset purge.
- [ ] Set `CHANNEL_PROCESSING_AGREEMENT=true` only after the agreements and checks above are complete.
