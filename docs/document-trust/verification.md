# Document Trust: Verification

Local v1 now demonstrates a proof registry v0. It supports document ingestion, hash verification, proof manifests, verifier lookup pages, test-key signatures, RFC3161-stub timestamps, and local supersession/revocation status handling. It does not provide production timestamping, qualified signatures, qualified trust services, court/registry acceptance, or long-term archival guarantees.

## Current services

| Service | Port | Purpose |
| --- | ---: | --- |
| `document-ingestion-gateway` | `:8400` | Accepts local document inputs and creates proof records. |
| `proof-service` | `:8700` | Stores proof manifests, issuers, status, and verification lookups. |
| `timestamp-service` | `:8800` | Adds RFC3161-stub timestamps for local verification flows. |
| `signature-service` | `:8900` | Adds test-key signatures for local proof manifests. |
| `document-signing-service` | `:8960` | Creates restricted signed charter artifacts, then registers proofs over their exact bytes. |

## Current routes

- `POST /api/v1/verify/hash` looks up an active proof manifest by submitted SHA-256 hash.
- `POST /api/v1/verify/file` hashes submitted `contentBase64`, then verifies it against active proof manifests.
- `GET /api/v1/proofs/:id` returns proof manifest detail.
- `GET /api/v1/proofs/:id/status` returns the current proof status.
- `GET /api/v1/issuers/:id` returns local issuer detail.
- The verifier proof detail page shows manifest, issuer, status, hash, timestamp, and signature fields where present.

For charter operations, see the
[charter signing operator guide](charter-signing.md).

## What this proves

The local flow proves that ingestion, hash creation, proof manifests, verifier response shapes, status lookup, test signatures, and stub timestamps work together for deterministic local content.

## Four separate trust mechanisms

Do not present these mechanisms as one signature:

1. **Provider signature.** A Documenso completion means a named person completed
   the provider's signing ceremony on a PDF. Polis treats it as a standard
   electronic signature. It is not an advanced or qualified electronic
   signature, and it does not prove identity assurance by itself. Stub mode
   only appends a test marker and has no legal validity.
2. **Polis institutional seal.** `signature-service` signs the proof manifest
   hash, not the PDF or the human signature. The local default uses a
   hard-coded Ed25519 test key. A seal records what Polis registered; it does
   not raise the provider signature's legal level.
3. **Timestamp.** `timestamp-service` timestamps the proof manifest hash, not
   the human signature. Local default mode creates an RFC 3161 stub token from
   the system clock; it is not evidence from a trusted timestamp authority.
4. **Hash verification.** `POST /api/v1/verify/file` hashes the bytes supplied
   by the verifier and looks for a public proof with the same file hash. A
   match proves that the held file is byte-identical to the registered
   artifact. It does not prove that the content is true or lawful, or that the
   signer was who they claimed.

For signed charters, the PDF bytes and artifact download remain `restricted`.
The SHA-256 hash, proof manifest, and lifecycle status are public. Public proof
access is not permission to disclose the charter content.

## Status caveats

- Superseded and revoked proof states are local registry states, not external legal determinations.
- Status precedence is `revoked` over `superseded`; a revoked proof must display as revoked even if it was also superseded.
- Internal supersede/revoke routes support local lifecycle testing and are not public production trust endpoints.

## What this does not prove

- That a real document came from Paperless or another source system.
- That a government, court, registry, or partner signed it.
- That a trusted timestamp authority anchored it.
- That a qualified trust service provider issued the signature or timestamp.
- That a court, registry, or agency accepts it.
- That the document can be made public.

## Production checklist

Production document trust requires document custody rules, object storage, access control, audit events, redaction, production timestamp provider, production signature provider, qualified trust-service decisions where needed, key rotation, retention, issuer governance, verifier UX that clearly distinguishes hash match from legal validity, and rollback/revocation operations.
