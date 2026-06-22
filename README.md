# Polis Interface

Polis Interface is a local v1 civic-infrastructure prototype for source-linked governance maps, public audit trails, and proof-oriented transition pilots.

This repository currently proves the local contract: seeded governance data in Postgres, a public BFF, internal governance/audit/proof/document/AI services, Astro public/operator app shells, and deterministic acceptance checks. It is not a production deployment.

## Current state

Local v1 runs the full mock-provider stack in Docker Compose: governance graph, audit, proof, document ingestion, timestamp, signature, deterministic AI, and the public BFF, plus Astro apps. `.env.example` sets `MOCK_EXTERNALS=true`; Paperless, upstream Polis, Keycloak/OIDC, external AI, payment rails, production timestamp/signature providers, and government systems are not live integrations in this local v1.

## Requirements

- Node.js compatible with the checked lockfile
- pnpm 10.x (`packageManager` is `pnpm@10.33.0`)

## Local setup

### Option A — Docker Compose (recommended, full stack)

```bash
pnpm install
docker compose -f infra/compose/docker-compose.yml up -d --build --wait
pnpm db:seed          # migrate + idempotent seed (§34 governance scenario)
node scripts/phase1-acceptance.mjs
# Optional targeted checks after compose is healthy:
node scripts/phase3-acceptance.mjs   # document proof verifier
node scripts/phase4-acceptance.mjs   # test timestamp/signature
node scripts/phase5-acceptance.mjs   # deterministic AI assistant v0
```

Services: postgres (:5432), platform-api BFF (:8080), governance-graph-api (:8100), audit-service (:8600), document-ingestion-gateway (:8400), proof-service (:8700), timestamp-service (:8800), signature-service (:8900), ai-gateway (:8550).

### Option B — Node-only (requires postgres on :5432)

```bash
pnpm install
cp .env.example .env
pnpm dev:services     # spawns core TS services, waits for /healthz
pnpm db:seed
```

Then in another shell:

```bash
pnpm dev:web          # public site on :4321
```

### Checks

```bash
pnpm build && pnpm typecheck && pnpm test
pnpm lint
pnpm verify           # build + typecheck + test + v1:smoke
node scripts/phase1-acceptance.mjs   # §23 contract across live services
# Optional targeted checks after compose is running:
node scripts/phase3-acceptance.mjs   # document proof verifier
node scripts/phase4-acceptance.mjs   # timestamp/signature v0.1
node scripts/phase5-acceptance.mjs   # AI assistant v0
```

`pnpm v1:smoke` and `scripts/phase1-acceptance.mjs` expect Postgres seed data plus services listening on :8080/:8100/:8600. Phase 3/4/5 acceptance scripts expect the Docker Compose stack because they exercise document ingestion, proof, timestamp/signature, and AI services.

## Apps

| App | Purpose | Default port |
| --- | --- | --- |
| `apps/web` | Public site, docs index, public civic flows, assistant entry points | 4321 |
| `apps/verifier` | Public proof verifier UI and proof detail page | 4322 |
| `apps/vault` | Citizen document vault UI shell | 4323 |
| `apps/admin` | Operator/admin UI shell and assistant review page | 4324 |

## Service map summary

`platform-api` remains the single public BFF edge. Internal services own governance graph reads, audit hash-chain writes, document ingestion, proof lookup/status, test timestamp/signature material, and deterministic AI answers/traces. Node services expose the shared runtime contract from `packages/service-runtime`: `GET /healthz`, `/readyz`, `/metrics`, `/version` (git sha + build metadata); `ai-gateway` exposes FastAPI health/version routes. Active local ports are set by `scripts/dev-services.mjs` and `infra/compose/docker-compose.yml`.

| Service | Port | Summary |
| --- | --- | --- |
| `platform-api` (BFF) | 8080 | Public governance/audit reads; proof routes (`POST /api/v1/verify/hash`, `POST /api/v1/verify/file`, `GET /api/v1/proofs/:id`, `GET /api/v1/proofs/:id/status`, `GET /api/v1/issuers/:id`); assistant routes (`POST /api/v1/assistant/ask`, `GET /api/v1/assistant/traces/:id`) |
| `governance-graph-api` | 8100 | Internal seeded civic graph reads and traversal |
| `audit-service` | 8600 | Append-only hash-chain writes and public redacted reads, including AI trace read audit events |
| `document-ingestion-gateway` | 8400 | Local document upload/canonicalization/proof orchestration |
| `proof-service` | 8700 | Proof manifests, status, issuer lookup, internal supersede/revoke routes; status precedence is revoked > superseded |
| `timestamp-service` | 8800 | RFC3161-stub timestamp provider for local proof manifests |
| `signature-service` | 8900 | Test-key signature provider for local proof manifests |
| `ai-gateway` | 8550 | Deterministic/local grounded RAG over approved public sources with injection heuristics and append-only human review state |

## Documentation

- [Architecture](ARCHITECTURE.md)
- [Roadmap](ROADMAP.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [Privacy](PRIVACY.md)
- [AI safety](AI_SAFETY.md)
- [Threat model](THREAT_MODEL.md)
- [Transparency](TRANSPARENCY.md)
- [Governance](GOVERNANCE.md)
- [Documentation tree](docs/architecture/service-map.md)

## License

Code is AGPL-3.0-or-later. See [NOTICE](NOTICE) for integration and content obligations tracked by this repository.
