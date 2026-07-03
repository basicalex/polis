# Effective AOC Agent Contract

Generated from layered AGENTS.md policy. Do not edit this generated output directly; edit source AGENTS.md files instead.

## Sources
- workspace: `~/dev/AGENTS.md` (4897 bytes)
- project: `~/dev/polis/AGENTS.md` (6861 bytes)
- precedence: project > workspace > global
- source hash: `bb7227ef9f9e8a46`
- raw AGENTS bytes: 11758

## Hard rules
- Use `.aoc/context.md` for orientation; run `aoc-init` if it is missing or stale.
- Do not read `.aoc/memory.md`, `.aoc/stm/current.md`, or `.taskmaster/tasks/tasks.json` directly; use AOC CLI commands.
- Use root `DESIGN.md` before UI, docs-site, marketing, HyperFrames, or product-facing work when present.

## Startup and Mind policy
- Use `aoc-handshake --json` as the metadata-only startup packet, including VCS mode and preferred command family.
- Do not load broad Mind memories during startup.
- Request focused Mind context only after user intent is known and include an explicit reason.
- Prefer `jj` in Jujutsu repositories and Git only in Git-only repositories; initialize Jujutsu only through explicit `/jj-init` or direct operator action.

## Project overrides
- Use root `DESIGN.md` as the visual/product design contract before UI, docs-site, marketing, HyperFrames, or other product-facing work.
- Request focused Mind context only after user intent is known, for resume/continuation, prior decisions, task/spec grounding, debugging previous attempts, provenance/audit, or when targeted local inspection is insufficient.
- If targeted inspection fails, escalate scope gradually and state why.
- Tasks: `tm tag current`, `tm tag spec show`, `aoc-task tag spec show --tag <tag>`, `aoc-task spec show <id> --tag <tag>`
- VCS: inspect detected mode with `aoc-handshake --json`; use `jj status`/`jj diff` in Jujutsu repos and `git status`/`git diff` in Git-only repos; use `/jj-init` only for explicit colocated Jujutsu setup.
- `DESIGN.md`: project-wide visual/product design contract; subsystem design docs extend it.
- `.taskmaster/docs/specs/`: spec documents linked to tags and tasks; `.taskmaster/docs/prds/` remains legacy-compatible.
- Tag default specs are currently stored via legacy key `aocPrd`; resolve with `aoc-task tag spec show --tag <tag>`.

## Lightweight validation
- Prefer OMP `lsp diagnostics` on touched files/globs for edit-loop validation before running build, lint, or typecheck commands.
- Use `lsp references` before changing exported symbols, and `lsp code_actions` for language-server fixes/imports when available.
- Do not run full project build/lint/test as a routine sanity check during active edits.
- In delegated multi-agent work, subagents should skip project-wide validation unless explicitly assigned.
- Final verification is still required; choose the smallest targeted command that proves the changed behavior.

## Task, memory, and STM commands
- Memory: `aoc-mem read`, `aoc-mem add`, `aoc-mem search`.
- STM handoff layer: `aoc-stm status`, `aoc-stm template`, `aoc-stm resume`, `aoc-stm handoff`, `aoc-stm add` (handoffs only; durable decisions use `aoc-mem`).
- Tasks/specs: `tm list`, `tm show <id>`, `tm add`, `tm sub ...`, `tm tag current`, `tm tag spec show`.
- AOC health: `aoc-init`, `aoc-handshake --json`, `aoc-rtk status`, `aoc-rtk doctor`.
- VCS: inspect mode with `aoc-handshake --json`; use `jj status`/`jj diff` for Jujutsu, Git commands for Git-only repositories, and `/jj-init` only for explicit setup.

## Lazy-load policy
- Skills are index-only until user intent matches; load a `SKILL.md` only when needed.
- Prompts are registered until invoked; do not inject prompt bodies by default.
- Extension source and themes are not startup context unless the task is about them.
- Task/spec details are loaded on demand; default startup should use active-tag summaries only.

## Response defaults
- Keep responses concise by default.
- Use narrow, path-scoped searches before broad scans.
- Run targeted checks/tests first; escalate only when required.
