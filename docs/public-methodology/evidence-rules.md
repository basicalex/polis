# Public Methodology: Evidence Rules

Evidence is the boundary between civic explanation and unsupported assertion.

## Rules

- Public claims need source references.
- Demo claims must be labeled or scoped as demo data.
- Claims about institutions, laws, policies, budgets, cases, or partners require a retrievable source.
- Private documents must not be converted into public evidence without authorization and redaction review.
- AI-generated summaries are not evidence; they can only explain or organize cited evidence.

## Current local v1

`GET /api/v1/claims` returns seeded claims hydrated with evidence links and sources. Claims must have evidence or be explicitly marked as unsupported drafts; no active AI endpoint cites or rewrites those claims in local v1.

## Review checklist

Before publishing a new claim, verify source availability, publication rights, personal-data risk, jurisdiction, translation accuracy, and whether the claim belongs in public evidence or private case material.
