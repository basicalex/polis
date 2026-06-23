# Polis Interface — M2–M9 Detail Plans

Companion to the `polis_interface_full_system_spec.md` §30 roadmap. Each milestone
below turns a §30 deliverable list into an actionable engineering plan grounded in
the **current monorepo state at end of M1**.

## Current baseline (post-M1, verified)

```
packages/   py-core (pydantic v2 + sha256), db (drizzle, 25 tables, 2 migrations),
            policy-rules (OPA: access/ai/rewards), service-runtime, domain
services/   platform-api (BFF, :8080), governance-graph-api (:8100), audit-service (:8600)
apps/       web (Astro SSR + React island), admin / vault / verifier (Astro shells)
infra/      docker/{node,python}.Dockerfile, compose/docker-compose.yml (pg+3 services)
```

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

## M2 — Polis integration v0 (§30.3, §13)

**Goal:** A public issue page embeds/links a Polis conversation; conversation metadata is stored; deliberation results attach to an issue/proposal.

**Spec refs:** §13 (Polis deliberation layer), §23 (API), §9 (service layer), §8.1 (web).

### Services & packages
- **New `services/polis-bridge-service` (TS, :8200)** — wraps a Polis instance. Read-only against Polis HTTP API; writes conversation creation only from authenticated callers. No Polis DB access (treat Polis as external).
- `packages/domain` — add `Issue`, `Conversation`, `ConversationResult` value objects + JSON mappers (camelCase wire).
- `apps/web` — `/issues` index + `/issues/[issueId]` embed; `/deliberate` landing links live conversations.

### Schema (`packages/db`, migration `0002_polis_v0.sql`)
- `issues` (id, jurisdiction_id FK, slug, title, summary, status enum, created_at)
- `conversations` (id, issue_id FK, polis_conversation_id, title, status, created_at) — stores Polis conversation id + metadata, never raw votes.
- `conversation_results` (id, conversation_id FK, consensus_groups jsonb, participant_count int, captured_at) — snapshot of a Polis report (§13).
- FK → existing `jurisdictions`. Append-only result snapshots (new rows per sync; no in-place update).

### API
- Internal (`polis-bridge-service`): `POST /internal/polis/conversations` (create/link), `GET /internal/polis/conversations/:id` (metadata + latest result), `POST /internal/polis/conversations/:id/sync` (pull report → new `conversation_results` row).
- Public via `platform-api` BFF: `GET /api/v1/issues`, `GET /api/v1/issues/:id` (hydrates linked conversation + latest result), `GET /api/v1/issues/:id/conversation` (embed config).
- `GET /api/v1/processes/:id/issues` — link issues to governance processes.

### Policy (`packages/policy-rules`)
- New `polis/access.rego`: conversation creation requires authenticated institution/partner identity (M2 uses service-level trust; real IAM lands in M6/M8 via §21).

### Audit
- Emit on conversation create, result sync: `polis.conversation.created`, `polis.result.synced` (public visibility).

### Web
- `/issues/[issueId]` embeds Polis via iframe/embed script (config from BFF); `/deliberate` lists open conversations; result snippet on issue page.

### Acceptance (§30.3)
- issue page embeds a Polis conversation ✓
- conversation metadata stored (DB row) ✓
- results attach to issue/proposal (`conversation_results` linked) ✓
- integration test: create conversation → sync stub result → BFF returns it.

### Out of scope
- Real Polis self-host deployment infra (use embed/managed in M2; self-host deferred).
- Live vote streaming (sync-on-demand only).

### Depends on
- M1 (governance graph, audit chain, BFF proxy pattern).

---

## M3 — Document proof verifier v0 (§30.4, §14, §15, §12)

**Goal:** Upload a public demo document → SHA-256 proof manifest → verify an uploaded file → valid/invalid result with audit events.

**Spec refs:** §14 (sovereign civic document layer), §15 (cryptographic proof architecture), §12 (evidence vault), §6.3 (Python for document processing).

