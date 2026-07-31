# Charter Signing: Operator and Reviewer Guide

## Scope

`document-signing-service` turns a pending mandate-holder charter into a signed,
proof-backed charter. It renders a deterministic unsigned PDF, sends it to a
provider, stores the exact signed bytes, registers a proof over those bytes,
and only then marks the charter `accepted`.

Provider completion records a named person completing a standard electronic
signing ceremony. It is not an advanced or qualified electronic signature and
does not prove identity assurance by itself. The Polis institutional seal and
RFC 3161 timestamp cover the proof manifest, not the human signature. Local
defaults use test/stub material.

## Architecture

`platform-api` is the public BFF. It verifies citizen sessions, injects the
trusted actor and internal token, and proxies charter requests to
`document-signing-service` on port `8960`. The signing service uses:

- Postgres for charters, signing requests, recipients, lifecycle events,
  artifact metadata, and database-mode artifact bytes;
- `proof-service` for the public proof manifest;
- `paperless-adapter` for best-effort restricted archival;
- `audit-service` for best-effort restricted lifecycle events;
- either the in-process stub provider or Documenso API v2;
- either Postgres or private S3-compatible storage for PDF bytes.

All `/internal/*` routes fail closed behind `X-Polis-Internal-Token`. The BFF's
`POST /webhooks/documenso` ingress forwards the raw body and
`X-Documenso-Secret`; the signing service checks both secrets.

## Modes

### Stub mode

Set `SIGNING_PROVIDER=stub`, the default. The provider keeps envelopes in
memory. The signer completes a request through
`POST /api/v1/signing-requests/:id/stub-complete`. The stub appends a marker
that says the output is test-only and has no legal validity. Restarting the
service loses the in-memory provider envelopes, so stub mode is for local
contract testing.

### Documenso mode

Set `SIGNING_PROVIDER=documenso`. The service uses the Documenso v2 Envelope API
to create and distribute the PDF, read envelope state, and download the signed
PDF. Documenso sends wake-up events to `POST /webhooks/documenso`. Polis still
confirms state with provider GET before it accepts a charter.

## Configuration

### Shared configuration

`DATABASE_URL` and `INTERNAL_API_TOKEN` are required. The other values below
have code defaults, but Compose supplies service-network URLs explicitly.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Signing state and database-mode artifact bytes. |
| `INTERNAL_API_TOKEN` | Shared fail-closed token for every internal call. |
| `SIGNING_PROVIDER` | `stub` or `documenso`; defaults to `stub`. |
| `ARTIFACT_STORE_MODE` | `database` or `s3`; defaults to `database`. |
| `SIGNING_INTERNAL_URL` | BFF URL for the signing service; Compose uses `http://document-signing-service:8960`. |
| `PROOF_INTERNAL_URL` | Signing-service URL for `proof-service`; defaults to `http://localhost:8700`. |
| `PAPERLESS_INTERNAL_URL` | Signing-service URL for `paperless-adapter`; defaults to `http://localhost:8300`. |
| `AUDIT_INTERNAL_URL` | Signing-service URL for `audit-service`; defaults to `http://localhost:8600`. |

`SIGNING_RECONCILE_INTERVAL_MS` controls the bounded poll. The code default is
`60000`; Compose sets `30000`. Set `0` only when an operator will reconcile by
another controlled path. `SIGNING_RECONCILE_BATCH_SIZE` defaults to `25` and
must be an integer from `1` through `100`.

### Documenso

All three values are required when `SIGNING_PROVIDER=documenso`; startup fails
if one is blank:

- `DOCUMENSO_API_URL`, ending at the v2 base such as
  `https://sign.example/api/v2`;
- `DOCUMENSO_API_TOKEN`;
- `DOCUMENSO_WEBHOOK_SECRET`, also configured on the webhook sender.

The client accepts only HTTP(S), sends the API token as `Authorization`, accepts
only `application/pdf` signed downloads, and limits a download to 20 MiB.

### Artifact storage

`ARTIFACT_STORE_MODE=database` needs no extra artifact variables. It stores PDF
bytes in `document_artifact_blobs` and verifies SHA-256 on write and read.

`ARTIFACT_STORE_MODE=s3` requires:

