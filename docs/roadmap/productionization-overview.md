# Polis Interface — Productionization Overview (M10–M15)

Companion to `polis_interface_full_system_spec.md` §30 roadmap and to
[`m2-m9-detail-plans.md`](./m2-m9-detail-plans.md). The productionization phase
succeeds the completed M0–M9 local slice: its goal is replacing the six external
adapters one at a time, behind the existing service contracts, so that
local-demo mode (`*_MODE=stub`) stays the default and stays green while each real
adapter is added behind its factory. No milestone in this phase invents a new
service or a new public-edge contract; each one fills an already-specified seam
or introduces the seam that M0–M9 deferred.

## Milestone index

| Milestone | Goal (one line) | §ref | Seam status | Depends on |
|---|---|---|---|---|
| **M10** | Operate persistent OIDC identity before any private document flow leaves demo mode | §21, §23 | **ready** (`createIdentityProvider()` / `IDENTITY_MODE`) | M8, M1 |
| **M11** | Paperless-ngx real backend for document ingestion | §14, §12 | **ready** (`createPaperlessClient()` / `PAPERLESS_MODE`) | M10, M3 |
| **M12** | RFC 3161 timestamp + EU DSS signature (two symmetric seams, one milestone) | §15 | **ready** (`createTimestampClient()` / `TIMESTAMP_MODE`, `createSignerClient()` / `SIGNATURE_MODE`) | M10, M4 |
| **M13** | Operate the real external AI provider behind the existing seam | §17, §22 | **ready** (`create_model_provider()` / `AI_MODE`) | M10, M5 |
| **M14** | Real upstream Polis instance for deliberation | §13 | **ready** (`createPolisClient()` / `POLIS_MODE`) | M10, M2 |
| **M15** | Real partner pilot replacing the simulated Grad Primjer | §30.10, §27, §28 | **n/a** (charter + ops, no adapter) | M10–M14 |

## Hard ordering (rationale is load-bearing)

**M10 (auth) → M11 (Paperless) → M12 (timestamp+signature) → M13 (AI) → M14 (Polis) → M15 (real partner pilot).**

