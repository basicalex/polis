# AI Safety

The current local v1 build exposes an AI assistant v0 through `ai-gateway` on `:8550` and the BFF route `POST /api/v1/assistant/ask`. It is a deterministic, local, grounded RAG flow over approved public sources. It is not an external model-provider integration.

## Current assistant v0

- `POST /api/v1/assistant/ask` answers from approved public sources only.
- `GET /api/v1/assistant/traces/:id` exposes the local trace for review and audit.
- Web and admin assistant pages show answer, citations, trace state, and review state.
- Audit events include `ai-trace` reads.
- Prompt-injection heuristics block instructions that try to override source grounding, citation rules, or system constraints.
- Human review state is append-only so operators can queue, inspect, and resolve assistant output without rewriting history.

## Rules for AI features

- AI output must cite source evidence where it makes public claims.
- AI output must not replace legal, administrative, medical, or financial decisions.
- AI assistance must expose review state to users and operators.
- Private documents must not be sent to external model providers without an approved data-processing basis.
- Operators must be able to audit prompts, citations, model/provider metadata, traces, and review outcomes where lawful.

## Production gates

Before enabling a real model provider, the project needs provider due diligence, prompt/data minimization, abuse testing, citation enforcement, prompt-injection testing, human review queues, appeal paths, logging policy, data-retention rules, model/provider metadata capture, and rollback controls.
