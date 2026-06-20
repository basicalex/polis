# Polis Interface

Polis Interface is local v1 civic infrastructure for governance maps, evidence-linked deliberation, document proof, citizen vaults, AI assistance, public audit, and transition pilots.

This repository is an implementation scaffold for the v1 contract. It is not a production deployment.

## Current state

Local v1 runs deterministic TypeScript services and Astro apps. `.env.example` sets `MOCK_EXTERNALS=true`, so Paperless, Polis upstream, Keycloak/OIDC, AI models, payment rails, timestamping, signatures, and government integrations are represented by local/mock adapters until real credentials and partnerships are configured.

## Requirements

- Node.js compatible with the checked lockfile
- pnpm 10.x (`packageManager` is `pnpm@10.33.0`)

## Local setup

### Option A — Docker Compose (recommended, full stack)

```bash
pnpm install
docker compose -f infra/compose/docker-compose.yml up -d --build --wait
pnpm db:seed          # migrate + idempotent seed (§34 governance scenario)
```

Services: postgres (:5432), governance-graph-api (:8100), audit-service (:8600), platform-api BFF (:8080).

### Option B — Node-only (requires postgres on :5432)

```bash
pnpm install
cp .env.example .env
pnpm dev:services     # spawns the 3 TS services, waits for /healthz
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
```

`pnpm v1:smoke` and `scripts/phase1-acceptance.mjs` expect the services listening on :8080 (compose or `pnpm dev:services`).

## Apps

| App | Purpose | Default port |
| --- | --- | --- |
| `apps/web` | Public site, docs index, public civic flows | 4321 |
| `apps/verifier` | Public proof verifier UI | 4322 |
| `apps/vault` | Citizen document vault UI shell | 4323 |
| `apps/admin` | Operator/admin UI shell | 4324 |

## Phase 1 service map

Three TypeScript services behind a single public BFF edge (`platform-api`). Domain services speak internal routes; only `platform-api` is public.

| Service | Port | Routes |
| --- | --- | --- |
| `platform-api` (BFF) | 8080 | `GET /api/v1/institutions`, `/institutions/:id`, `/roles/:id`, `/processes`, `/processes/:id`, `/claims`, `/jurisdictions`, `/graph/traverse`; `POST /api/v1/verify/hash` |
| `governance-graph-api` | 8100 | internal graph reads (§23.1): institutions, roles, processes, claims (hydrated with evidence + sources), required documents, `/api/v1/graph/traverse` |
| `audit-service` | 8600 | `POST /internal/audit/events` (§26.3 append-only hash-chain); `GET /api/v1/audit/:objectType/:objectId` (public-only) |

Every service exposes the shared runtime contract from `packages/service-runtime`: `GET /healthz`, `/readyz`, `/metrics`, `/version` (git sha + build metadata). Default ports are declared in `.env.example` and used by `scripts/dev-services.mjs` and `infra/compose/docker-compose.yml`.

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