### Services & packages
- **New `services/document-ingestion-gateway` (TS, :8300)** — public edge for uploads (behind platform-api); streams to object storage (local volume in M3; R2/S3 adapter shape ready), writes a `documents` row.
- **New `services/canonicalization-service` (Python/FastAPI, :8400)** — content-addressed canonicalization: normalize → SHA-256 → return canonical hash. Pure function, stateless, tests for determinism.
- **New `services/proof-manifest-service` (TS, :8500)** — builds the §15 proof manifest (algorithm, canonical hash, source provenance, timestamps slot for M4), stores it, issues verify.
- `packages/py-core` — add `Document`, `ProofManifest`, `CanonicalHash` models; reuse `crypto.sha256_hex`.
- `apps/verifier` — public proof + verifier UI (`/proofs/[manifestId]`, `/verify`).

### Schema (migration `0003_document_proof_v0.sql`)
- `documents` (id, owner_type, owner_id, mime_type, storage_uri, byte_size, uploaded_at)
- `document_canonical_hashes` (id, document_id FK, algorithm, canonical_hash UNIQUE, produced_at)
- `proof_manifests` (id, document_id FK, manifest jsonb, version, created_at) — manifest is the §15 artifact
- `verification_results` (id, manifest_id FK, input_hash, verdict enum(valid|invalid|mismatch), checked_at) — append-only
- FKs to `evidence_vault`/`sources` where applicable (§12 linkage).

### API
- Internal: ingestion `POST /internal/documents` (multipart → storage + `documents` row), canonicalization `POST /internal/canonicalize` (bytes → hash), proof `POST /internal/proofs` (document_id → manifest).
- Public via BFF: `POST /api/v1/documents` (upload), `GET /api/v1/proofs/:id`, `POST /api/v1/proofs/:id/verify` (upload bytes → verdict), `GET /api/v1/verify/hash` (existing from M1, reused).

### Policy
- `documents/access.rego`: public demo docs world-readable; private docs require owner/grant (grant table lands in M8; M3 enforces owner check).

### Audit
- `document.uploaded`, `proof.manifest.created`, `proof.verified` (verdict in payload, public for demo docs).

### Web
- `apps/verifier`: upload form → manifest page; verify form → verdict; valid/invalid styling.

### Acceptance (§30.4)
- upload public demo document ✓
- generate SHA-256 proof manifest ✓
- verify uploaded file ✓
- show valid/invalid result ✓
- audit events emitted ✓
- canonicalization determinism test (same bytes → same hash across runs).

### Out of scope
- RFC3161 timestamps and signatures (M4); OCR; multilingual canonicalization beyond UTF-8 normalization.

### Depends on
- M1 (audit chain, evidence vault schema, BFF pattern). Re-add `services/*` to `uv` workspace for the Python canonicalization service (per M0 decision, TS-only services were dropped from uv; Python services rejoin here).

---

## M4 — Timestamp and signature v0.1 (§30.5, §15)

**Goal:** Proof page shows RFC3161 timestamp status; a test issuer signature validates; superseded documents show a newer version.

**Spec refs:** §15 (cryptographic document proof architecture), §14.

### Services & packages
- **New `services/timestamp-service` (TS, :8700)** — pluggable RFC3161 adapter; M4 ships a mock TSA + adapter interface; real TSA behind config flag.
- **New `services/signature-service` (TS, :8800)** — verify issuer signatures/seals (test issuer keypair committed for M4); validate against key registry.
- Extend `proof-manifest-service` (M3) to embed timestamp + signature slots into the §15 manifest.

### Schema (migration `0004_timestamp_signature_v0.sql`)
- `timestamps` (id, manifest_id FK, tsa_endpoint, tsr bytes, status enum, applied_at)
- `signatures` (id, manifest_id FK, issuer_key_id, signature_bytes, algorithm, status enum(valid|invalid|revoked), verified_at)
- `document_supersessions` (id, superseded_document_id FK, superseding_document_id FK, reason, created_at) — drives the "newer version" display.
- Append-only; revocation/supersession are new rows, never edits.

### API
- Internal: `POST /internal/timestamps` (request TSR), `POST /internal/signatures/verify`.
- Public via BFF: `GET /api/v1/proofs/:id` now includes timestamp + signature status; `GET /api/v1/documents/:id/history` (supersession chain).

### Policy
- `proofs/trust.rego`: which TSA endpoints / issuer keys are trusted (configurable allowlist).

