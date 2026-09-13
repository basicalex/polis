# Channel intake plan

## Current scope

The channel path accepts municipal reports by SMS or voice. The local and pilot runtime uses stub channel and speech-to-text providers. A non-stub channel or speech-to-text provider is blocked unless `CHANNEL_PROCESSING_AGREEMENT=true`.

The live provider is Infobip d.o.o., Istarska 157, Vodnjan, Croatia. One dedicated Croatian `+385` Virtual Long Number carries SMS and voice. Infobip uses EU data centres. Polis will request an EU region-locked configuration and sign a DPA before go-live.

The public `platform-api` BFF accepts inbound SMS at `POST /webhooks/infobip/sms`, delivery reports at `POST /webhooks/infobip/sms-reports`, and Calls API events at `POST /webhooks/infobip/calls`. It forwards the raw bytes and `X-Hub-Signature` header to `/internal/channel/webhooks/infobip/{sms,sms-reports,calls}` in `channel-gateway`.

Stub injection is available only with `CHANNEL_PROVIDER=stub` and `CHANNEL_ALLOW_STUB_INJECTION=true`.

## SMS flow

1. `channel-gateway` normalizes the sender to E.164, seals the number with AES-256-GCM, and computes a municipality-scoped, peppered HMAC hash only for abuse limits.
2. `STOP`, `STOJ`, or `PREKID` blocks the hashed number. `START`, `POČNI`, or `POCNI` reopens the channel.
3. The gateway seals the SMS body while it waits for processing. A new report creates a Trace case. A later message from the same number appends to its open case. A case number such as `VRS-184213` selects that open case when the number has more than one.
4. Trace returns a case number and a reopen reference. The gateway keeps the number-to-case link and queues a Croatian confirmation through the Infobip SMS API.
5. Trace creates a case number with the prefix `VRS-` and six random digits. The first digit is never zero. The old counter table remains but is unused. Random numbers prevent enumeration and hide the public case count while remaining easy to dictate by phone.
6. An Infobip delivery report changes an outbox message to `delivered` or `failed`. Staff see `DOSTAVLJENO` only after a real delivery report. Stub mode leaves the stamp at `U DOSTAVI`.

Inbound and outbound caps apply per hashed number and per case. Provider-wide outbound caps also bound relay volume.

## Voice flow

Calls API events drive the call in this order:

1. `CALL_RECEIVED` makes the gateway answer the call.
2. `CALL_ESTABLISHED` creates a case with an empty narrative and speaks the Croatian prompt with the configured Croatian voice.
3. `SAY_FINISHED` starts recording. The gateway then reads the case number back digit by digit.
4. `CALL_FINISHED` makes the gateway fetch the recording files and delete them at Infobip.

Call step state lives in the gateway table `channel_calls`. The gateway does not rely on provider client state.

The spoken prompt is:

> Dobar dan. Ovo je automatska prijava komunalnog problema. Polis ne traži vaš identitet. Vaš broj neće biti javno povezan s prijavom. Ako ne navedete ime, prijava se vodi bez imena. Opišite problem nakon zvučnog signala. Kada završite, poklopite.

The native Croatian editor must approve this prompt with the other channel copy. The old prompt promised anonymity. The new text states the narrower fact: the carrier receives the number, but Polis never links it to the public case and never sends it to the municipality.

The gateway never persists the original recording. It transcribes the original in memory, then applies pitch and formant shift and converts the audio to 8 kHz. It zeroes the original bytes after processing. Only the distorted copy may be stored, and the default `CHANNEL_AUDIO_SINK=discard` keeps no audio.

Distortion reduces casual voice recognition. It does not make a speaker unrecognisable to a determined party that has a reference sample. Do not describe it as anonymisation.

## Transcription choice

The default `STT_PROVIDER=openai-compatible` points to self-hosted Whisper `large-v3` with the `hr` language hint. Whisper transcribes the in-memory original inside Polis infrastructure. Its Croatian error rate is documented.

`STT_PROVIDER=infobip` uses Infobip `hr-HR` transcription for the same call. This keeps voice and transcription with one vendor under one DPA. Infobip does not publish a Croatian error rate.

The pilot will compare both options on real calls at gate L8. That result decides the production provider.

## Webhook security

Infobip subscriptions sign the raw request body with HMAC-SHA256. The signature arrives in `X-Hub-Signature`. The gateway uses `INFOBIP_WEBHOOK_SECRET` and a constant-time comparison. The signature contains no timestamp.

The `channel_events` table deduplicates each provider event and applies its TTL as replay defence. mTLS on the Infobip notification profile is an optional extra layer.

## Privacy boundary

The design keeps three records apart: **number ≠ identity ≠ case**.

- The phone number exists only in the `channel-gateway` vault, sealed with AES-256-GCM. Its lookup key is a peppered HMAC hash scoped to the municipality. The hash is used only for abuse limits.
- The gateway decrypts the number in one place for outbound delivery.
- The identity service holds legal or account identity. Channel intake does not send it a phone number or join a caller to an account.
- `trace-service`, the case record, the public shell, and municipal staff never receive the phone number. Staff can read the typed report or voice transcript and the case workflow needed to handle it.
- The public receives only the narrative-free case shell unless a separate reviewed publication flow creates a public record.