M10 gates everything downstream: vault grants (M8), contribution/review (M6),
private reward payout records (M7), and verifiable-credential issuance (M8) all
require a real persistent identity before any private document or output flow
leaves demo mode. This is `ROADMAP.md` "Next build order" item 3 ("authentication
and role-aware authorization before private document flows leave local demo
mode"), and `m2-m9-detail-plans.md` M8's explicit dependency ("real §21 identity").
Paperless (M11) and AI (M13) handle private documents/outputs and therefore
depend on M10. The order is fixed; the only reviewer-discretion in
[`m10-productionization-plans.md`](./m10-productionization-plans.md) is whether
M12 is split into separate timestamp/signature milestones (which renumbers the
later entries but changes neither content nor sequence).

## Cross-cutting invariants

Carried verbatim from `m2-m9-detail-plans.md` so the implementer does not
re-derive them. Every productionization milestone inherits and must preserve:

- §23 is the public API contract; `platform-api` is the only public edge; domain services speak internal routes behind it.
- Drizzle schema is source of truth; migrations are committed DDL (snake_case columns, wire camelCase via mappers).
- Audit is §26.3-shaped, append-only, hash-chained (`hash`/`previousHash`); no UPDATE/DELETE on audit rows.
- OPA/Rego policy-as-code with real `opa eval` decision tests in `packages/policy-rules`.
- Stack split (§6.3): TypeScript on Node 24 for apps and 17 services; Python 3.12 (FastAPI, via `uv`) for `ai-gateway`.
- Project TS rules enforced: `ts-no-return-type`, `ts-import-type`, `ts-no-dynamic-import`, `ts-set-map`, `ts-no-tiny-functions`.
- Ports: platform-api 8080, governance-graph-api 8100, audit-service 8600, web 4321, postgres 5432.
- **Deferred until its milestone (do NOT pre-build):** graph DB, NATS, Redis, Turbo, blockchain.

Node 24 is the runtime; `import.meta.dirname` is used (no polyfill). The
`import.meta.dirname` dist→root path depth pattern is already used by
`platform-api` and is reused unchanged.

## Adapter-seam contract

The provider adapters ship env-driven factories that default to local modes and fail fast on unsupported configuration. Identity already has an OIDC implementation, and the AI gateway implements both deterministic `stub` and OpenAI-compatible `real` modes. Productionization completes and operates these seams without silent fallback:

| Factory | File | Env | Throw string (verbatim) |
|---|---|---|---|
| `createPolisClient()` | `services/polis-bridge-service/src/polis-client.ts` | `POLIS_MODE` | `POLIS_MODE=${mode} is not supported in M2; lands when a Polis instance is deployed` |
| `createPaperlessClient()` | `services/paperless-adapter/src/paperless-client.ts` | `PAPERLESS_MODE` | `PAPERLESS_MODE=${mode} is not supported in M3; lands when a Paperless-ngx instance is deployed` |
| `createSignerClient()` | `services/signature-service/src/signer-client.ts` | `SIGNATURE_MODE` | `SIGNATURE_MODE=${mode} is not supported in M4; lands when EU DSS / qualified TSP integration is wired` |
| `createTimestampClient()` | `services/timestamp-service/src/timestamp-client.ts` | `TIMESTAMP_MODE` | `TIMESTAMP_MODE=${mode} is not supported in M4; lands when a real RFC 3161 TSA endpoint is configured` |
| `create_model_provider()` | `services/ai-gateway/src/polis_aigateway/main.py` | `AI_MODE` | Unknown modes fail with supported values; `real` requires `AI_PROVIDER_BASE_URL`, `AI_PROVIDER_API_KEY`, and `AI_PROVIDER_MODEL`. |
| `createIdentityProvider()` | `services/citizen-identity-service/src/identity-provider.ts` | `IDENTITY_MODE` | `stub` keeps local magic-link behavior; `oidc` requires the issuer, client credentials, and redirect configuration. |

For the four Node content/proof seams, add the real adapter as an `XClient` implementation selected by the existing factory. Preserve the `stub` branch, unknown-mode error, contract, and call sites. The AI provider keeps the same invariants through its Python `ModelProvider` protocol. Identity productionization now means startup validation, provider review, role mapping, and operational acceptance of the existing OIDC seam rather than creating a new abstraction.

## Config / secrets convention

All real-adapter connection strings, endpoints, API keys, issuer URLs, and
client secrets flow via **operator env**, never committed. Dev defaults exist
only for stubs. The current compose (`infra/compose/docker-compose.yml`) sets
`POLIS_MODE`/`PAPERLESS_MODE`/`SIGNATURE_MODE`/`TIMESTAMP_MODE` = `stub` and
`IDENTITY_DEV_TOKENS: 'true'`; `scripts/dev-services.mjs` mirrors these for the Node services. The external Python gateway reads `AI_MODE` directly.
Productionization flips the relevant `*_MODE` per-deploy via operator env.

Consolidated env-var index introduced by this phase (per-milestone detail in
[`m10-productionization-plans.md`](./m10-productionization-plans.md)):

| Milestone | Mode env (new) | Secrets / endpoints (new, operator env) | Existing env kept |
|---|---|---|---|
| M10 | `IDENTITY_MODE` (`stub`\|`oidc`) | `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI` | `IDENTITY_HMAC_KEY`, `IDENTITY_DEV_TOKENS` (dev-only) |
| M11 | `PAPERLESS_MODE` (`stub`\|`http`) | `PAPERLESS_BASE_URL`, `PAPERLESS_API_TOKEN` | — |
| M12 | `TIMESTAMP_MODE` (`stub`\|`real`), `SIGNATURE_MODE` (`stub`\|`real`) | `TSA_ENDPOINT`, `TSA_CERT_CHAIN`, `DSS_ENDPOINT`, `ISSUER_KEY_ID` | — |
| M13 | `AI_MODE` (`stub`\|`real`) | `AI_PROVIDER_BASE_URL`, `AI_PROVIDER_API_KEY`, `AI_PROVIDER_MODEL` | — |
| M14 | `POLIS_MODE` (`stub`\|`http`) | `POLIS_BASE_URL`, `POLIS_API_KEY` | — |
| M15 | — | partner charter fields (operational, not adapter env) | — |

## Acceptance convention

Each milestone ships `scripts/phaseNN-acceptance.mjs` mirroring the existing
`phase8-acceptance.mjs` / `phase9-acceptance.mjs` (`check()` helper,
`get`/`post`/`del`/`patch`, a `failures` counter, and `process.exit` on
non-zero), exercising the **real** adapter against a configured (not stub)
instance. The existing stub-path tests stay green and untouched; the new
acceptance script runs only against a deployment whose `*_MODE` is flipped to the
real branch. Acceptance criteria are mapped 1:1 to §30.x in the per-milestone
doc.

## Non-goals

No on-chain payout; no HSM procurement beyond naming the dependency; no
multi-jurisdiction rollout; no localization.
