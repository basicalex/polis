<div align="center">

# Polis Interface

**Civic infrastructure for source-linked governance maps, public audit trails, and proof-oriented transition pilots.**

A government campaigning surface and a public accountability layer, built over the same verifiable data — so what a movement promises and what an institution does can be checked against the same evidence.

[![CI](https://img.shields.io/github/actions/workflow/status/basicalex/polis/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/basicalex/polis/actions/workflows/ci.yml)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg?style=flat-square)](NOTICE)
[![Bun](https://img.shields.io/badge/bun-1.3.14-FBF0DF.svg?style=flat-square&logo=bun&logoColor=000000)](https://bun.sh)
[![Node](https://img.shields.io/badge/node-24-5FA04E.svg?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/typescript-5.9%20%2F%207.0--rc-3178C6.svg?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Python](https://img.shields.io/badge/python-3.12-3776AB.svg?style=flat-square&logo=python&logoColor=white)](https://www.python.org)
[![Astro](https://img.shields.io/badge/astro-5-BC52EE.svg?style=flat-square&logo=astro&logoColor=white)](https://astro.build)
[![Postgres](https://img.shields.io/badge/postgres-16%20pgvector-4169E1.svg?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Status](https://img.shields.io/badge/status-local%20v1%20prototype-F5A623.svg?style=flat-square)](#honest-status)

<sub>[Quickstart](#quickstart) · [Architecture](#architecture) · [Services](#services) · [Docs](#documentation)</sub>

</div>

---

## Why this exists

Civic data suffers from a trust problem, not a data problem. Documents circulate without provenance. Promises drift from records. Dashboards summarise without sources. AI answers about government cannot be audited.

Polis Interface answers this with four disciplines held simultaneously:

- **Governance claims are source-linked** — facts trace back to the institution, role, jurisdiction, process, or law they came from.
- **Sensitive actions leave bounded audit evidence** — covered routes append public or restricted events to a hash-linked ledger; audit coverage is explicit rather than universal.
- **Proof-bearing documents are verifiable** — canonicalized bytes plus a manifest of hash, signature, and timestamp, with revoke and supersede semantics.
- **Assistant outputs are traced and reviewable** — deterministic grounded retrieval, injection heuristics, and an append-only staff review state.

The same substrate serves two audiences: a campaigning surface for movements and candidates to publish source-anchored programmes, and a public accountability layer for citizens to check what elected institutions actually did against them.

---

## Architecture

```mermaid
flowchart TB
    citizens([Citizens])
    operators([Operators / Reviewers])

    subgraph apps["Astro apps"]
        direction LR
        web["apps/web<br/>:4321"]
        verifier["apps/verifier<br/>:4322"]
        vault["apps/vault<br/>:4323"]
        admin["apps/admin<br/>:4324"]
    end

    subgraph edge["Public edge"]
        bff["platform-api BFF<br/>:8080"]
    end

    subgraph core["Governance and audit"]
        gov["governance-graph-api<br/>:8100"]
        audit["audit-service<br/>:8600"]
        contrib["contribution-service<br/>:8450"]
        complaints["complaints-service<br/>:8970"]
    end

    subgraph proof["Document proof pipeline"]
        ingest["document-ingestion-gateway<br/>:8400"]
        canon["canonicalization-service<br/>:8500"]
        proofsvc["proof-service<br/>:8700"]
        ts["timestamp-service<br/>:8800"]
        sig["signature-service<br/>:8900"]
        docsign["document-signing-service<br/>:8960"]
    end

    subgraph ai["AI assistant"]
        gw["ai-gateway<br/>:8550<br/>FastAPI"]
    end

    subgraph citizen["Citizen and credentials"]
        cid["citizen-identity"]
        cvault["citizen-vault"]
        vc["vc-issuer"]
    end

    subgraph adapters["Adapters and rewards"]
        bridge["polis-bridge"]
        paperless["paperless-adapter"]
        rewards["rewards-service"]
    end

    db[("PostgreSQL 16<br/>pgvector · :5432")]

    citizens --> web
    citizens --> verifier
    citizens --> vault
    operators --> admin

    web --> bff
    verifier --> bff
    vault --> bff
    admin --> bff

    bff --> gov
    bff --> audit
    bff --> proofsvc
    bff --> gw
    bff --> contrib
    bff --> complaints
    bff --> docsign
    bff --> citizen
    bff --> adapters

    ingest --> canon --> proofsvc
    proofsvc --> ts
    proofsvc --> sig
    docsign --> proofsvc
    docsign --> paperless

    gov --> db
    audit --> db
    proofsvc --> db
    gw --> db
    contrib --> db
    complaints --> db
    citizen --> db
```

---

## Feature pillars

- **Governance graph** — seeded institutions, roles, jurisdictions, processes, laws, and claims, exposed as read-only civic traversal.
- **Evidence-linked claims** — a write path with a review adjudication queue via `contribution-service`.
- **Document proof architecture** — canonicalize, hash, sign, timestamp; manifests carry revoke and supersede states with `revoked > superseded` precedence.
- **Append-only audit hash chain** — covered public and restricted events preserve ordering and integrity without exposing private case content.
- **Deterministic AI assistant** — grounded RAG over approved public sources, injection heuristics, staff-only trace review, and an `AI_MODE` seam for real providers (stub is the default).
- **Contribution and review** — claims are proposed, adjudicated, and either resolved or sent back through the review flow.
- **Citizen vault and verifiable credentials** — identity, vault, and issuer service shells for citizen-side custody.
- **Representative accountability (M-RA)** — commitments, status events, evidence-anchored scorecards, charter coverage, evidence redaction.
- **Private complaint cases** — resident submission, staff assignment, information requests, decisions, appeal separation of duty, and restricted audit events.
- **Civic rewards** — a prototype rewards surface for civic participation.

---

## Quickstart

Prerequisites: **Bun 1.3.14**, **Node 24**, **Python 3.12** (for `ai-gateway`), **Docker** for Option A, **PostgreSQL 16** for Option B.

### Option A — Docker Compose (recommended, full stack)

```bash
bun install --frozen-lockfile
docker compose -f infra/compose/docker-compose.yml up -d --build --wait
bun run db:seed
bun scripts/phase1-acceptance.mjs
```

Optional acceptance scripts once the stack is healthy:

```bash
bun scripts/phase3-acceptance.mjs   # document proof verifier
bun scripts/phase4-acceptance.mjs   # timestamp + signature
bun scripts/phase5-acceptance.mjs   # AI assistant
bun scripts/phase-complaints-acceptance.mjs # private complaint lifecycle
```

### Option B — Local processes (requires Postgres on :5432)

```bash
bun install --frozen-lockfile
cp .env.example .env
bun run build
bun run db:seed
```

Then keep the catalogued Node services, Python gateway, and web app running in separate shells:

```bash
bun run dev:services                 # all 17 Node services
PORT=8550 uv run python -m polis_aigateway # Python AI gateway
bun run dev:web                      # public and resident site on :4321
```

### Checks

```bash
bun run verify                    # build + typecheck + test + v1:smoke
bun run lint
bun run build && bun run typecheck && bun run test
```

> `bun run v1:smoke` and the phase acceptance scripts require Postgres seed data plus the relevant services. The complaint acceptance flow is development-only and is not part of the isolated public-read pilot.

---

## Apps

| App | Port | Purpose |
| --- | --- | --- |
| `apps/web` | 4321 | Public site, docs index, civic flows, and authenticated resident complaint cases |
| `apps/verifier` | 4322 | Public proof verifier UI and proof detail |
| `apps/vault` | 4323 | Citizen document vault UI shell |
| `apps/admin` | 4324 | Operator UI for review, assistant oversight, and private complaint handling |

## Services

`platform-api` is the only public BFF edge. All Node services expose the shared runtime contract from `@polis/service-runtime` — `/healthz`, `/readyz`, `/metrics`, `/version` — and `ai-gateway` exposes equivalent FastAPI routes.

<details>
<summary><b>Full service and port table</b></summary>

<!-- service-catalog:readme:start -->
| Service | Runtime | Port | Summary | Dev launcher |
| --- | --- | ---: | --- | --- |
| `platform-api` | Node 24 | 8080 | Public BFF for governance, proof, assistant, citizen, signing, contribution, rewards, and complaint routes. | Yes (17) |
| `governance-graph-api` | Node 24 | 8100 | Postgres-backed civic graph and governance read API. | Yes (1) |
| `polis-bridge-service` | Node 24 | 8200 | Local Polis issue and conversation bridge with a provider seam. | Yes (3) |
| `paperless-adapter` | Node 24 | 8300 | Document intake and archive adapter for stub or Paperless backends. | Yes (4) |
| `document-ingestion-gateway` | Node 24 | 8400 | Orchestrates document intake, canonicalization, and proof registration. | Yes (9) |
| `contribution-service` | Node 24 | 8450 | Persists evidence-linked claims and review decisions. | Yes (14) |
| `rewards-service` | Node 24 | 8460 | Runs the local civic rewards prototype. | Yes (13) |
| `canonicalization-service` | Node 24 | 8500 | Creates deterministic SHA-256 document hash bundles. | Yes (5) |
| `ai-gateway` | Python 3.12 | 8550 | FastAPI grounded-RAG assistant with stub and OpenAI-compatible provider modes. | No (external) |
| `audit-service` | Node 24 | 8600 | Stores and reads append-only hash-chained audit events. | Yes (2) |
| `citizen-identity-service` | Node 24 | 8650 | Provides local HMAC-based citizen sessions. | Yes (10) |
| `proof-service` | Node 24 | 8700 | Stores proof manifests and serves verification, status, and issuer reads. | Yes (8) |
| `citizen-vault-service` | Node 24 | 8750 | Provides the citizen document vault service shell. | Yes (11) |
| `timestamp-service` | Node 24 | 8800 | Issues local RFC 3161-style timestamps behind a provider seam. | Yes (6) |
| `signature-service` | Node 24 | 8900 | Issues test-key proof signatures and exposes the issuer registry. | Yes (7) |
| `vc-issuer-service` | Node 24 | 8950 | Provides the verifiable credential issuer service shell. | Yes (12) |
| `document-signing-service` | Node 24 | 8960 | Renders charter PDFs and coordinates signing, storage, proof registration, and acceptance. | Yes (15) |
| `complaints-service` | Node 24 | 8970 | Manages private resident complaint cases, staff decisions, and appeals. | Yes (16) |
<!-- service-catalog:readme:end -->

PostgreSQL 16 with pgvector listens on port `5432` in the local stack.

</details>

---

## Repository layout

<details>
<summary><b>Monorepo tree</b></summary>

```
polis/
├── apps/                    # Astro 5 + React 19 + Tailwind 4 UIs
│   ├── web/                 # Public site (:4321)
│   ├── verifier/            # Proof verifier (:4322)
│   ├── vault/               # Citizen vault (:4323)
│   └── admin/               # Operator + assistant review (:4324)
├── services/                # Node services + Python ai-gateway
├── packages/
│   ├── domain/              # Shared TypeScript types
│   ├── ui/                  # Shared UI primitives
│   ├── db/                  # Drizzle schema, migrations, seed
│   ├── policy-rules/        # OPA / Rego policy-as-code
│   ├── service-runtime/     # /healthz /readyz /metrics /version contract
│   └── py-core/             # Shared Pydantic models
├── infra/
│   └── compose/             # docker-compose.yml for the full stack
├── scripts/                 # dev-services, phase acceptance, v1 smoke
└── docs/                    # Architecture and service map
```

</details>

---

## Honest status

This is a **local v1 prototype**, not a production deployment.

`.env.example` sets `MOCK_EXTERNALS=true` and the stack runs entirely against mock providers. The following are **not** live integrations here:

- Paperless-ngx (upstream document intake)
- Upstream Polis deliberation
- Keycloak / OIDC identity
- External AI providers (a real-provider seam exists via `AI_MODE`; stub is the default)
- Payment rails
- Production timestamp and signature authorities
- Any government systems

The full development stack now exercises one private complaint lifecycle against seeded identities and mock providers. The isolated pilot profile remains public-read only and does not run identity, complaints, AI, signing, or private-document services. No profile is approved for real resident data or government operations.

A project about verifiability has to be honest about what it verifies. Local v1 proves selected contracts end-to-end against synthetic data and mocks; the remaining work is documented in [ROADMAP.md](ROADMAP.md).

---

## Documentation

**Architecture and design**
[Architecture](ARCHITECTURE.md) · [Design](DESIGN.md) · [Service map](docs/architecture/service-map.md) · [Full system spec](polis_interface_full_system_spec.md) · [Roadmap](ROADMAP.md)

**Trust and safety**
[Security](SECURITY.md) · [Privacy](PRIVACY.md) · [AI safety](AI_SAFETY.md) · [Threat model](THREAT_MODEL.md) · [Transparency](TRANSPARENCY.md)

**Project**
[Contributing](CONTRIBUTING.md) · [Governance](GOVERNANCE.md) · [Code of conduct](CODE_OF_CONDUCT.md) · [Notice](NOTICE)

---

## License

Code is **AGPL-3.0-or-later**. See [NOTICE](NOTICE) for integration and content obligations tracked by this repository.

<div align="center">
<sub>Polis Interface · v0.1.0-v1 · built to be checked, not trusted.</sub>
</div>
