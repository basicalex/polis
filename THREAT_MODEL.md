# Threat Model

## Assets

- Private citizen documents and metadata.
- Public evidence claims and source references.
- Proof manifests and hashes.
- Governance process records.
- Audit events.
- Operator credentials and service secrets.
- AI prompts, outputs, citations, and review decisions.
- Channel phone numbers and their sealed lookup records.
- Source and distorted voice recordings.
- Private SMS reports and voice transcripts.

## Primary threats

- Publishing private documents or personal data as public evidence.
- Forging or replaying proof manifests.
- Tampering with audit events.
- Letting mock adapters be mistaken for production integrations.
- Prompt injection or unsupported AI claims influencing civic decisions.
- Unauthorized operator access to vault, admin, or partner data.
- Supply-chain compromise of app/service dependencies.
- Linking a phone number to a case by webhook, relay, or staff-action timing.
- Re-identifying a distorted voice with a known reference sample.
- Enumerating sequential public case shells.
- Abusing the relay to send messages to a victim's number.
- Spoofing SMS or voice webhooks.

## Current controls in local v1

- Deterministic seeded data avoids real citizen records.
- Proof verification is hash-based and local.
- AI responses are marked `under_review` and use mock model metadata.
- Services expose health/readiness/version endpoints for operational checks.
- Documentation states that production integrations are not live.
- `channel-gateway` alone holds AES-256-GCM-sealed phone numbers and uses a
  municipality-scoped, peppered HMAC hash for lookup. Trace and municipal users
  receive only a case number and gateway reference.
- Telnyx mode verifies Ed25519 webhook signatures and bounded timestamps. Stub
  injection is unavailable outside the stub provider.
- Per-hash, per-case, and provider-wide rate caps limit intake and relay abuse.
  `STOP`, `STOJ`, and `PREKID` block a number.
- Voice is pitch/formant shifted, jittered, low-pass filtered, and downsampled
  before transcription. Original bytes are discarded, and the default audio
  sink keeps nothing after transcription. Voice re-identification remains a
  residual risk.
- Case numbers are sequential per municipality, so shell enumeration is by
  design. Public shells expose no narrative or phone data.
- Non-stub channel or speech-to-text providers fail closed unless
  `CHANNEL_PROCESSING_AGREEMENT=true`.


The [isolated public-read pilot runbook](docs/operations/isolated-pilot-runbook.md) defines a separate synthetic/public-data-only deployment boundary, its fail-closed preflight, and its incident shutdown procedure. It does not satisfy the production controls below.

## Required production controls

Production deployments need authenticated identity, role-based authorization, encrypted storage, append-only audit integrity, secret management, backup/restore tests, provider security reviews, incident response, and partner-specific data-sharing agreements.
