# Current Status Playbook

Use this page to orient an implementation or review session.

## What exists

- pnpm/TypeScript/Astro monorepo.
- Public, verifier, vault, and admin Astro apps.
- Shared local service runtime with deterministic v1 API routes.
- Domain package for seeded civic data, evidence claims, assessments, proof hashing, and verification.
- Policy-rule package.
- Local service launcher and smoke test.
- Documentation for architecture, methodology, document trust, AI safety, contribution, partner pilots, and governance.

## What remains mocked

`.env.example` sets `MOCK_EXTERNALS=true`. Production Paperless, upstream Polis, Keycloak/OIDC, real AI provider, payment/reward payout, timestamping, signing, and government integrations are not live.

## First checks

```bash
pnpm install
pnpm dev:services
pnpm v1:smoke
pnpm verify
```

`pnpm v1:smoke` requires services to be running first.

## Safe next work

Prefer replacing one mock adapter at a time behind an existing service route. Do not expand public claims or private-document flows without matching evidence, privacy, security, and audit updates.