- `S3_ARTIFACT_ENDPOINT`;
- `S3_ARTIFACT_REGION`;
- `S3_ARTIFACT_BUCKET`;
- `S3_ARTIFACT_ACCESS_KEY_ID`;
- `S3_ARTIFACT_SECRET_ACCESS_KEY`.

Optional settings are `S3_ARTIFACT_PATH_STYLE` (default `true`),
`S3_ARTIFACT_PREFIX` (code default `document-artifacts`), and
`S3_ARTIFACT_SERVER_SIDE_ENCRYPTION`. S3 references are private internal
references, not public URLs. The store verifies SHA-256 after download.

## End-to-end flow

1. Provision a versioned `mandate_holder_charters` row with status `pending`.
   The mandate-holder must be active and its citizen must be
   `verified_official`.
2. The mandate-holder sends
   `POST /api/v1/mandate-holders/:id/charter-signing-requests` with a bearer
   citizen session and a non-empty `Idempotency-Key` header. The BFF maps it to
   `POST /internal/signing/charter-requests` and supplies the trusted actor.
3. The signing service loads the latest pending charter, checks that the caller
   owns the mandate-holder, renders the PDF, hashes it, and stores a restricted
   `charter_unsigned` artifact.
4. The service creates a signing request and signer recipient, creates a
   provider envelope, and distributes it. Reusing the idempotency key returns
   the existing request.
5. The client reads progress through
   `GET /api/v1/mandate-holders/:id/charter-signing-status`. Internal operators
   may inspect `GET /internal/signing/requests/:id` with the internal token.
6. In stub mode, the signer calls
   `POST /api/v1/signing-requests/:id/stub-complete`. In Documenso mode, the
   signer completes the provider ceremony and Documenso may call
   `POST /webhooks/documenso` with `X-Documenso-Secret`.
7. Reconciliation calls provider GET. On completion it downloads the signed
   PDF, computes SHA-256, stores the exact bytes as a restricted
   `charter_signed` artifact, and links it to the unsigned artifact.
8. The service reads the stored bytes back. It sends the same bytes to
   `paperless-adapter` on a best-effort path and registers a proof through
   `POST /internal/proofs/manifests`. Both `originalFileHash` and
   `canonicalPdfHash` equal the signed artifact hash. The proof has restricted
   content visibility and public proof visibility.
9. After proof registration, one database transaction marks the signing request
   `completed`, changes the pending charter to `accepted`, records the signed
   artifact and proof IDs, and appends `completed` and `accepted` events.
10. Publication policy may now accept commitments for that mandate-holder. The
    public `GET /api/v1/mandate-holders/:id` projection exposes safe charter
    status, version, signing time, proof ID, and signed-document hash without
    exposing the charter terms, artifact ID, provider envelope, recipients, or
    PDF bytes.
11. A verifier may use `POST /api/v1/verify/file`,
    `POST /api/v1/verify/hash`, `GET /api/v1/proofs/:id`, and
    `GET /api/v1/proofs/:id/status`.

## Webhooks and reconciliation

A webhook is a wake-up signal, not evidence of completion. The signing service
stores only its event name, payload hash, and dedupe fingerprint. A duplicate
returns `202` with `duplicate: true` and does not schedule another wake-up.
Neither the event body nor its claimed state advances the charter.

The first new event schedules a bounded reconciliation run. The periodic poll
also selects `created`, `distributed`, and `awaiting_signatures` requests. Each
reconciliation reads the envelope through provider GET. Operators can trigger
one request through `POST /internal/signing/requests/:id/reconcile` with the
internal token.

## Failure and retry behavior

- Missing or mismatched internal tokens return `401 internal_auth_required`.
  Missing citizen sessions return `401`; wrong ownership, identity, staff role,
  or signing recipient returns `403`.
- Invalid provider, Documenso, artifact-store, batch-size, or interval settings
  fail startup rather than falling back.
- A rejected, expired, or cancelled provider envelope becomes a terminal
  `declined`, `expired`, or `withdrawn` request. It does not accept the charter.
- A failure after the request row is created but before a provider envelope ID
  is stored can leave a `created` request that the poll cannot advance. Reusing
  its idempotency key returns that row. An operator must inspect and repair the
  request before starting another signing ceremony.
- Background reconciliation catches a request error and retries it on the next
  poll. It does not run overlapping batches.
- A signed-artifact write failure records `artifact_store_error` and leaves the
  request retryable. Later reconciliation reuses an artifact or proof already
  linked to the request.
