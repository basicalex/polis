# Document Trust: Verification

Local v1 demonstrates hash-based proof manifests. It does not provide production timestamping, digital signatures, qualified trust services, or long-term archival guarantees.

## Current routes

- `POST /api/v1/proofs` creates a local proof manifest for submitted `content`.
- `POST /api/v1/verify/hash` creates a local manifest and verifies the submitted content hash against it.

## What this proves

The local flow proves that the service contract, hashing path, and verifier response shape work for deterministic content.

## What this does not prove

- That a real document came from Paperless.
- That a government or partner signed it.
- That a trusted timestamp authority anchored it.
- That a court, registry, or agency accepts it.
- That the document can be made public.

## Production checklist

Production document trust requires document custody rules, object storage, access control, audit events, redaction, timestamp provider, signature provider, key rotation, retention, and verifier UX that clearly distinguishes hash match from legal validity.
