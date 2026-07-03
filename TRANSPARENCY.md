# Transparency

Polis Interface should make public civic processes traceable without exposing private documents by default.

## What local v1 exposes

- Service health, readiness, metrics, and version endpoints.
- Seeded jurisdictions, institutions, roles, processes, document types, laws, budget lines, failure modes, controls, claims, and graph relationships.
- Public claims hydrated with evidence links and source references.
- Local hash verification through `POST /api/v1/verify/hash`.
- Append-only public audit reads backed by canonical, hash-chained audit rows.

## What local v1 does not claim

- No production public authority is connected.
- No upstream Polis instance is live.
- No external AI model is used.
- No Paperless backend is processing documents.
- No payment, token, timestamp, signature, or identity provider is active.

## Public-code obligation

Public claims, evidence rules, AI behavior, proof semantics, and audit semantics should be reviewable in code and documentation. When an operator changes those rules for a deployment, the changed policy and implementation should be published or otherwise made accountable to affected users.
