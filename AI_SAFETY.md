# AI Safety

The local v1 AI endpoint is a mock adapter. `POST /api/v1/ai/explain` returns a deterministic source-linked response with `model: "mock-civic-chat-v1"` and `reviewState: "under_review"`. No external model is called by the current implementation.

## Rules for AI features

- AI output must cite source evidence where it makes public claims.
- AI output must not replace legal, administrative, medical, or financial decisions.
- AI assistance must expose review state to users and operators.
- Private documents must not be sent to external model providers without an approved data-processing basis.
- Operators must be able to audit prompts, citations, model/provider metadata, and review outcomes where lawful.

## Production gates

Before enabling a real model provider, the project needs provider due diligence, prompt/data minimization, abuse testing, human review queues, appeal paths, logging policy, and rollback controls.
