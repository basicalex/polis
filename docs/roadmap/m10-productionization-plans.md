# Polis Interface — M10–M15 Productionization Plans

Companion to the `polis_interface_full_system_spec.md` §30 roadmap and to
[`productionization-overview.md`](./productionization-overview.md). Each milestone
below replaces one external stub behind its existing service contract (or
introduces the seam M0–M9 deferred, then the adapter), grounded in the **current
monorepo state at end of M9**. Sequencing, cross-cutting invariants, and the
adapter-seam contract live in the overview; this doc holds the per-milestone
decision-complete deltas.

## Current baseline (post-M9, verified)

```
packages/   py-core, db (drizzle, migrations 0001–0009), policy-rules
            (OPA: access/ai/rewards/pilot), service-runtime, domain
services/   platform-api (:8080, BFF — only public edge), governance-graph-api (:8100),
            audit-service (:8600), polis-bridge-service (:8200), paperless-adapter (:8300),
            canonicalization-service (:8500), proof-service (:8700), signature-service (:8900),
            timestamp-service (:8800), document-ingestion-gateway (:8400),
            contribution-service (:8450), rewards-service (:8460),
            citizen-identity-service (:8650), citizen-vault-service (:8750),
            vc-issuer-service (:8950), ai-gateway (:8550)
apps/       web (:4321, Astro SSR + React), admin / vault / verifier (Astro)
infra/      docker/{node,python,ai-gateway}.Dockerfile, compose/docker-compose.yml
            (postgres pgvector:pg16, :5432, no host port mapping)
```

Every external adapter is a deterministic stub today. Four ship an env-driven
`createXClient()` seam (`POLIS_MODE`, `PAPERLESS_MODE`, `SIGNATURE_MODE`,
`TIMESTAMP_MODE`, all `= stub`); two (identity, AI) have no seam and add one as
the first step of their milestone.

**Invariants every milestone inherits and must preserve:**

- §23 is the public API contract; `platform-api` is the only public edge; domain services speak internal routes behind it.
- Drizzle schema is source of truth; migrations are committed DDL (snake_case columns, wire camelCase via mappers).
- Audit is §26.3-shaped, append-only, hash-chained (`hash`/`previousHash`); no UPDATE/DELETE on audit rows.
- OPA/Rego policy-as-code with real `opa eval` decision tests in `packages/policy-rules`.
- Stack split (§6.3): TypeScript for web/BFF/graph/audit; Python (FastAPI, via `uv`) for AI/data/document services.
- Project TS rules enforced: `ts-no-return-type`, `ts-import-type`, `ts-no-dynamic-import`, `ts-set-map`, `ts-no-tiny-functions`.
- Ports: platform-api 8080, governance-graph-api 8100, audit-service 8600, web 4321, postgres 5432.
- **Deferred until its milestone (do NOT pre-build):** graph DB, NATS, Redis, Turbo, blockchain.

Each plan ends with an **Acceptance** block mapped 1:1 to §30.x acceptance criteria, and an **Out of scope** guardrail.

---

## M10 — Auth hardening (§21, §23)

**Goal:** Real persistent identity (OIDC) backs every private flow — vault grants, contribution review, private reward payout records, VC issuance — before any of them leaves local demo mode. Local demo mode keeps working via the existing HMAC session path.

**Spec refs:** §21 (identity & identity levels), §23 (API contract / BFF-only public edge), §15 (proof/verify consumers of identity).

### Services & packages
- `services/citizen-identity-service` — **introduce the seam first.** Add an `IdentityProvider` interface (`beginMagicLink(email)` → emits a link/token; `exchangeToken(token)` → `{citizenId, sessionToken}`; `verifySession(token)` → `citizenId | null`) selected by a new `createIdentityProvider()` reading `IDENTITY_MODE`. `IDENTITY_MODE=stub` is the current HMAC path preserved verbatim (`signSession`/`verifySession` become the stub impl); `IDENTITY_MODE=oidc` is the new provider. No `IdentityProvider` abstraction exists today — this step adds it.
- `platform-api` (BFF) — add the public callback route (below); no other contract change.

