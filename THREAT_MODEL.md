# Threat Model

## Assets

- Private citizen documents and metadata.
- Public evidence claims and source references.
- Proof manifests and hashes.
- Governance process records.
- Audit events.
- Operator credentials and service secrets.
- AI prompts, outputs, citations, and review decisions.

## Primary threats

- Publishing private documents or personal data as public evidence.
- Forging or replaying proof manifests.
- Tampering with audit events.
- Letting mock adapters be mistaken for production integrations.
- Prompt injection or unsupported AI claims influencing civic decisions.
- Unauthorized operator access to vault, admin, or partner data.
- Supply-chain compromise of app/service dependencies.

## Current controls in local v1

- Deterministic seeded data avoids real citizen records.
- Proof verification is hash-based and local.
- AI responses are marked `under_review` and use mock model metadata.
- Services expose health/readiness/version endpoints for operational checks.
- Documentation states that production integrations are not live.

## Required production controls

Production deployments need authenticated identity, role-based authorization, encrypted storage, append-only audit integrity, secret management, backup/restore tests, provider security reviews, incident response, and partner-specific data-sharing agreements.
