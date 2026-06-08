# Session Log

Use this as the handoff format for agent or maintainer sessions. Keep entries short, factual, and tied to observed commands or files.

## Entry template

```md
## YYYY-MM-DD — short title

- Goal:
- Files changed:
- Behavior changed:
- External integrations still mocked:
- Verification run:
- Follow-up risk:
```

## Current baseline

- Goal: document local v1 honestly and make `/docs` useful.
- Behavior changed: documentation route should render navigable public documentation links instead of placeholder JSON.
- External integrations still mocked: Paperless, upstream Polis, Keycloak/OIDC, AI provider, payment rails, timestamping, signing, and government systems.
- Verification expected: `pnpm verify`, `pnpm v1:smoke`, and built `/docs` HTML inspection.

Do not use this file for secrets, private partner data, raw logs, or unresolved security reports.