### Schema (`packages/db`, migration `0010_identity_oidc_v0.sql`)
- No change to `citizens`/`sessions` (M8 tables reused).
- Add `external_identities` — **confirmed absent against `packages/db` at authoring time**, so this migration adds it: `(id, citizen_id FK→citizens, provider text, subject text, linked_at timestamptz)`, `UNIQUE (provider, subject)` (one IdP subject → one citizen), index on `citizen_id`.

### API
- Public via BFF (new): `POST /api/v1/identity/callback` — OIDC authorization-code exchange → mints a session via `createIdentityProvider().exchangeToken(...)`.
- Existing `/internal/identity/magic-link`, `/internal/identity/session`, `/internal/identity/citizens/:id` unchanged.
- Existing `/internal/identity/dev-tokens` stays 404 unless `IDENTITY_DEV_TOKENS='true'`; in `IDENTITY_MODE=oidc` it remains 404 (dev tokens are stub-only).

### Policy (`packages/policy-rules`)
- `identity/access.rego` — `oidc` mode requires a verified-email claim for private flows; stub mode unchanged.

### Audit
- `identity.session.oidc.exchanged` (new). Existing `identity.session.exchanged` is reused where the payload shape matches.

### Web
- `apps/web` — add the OIDC redirect target page that posts the code to `/api/v1/identity/callback`; existing magic-link UI retained for stub mode.

### Acceptance (§21)
- login via a configured IdP issues a session ✓
- `IDENTITY_DEV_TOKENS` is ignored (404) when `IDENTITY_MODE=oidc` ✓
- a private route (`GET /api/v1/vault/documents`) returns 401 without a valid session ✓

### Out of scope
- WebAuthn passkeys; federated SSO beyond one IdP; account-merge UI for pre-existing stub sessions.

### Depends on
- M8 (sessions/citizens tables, vault grants), M1 (BFF proxy pattern).

---

## M11 — Paperless-ngx real backend (§14, §12)

**Goal:** Document ingestion writes to a real Paperless-ngx instance instead of the local volume; storage URI points at a Paperless doc id; the verify flow still returns a valid §15 manifest.

**Spec refs:** §14 (sovereign civic document layer), §12 (evidence vault), §15 (cryptographic proof architecture), §23 (API).

### Services & packages
- `services/paperless-adapter/src/paperless-client.ts` — add `HttpPaperlessClient implements PaperlessClient` behind the existing `createPaperlessClient()` for `PAPERLESS_MODE=http`. Replace the current `throw` (`PAPERLESS_MODE=${mode} is not supported in M3; lands when a Paperless-ngx instance is deployed`) with the `http` branch; keep `'stub'` and the unknown-mode throw.
- `services/document-ingestion-gateway` — unchanged contract; now flows uploads through the real client when configured.

### Schema
- None. `documents.storage_uri` is already abstract (M3).

### API
- Unchanged contracts. `POST /internal/documents` (ingestion) and `POST /api/v1/documents` (BFF upload) now persist to Paperless when `PAPERLESS_MODE=http`.

### Policy (`packages/policy-rules`)
- `documents/access.rego` unchanged (owner check already enforced at M3).

### Audit
- `document.uploaded` unchanged. Add `document.paperless.linked` (carries the Paperless doc id).

### Web
- No UI change; upload/verify pages are unchanged.

### Acceptance (§14)
- upload → document appears in the configured Paperless instance ✓
- `documents.storage_uri` points at the Paperless doc id ✓
- verify flow still returns a valid §15 manifest ✓

### Out of scope
- OCR tuning; Paperless admin/automation; alternate object stores.

### Depends on
- M10 (private docs require real auth), M3 (documents/proof manifest).

---

## M12 — RFC 3161 timestamp + EU DSS signature (§15)

**Goal:** Proof manifests carry a real RFC 3161 timestamp response (TSR) and a real issuer signature validated by the proof service. The spec groups crypto proof in §15; the two ready seams are symmetric and co-dependent, so this is one milestone with two adapters.

**Spec refs:** §15 (proof / timestamp / signature), §23 (API).