AI intake may propose category, location, responsible office, and a possible duplicate. The proposal stays unpublished. An official or reviewer decides it, and that decision is audited. The AI trace stores the report text only as a SHA-256 hash, not as raw prompt text.

### Disclosure

A written police or court request under Croatian criminal procedure law may
require disclosure for a criminal case. The request goes to the Polis operator,
Intrface j.d.o.o., never to the municipality. The municipality has no phone
number to hand over. Only the operator's vault key holder can decrypt a number.
Every decryption is written to the audit trail with the request reference. The
operator notifies the person unless the law forbids notice. The vault TTL is the
outer limit: after purge, there is nothing to disclose.

Intrface j.d.o.o. decides the purpose of phone-number and relay processing, so
it is the controller for that contact data. The municipality is the controller
for case content. The L1 agreement must record these separate roles. A plain
processor agreement would misdescribe the phone path. Counsel must confirm this
legal position before go-live.

A caller who says their name or a texter who signs has chosen to be named. The
name stays in the private transcript or message and reaches the municipality.
Polis neither removes nor adds it. The public page still shows only the summary
approved by a reviewer.

The target copy for the phone channel help block and spoken prompt is:

> Polis čuva vaš broj samo da bi vam mogao odgovoriti. Općina ga ne dobiva. Broj se otkriva samo na zakonit zahtjev u kaznenom postupku.

The native Croatian editor must approve this copy. Updating
`apps/web` `VrsarChannelHelp` is a separate task; this plan does not change the
code.

## Retention

- The target retention rule for the gateway vault is to purge a number and its contact-data links 30 days after the case closes or after its last message. The code will follow this case-tied rule.
- The gateway deletes Infobip recordings and transcripts after processing. Set the Infobip account retention to the minimum.
- The gateway zeroes the in-memory original after transcription and distortion. It never stores original audio.
- The default audio sink retains no distorted audio after transcription. Any non-default sink needs a written purpose, access rule, and shorter explicit retention period before use.
- Voice transcripts and SMS reports remain private case messages under the municipality's case-retention schedule. Public shells contain no narrative.
- Keep public case shells only under the pilot charter's public archive decision.

## Provider configuration

Set these values for the live provider:

- `CHANNEL_PROVIDER=infobip`
- `INFOBIP_BASE_URL`
- `INFOBIP_API_KEY`
- `INFOBIP_WEBHOOK_SECRET`
- `INFOBIP_WEBHOOK_SIGNATURE_HEADER`, default `x-hub-signature`
- `INFOBIP_SENDER`
- `INFOBIP_CALLS_CONFIGURATION_ID`
- `INFOBIP_TTS_LANGUAGE`, default `hr`
- `INFOBIP_TTS_VOICE`

The only channel provider values are `stub` and `infobip`.

## Public pricing reference

Infobip's public list gives these usage prices for planning:

- Recording: `0.0021 EUR/min`
- Transcription: `0.0402 EUR/min`
- TTS: `0.00002 EUR/character`
- Number rental: price on request

## Infobip go-live checklist

Do not set `CHANNEL_PROVIDER=infobip` until every item has an owner and dated evidence.

- [ ] Confirm live availability and price of one `+385` Virtual Long Number with both SMS and VOICE capability with Infobip at its Vodnjan office, `+385 52 635 826`.
- [ ] L1: Name Intrface j.d.o.o. as controller for phone numbers and the relay, and the municipality as controller for case content. Have counsel confirm these roles before signing the agreement.
- [ ] L2: Sign the Infobip DPA with EU processing and an EU region lock. List Infobip as a subprocessor. Provision the number with SMS and VOICE. Configure all three subscriptions with HMAC.
- [ ] L3: Choose the speech-to-text path after the pilot comparison. Run Whisper inside Polis infrastructure or use Infobip transcription under the same DPA.
- [ ] Sign the AI provider DPA before any channel report reaches that provider.
- [ ] Record the lawful basis for call recording and approve the spoken recording notice.
- [ ] Name the controller contact, processor contact, privacy owner, security owner, channel operator, incident owner, and deletion owner.
- [ ] L8: Capture one live inbound SMS, one delivery report, and one full call event sequence with a recording file. Confirm the event names, signature header format, and transcription endpoint with Infobip before changing `CHANNEL_PROVIDER` to `infobip`.
- [ ] Obtain native Croatian sign-off for the SMS, call prompt, readback, stop, error, and status copy.
- [ ] Verify rate caps per hashed number and per case, `STOP`/`STOJ`/`PREKID` blocking, webhook spoof rejection, provider recording and transcript deletion, and the case-tied vault purge.
- [ ] Set the Infobip account's recording and transcript retention to the minimum.
- [ ] Set `CHANNEL_PROCESSING_AGREEMENT=true` only after the agreements and checks above are complete.
