# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Polis serves people who need to understand what happened after they raised a public problem, and institutions that need a credible way to explain and document their response.

Primary product audiences include:

- residents and community representatives following ownership and public follow-through without exposing private case material;
- public officials and staff routing work, stating commitments, publishing evidence, and explaining outcomes;
- independent reviewers who decide whether evidence supports a terminal status;
- journalists, watchdogs, funders, and technical contributors inspecting sources, rules, proofs, and public receipts.

## Product Purpose

Polis connects community voice to official response and a public receipt. A person can raise a problem; the institution can identify responsibility, act, and publish a measurable commitment; an independent reviewer can assess the evidence; and the public can inspect the resulting status and trail.

Success means one scoped public process becomes easier to follow without making private case files public. A viewer should be able to identify who owns the response, what was promised, what evidence changed the status, and what happened in the end.

## Positioning

Polis is the public response layer between community voice and government action. Its distinct mechanism is one traceable accountability record that joins:

1. community voice;
2. explicit responsibility;
3. official response;
4. independent review;
5. a public receipt.

Private case material stays on a separate restricted rail. Officials can file commitments and evidence, but cannot set their own terminal follow-through status.

## Operating Context

Polis is evaluated and used across public and restricted workflows:

- public process, institution, role, decision-right, claim, source, commitment, proof, status, and audit views;
- private resident complaint casework and restricted staff operations;
- contribution and independent-review queues;
- browser-side document verification against a registered proof manifest;
- scoped pilot planning under a written charter with named owners, data boundaries, success measures, redaction, rollback, retention, and sunset terms.

The current strongest path is a local demonstrator with synthetic data. A real partner deployment has not been authorized.

## Capabilities and Constraints

- Public claims, commitments, rules, proofs, and outcomes can be inspected. Complaint narratives, identity, resident documents, and private case audit data do not become a public feed.
- New commitments start **pending independent review** after the charter and scope gate. They publish only after review. Resolution claims also require independent review before a terminal status changes.
- Evidence and proof do not make a claim true. They show what source, bytes, signature, timestamp, policy rule, review decision, or audit linkage supports the registered record.
- Use `hash-linked` or `tamper-evident`, not `immutable`.
- The current governance, complaint, commitment, contribution/review, proof, audit, and vault capabilities are local demonstrator surfaces, not production approval.
- Grad Primjer records and reported outcomes are synthetic presentation fixtures, not real participants, partners, or results.
- External Polis participation, the default assistant provider, rewards, signatures, and timestamps include stubs or test material and must be labeled.
- Polis is not a social network, campaign platform, political ranking system, blockchain product, AI decision-maker, generic CRM, or production-ready service.
- A production pilot still needs a named partner and owners, an approved charter, legal and security decisions, production identity and trust providers, recovery evidence, monitoring, and an independent go/no-go review.

## Brand Commitments

- Name: Polis.
- Voice: exact, plain, evidence-linked, and constructive toward both the public and institutions.
- Lead with the response loop, not technical architecture, cryptography, AI, or a list of civic-tech features.
- State limits in the interface rather than hiding them in disclaimers.
- Avoid anti-government posture, inflated transformation claims, invented metrics, and claims that a fixture or local mechanism is live.

## Evidence on Hand

The repository contains product truth and demonstrator evidence in:

- `design-lab/pitch/product-pitch.md` and `design-lab/pitch/tooling-and-reuse-plan.md`;
- `polis_interface_full_system_spec.md`, `ARCHITECTURE.md`, `ROADMAP.md`, and `GO_LIVE_READINESS.md`;
- `docs/communication/`, `docs/pilot/`, `docs/partners/`, and `docs/operations/`;
- `apps/web`, `apps/admin`, `apps/verifier`, and `apps/vault`;
- `packages/ui`, `packages/policy-rules`, and the backend services;
- committed synthetic Grad Primjer data, acceptance scripts, proof fixtures, and audit-chain checks.

No real partner, production authorization, real-world outcome, contracting entity, delivery budget, procurement path, or production provider decision is available. Future product and pitch work must not fabricate them.

## Product Principles

1. The voice is the start, the official response is the product, and the public receipt is the proof.
2. Make responsibility, evidence, review authority, and product limits visible.
3. Keep private case material private while preserving public accountability for process and response.
4. Let independent review, not self-attestation, control publication and terminal follow-through states.
5. Start with one chartered process and measurable public outcomes rather than replacing government wholesale.

## Accessibility & Inclusion

- The main product and pitch must work on a phone under stress, with clear state, readable type, predictable navigation, and no dependence on fine motor control.
- Keyboard access, visible focus, meaningful reduced-motion behavior, and printable records are required.
- Color cannot be the only carrier of capability, disclosure, review, proof, or status meaning.
- Public explanations should not require prior knowledge of cryptography, service architecture, or government data systems.
