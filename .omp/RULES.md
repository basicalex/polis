# polis rules

Curated from the project mnemopi bank on 2026-08-06 (`/optimize-mnemopi`). The privacy invariants are load-bearing; verify against current code before weakening any of them.

## Privacy and security invariants

- Never SELECT personal columns (`contributorId`, `displayName`) or raw document bytes in queries where they could leak — privacy by column selection, not by a WHERE clause someone can forget.
- Magic-link auth: `beginMagicLink(email)` always returns `{sent:true}` — no email enumeration, no silent fallback.
- Audit rows are NOT all public-read: M10+ emits restricted/private identity, vault, and reward-payout events.
- Terminal commitment status is never self-declared — only an approved resolution claim through the §19 review queue.
- Legal identity never reaches downstream services; `/callback` mints a Polis HMAC session instead.
- Marketing copy: never "AI-powered", never self-declared capability claims.

## Workflow

- Never `git add` a service directory wholesale (`services/*/dist` ends up staged).
- Docker `ARG SERVICE` is build-time only — never promote it to a runtime env var.
- Seeding is manual: migrations are DDL-only; run `seed.ts` inside the container on the polis network (Postgres is not exposed on localhost).
- Never publish types via `ReturnType<typeof fn>` across package boundaries.
