# Service Map

Local v1 Node services share the HTTP runtime in `packages/service-runtime/src/index.ts`; `services/ai-gateway` is a FastAPI service. The route set is deterministic and backed by seeded/local Postgres so contributors and operators can verify behavior without external systems.

## Common operational routes

Node services using `packages/service-runtime` expose:

| Method | Path | Response |
| --- | --- | --- |
| GET | `/healthz` | `{ status: "ok", service }` |
| GET | `/readyz` | `{ status: "ready", service }` |
| GET | `/metrics` | Prometheus-style `polis_service_up` line |
| GET | `/version` | service name, `0.1.0-v1`, and `GIT_SHA` or `dev` |

`ai-gateway` exposes equivalent `GET /healthz`, `GET /readyz`, and `GET /version` routes. `AI_MODE=stub` is deterministic; `AI_MODE=real` selects its OpenAI-compatible provider.

## v1 API routes exposed through `platform-api` (:8080)

| Method | Path | Current behavior |
| --- | --- | --- |
| GET | `/api/v1/jurisdictions` | Returns seeded jurisdictions. |
| GET | `/api/v1/institutions` | Returns seeded institutions; optional `jurisdiction_id` filter. |
| GET | `/api/v1/institutions/:id` | Returns an institution plus `roles[]`. |
| GET | `/api/v1/roles/:id` | Returns a role plus mandate fields when present. |
| GET | `/api/v1/processes` | Returns process summaries. |
| GET | `/api/v1/processes/:id` | Returns process detail with `steps`, `requiredDocuments`, and failure modes. |
| GET | `/api/v1/document-types/:id` | Returns a seeded document type. |
| GET | `/api/v1/laws/:id` | Returns a seeded law. |
| GET | `/api/v1/budget-lines/:id` | Returns a seeded budget line. |
| GET | `/api/v1/failure-modes` | Returns seeded failure modes. |
| GET | `/api/v1/controls` | Returns seeded controls. |
| GET | `/api/v1/proposals/:id` | Reserved; currently returns `404 not_found`. |
| GET | `/api/v1/assessments/:id` | Reserved; currently returns `404 not_found`. |
| GET | `/api/v1/claims` | Returns claims hydrated with evidence links and sources; optional `subject_id` filter. |
| GET | `/api/v1/claims/:id` | Returns one hydrated claim. |
| GET | `/api/v1/relationships` | Returns typed graph edges; optional `type`, `from_id`, `to_id` filters. |
| GET | `/api/v1/graph/traverse` | Returns outgoing graph edges for `entity_id` + `entity_type`. |
| GET | `/api/v1/issues` | Proxies to the Polis bridge and returns seeded/local issue summaries; optional `jurisdiction_id` and `process_id` filters. |
| GET | `/api/v1/issues/:id` | Returns one issue plus latest local conversation/result when present. |
| GET | `/api/v1/processes/:id/issues` | Returns local issues for a process. |
| GET | `/api/v1/issues/:id/conversation` | Returns latest local conversation embed metadata for an issue. |
| POST | `/api/v1/verify/hash` | Looks up an active proof manifest by submitted `hash`; returns `valid` with manifest or `not_found`. |
| POST | `/api/v1/verify/file` | Hashes submitted `contentBase64`, then verifies it against active proof manifests. |
| POST | `/api/v1/verify/manifest` | Looks up an active proof manifest by `manifestHash`; returns `valid` or `not_found`. |
| GET | `/api/v1/proofs/:id` | Returns proof manifest detail with signatures, timestamps, supersession, and revocation state. |
| GET | `/api/v1/proofs/:id/status` | Returns effective proof status; local precedence is `revoked > superseded > registryStatus`. |
| GET | `/api/v1/proofs/:id/audit` | Returns proof audit rows from local Postgres. |
| GET | `/api/v1/issuers/:id` | Returns proof issuer details or the demo-authority fallback. |
| GET | `/api/v1/audit/:objectType/:objectId` | Returns public redacted audit rows for a target. |
| POST | `/api/v1/assistant/ask` | Proxies to the local assistant; deterministic RAG over approved public sources or injection/no-source refusal. |
| GET | `/api/v1/assistant/traces` | Lists recent assistant traces with outputs. |
| GET | `/api/v1/assistant/traces/:id` | Returns one assistant trace and its outputs. |
| GET | `/api/v1/assistant/outputs/:id` | Returns one assistant output with effective review state and review history. |
| POST | `/api/v1/assistant/outputs/:id/review` | Appends an approved/rejected human review decision and returns effective state. |
| POST | `/api/v1/mandate-holders/:id/charter-signing-requests` | Requires a citizen session and `Idempotency-Key`; starts signing for the caller's pending charter. |
| GET | `/api/v1/mandate-holders/:id/charter-signing-status` | Requires a citizen session; returns the latest signing request for the mandate-holder. |
| POST | `/api/v1/signing-requests/:id/stub-complete` | Requires the signer citizen's session; completes and reconciles a stub request. |
| POST | `/webhooks/documenso` | Forwards the raw body and `X-Documenso-Secret` to the signing service. |
| POST | `/api/v1/complaints` | Requires a citizen session; creates a resident-owned complaint case. |
| GET | `/api/v1/complaints/mine` | Requires a citizen session; lists the caller's complaint summaries. |
| GET | `/api/v1/complaints/queue` | Requires a staff session and authorized complaints right; lists the intake queue. |
| GET | `/api/v1/complaints/:id` | Requires a citizen session; returns owner- or authorized-staff-readable case detail. |
| POST | `/api/v1/complaints/:id/assign` | Requires authorized intake staff; assigns a submitted case. |
| POST | `/api/v1/complaints/:id/information-requests` | Requires authorized staff; requests case information. |
| POST | `/api/v1/complaints/:id/information-requests/:requestId/respond` | Requires the owner session; responds to a pending information request. |
| POST | `/api/v1/complaints/:id/decisions` | Requires the assigned initial decision officer; records the initial decision. |
| POST | `/api/v1/complaints/:id/appeals` | Requires the owner session; files one appeal after the initial decision. |
| POST | `/api/v1/complaints/:id/appeals/:appealId/decisions` | Requires an independent appeal officer; decides the appeal and closes the case. |
| POST | `/api/v1/complaints/:id/close` | Requires the assigned initial decision officer; closes an unappealed decided case. |

