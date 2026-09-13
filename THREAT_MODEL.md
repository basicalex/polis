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
- Compelled disclosure or insider decryption of a phone number.
- Re-identifying a distorted voice with a known reference sample.
- Guessing or enumerating public case shells.
- Abusing the relay to send messages to a victim's number.
- Spoofing SMS or voice webhooks.

## Current controls in local v1

- Deterministic seeded data avoids real citizen records.
- Proof verification is hash-based and local.
- AI responses are marked `under_review` and use mock model metadata.
- Services expose health/readiness/version endpoints for operational checks.
- Documentation states that production integrations are not live.
- `channel-gateway` alone holds AES-256-GCM-sealed phone numbers. It computes a
  municipality-scoped, peppered HMAC hash only for abuse limits. Trace and
  municipal users receive only a case number and gateway reference.
- Only the operator's vault key holder can decrypt a number. Each decryption is
  written to the audit trail with the lawful request reference. The target TTL
  purges the vault record 30 days after the case closes or its last message.
  The municipality has no key and no path to the phone-number vault.
- Infobip mode verifies `X-Hub-Signature` as HMAC-SHA256 over the raw body
  using a constant-time comparison. The signature has no timestamp.
  `channel_events` rejects duplicate event identifiers until their TTL expires.
  Notification-profile mTLS is an optional extra layer. Stub injection is
  unavailable outside the stub provider.
- Per-hash, per-case, and provider-wide rate caps limit intake and relay abuse.
  `STOP`, `STOJ`, and `PREKID` block a number.
- Voice is transcribed from the original in memory, then pitch/formant shifted
  and downsampled to 8 kHz. The original bytes are zeroed, and the default audio
  sink keeps no distorted copy. Voice re-identification remains a residual risk.
- Case numbers use `VRS-` plus six random digits with no leading zero. This
  prevents sequential enumeration and avoids leaking the public case count.
  Public shells expose no narrative or phone data.
- Non-stub channel or speech-to-text providers fail closed unless
  `CHANNEL_PROCESSING_AGREEMENT=true`.


The [isolated public-read pilot runbook](docs/operations/isolated-pilot-runbook.md) defines a separate synthetic/public-data-only deployment boundary, its fail-closed preflight, and its incident shutdown procedure. It does not satisfy the production controls below.

## Required production controls

Production deployments need authenticated identity, role-based authorization, encrypted storage, append-only audit integrity, secret management, backup/restore tests, provider security reviews, incident response, and partner-specific data-sharing agreements.
