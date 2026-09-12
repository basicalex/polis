# Privacy

Polis Interface separates public civic evidence from private citizen documents. The current local v1 uses seeded demo data and mock external adapters; it is not connected to production identity, Paperless, government registers, or external AI providers.

## Local v1 data

Local endpoints return seeded jurisdictions, institutions, roles, processes, claims with evidence/sources, graph relationships, public audit rows, and local hash-verification responses. Submitted hash-verification content is processed by the local runtime for the request and is not persisted by the BFF verifier.

## Channel intake

The channel-intake path uses stub SMS, voice, and speech-to-text providers by
default. A live path may use Telnyx for SMS and voice transport in its EU region
and a separate speech-to-text vendor. Both are subprocessors and require
approved data-processing terms before use.

`channel-gateway` is the only service that holds a phone number. It seals the
number with AES-256-GCM and indexes it by a municipality-scoped, peppered HMAC
hash. `trace-service` and the municipality receive a case number and reference,
never the number. Phone numbers and their contact-data links must be deleted 90
days after pilot sunset.

Voice recordings are distorted before transcription by pitch and formant shift,
jitter, a 3.4 kHz low-pass filter, and 8 kHz sampling. The original bytes are
discarded. Recordings are deleted after transcription, and the default audio
sink retains no audio. Distortion reduces casual recognition; it does not stop
a determined match against a reference sample.

## Production principles

- Collect the minimum data needed for a civic process.
- Keep private documents out of public deliberation by default.
- Publish claim evidence only when it is lawful, sourced, and reviewed.
- Record audit events for access and changes.
- Make AI assistance reviewable and source-linked.
- Define retention and deletion rules before onboarding partners.

## Operator obligations

A production operator must publish jurisdiction-specific privacy notices, data-processing roles, retention schedules, subprocessors, data-subject request procedures, and breach-notification contacts before collecting real citizen data.
