# Agent Memory for Project: polis
This file contains persistent context, decisions, and knowledge for the AI agent.
Agents should read this to understand project history and append new decisions here.

## Core Decisions
- [2026-06-20 09:37] Phase 1 (M0+M1) COMPLETE & verified: schema 25 tables (migration 0001_governance_v0.sql), seed loader packages/db/src/seed.ts (idempotent upsert), governance-graph-api (:8100, §23.1 reads), audit-service (:8600, §26.3 append-only hash-chain, POST /internal/audit/events + GET /api/v1/audit/:objectType/:objectId), platform-api (:8080, BFF proxy + POST /api/v1/verify/hash). phase1-acceptance.mjs 13/13 green.
- [2026-06-20 09:37] Stack decision: TS services dropped from uv workspace in M0 (TS-only); Python services rejoin uv at M3 (canonicalization-service) — first Python service since py-core. TS for web/BFF/graph/audit; Python/FastAPI for AI/data/document (§6.3).
- [2026-06-20 09:37] Docker fix (critical): node.Dockerfile runner stage MUST convert build ARG SERVICE to runtime ENV via 'ENV SERVICE=${SERVICE}' — otherwise CMD 'exec node services/${SERVICE}/dist/index.js' expands to empty path and crashes with MODULE_NOT_FOUND. Force 'docker compose up --build' after Dockerfile changes (up alone reuses cached images).
- [2026-06-20 09:37] Web app is SSR (output:'server' + @astrojs/node) so dynamic routes can SSR-fetch the API; all fetches null-safe so 'astro build' passes offline. Claim rendering extracted to apps/web/src/components/Claim.astro (JSX in .astro frontmatter is INVALID — frontmatter is plain TS module scope; use a component).
- [2026-06-20 09:37] M2-M9 detail-plans authored at docs/roadmap/m2-m9-detail-plans.md — grounded in spec §13/§14/§15/§12/§17/§19/§20/§22/§16/§27. Each plan maps §30 deliverables to services/schema/API/OPA/audit/web/acceptance. Re-adds Python to uv at M3.
