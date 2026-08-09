# Roadmap

## v1 status

Local v1 is implemented as a deterministic, seeded Postgres environment with mock/test external adapters. It is suitable for local demos, route validation, contributor onboarding, and partner discovery. It is not production-ready and does not include live external integrations.

## Optimization mode

The architecture is feature-complete for the current prototype. New services and product pillars are paused while the project proves one partner workflow:

`accepted charter → signed proof → commitment → evidence → independent review → public status`

This workflow remains local/demo-only until trusted identity, role-aware review, fail-closed audit for sensitive writes, backup/restore evidence, and a reviewed partner charter are executable release gates. The isolated `pilot` deployment remains synthetic and public-read only.

## Completed local v1 slice

- Astro app shells for public web, verifier, vault, and admin surfaces, including verifier proof detail and assistant pages.
- Public BFF, internal governance graph API, append-only audit service, document ingestion gateway, proof service, timestamp/signature services, and deterministic AI gateway.
- Shared service runtime with health, readiness, metrics, version, JSON routing, and CORS.
- Drizzle/Postgres schema, migrations, and idempotent civic graph seed.
- Governance graph routes for jurisdictions, institutions, roles, processes, document types, laws, budget lines, failure modes, controls, claims, relationships, and traversal.
- Audit write/read routes with canonical JSON and chained hashes, including AI trace read audit events.
- Proof verifier routes for hash/file verification, proof detail/status, issuer lookup, and internal supersede/revoke routes.
- Test timestamp/signature v0.1 with RFC3161-stub timestamps, test-key signatures, and status precedence revoked > superseded.
- AI assistant v0: deterministic/local grounded RAG over approved public sources with injection heuristics and append-only human review state.
- Policy-rule package with Rego files.
- Local launcher, smoke test, phase-1 acceptance script, phase-3/4/5 targeted acceptance scripts, and repository verification script.
- Operator and public documentation for the implemented v1 state.

## Next build order

1. Replace mock/test adapters one integration at a time behind the existing service contracts.
2. Add persistent storage hardening for governance objects, claims, proof manifests, AI review state, and audit events.
3. Implement authentication and role-aware authorization before private document flows leave local demo mode.
4. Connect document ingestion to a real Paperless-compatible backend and object storage.
5. Replace RFC3161-stub timestamps and test-key signatures with reviewed providers.
6. Introduce reviewed external AI provider integration only after citation enforcement, source governance, and human review queues are production-ready.
7. Connect upstream Polis conversations after data-sharing and moderation agreements are explicit.
8. Pilot with one partner institution using a written charter, threat review, and rollback plan.
Detailed plans: docs/roadmap/m10-productionization-plans.md (M10–M15), docs/roadmap/productionization-overview.md (sequencing + cross-cutting).

## Parallel capability tracks

Capability milestones that compose with the M0–M15 sequence without being gated by it (public-read surfaces ship now; drafting surfaces gate on M10):

- **M-RA — Representative Accountability:** office-holders publish positions and commitments as audited, evidence-anchored claims tracked against reality — follow-through is adjudicated through the public review queue, never self-reported; no persuasion/targeting/GOTV (firewall). Architecture: `docs/architecture/representative-accountability.md`; plan: `docs/roadmap/m-ra-representative-accountability.md`.

## Non-goals for current v1

- No production identity provider.
- No live government, municipal, Paperless, timestamping, signature, or AI provider integration.
- No production AI model claims or automated legal/benefits advice.
- No payment, token, or reward payout system.
- No guarantee that seeded demo content represents an active public process.
