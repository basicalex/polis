# Service Map

Local v1 services share the HTTP runtime in `packages/service-runtime/src/index.ts`. The route set is intentionally deterministic so contributors and operators can verify behavior without external systems.

## Common operational routes

| Method | Path | Response |
| --- | --- | --- |
| GET | `/healthz` | `{ status: "ok", service }` |
| GET | `/readyz` | `{ status: "ready", service }` |
| GET | `/metrics` | Prometheus-style `polis_service_up` line |
| GET | `/version` | service name, `0.1.0-v1`, and `GIT_SHA` or `dev` |

## v1 API routes

| Method | Path | Current behavior |
| --- | --- | --- |
| GET | `/api/v1/governance/institutions` | Returns seeded demo institution data. |
| GET | `/api/v1/governance/processes` | Returns seeded demo governance process data. |
| GET | `/api/v1/evidence/claims` | Returns seeded public claims and evidence references. |
| GET | `/api/v1/assessment/process-public-complaint` | Runs deterministic process assessment for the demo process. |
| POST | `/api/v1/proofs` | Creates a local proof manifest for submitted `content`. |
| POST | `/api/v1/verify/hash` | Creates a local manifest and verifies its hash for submitted `content`. |
| GET | `/api/v1/polis/conversations` | Returns a mock Polis conversation summary. |
| POST | `/api/v1/ai/explain` | Returns a mock source-linked explanation with `reviewState: "under_review"`. |
| GET | `/api/v1/rewards/rules` | Returns local reward/non-reward rule categories. |
| GET | `/api/v1/audit/events` | Returns a deterministic demo audit event for the service. |

## Local ports

`.env.example` defines the service ports used by the local launcher, including platform API `8080`, governance graph `8100`, Polis adapter `8110`, AI orchestrator `8200`, assessment engine `8300`, document proof `8410`, verifier API `8420`, reward service `8500`, audit service `8600`, and search service `8800`.

## Integration warning

These endpoints prove local contract shape only. They do not prove production Paperless, upstream Polis, identity, payment, timestamp, signature, AI provider, or government connectivity.
