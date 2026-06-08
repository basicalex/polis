# Polis Interface

Polis Interface is local v1 civic infrastructure for governance maps, evidence-linked deliberation, document proof, citizen vaults, AI assistance, public audit, and transition pilots.

This repository is an implementation scaffold for the v1 contract. It is not a production deployment.

## Current state

Local v1 runs deterministic TypeScript services and Astro apps. `.env.example` sets `MOCK_EXTERNALS=true`, so Paperless, Polis upstream, Keycloak/OIDC, AI models, payment rails, timestamping, signatures, and government integrations are represented by local/mock adapters until real credentials and partnerships are configured.

## Requirements

- Node.js compatible with the checked lockfile
- pnpm 10.x (`packageManager` is `pnpm@10.33.0`)

## Local setup

```bash
pnpm install
cp .env.example .env
pnpm dev:services
```

In another shell:

```bash
pnpm dev:web
```

Useful checks:

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm v1:smoke
pnpm verify
```

`pnpm v1:smoke` expects the local services from `pnpm dev:services` to be listening, including `platform-api` on `http://localhost:8080`.

## Apps

| App | Purpose | Default port |
| --- | --- | --- |
| `apps/web` | Public site, docs index, public civic flows | 4321 |
| `apps/verifier` | Public proof verifier UI | 4322 |
| `apps/vault` | Citizen document vault UI shell | 4323 |
| `apps/admin` | Operator/admin UI shell | 4324 |

## Local v1 service map

Every service uses the same local runtime contract from `packages/service-runtime/src/index.ts`:

- `GET /healthz`
- `GET /readyz`
- `GET /metrics`
- `GET /version`
- `GET /api/v1/governance/institutions`
- `GET /api/v1/governance/processes`
- `GET /api/v1/evidence/claims`
- `GET /api/v1/assessment/process-public-complaint`
- `POST /api/v1/proofs`
- `POST /api/v1/verify/hash`
- `GET /api/v1/polis/conversations`
- `POST /api/v1/ai/explain`
- `GET /api/v1/rewards/rules`
- `GET /api/v1/audit/events`

Default local ports are declared in `.env.example` and used by `scripts/dev-services.mjs`.

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
