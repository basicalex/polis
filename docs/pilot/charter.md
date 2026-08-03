# Pilot Charter — Grad Primjer Municipality

> Simulated partner for §30.10 pilot validation. All adapters are local v1 stubs.

The broader local profile described below remains simulated. A separate [isolated public-read API profile](../operations/isolated-pilot-runbook.md) may expose only seeded synthetic/public data; it is not writable and cannot process real-person or private-document data.

## Pilot identity

- **Partner institution:** Grad Primjer Municipality (simulated)
- **Jurisdiction:** `jur-croatia-local` (HR/local/grad-primjer)
- **Public purpose:** Test municipal document-requirement-map, public verifier, and Polis deliberation for duplicate document handoff reduction.
- **Pilot owner:** Polis Interface project governance
- **Technical owner:** Polis Interface engineering
- **Security/privacy contact:** project-governance@polis.local
- **Isolated-profile deployment owner:** Not assigned — deployment blocked.
- **Isolated-profile security/incident owner:** Not assigned — deployment blocked.
- **Isolated-profile backup owner:** Not assigned — deployment blocked.
- **Isolated-profile restore owner:** Not assigned — deployment blocked.
- **Latest reviewed restore evidence:** None — deployment blocked until a dated successful drill names the snapshot, operator, reviewer, and evidence location.

## Scope

- **Civic process or service being tested:** Municipal complaints process — duplicate document handoff reduction.
- **User groups affected:** Municipal residents filing complaints; municipal clerks processing documents.
- **Data categories:** Public government records (census extracts, residency proofs); deliberation comments (public); audit events (public, redacted).
- **Public evidence to be published:** 2 verified document proofs (SHA-256 manifest + Ed25519 test-key signature); Polis deliberation results (87 participants, 1 consensus cluster).
- **Private documents to be processed:** None in this pilot scope.
- **Systems integrated:** Governance graph (live), audit trail (live), document proof registry (live), citizen identity (local DB), citizen vault (live), contribution/review (live), rewards eligibility (live).
- **Isolated public-read systems, if separately launched:** PostgreSQL, one-shot seed/migrations, governance graph, public audit, proof, Polis bridge, platform API, and Caddy only. Reads use seeded records; this does not make any external adapter live.

## Current implementation status

### Live (real code, real data)

- Governance graph
- Audit trail (append-only hash chain)
- Document proof registry (SHA-256 manifest + test-key signature)
- Citizen identity (local DB)
- Citizen vault
- Contribution/review
- Rewards eligibility

### Mocked (stub adapters)

- Paperless-ngx (stub)
- Upstream Polis (stub — `POLIS_MODE=stub`)
- Keycloak/OIDC (dev tokens — `IDENTITY_DEV_TOKENS=true`)
- AI providers (deterministic RAG)
- Payment rails (manual export)
- RFC3161 timestamping (stub)
- Signing (test-key — `Ed25519Signature2018` with committed test keypair)

### Isolated public-read profile gate

This optional profile does not replace or reclassify the simulated local status above. Before launch, the charter must replace every unassigned operational-owner field with a named person and backup, link a dated successful disposable restore drill, record the reviewed Git SHA and image tag, and complete the runbook's DNS/TLS/readiness/route-denial evidence. No approval under this charter expands the profile to writes, login, participation, private documents, or real-person data.

## Safeguards

- **Legal basis and privacy notice:** Simulated pilot; no real personal data processed. Seed data uses synthetic identities.
- **Retention schedule:** Data retained for 90 days post-sunset, then archived as immutable record.
- **Access roles:** Project governance (admin), simulated partner (read-only public), citizens (authenticated participation).
- **Redaction rules:** Only pre-agreed privacy/security redactions. All redactions logged as audit events (`eventType: pilot.result.redacted`) with reason and authorizing authority. Partner cannot unilaterally delete results.
- **AI review process:** AI outputs require citations from approved sources + human review before publish (§30.6 / ADR-005).
- **Audit/event review process:** All actions audit-logged via append-only hash chain. Public audit trail exposes actors, actions, hashes, and previous hashes.
- **Incident contact and response time:** project-governance@polis.local; 24h response SLA for simulated pilot.
- **Rollback trigger:** Security incident, data integrity failure, or partner agreement breach.

## Success criteria

1. ≥1 deliberation with ≥5 participant comments
2. ≥1 document proof verified
3. Results report published
4. Redaction audit trail non-empty if redactions applied

## Exit plan

At sunset (2026-09-21): archive all data, preserve public pages and audit trail as immutable record, export deliberation results, transfer any partner-specific data per agreement. Public pages remain accessible; audit trail is append-only and cannot be deleted by any party.
