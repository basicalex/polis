# AI Safety: Model and Review

The current local v1 build exposes an AI assistant v0 through `ai-gateway` and the BFF route `POST /api/v1/assistant/ask`. It is deterministic local RAG over approved public sources with stored traces, citations, review state, and audit events. It is not an external model-provider integration.

## Current behavior

- No external AI model is called and no user prompt is sent to a provider.
- Answers must come from approved public sources or remain unpublished/low-confidence.
- Prompt-injection heuristics block attempts to override source grounding, citation rules, or system constraints.
- `packages/policy-rules/ai/ai.rego` keeps the production rule shape: publish only cited, approved outputs.
- Assistant traces and output review decisions are persisted append-only for operator review.

## Review model

AI output should be treated as draft assistance until a human or approved review process accepts it. Review should check citation coverage, unsupported claims, sensitive data, jurisdictional accuracy, and user-facing risk.

## Prohibited production shortcuts

- Do not send private documents to a model provider without a data-processing basis.
- Do not remove review state from civic explanations.
- Do not let model output create or modify official records without audit.
- Do not present AI summaries as source evidence.

## Production checklist

A real provider integration needs model/provider metadata, prompt and data minimization, citation enforcement, red-team tests, abuse handling, human review queues, retention policy, and rollback controls.