`platform-api` maps authenticated `/api/v1/complaints*` routes to `complaints-service` through `COMPLAINTS_INTERNAL_URL` in the development Compose stack. The BFF verifies the session and injects the trusted actor plus service token; direct `/internal/complaints*` calls remain private.

## Service roles and health

<!-- service-catalog:service-map:start -->
| Service | Runtime | Port | Role in local v1 | Operational health | Dev order |
| --- | --- | ---: | --- | --- | ---: |
| `platform-api` | Node 24 | 8080 | Public BFF for governance, proof, assistant, citizen, signing, contribution, rewards, and complaint routes. | `GET /readyz` | 17 |
| `governance-graph-api` | Node 24 | 8100 | Postgres-backed civic graph and governance read API. | `GET /readyz` | 1 |
| `polis-bridge-service` | Node 24 | 8200 | Local Polis issue and conversation bridge with a provider seam. | `GET /readyz` | 3 |
| `paperless-adapter` | Node 24 | 8300 | Document intake and archive adapter for stub or Paperless backends. | `GET /readyz` | 4 |
| `document-ingestion-gateway` | Node 24 | 8400 | Orchestrates document intake, canonicalization, and proof registration. | `GET /readyz` | 9 |
| `contribution-service` | Node 24 | 8450 | Persists evidence-linked claims and review decisions. | `GET /readyz` | 14 |
| `rewards-service` | Node 24 | 8460 | Runs the local civic rewards prototype. | `GET /readyz` | 13 |
| `canonicalization-service` | Node 24 | 8500 | Creates deterministic SHA-256 document hash bundles. | `GET /readyz` | 5 |
| `ai-gateway` | Python 3.12 | 8550 | FastAPI grounded-RAG assistant with stub and OpenAI-compatible provider modes. | `GET /readyz` | external |
| `audit-service` | Node 24 | 8600 | Stores and reads append-only hash-chained audit events. | `GET /readyz` | 2 |
| `citizen-identity-service` | Node 24 | 8650 | Provides local HMAC-based citizen sessions. | `GET /readyz` | 10 |
| `proof-service` | Node 24 | 8700 | Stores proof manifests and serves verification, status, and issuer reads. | `GET /readyz` | 8 |
| `citizen-vault-service` | Node 24 | 8750 | Provides the citizen document vault service shell. | `GET /readyz` | 11 |
| `timestamp-service` | Node 24 | 8800 | Issues local RFC 3161-style timestamps behind a provider seam. | `GET /readyz` | 6 |
| `signature-service` | Node 24 | 8900 | Issues test-key proof signatures and exposes the issuer registry. | `GET /readyz` | 7 |
| `vc-issuer-service` | Node 24 | 8950 | Provides the verifiable credential issuer service shell. | `GET /readyz` | 12 |
| `document-signing-service` | Node 24 | 8960 | Renders charter PDFs and coordinates signing, storage, proof registration, and acceptance. | `GET /readyz` | 15 |
| `complaints-service` | Node 24 | 8970 | Manages private resident complaint cases, staff decisions, and appeals. | `GET /readyz` | 16 |
<!-- service-catalog:service-map:end -->