### Audit
- `timestamp.applied`, `signature.verified`, `document.superseded`.

### Web
- Proof page gains timestamp status badge + signature validation panel; superseded docs show "superseded by …" link.

### Acceptance (§30.5)
- proof page shows timestamp status ✓
- test issuer signature validates ✓
- superseded document shows newer version ✓
- mock TSA + pluggable adapter demonstrated (swap via config).

### Out of scope
- Production TSA procurement; HSM key custody; long-term archive (LTA) renewal.

### Depends on
- M3 (proof manifests, documents).

---

## M5 — AI assistant v0 (§30.6, §17, §6.3)

**Goal:** Assistant answers from approved sources, cites evidence, flags low confidence, AI trace visible internally, prompt-injection test passes.

**Spec refs:** §17 (AI assistance architecture), §6.3 (Python/FastAPI for AI), §12 (evidence vault as RAG source), §22 (policy-as-code for AI gating).

### Services & packages
- **New `services/ai-gateway` (Python/FastAPI, :8900)** — LLM gateway with RAG retrieval over the evidence vault; source-linked completions; confidence scoring; structured AI traces.
- `packages/py-core` — `AiTrace`, `Citation`, `RetrievalChunk`, `AssistantAnswer` models.
- Reuse `packages/policy-rules/ai/ai.rego` (M0: requires citations + approved sources) as the publish gate.

### Schema (migration `0005_ai_v0.sql`)
- `ai_traces` (id, request_id, prompt_hash, retrieved_chunk_ids jsonb, model, params jsonb, created_at) — internal-only.
- `ai_outputs` (id, trace_id FK, answer text, citations jsonb, confidence_state enum, review_state enum, published bool, created_at) — publishable outputs go through human review.
- `ai_review_queue` (id, output_id FK, status enum, reviewer_id, decided_at) — human review for publishable outputs.
- Link citations → `sources`/`evidence_links` (§12).

### API
- Internal: `POST /internal/ai/answer` (question → grounded answer + citations + trace_id).
- Public via BFF: `POST /api/v1/assistant/ask` (returns published/citeable answers only; low-confidence flagged), `GET /api/v1/assistant/traces/:id` (internal/admin only).

### Policy
- Enforce existing `ai.rego`: no answer published without citations from approved sources; low-confidence blocked from publish.

### Audit
- `ai.answer.requested`, `ai.output.published`, `ai.output.rejected` (review decisions).

### Web
- Admin (`apps/admin`): AI trace viewer + review queue. Public: cited assistant answers on relevant pages (governance/issue).

### Acceptance (§30.6)
- assistant answers from approved sources ✓
- cites evidence ✓
- flags low confidence ✓
- AI output trace visible internally ✓
- **prompt-injection test passes** (dedicated adversarial test suite: leaked-system-prompt, jailbreak, citation-forgery, unauthorized-publish).

### Out of scope
- Model fine-tuning; multi-modal; voice; autonomous actions.

### Depends on
- M1 (evidence vault, sources), M3 (document corpus widens RAG).

---

## M6 — Contribution and review v0 (§30.7, §19)

**Goal:** User submits evidence; reviewer approves/rejects; accepted evidence appears publicly; audit records every change.

**Spec refs:** §19 (contribution and review architecture), §21 (identity levels), §26 (audit), §11 (graph edits).

### Services & packages
- **New `services/contribution-service` (TS, :8400 reused only if free; else :8450)** — submission intake, status machine, reviewer assignment.
- Extend `governance-graph-api` with a **staging graph** read path: proposed edits live in `graph_proposals` until approved, then applied.
- `apps/web/contribute/*` — evidence + graph-edit submission UIs; `apps/admin` — review queue.

### Schema (migration `0006_contribution_review_v0.sql`)
- `contributors` (id, identity_level enum(§21), display_name, created_at)
- `submissions` (id, contributor_id FK, type enum(evidence|graph_edit|claim), payload jsonb, status enum(pending|in_review|approved|rejected), submitted_at, decided_at)
- `graph_proposals` (id, submission_id FK, target_table, target_id, op enum(insert|update|delete), proposed_payload jsonb, applied_at)
- `reviews` (id, submission_id FK, reviewer_id, decision enum, notes, decided_at)
- Approved submissions mutate governance tables via proposal application; all changes audit-emitted.

