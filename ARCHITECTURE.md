# Architecture

Polis Interface v1 is a local-first monorepo. Astro apps provide public/operator surfaces, TypeScript packages hold deterministic domain logic, and service entrypoints expose the same HTTP runtime while the production integrations remain mocked.

## Boundaries

- `apps/web`: public landing, status, and `/docs` surface.
- `apps/verifier`: public proof-verification UI.
- `apps/vault`: citizen vault UI shell for document custody flows.
- `apps/admin`: operator UI shell.
- `packages/domain`: schemas, demo institutions/processes/claims, proof hashing, verification, and process assessment.
- `packages/service-runtime`: shared Node HTTP runtime and the current local v1 API route set.
- `packages/policy-rules`: Rego policy files for access and evidence rules.
- `services/*`: independently named service packages that start the shared runtime under service-specific names and ports.
- `scripts/dev-services.mjs`: local launcher for the v1 service set.
- `scripts/v1-smoke.mjs`: smoke test for the documented local API contract.

## Runtime model

The current services are deterministic and in-memory. They return seeded demo institutions, governance processes, evidence claims, assessment output, proof manifests, hash verification, mock Polis conversations, mock AI explanations, reward rules, and audit events.

All services expose:

- `GET /healthz`
- `GET /readyz`
- `GET /metrics`
- `GET /version`
- `GET /api/v1/*` routes listed in `docs/architecture/service-map.md`

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

## Data and evidence flow

1. Public claims are seeded in `packages/domain` with source references.
2. Governance process endpoints expose institutions and processes.
3. Assessment endpoints compute deterministic public-process scores.
4. Proof endpoints hash submitted content and verify hashes against generated manifests.
5. AI endpoints return mock, source-linked explanations with `reviewState: "under_review"`.
6. Audit endpoints return public demo audit events.

## Design constraint

The architecture intentionally keeps public claims, private documents, AI review state, and audit events separate. A production cutover must replace mock adapters without weakening that separation.