`document-signing-service` depends on Postgres, `proof-service`,
`paperless-adapter`, and `audit-service`. Proof registration blocks charter
acceptance. Paperless archival and audit emission are best-effort.

`complaints-service` depends on Postgres and `audit-service`. Its case content, resident ownership identifier, and audit correlation identifier are private; serialized responses omit the latter two.

The isolated public-read pilot Compose deliberately omits `complaints-service`, its port, and `COMPLAINTS_INTERNAL_URL`.

## Internal service routes

Every `/internal/*` route requires `X-Polis-Internal-Token`. The shared runtime
returns `401 internal_auth_required` when `INTERNAL_API_TOKEN` is missing or the
header does not match. The public BFF injects this header for service calls. The
Documenso webhook also requires `X-Documenso-Secret`.

| Service | Port | Method | Path | Current behavior |
| --- | ---: | --- | --- | --- |
| `polis-bridge-service` | 8200 | POST | `/internal/polis/conversations` | Creates a local/stub Polis conversation for an issue and emits best-effort audit. |
| `polis-bridge-service` | 8200 | POST | `/internal/polis/conversations/:id/sync` | Appends a local/stub conversation result snapshot and emits best-effort audit. |
| `paperless-adapter` | 8300 | POST | `/internal/paperless/consume` | Accepts base64 document content and returns deterministic stub intake metadata. |
| `paperless-adapter` | 8300 | GET | `/internal/paperless/documents/:id` | Returns stub document metadata or `404 not_found`. |
| `paperless-adapter` | 8300 | GET | `/internal/paperless/documents/:id/original` | Returns a stub original document reference. |
| `paperless-adapter` | 8300 | GET | `/internal/paperless/documents/:id/archive` | Returns a stub archive reference. |
| `paperless-adapter` | 8300 | GET | `/internal/paperless/documents/:id/metadata` | Returns stub document metadata. |
| `paperless-adapter` | 8300 | POST | `/internal/paperless/documents/:id/reprocess` | Returns the existing stub document when present. |
| `document-ingestion-gateway` | 8400 | POST | `/internal/ingestion/documents` | Orchestrates Paperless consume → canonicalization → proof manifest creation; returns the created manifest or `502` naming the failed stage. |
| `canonicalization-service` | 8500 | POST | `/internal/canonicalization/canonicalize` | Hashes submitted content/metadata into original, canonical PDF, OCR text, metadata, and manifest SHA-256 values. |
| `ai-gateway` | 8550 | POST | `/internal/ai/answer` | Deterministic local assistant answer, trace, output, citations, risk flags, and audit event. |
| `ai-gateway` | 8550 | GET | `/internal/ai/traces` | Lists recent assistant traces. |
| `ai-gateway` | 8550 | GET | `/internal/ai/traces/:id` | Returns one assistant trace. |
| `ai-gateway` | 8550 | GET | `/internal/ai/outputs/:id` | Returns one assistant output and review history. |
| `ai-gateway` | 8550 | POST | `/internal/ai/outputs/:id/review` | Appends an assistant output review decision. |
| `audit-service` | 8600 | POST | `/internal/audit/events` | Appends a canonical, hash-chained audit row. |
| `proof-service` | 8700 | POST | `/internal/proofs/manifests` | Persists a proof manifest, then best-effort requests a test signature and stub timestamp. |
| `proof-service` | 8700 | POST | `/internal/proofs/:id/supersede` | Appends local supersession state; latest row wins unless revoked. |
| `proof-service` | 8700 | POST | `/internal/proofs/:id/revoke` | Appends local revocation state; revocation takes precedence over supersession. |
| `timestamp-service` | 8800 | POST | `/internal/timestamps` | Persists an RFC3161-stub timestamp for a proof/hash. |
| `timestamp-service` | 8800 | GET | `/internal/timestamps/:proofId` | Lists timestamps for a proof. |
| `signature-service` | 8900 | POST | `/internal/signatures` | Upserts a local issuer and persists a test-key signature for a proof/hash. |
| `signature-service` | 8900 | GET | `/internal/signatures/:proofId` | Lists signatures for a proof. |
| `signature-service` | 8900 | GET | `/internal/issuers/:id` | Reads an internal issuer row. |
| `complaints-service` | 8970 | POST | `/internal/complaints` | Creates a resident-owned complaint case. |
| `complaints-service` | 8970 | GET | `/internal/complaints/mine` | Lists complaint summaries owned by the trusted resident. |
| `complaints-service` | 8970 | GET | `/internal/complaints/queue` | Lists cases for authorized complaint staff. |
| `complaints-service` | 8970 | GET | `/internal/complaints/:id` | Returns owner- or authorized-staff-readable case detail. |
| `complaints-service` | 8970 | POST | `/internal/complaints/:id/assign` | Intake staff route a submitted case to an initial decision holder. |
| `complaints-service` | 8970 | POST | `/internal/complaints/:id/information-requests` | Authorized staff request case information. |
| `complaints-service` | 8970 | POST | `/internal/complaints/:id/information-requests/:requestId/respond` | The owner responds to a pending information request. |
| `complaints-service` | 8970 | POST | `/internal/complaints/:id/decisions` | Assigned initial decision staff record a decision. |
| `complaints-service` | 8970 | POST | `/internal/complaints/:id/appeals` | The case owner files one appeal after the initial decision. |
| `complaints-service` | 8970 | POST | `/internal/complaints/:id/appeals/:appealId/decisions` | An independent appeal officer decides and closes the case. |
| `complaints-service` | 8970 | POST | `/internal/complaints/:id/close` | Assigned initial decision staff close an unappealed decided case. |
| `document-signing-service` | 8960 | POST | `/internal/signing/charter-requests` | Renders and stores a pending charter PDF, then creates and distributes a provider envelope. |
| `document-signing-service` | 8960 | GET | `/internal/signing/charter-status/:mandateHolderId` | Returns the holder's latest signing request. |
| `document-signing-service` | 8960 | GET | `/internal/signing/requests/:id` | Returns one signing request. |
| `document-signing-service` | 8960 | POST | `/internal/signing/requests/:id/reconcile` | Reads the provider envelope and advances local state. |
| `document-signing-service` | 8960 | POST | `/internal/signing/requests/:id/stub-complete` | In stub mode, completes the signing recipient's test envelope and reconciles it. |
| `document-signing-service` | 8960 | GET | `/internal/signing/artifacts/:id/content` | Downloads restricted artifact bytes with private, no-store caching. |
| `document-signing-service` | 8960 | POST | `/internal/signing/webhooks/documenso` | Deduplicates a secret-authenticated wake-up event and schedules reconciliation. |

## Local ports

The generated service table above is the canonical local port map. Compose publishes only `platform-api` at host port `8080`; Postgres and internal services use `expose`. `scripts/dev-services.mjs` launches all 17 catalogued Node services in the listed dependency-safe order and supplies their development internal URLs. The Python `ai-gateway` remains an external process.

## Integration warning

These endpoints prove local contract shape only. They do not prove production
Paperless, upstream Polis, identity, payment, trusted timestamp authority,
electronic-signature provider, external AI model provider, or government
connectivity. The AI path uses deterministic local RAG over approved public sources in `AI_MODE=stub`; `AI_MODE=real` calls the configured OpenAI-compatible provider. Both modes retain heuristic injection handling and append-only review state.
Provider completion does not make the human signature advanced or qualified.
The local Polis seal and timestamp use test/stub material. See
[Document Trust: Verification](../document-trust/verification.md) and the
[charter signing operator guide](../document-trust/charter-signing.md).
