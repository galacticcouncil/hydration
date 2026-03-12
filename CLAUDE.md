# Hydration Project Context

This is the top-level context repository for the Hydration DeFi protocol. It provides overview documentation, custom Claude skills, and agents. Detailed context for each component lives in its own repository (same CLAUDE.md structure).

## Repositories

| Component | Repository | Description |
|-----------|-----------|-------------|
| Runtime | https://github.com/galacticcouncil/hydration-node | Substrate-based blockchain runtime (Rust) |
| UI | https://github.com/galacticcouncil/hydration-ui | Frontend application |
| SDK | https://github.com/galacticcouncil/sdk | Developer SDK |

## Working with this project

- **Runtime tasks:** Clone the runtime repo. The UI and SDK repos are not needed for runtime work.
- **Frontend tasks:** Both the UI and SDK repos are needed. Clone them only when required.
- **Clone location:** Clone repos into this directory for full context. Before cloning, ask whether the repo already exists elsewhere — it may be better to symlink it or use a custom location (check one level up first).

## Skills and agents

This repository ships custom Claude skills and agents in `claude/skills/`. To install them:

1. **Ask the user** whether they want to install the provided skills/agents.
2. **Propose two options:**
   - **Global install** — copy skills/agents/commands to `~/.claude/` so they are available across all projects.
   - **Project-specific install** — copy to the target project's `.claude/` directory.
3. If working directly in this repository, copy to the target project's `.claude/` directory.

## Reference material

- `general/hydration.md` — Protocol overview (products, architecture, governance, tokenomics)
- `claude/skills/hydration-auditor/` — Security audit skill with attack vector references
