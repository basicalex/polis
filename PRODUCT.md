# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Polis serves people who need to understand what happened after they raised a public problem, and institutions that need a credible way to explain and document their response.

Primary product audiences include:

- residents and community representatives following ownership and public follow-through without exposing private contact or casework;
- public officials and staff routing work, publishing signed commitments and completion evidence, and explaining outcomes;
- filers and followers checking completion through disputes and not-fixed signals;
- journalists, watchdogs, funders, and technical contributors inspecting sources, rules, proofs, and public receipts.

## Product Purpose

Polis connects community voice to official response and a public receipt. A person can raise a problem; the report text publishes after an automated compliance pass; the institution can identify responsibility, act, and publish a signed commitment and evidence; and the public can dispute a completion claim or mark it not fixed.

Success means one scoped public process becomes easier to follow while contact data, attachments, and private casework stay restricted. A viewer should be able to identify who owns and signed the response, what was promised, what evidence changed the status, and what happened in the end.

## Positioning

Polis is the public response layer between community voice and government action. Its distinct mechanism is one traceable accountability record that joins:

1. community voice;
2. explicit responsibility;
3. official response;
4. public check;
5. a public receipt.

Private contact, attachments, and casework stay on a separate restricted rail. Report text is public after the filing-time compliance pass unless held; official release or redaction is a logged public event.

## Operating Context

Polis is evaluated and used across public and restricted workflows:

- public process, institution, role, decision-right, claim, source, commitment, proof, status, and audit views;
- private resident complaint casework and restricted staff operations;
- official casework, text-control actions, and public dispute and not-fixed checks;
- browser-side document verification against a registered proof manifest;
- scoped pilot planning under a written charter with named owners, data boundaries, success measures, redaction, rollback, retention, and sunset terms.

The current strongest path is a local demonstrator with synthetic data. A real partner deployment has not been authorized.

## Capabilities and Constraints

- Filed report text and location are public after the automated compliance pass. Held text keeps a public shell and reason; contact data, resident documents, attachments, and private case audit data stay restricted.
- Officials publish commitments under their name and title and report completion with evidence. Filers may dispute completion; followers may mark it not fixed.
- Evidence and proof do not make a claim true. They show what source, bytes, signature, timestamp, policy rule, public event, or audit linkage supports the registered record.
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
2. Make responsibility, evidence, signed official answers, public checks, and product limits visible.
3. Keep private contact and casework private while preserving public accountability for filed text, process, and response.
4. Let public visibility, disputes, and not-fixed signals check official completion claims.
5. Start with one chartered process and measurable public outcomes rather than replacing government wholesale.

## Accessibility & Inclusion

- The main product and pitch must work on a phone under stress, with clear state, readable type, predictable navigation, and no dependence on fine motor control.
- Keyboard access, visible focus, meaningful reduced-motion behavior, and printable records are required.
- Color cannot be the only carrier of capability, disclosure, review, proof, or status meaning.
- Public explanations should not require prior knowledge of cryptography, service architecture, or government data systems.
