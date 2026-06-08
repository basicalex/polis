# Roadmap

## v1 status

Local v1 is implemented as a deterministic mock-adapter environment. It is suitable for local demos, route validation, contributor onboarding, and partner discovery. It is not production-ready and does not include live external integrations.

## Completed local v1 slice

- Astro app shells for public web, verifier, vault, and admin surfaces.
- Shared service runtime with health, readiness, metrics, version, governance, evidence, assessment, proof, verifier, Polis, AI, reward, and audit endpoints.
- Domain package for seeded governance data, claim evidence, proof hashing, and assessment logic.
- Policy-rule package with Rego files.
- Local smoke test and repository verification script.
- Operator and public documentation for the implemented v1 state.

## Next build order

1. Replace mock adapters one integration at a time behind the existing service contracts.
2. Add persistent storage for governance objects, claims, proof manifests, and audit events.
3. Implement authentication and role-aware authorization before private document flows leave local demo mode.
4. Connect document ingestion to a real Paperless-compatible backend and object storage.
5. Add signed timestamp and signature verification providers for proof manifests.
6. Introduce reviewed AI provider integration with citation enforcement and human review queues.
7. Connect upstream Polis conversations after data-sharing and moderation agreements are explicit.
8. Pilot with one partner institution using a written charter, threat review, and rollback plan.

## Non-goals for current v1

- No production identity provider.
- No live government or municipal integration.
- No production AI model claims.
- No payment, token, or reward payout system.
- No guarantee that seeded demo content represents an active public process.