### API
- Public via BFF: `POST /api/v1/contribute/evidence`, `POST /api/v1/contribute/graph-edit`, `GET /api/v1/contributions/:id` (status).
- Internal/admin: `GET /internal/review/queue`, `POST /internal/review/:id/decide`.

### Policy
- `contribute/access.rego`: submission requires identity_level ≥ casual; approval requires reviewer role; political_agreement contributions not auto-publishable.

### Audit
- `contribution.submitted`, `contribution.approved`, `contribution.rejected`, `graph.edit.applied` (each public, target-typed).

### Web
- Contributor profiles (`/contributors/:id`), submission status tracking, review queue in admin.

### Acceptance (§30.7)
- user can submit evidence ✓
- reviewer can approve/reject ✓
- accepted evidence appears on public page ✓
- audit trail records change ✓

### Out of scope
- Real OAuth/WebAuthn (M8-grade IAM); paid rewards (M7 handles eligibility only).

### Depends on
- M1 (governance graph, audit), M3 (evidence/documents).

---

## M7 — Rewards prototype (§30.8, §20, §22)

**Goal:** Approved contribution generates eligibility; political agreement is not rewardable; aggregate ledger public; personal payout details private.

**Spec refs:** §20 (civic reward architecture), §22 (policy-as-code), existing `packages/policy-rules/rewards.rego` (M0: political_agreement denied).

### Services & packages
- **New `services/rewards-service` (TS, :8600 — note: audit is :8600; use :8650)** — eligibility evaluation, anti-spam caps, aggregate ledger, payout export.
- Extend `policy-rules/rewards.rego` with eligibility rules + caps; new `rewards/caps.rego`.

### Schema (migration `0007_rewards_v0.sql`)
- `reward_rules` (id, slug, rego_module, active, version)
- `eligibility_events` (id, contributor_id FK, triggering_submission_id FK, rule_slug, eligible bool, reason, created_at)
- `reward_ledger_public` (id, period, rule_slug, aggregate_count int, aggregate_amount numeric) — public aggregates only.
- `payout_records` (id, contributor_id FK, amount, status, exported_at) — **private**; never exposed via public API.

### API
- Internal: `POST /internal/rewards/evaluate` (submission approved → evaluate eligibility), `POST /internal/rewards/export` (manual payout export, admin).
- Public via BFF: `GET /api/v1/rewards/ledger` (aggregate only), `GET /api/v1/rewards/rules`.
- Policy: OPA decision tests assert political_agreement → deny, caps enforced.

### Audit
- `rewards.eligibility.evaluated`, `rewards.payout.exported` (no personal amounts in public audit rows).

### Web
- `/rewards` public aggregate ledger + rule transparency; contributor private view in `apps/vault`.

### Acceptance (§30.8)
- approved contribution can generate eligibility ✓
- political agreement is not rewardable ✓ (OPA test)
- aggregate ledger is public ✓
- personal payout details are private ✓ (API/test asserts no PII in public surfaces)

### Out of scope
- On-chain disbursement; tax integration; real currency rails.

### Depends on
- M6 (contributions/approvals drive eligibility).

---

## M8 — Citizen vault v1 (§30.9, §16)

**Goal:** User grants/revoke access; grantee verifies within scope; access events visible to the user.

**Spec refs:** §16 (citizen vault and access control), §21 (identity), §15 (proof-only sharing via verifiable credentials).

### Services & packages
- **New `services/citizen-vault-service` (TS, :8750)** — private document listing, access grants, revoke, proof-only sharing.
- **New `services/vc-issuer-service` (TS, :8950)** — issues verifiable credentials for proof-only sharing (scope-limited; no raw document disclosure).
- `apps/vault` — citizen-facing vault UI.

### Schema (migration `0008_citizen_vault_v1.sql`)
- `vault_documents` (id, citizen_id, document_id FK, label, added_at) — listing for the citizen.
- `access_grants` (id, granter_id, grantee_id, scope jsonb, document_id FK NULLABLE, proof_only bool, status enum(active|revoked), granted_at, revoked_at)
- `access_events` (id, grant_id FK, event enum(grant|access|revoke), actor_id, at) — visible to the citizen.
- `verifiable_credentials` (id, grant_id FK, vc jsonb, issued_at, expires_at)