### Services & packages
- `services/timestamp-service/src/timestamp-client.ts` — add `Rfc3161TimestampClient implements TimestampClient` behind the existing `createTimestampClient()` for `TIMESTAMP_MODE=real`. Replace the current `throw` (`TIMESTAMP_MODE=${mode} is not supported in M4; lands when a real RFC 3161 TSA endpoint is configured`) with the `real` branch; keep `'stub'` and the unknown-mode throw.
- `services/signature-service/src/signer-client.ts` — add `DssSignerClient implements SignerClient` behind the existing `createSignerClient()` for `SIGNATURE_MODE=real`. Replace the current `throw` (`SIGNATURE_MODE=${mode} is not supported in M4; lands when EU DSS / qualified TSP integration is wired`) with the `real` branch; keep `'stub'` and the unknown-mode throw.

### Schema
- None new. M4 `timestamps` (`tsa_endpoint`, `tsr`) and `signatures` (`issuer_key_id`, `signature_bytes`, `status`) already store the bytes and endpoint/key id.

### API
- Unchanged contracts. `GET /api/v1/proofs/:id` carries real TSR + signature status.

### Policy (`packages/policy-rules`)
- `proofs/trust.rego` — extend the trusted-TSA-endpoint and trusted-issuer-key allowlist from operator config (already the configurable allowlist from M4).

### Audit
- `timestamp.applied`, `signature.verified` unchanged (payload carries the real TSA endpoint / issuer key id).

### Web
- Proof page timestamp badge + signature panel unchanged (already render status from M4).

### Acceptance (§15)
- proof manifest carries a real RFC 3161 TSR that `POST /api/v1/proofs/:id/verify` accepts ✓
- issuer signature validates against a reviewed key ✓
- supersession is still new-row-only (no UPDATE/DELETE) ✓

### Out of scope
- HSM key custody (named as a dependency, not procured); long-term archive (LTA) renewal.

### Depends on
- M10 (issuer-key custody needs a real operator identity), M4 (timestamps/signatures tables, trust allowlist).

> Reviewer discretion: if timestamp and signature are preferred as separate milestones, split into M12 (timestamp) + M13 (signature) and renumber AI→M14, Polis→M15, pilot→M16. Sequence and content are unchanged.

---

## M13 — Real AI provider (§17, §22)

**Goal:** The assistant answers from a real external LLM behind a new provider seam, with citation enforcement, source governance, and the human review queue still gating publish. Stub mode (`AI_MODE=stub`) is unchanged.

**Spec refs:** §17 (AI assistance architecture), §22 (policy-as-code for AI gating), §30.6, §23 (API).

### Services & packages
- `services/ai-gateway/src/polis_aigateway/main.py` — **introduce the seam first.** Replace the module constants `_MODEL_PROVIDER = "polis"` / `_MODEL_NAME = "stub"` with `createModelProvider()` reading `AI_MODE`. `AI_MODE=stub` preserves the current deterministic RAG path; `AI_MODE=real` returns an HTTP LLM client. No provider abstraction exists today — this step adds it. `rag.py` stays keyword-`ILIKE` retrieval (embeddings explicitly out of scope).

### Schema
- None new. M5 `ai_traces` (`model`, `params`) / `ai_outputs` / `ai_review_queue` carry real model + params.

### API
- Unchanged contracts. `POST /internal/ai/answer` and the BFF `POST /api/v1/assistant/ask` are unchanged.

### Policy (`packages/policy-rules`)
- Enforce existing `ai.rego` (no answer published without citations from approved sources; low-confidence blocked from publish). No publish-path change.

### Audit
- `ai.answer.requested`, `ai.output.published` unchanged (payload carries the real provider/model).

### Web
- No UI change; the admin trace viewer + review queue are unchanged.

### Acceptance (§30.6)
- answer cites real-model output with citations from approved sources ✓
- the M5 adversarial prompt-injection suite still passes ✓
- stub path is byte-identical when `AI_MODE=stub` ✓

### Out of scope
- Embeddings / semantic retrieval; multi-modal; fine-tuning; autonomous actions.

### Depends on
- M10 (the review queue requires auth), M5 (AI gateway, traces, review queue, `ai.rego`).

---

## M14 — Real upstream Polis (§13)

