# Public Methodology: Scoring

Local v1 scoring is deterministic demo logic from the domain package. It is intended to show how a public governance process can be assessed, not to certify any real institution.

## Principles

- Scores must be explainable from public evidence.
- Missing evidence should reduce confidence rather than be filled by AI.
- Private documents should not be required for public scoring unless a lawful publication path exists.
- Scoring rules must be versioned when they affect public conclusions.

## Current local v1

`GET /api/v1/assessment/process-public-complaint` assesses the seeded demo process. The response is stable for local tests and demos.

## Production requirement

Before production scoring, operators must publish the scoring rubric, evidence thresholds, review roles, appeal path, and change history. Partner-specific scoring changes must not be hidden in code or prompts.
