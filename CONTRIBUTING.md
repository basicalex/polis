# Contributing

Contributions must keep the repository truthful about what runs locally and what is still mocked.

## Workflow

1. Start from an issue, task, or explicit maintainer request.
2. Inspect the existing package/app/service pattern before adding files.
3. Make the smallest change that satisfies the behavior.
4. Add or update tests for behavior that can break.
5. Run the narrowest relevant check, then `bun run verify` before handoff when behavior or docs routes changed.

## Evidence rules

Public factual claims need a source reference. Do not add civic, legal, policy, partner, or institutional claims without a URL, document identifier, or local evidence object. If a claim is illustrative, label it as demo or mock data.

## Review expectations

Pull requests should state:

- what changed;
- what user/operator behavior changed;
- which external integrations remain mocked;
- how evidence, private data, security, and AI review state are affected;
- commands run and observed results.

## Code rules

- Prefer existing packages and service contracts over new abstractions.
- Do not add production-looking fallbacks that silently use mock data.
- Do not bypass proof, audit, or review state for convenience.
- Keep browser-exposed configuration limited to `PUBLIC_*` variables.

## Documentation rules

Docs must match code. If an endpoint, provider, or workflow is not implemented, write that directly instead of describing the intended production system as present.
