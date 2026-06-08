# AI Safety: Model and Review

The current AI route is a mock civic assistant, not a production model integration.

## Current behavior

`POST /api/v1/ai/explain` returns:

- a deterministic explanation string for the submitted `question`;
- citations from seeded demo evidence claims;
- `model: "mock-civic-chat-v1"`;
- `reviewState: "under_review"`.

## Review model

AI output should be treated as draft assistance until a human or approved review process accepts it. Review should check citation coverage, unsupported claims, sensitive data, jurisdictional accuracy, and user-facing risk.

## Prohibited production shortcuts

- Do not send private documents to a model provider without a data-processing basis.
- Do not remove review state from civic explanations.
- Do not let model output create or modify official records without audit.
- Do not present AI summaries as source evidence.

## Production checklist

A real provider integration needs model/provider metadata, prompt and data minimization, citation enforcement, red-team tests, abuse handling, human review queues, retention policy, and rollback controls.