- A proof registration failure prevents charter acceptance. A later
  reconciliation retries after reading the stored signed artifact.
- Paperless archival and audit emission are best-effort; their failure does not
  block proof registration or acceptance.
- `proof-service` records a proof even if its follow-up seal or timestamp call
  fails. It emits a missed-event audit row and returns empty signature or
  timestamp arrays. Operators must check both before making a trust claim.
- Completed, declined, expired, and withdrawn requests are terminal. Repeated
  completion returns the existing row. The final database transaction changes
  a pending charter once and appends its terminal events once.

## Reviewer checks

Before approval or publication, a reviewer should check:

1. the reviewer entered through a staff session; the review API ignores a
   body-supplied reviewer ID;
2. the mandate-holder and signer identity evidence matches the pilot's stated
   assurance process;
3. the expected provider and charter version were used;
4. the signing request is `completed` and the charter is `accepted`;
5. the signed-document hash matches the public proof;
6. the proof contains the expected Polis seal and timestamp, or records their
   absence without overstating trust;
7. retention, access, supersession, revocation, and incident rules are recorded.

## Public and restricted data

Public data includes the signed-document SHA-256 hash, proof manifest and
status, charter lifecycle status, charter version, signing time, and proof ID.
Public hash verification proves byte identity only. It does not prove truth,
lawfulness, signer identity, or legal acceptance.

Restricted data includes unsigned and signed PDF bytes, charter terms,
artifact storage references, provider envelope and recipient details, signer
contact data, and restricted signing audit events. Artifact content is available
only through `GET /internal/signing/artifacts/:id/content`, which returns
`Cache-Control: private, no-store`.

## Backup and restore targets

Back up these targets together and test a point-in-time restore:

- Postgres signing and charter tables: `mandate_holder_charters`,
  `mandate_holder_charter_events`, `signing_requests`, `signing_recipients`,
  `signing_provider_events`, `document_artifacts`, proof tables, and audit rows;
- `document_artifact_blobs` when `ARTIFACT_STORE_MODE=database`;
- the private S3 bucket, object versions, encryption configuration, and access
  policy when `ARTIFACT_STORE_MODE=s3`;
- Documenso envelopes, completion evidence, provider configuration, and its own
  backup set under the provider's retention contract;
- production Polis institutional-seal certificate and private-key material,
  preferably in its HSM or managed key backup. The charter signing service
  itself owns no signing certificate; `signature-service` owns the proof seal;
- TSA configuration and stored timestamp tokens when real RFC 3161 mode is used;
- secret-manager records for tokens and storage credentials, through the
  secret manager's protected backup process rather than a plaintext export.

A restore is incomplete if database metadata points to missing artifact bytes,
or if a proof cannot be checked against the restored signed PDF.

## Production checklist

Before real use:

- [ ] Approve the legal basis, signature level, identity-check process, privacy notice, and reviewer authority for the jurisdiction.
- [ ] Replace dev identity tokens with real sessions and test the `staff` and `verified_official` gates.
- [ ] Select `documenso`, configure the v2 URL, API token, webhook secret, callback URL, and provider retention policy.
- [ ] Restrict `/webhooks/documenso` at the edge, preserve its raw body, cap it at 1 MiB, and test wrong-secret rejection.
- [ ] Replace local test/stub seal and timestamp modes with approved production services where the legal design requires them.
- [ ] Use private durable artifact storage, encryption at rest, least-privilege credentials, versioning, and tested restore procedures.
- [ ] Rotate `INTERNAL_API_TOKEN`, provider, storage, seal, and TSA secrets through the production secret manager.
- [ ] Set reconciliation interval and batch size for expected load; alert on old non-terminal requests and repeated failures.
- [ ] Test completed, duplicate, rejected, expired, cancelled, provider outage, artifact outage, and proof outage paths.
- [ ] Confirm public responses expose only status, proof, and hash data; test that charter terms, contacts, envelopes, storage references, and PDF bytes stay restricted.
- [ ] Define retention, deletion, legal hold, withdrawal, proof revocation, and charter supersession procedures.
- [ ] Record who monitors Paperless and audit best-effort failures and how they repair missing copies or events.
- [ ] Train reviewers to separate provider signature, Polis seal, timestamp, and hash match in every public statement.
