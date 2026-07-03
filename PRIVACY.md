# Privacy

Polis Interface separates public civic evidence from private citizen documents. The current local v1 uses seeded demo data and mock external adapters; it is not connected to production identity, Paperless, government registers, or external AI providers.

## Local v1 data

Local endpoints return seeded jurisdictions, institutions, roles, processes, claims with evidence/sources, graph relationships, public audit rows, and local hash-verification responses. Submitted hash-verification content is processed by the local runtime for the request and is not persisted by the BFF verifier.

## Production principles

- Collect the minimum data needed for a civic process.
- Keep private documents out of public deliberation by default.
- Publish claim evidence only when it is lawful, sourced, and reviewed.
- Record audit events for access and changes.
- Make AI assistance reviewable and source-linked.
- Define retention and deletion rules before onboarding partners.

## Operator obligations

A production operator must publish jurisdiction-specific privacy notices, data-processing roles, retention schedules, subprocessors, data-subject request procedures, and breach-notification contacts before collecting real citizen data.
