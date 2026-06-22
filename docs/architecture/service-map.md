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

`ai-gateway` exposes `GET /healthz` and `GET /version`.

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

## Service roles and health

| Service | Port | Role in local v1 | Health |
| --- | ---: | --- | --- |
| `platform-api` | 8080 | Public BFF for graph, Polis, audit, proof, and assistant routes. | `GET /healthz` |
| `governance-graph-api` | 8100 | Postgres-backed civic graph/read model. | `GET /healthz` |
| `polis-bridge-service` | 8200 | Local/stub Polis issue and conversation bridge. | `GET /healthz` |
| `paperless-adapter` | 8300 | Stub document intake/archive adapter. | `GET /healthz` |
| `document-ingestion-gateway` | 8400 | Upload pipeline conductor: Paperless stub → canonicalization → proof registry. | `GET /healthz` |
| `canonicalization-service` | 8500 | Stateless SHA-256 hash bundle generator for proof manifests. | `GET /healthz` |
| `ai-gateway` | 8550 | FastAPI deterministic assistant/RAG service with trace/output/review state. | `GET /healthz` |
| `audit-service` | 8600 | Append-only hash-chained audit writer and public audit reader. | `GET /healthz` |
| `proof-service` | 8700 | Proof registry plus public verification/detail/status API. | `GET /healthz` |
| `timestamp-service` | 8800 | Internal RFC3161-stub timestamp issuer for proof hashes. | `GET /healthz` |
| `signature-service` | 8900 | Internal test-key signature issuer and issuer registry reader. | `GET /healthz` |

## Internal service routes

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

## Local ports

`infra/compose/docker-compose.yml` defines Postgres `5432`, platform API `8080`, governance graph `8100`, Polis bridge `8200`, Paperless adapter `8300`, document-ingestion gateway `8400`, canonicalization `8500`, AI gateway `8550`, audit service `8600`, proof service `8700`, timestamp service `8800`, and signature service `8900`. `scripts/dev-services.mjs` launches the TypeScript services currently listed in that script: governance graph `8100`, audit service `8600`, Paperless adapter `8300`, canonicalization `8500`, proof service `8700`, document-ingestion gateway `8400`, and platform API `8080`.

## Integration warning

These endpoints prove local contract shape only. They do not prove production Paperless, upstream Polis, identity, payment, trusted timestamp authority, digital signature provider, external AI model provider, or government connectivity. The current AI v0 path is deterministic local RAG over approved public sources with heuristic injection handling and append-only review state; the signature/timestamp paths use local test/stub providers.