### API
- Public via BFF (authenticated): `GET /api/v1/vault/documents`, `POST /api/v1/vault/grants`, `DELETE /api/v1/vault/grants/:id` (revoke), `GET /api/v1/vault/access-events`.
- Grantee verify: `POST /api/v1/vault/verify` (VC → scoped verdict; no raw bytes if proof_only).

### Policy
- `vault/access.rego`: grant enforcement; proof_only grants never return document bytes; only verification verdict.

### Audit
- `vault.grant.created`, `vault.grant.revoked`, `vault.access.used` (visible to citizen; counterparty minimized).

### Web
- `apps/vault`: document list, grant/revoke UI, access-event timeline, proof-only sharing flow.

### Acceptance (§30.9)
- user can grant/revoke access ✓
- grantee can verify within scope ✓
- access events visible to user ✓
- proof_only path never leaks raw document (test).

### Out of scope
- Full IAM (WebAuthn/OAuth) hardening to production grade; cross-jurisdiction portability.

### Depends on
- M3 (documents), real §21 identity (M6 introduces levels; M8 requires persistent citizen identity).

---

## M9 — First public pilot (§30.10, §27, §28, §34)
> **Status: Implemented (2026-06-23).** Simulated partner (Grad Primjer Municipality) over existing `jur-croatia-local` seed. Charter at `docs/pilot/charter.md`, data at `data/pilot/`. BFF routes: `GET /api/v1/pilot/charter`, `GET /api/v1/pilot/results`. Redaction governance: `packages/policy-rules/pilot/redaction.rego`. Acceptance: `scripts/phase9-acceptance.mjs`.

**Goal:** A scoped, time-bound public pilot with a partner, a live issue map, deliberation, document proof or workflow simplification, and a public results report the partner cannot suppress beyond pre-agreed redactions.

**Spec refs:** §27 (deployment/sovereign hosting), §28 (strategic communication), §34 (demo scenario), §30.10.

### No new core service — integration + ops + comms
- Pilot charter document (`docs/pilot/charter.md`): scope, sunset date, success metrics, redaction policy, partner agreement boundaries.
- Partner page (`apps/web/partners` already scaffolded): public partner listing + pilot scope.
- Live issue map: seed a real jurisdiction domain through M1 graph + M2 issues + M6 contributions.
- Deliberation: M2 Polis conversation live.
- Document proof or workflow simplification: exercise M3/M4 on a real document.
- Public results report (`docs/pilot/results-<period>.md` + web page): measurable outcome published.

### Operational
- Deployment (§27): production-grade compose/helm; backups; monitoring hooks (§26 observability).
- Sunset automation: pilot charter records expiry; data-retention/teardown runbook.

### Acceptance (§30.10)
- pilot has public scope and sunset ✓ (charter published)
- measurable outcome published ✓ (results report)
- partner cannot suppress results outside pre-agreed privacy/security redactions ✓ (governance: redactions are logged + audited; no unilateral partner delete)

### Out of scope
- Multi-jurisdiction rollout; full localization; scale/perf hardening beyond pilot load.

### Depends on
- M1–M8 integrated and green; a partner + real jurisdiction data.

---

## Cross-cutting plan notes

- **Migration numbering** is illustrative (`0002`…`0008`); actual numbers follow the `_journal.json` sequence at authoring time.
- **Port assignments** avoid collisions; final numbers confirmed when each service is added to `infra/compose/docker-compose.yml`.
- **uv workspace**: Python services (canonicalization M3, ai-gateway M5) rejoin the `uv` workspace; the M0 decision to keep services TS-only is reversed at M3 when the first Python service arrives.
- **Every milestone** adds OPA decision tests to `packages/policy-rules` and audit-event types that flow through the M1 hash-chain append-only audit-service.
- **Acceptance scripts**: extend `scripts/` with a per-milestone acceptance runner (mirrors `phase1-acceptance.mjs`) exercising the §30.x criteria against live compose.
