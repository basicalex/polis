# Public Methodology: Scoring

Local v1 exposes sourced governance graph data and review states. Scoring/assessment detail routes are reserved for later milestones and currently return `404 not_found`.

## Principles

- Scores must be explainable from public evidence.
- Missing evidence should reduce confidence rather than be filled by AI.
- Private documents should not be required for public scoring unless a lawful publication path exists.
- Scoring rules must be versioned when they affect public conclusions.

## Current local v1

The implemented methodology surface is evidence discipline: claims must be sourced or explicitly marked as unsupported drafts, and public graph reads expose review state. `/api/v1/assessments/:id` is reserved but not implemented.

## Production requirement

Before production scoring, operators must publish the scoring rubric, evidence thresholds, review roles, appeal path, and change history. Partner-specific scoring changes must not be hidden in code or prompts.
