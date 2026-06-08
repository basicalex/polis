# Contributor Guide: Evidence and Claims

Use this guide when changing public claims, demo data, docs, AI explanations, or methodology.

## Claim types

- Public claim: a statement the public UI or docs present as factual.
- Demo claim: seeded or illustrative data used to exercise local routes.
- Private case material: document or metadata tied to a citizen, partner, or case.
- AI output: generated explanation that must cite evidence and carry review state.

## Contributor rules

1. Keep demo claims clearly scoped.
2. Add source references for factual public claims.
3. Never turn private case material into public evidence without review.
4. Update tests when changing route response shape or domain logic.
5. Update docs when a mocked integration becomes real or a real integration is removed.

## Review questions

- Can a reader find the source?
- Is the claim current and jurisdiction-specific?
- Does it expose personal or partner-confidential data?
- Is it a claim, an interpretation, or an AI-generated explanation?
- Does the UI/API make that distinction clear?
