# Architecture

Polis Interface v1 is a local-first monorepo. Astro apps provide public/operator surfaces, TypeScript packages hold deterministic domain logic, Postgres stores seeded civic graph/audit/proof/AI state, and service entrypoints expose the current HTTP runtime while production integrations remain mocked. The TypeScript services target Node 24; the FastAPI AI gateway targets Python 3.12.

## Boundaries

- `apps/web`: public landing, status, `/docs`, proof search, verifier entry, and assistant pages.
- `apps/verifier`: public proof-verification UI, including `/proofs/:id` proof detail.
- `apps/vault`: citizen vault UI shell for document custody flows.
- `apps/admin`: operator UI shell, including assistant trace/review pages.
- `packages/domain`: proof hashing and verification helpers retained by the BFF hash verifier.
- `packages/db`: Drizzle schema, migrations, and idempotent seed data for civic graph, document proofs, proof signatures/timestamps, AI traces, review state, and audit events.
- `packages/service-runtime`: shared Node HTTP runtime, operational routes, CORS, route matching, and JSON helpers.
- `packages/policy-rules`: Rego policy files for access, AI, and rewards rules.
- `services/platform-api`: public BFF on :8080; proxies graph/audit/Polis/proof/assistant reads and writes plus authenticated complaint lifecycle routes to `complaints-service`.
- `services/governance-graph-api`: internal graph read API on :8100 backed by Postgres.
- `services/polis-bridge-service`: internal stub Polis bridge on :8200.
- `services/paperless-adapter`: internal stub document intake adapter on :8300.
- `services/document-ingestion-gateway`: internal document pipeline conductor on :8400.
- `services/canonicalization-service`: internal canonical hash service on :8500.
- `services/ai-gateway`: internal assistant/RAG service on :8550 backed by Postgres; `AI_MODE=stub` is deterministic and `AI_MODE=real` selects the OpenAI-compatible provider.
- `services/audit-service`: append-only audit write/read API on :8600 backed by Postgres.
- `services/citizen-identity-service`: local citizen session service on :8650.
- `services/proof-service`: proof registry and public verifier API on :8700 backed by Postgres.
- `services/citizen-vault-service`: citizen document vault service shell on :8750.
- `services/timestamp-service`: internal RFC3161-stub timestamp service on :8800.
- `services/signature-service`: internal test-key signature service on :8900.
- `services/vc-issuer-service`: verifiable credential issuer shell on :8950.
- `services/document-signing-service`: charter rendering and signing coordinator on :8960.
- `services/contribution-service`: evidence-linked claim and review service on :8450.
- `services/rewards-service`: local civic rewards service on :8460.
- `services/complaints-service`: private complaint-case lifecycle service on :8970; accepts only trusted internal callers, emits best-effort audit events, and never exposes resident identifiers or audit correlation identifiers in response shapes.
- `scripts/dev-services.mjs`: catalog-driven local launcher for all 17 Node services; the Python `ai-gateway` stays external.
- `infra/compose/docker-compose.yml`: compose stack for Postgres plus Node/Python services.
- `scripts/v1-smoke.mjs`: smoke test for the documented local API contract.

## Runtime model

The current services are deterministic and Postgres-backed after `bun run db:seed`. They return seeded jurisdictions, institutions, roles, processes, document types, laws, budget lines, failure modes, controls, claims with evidence/sources, graph relationships, public audit rows, local proof-verification results, proof manifests with test-key signatures and RFC3161-stub timestamps, and assistant traces/outputs grounded in approved local public sources.

Node services using `packages/service-runtime` expose:

- `GET /healthz`
- `GET /readyz`
- `GET /metrics`
- `GET /version`
- public `/api/v1/*` or internal routes listed in `docs/architecture/service-map.md`

`services/ai-gateway` is FastAPI-based and exposes `GET /healthz`, `GET /readyz`, `GET /version`, and `/internal/ai/*` routes. Its current `AI_MODE` seam supports deterministic `stub` and OpenAI-compatible `real` providers.

## Integration status

`.env.example` contains production-shaped variables, but local v1 uses `MOCK_EXTERNALS=true`. The following are not live production integrations in this repo:

- Paperless document ingestion
- upstream Polis deployment
- Keycloak/OIDC identity
- payment or reward rails
- external AI model provider
- trusted timestamp authority
- digital signature provider
- government registers or case-management systems
- the private complaints lifecycle; the isolated public-read pilot Compose intentionally omits `complaints-service` and its upstream configuration

## Data and evidence flow

1. Public claims are seeded in `packages/domain` with source references.
2. Governance process endpoints expose institutions and processes.
3. Relationship endpoints expose typed graph edges and traversal from a requested entity.
4. Document ingestion posts base64 content to `document-ingestion-gateway`, which calls the Paperless stub, canonicalization, then `proof-service`.
5. `proof-service` stores the manifest, asks `signature-service` for a test-key signature and `timestamp-service` for an RFC3161-stub timestamp, and emits best-effort audit events.
6. Public verifier routes on `platform-api` proxy hash/file/manifest verification, proof detail, proof status, proof audit, and issuer reads to `proof-service`.
7. Proof status resolves local append-only state with precedence `revoked > superseded > stored registryStatus`.
8. Assistant pages call `platform-api`, which proxies to `ai-gateway`; `ai-gateway` retrieves approved public sources, applies deterministic prompt-injection heuristics, persists traces/outputs/review decisions, and emits best-effort audit events.
9. `POST /internal/audit/events` appends canonical, hash-chained audit rows; public reads return only `visibility: "public"` target rows.
10. `document-signing-service` renders charter PDFs, coordinates the signing provider, archives restricted artifacts, registers proofs, and records acceptance.
11. `complaints-service` accepts private, trusted-actor complaint lifecycle calls, persists owner-scoped cases and decisions, and emits best-effort audit events. It remains outside the isolated public-read pilot profile.

## Design constraint

The architecture intentionally keeps public claims, private documents, private complaint case data, proof manifests, signatures/timestamps, AI review state, and audit events separate. A production cutover must replace mock/test adapters without weakening that separation.
