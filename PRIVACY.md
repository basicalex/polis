# Privacy

Polis Interface separates public civic evidence from private citizen documents. The current local v1 uses seeded demo data and mock external adapters; it is not connected to production identity, Paperless, government registers, or external AI providers.

## Local v1 data

Local endpoints return seeded jurisdictions, institutions, roles, processes, claims with evidence/sources, graph relationships, public audit rows, and local hash-verification responses. Submitted hash-verification content is processed by the local runtime for the request and is not persisted by the BFF verifier.

## Channel intake

The channel-intake path uses stub SMS, voice, and speech-to-text providers by
default. The live SMS and voice subprocessor is Infobip d.o.o., Istarska 157,
Vodnjan, Croatia. Infobip processes the dedicated Croatian number in EU data
centres. Polis will request an EU region-locked configuration and sign a DPA
before go-live.

Self-hosted Whisper is the default live speech-to-text path. It runs inside
Polis infrastructure and transcribes the original recording in memory. Infobip
`hr-HR` transcription is the alternative for keeping voice and transcription
with one vendor under the same DPA.

`channel-gateway` is the only service that holds a phone number. It seals the
number with AES-256-GCM and computes a municipality-scoped, peppered HMAC hash
only for abuse limits. It decrypts the number only for outbound delivery.
`trace-service`, the case record, the public shell, and the municipality never
receive the number. The target rule is to purge the vault record and its
contact-data links 30 days after the case closes or its last message.

The gateway never persists the original recording. It transcribes the original
in memory, then applies pitch and formant shift and converts the audio to 8 kHz.
It zeroes the original bytes after processing. Infobip recordings and
transcripts are deleted after processing, and the provider account retention is
set to the minimum. Only distorted audio may be stored, and the default audio
sink retains none. Distortion reduces casual recognition; it does not stop a
determined match against a reference sample.

The spoken prompt does not promise anonymity because the caller's number enters
the carrier's systems; it says instead that the number is never linked to the
public case or sent to the municipality.

### Who can learn your number

Polis needs your number so it can receive your report and reply. The
municipality does not receive it. A written police or court request under
Croatian criminal procedure law may require the Polis operator, Intrface
j.d.o.o., to disclose it for a criminal case. The request goes to the operator,
not the municipality, because the municipality has no number to hand over.
Only the operator's vault key holder can decrypt a number. Every decryption is
written to the audit trail with the request reference. Polis tells the person
about the disclosure unless the law forbids notice.

The target retention period is part of this promise. The vault record is purged
30 days after the case closes or its last message. After purge, there is no
number to disclose.

Intrface j.d.o.o. decides why phone numbers and the relay are processed, so it
is the controller for that contact data. The municipality is the controller for
the case content. The L1 agreement must describe these separate roles. Counsel
must confirm them before go-live because a processor-only agreement would
misdescribe the phone path.

If a caller says their name or a texter signs their message, that name stays in
the private transcript or message and reaches the municipality. Polis neither
removes nor adds a name. The public page still shows only the summary approved
by a reviewer.

## Production principles

- Collect the minimum data needed for a civic process.
- Keep private documents out of public deliberation by default.
- Publish claim evidence only when it is lawful, sourced, and reviewed.
- Record audit events for access and changes.
- Make AI assistance reviewable and source-linked.
- Define retention and deletion rules before onboarding partners.

## Operator obligations

A production operator must publish jurisdiction-specific privacy notices, data-processing roles, retention schedules, subprocessors, data-subject request procedures, and breach-notification contacts before collecting real citizen data.
