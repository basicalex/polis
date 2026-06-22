# Current Status Playbook

Use this page to orient an implementation or review session.

## What exists

- pnpm/TypeScript/Astro monorepo.
- Public, verifier, vault, and admin Astro apps.
- Public BFF (`platform-api`), internal governance graph API, Polis stub bridge, document ingestion/canonicalization/proof services, timestamp/signature services, deterministic AI gateway, and append-only audit service.
- Shared service runtime with deterministic operational and v1 API routes for the TypeScript services.
- Drizzle/Postgres schema, migrations, and seeded civic graph/audit/proof/AI data.
- Domain package for local hash proof creation and verification.
- Policy-rule package.
- Local TypeScript service launcher, compose stack, smoke test, and phase acceptance scripts.
- Documentation for architecture, methodology, document trust, AI safety, contribution, partner pilots, and governance.

## Runtime ports

| Port | Service |
| ---: | --- |
| 8080 | `platform-api` public BFF |
| 8100 | `governance-graph-api` |
| 8200 | `polis-bridge-service` |
| 8300 | `paperless-adapter` |
| 8400 | `document-ingestion-gateway` |
| 8500 | `canonicalization-service` |
| 8550 | `ai-gateway` |
| 8600 | `audit-service` |
| 8700 | `proof-service` |
| 8800 | `timestamp-service` |
| 8900 | `signature-service` |

## What remains mocked

`.env.example` sets `MOCK_EXTERNALS=true`. Production Paperless, upstream Polis, Keycloak/OIDC, external AI model provider, payment/reward payout, trusted timestamp authority, digital signature provider, and government integrations are not live. Proposal and assessment detail routes are reserved and return `404 not_found`; proof/signature/timestamp/assistant behavior is local v1 using stub/test providers and Postgres state.

## First checks

```bash
pnpm install
pnpm dev:services
pnpm v1:smoke
pnpm verify
```

`pnpm v1:smoke` requires services to be running first. `scripts/dev-services.mjs` launches the current TypeScript service subset; `infra/compose/docker-compose.yml` includes Postgres plus the Node/Python service stack, including `ai-gateway` on :8550, `timestamp-service` on :8800, and `signature-service` on :8900.

## Safe next work

Prefer replacing one mock adapter at a time behind an existing service route. Do not expand public claims, private-document flows, proof trust state, assistant outputs, or audit exposure without matching evidence, privacy, security, and audit updates.