**Goal:** Issue pages embed/link a real Polis conversation; conversation creation returns a real Polis conversation id; sync pulls a real consensus-groups snapshot.

**Spec refs:** §13 (Polis deliberation layer), §23 (API), §9 (service layer), §8.1 (web).

### Services & packages
- `services/polis-bridge-service/src/polis-client.ts` — add `HttpPolisClient implements PolisClient` behind the existing `createPolisClient()` for `POLIS_MODE=http`. Replace the current `throw` (`POLIS_MODE=${mode} is not supported in M2; lands when a Polis instance is deployed`) with the `http` branch; keep `'stub'` and the unknown-mode throw.

### Schema
- None new. M2 `conversations` (`polis_conversation_id`) and `conversation_results` (`consensus_groups`) already store Polis ids + snapshots.

### API
- Unchanged contracts. `POST /internal/polis/conversations` and `POST /internal/polis/conversations/:id/sync` hit the real Polis HTTP API.

### Policy (`packages/policy-rules`)
- `polis/access.rego` unchanged (M6/M8 IAM now backs it post-M10).

### Audit
- `polis.conversation.created`, `polis.result.synced` unchanged.

### Web
- `/issues/[issueId]` embed unchanged (config now sourced from a real conversation).

### Acceptance (§13)
- create conversation → real Polis conversation id ✓
- sync → real consensus-groups snapshot stored in `conversation_results` ✓

### Out of scope
- Live vote streaming; self-hosted Polis operations.

### Depends on
- M10, M2 (Polis bridge, conversations/results tables); data-sharing and moderation agreements (operational prerequisite — named, not built here).

---

## M15 — Real partner pilot (§30.10, §27, §28)

**Goal:** Replace the simulated Grad Primjer pilot with a real partner institution under a written charter, exercising the integrated M10–M14 stack end to end, with a public results report the partner cannot suppress beyond pre-agreed redactions.

**Spec refs:** §30.10 (pilot), §27 (deployment/sovereign hosting), §28 (strategic communication), §34 (demo scenario).

### No new core service — integration + ops + comms
- Replace the simulated partner data: update `data/pilot/charter.json` (partner, jurisdiction, scope, sunset, success metrics) for the real partner. Charter template at `docs/partners/pilot-charter-template.md`.
- Re-run `scripts/phase9-acceptance.mjs` (unchanged harness; now exercises real adapters where `*_MODE` is flipped).
- Redaction governance `packages/policy-rules/pilot/redaction.rego` unchanged; the BFF `DELETE`-on-grant path stays 404 (no unilateral partner delete).

### Schema
- None.

### API
- Unchanged. `GET /api/v1/pilot/charter`, `GET /api/v1/pilot/results` return the real partner's data.

### Policy
- `packages/policy-rules/pilot/redaction.rego` unchanged.

### Audit
- Pilot/charter/result events unchanged in shape; payloads reflect the real partner.

### Web
- Partner page + pilot scope render the real partner.

### Acceptance (§30.10)
- real partner charter published ✓
- measurable outcome report published ✓
- partner cannot suppress results outside pre-agreed redactions ✓ (existing redaction policy + 404-on-DELETE BFF)

### Out of scope
- Multi-jurisdiction rollout; full localization; scale/perf hardening beyond pilot load.

### Depends on
- M10–M14 integrated and green; a real partner institution.

---

## Cross-cutting plan notes

- **Migration numbering** is illustrative (`0010`…); actual numbers follow the `_journal.json` sequence at authoring time.
- **Port assignments** are fixed per the post-M9 baseline above; no new ports are introduced in M10–M14 (M15 adds no service).
- **Every milestone** keeps the stub path green and adds a `scripts/phaseNN-acceptance.mjs` runner (mirrors `phase8-acceptance.mjs` / `phase9-acceptance.mjs`) exercising the real adapter against a configured (not stub) instance.
- **OPA decision tests** and **audit-event types** continue to flow through the M1 hash-chained append-only audit-service and `packages/policy-rules`.
- **Two milestones add a seam before an adapter** (M10 identity, M13 AI); the other three (M11, M12×2, M14) fill an existing `createXClient()` factory and preserve the fail-fast unknown-mode throw.
