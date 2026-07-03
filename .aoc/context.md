# Project Context Snapshot

## Repository
- Name: .
- Root: .
- VCS: git
- Git branch: main

## Key Files
- README.md
- DESIGN.md
- package.json
- pnpm-lock.yaml
- pyproject.toml

## Project Structure (tree -L 2)
```
.
./AGENTS.md
./AI_SAFETY.md
./apps
./apps/admin
./apps/vault
./apps/verifier
./apps/web
./ARCHITECTURE.md
./CODE_OF_CONDUCT.md
./CONTRIBUTING.md
./data
./data/pilot
./data/seed
./DESIGN.md
./.dockerignore
./docs
./docs/agent-playbooks
./docs/ai-safety
./docs/architecture
./docs/communication
./docs/contributor-guides
./docs/document-trust
./docs/partners
./docs/pilot
./docs/public-methodology
./docs/roadmap
./.env
./.env.example
./eslint.config.mjs
./.github
./.github/workflows
./.gitignore
./GOVERNANCE.md
./infra
./infra/compose
./infra/docker
./LICENSE
./.mypy_cache
./.mypy_cache/3.12
... [tree truncated to 40 lines]
```

## README Headings
# Polis Interface
## Current state
## Requirements
## Local setup
### Option A — Docker Compose (recommended, full stack)
# Optional targeted checks after compose is healthy:
### Option B — Node-only (requires postgres on :5432)
### Checks
# Optional targeted checks after compose is running:
## Apps
## Service map summary
## Documentation
## License

## Design Contract
- Root DESIGN.md: present
- Use as visual/product design source before product-facing UI, docs-site, marketing, or media changes.

## Current Task Tag
```
master
```

## Active Workstreams (Tags)
```
master (6)
```

## Task spec Location
- Directory: .taskmaster/docs/specs
- Resolve tag spec default with: aoc-task tag spec show --tag <tag>
- Resolve task spec override with: aoc-task spec show <id> --tag <tag>
- Effective precedence: task spec override -> tag spec default
