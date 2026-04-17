# Hydration Project Context

This is the top-level context repository for the Hydration DeFi protocol. It provides overview documentation, custom Claude skills, and agents. Detailed context for each component lives in its own repository (same CLAUDE.md structure).

## Repositories

| Component | Repository | Description |
|-----------|-----------|-------------|
| Runtime | https://github.com/galacticcouncil/hydration-node | Substrate-based blockchain runtime (Rust) |
| AAVE v3 | https://github.com/galacticcouncil/aave-v3-deploy | EVM smart contracts & configs for the AAVE v3 fork (money market supply/borrow, HOLLAR stablecoin based on GHO), runs on top of Frontier |
| UI | https://github.com/galacticcouncil/hydration-ui | Frontend application |
| SDK | https://github.com/galacticcouncil/sdk | Developer SDK |

## Accessing repo code

When a skill or task needs to read code from hydration-node, hydration-ui, or sdk, ask the user:

> Are the repos cloned locally (one directory up from here), or should I fetch from GitHub?

- **Local:** Look in `../hydration-node/`, `../hydration-ui/`, `../sdk/`
- **GitHub:** Fetch files via WebFetch from the raw URLs (e.g., `https://raw.githubusercontent.com/galacticcouncil/hydration-node/main/...`)

## Skills

### Hosted in this repo

| Skill | Path | Description |
|-------|------|-------------|
| `spec-writer` | `.claude/skills/spec-writer/` | Feature spec writing. `--ui` for frontend, `--full` for both runtime and UI. |
| `reset-fork` | `.claude/skills/reset-fork/` | Reset a lark fork node to the latest mainnet block. Requires `swarmpit-lark` MCP. |

To install a skill to a target project:

1. **Ask the user** whether they want to install the skill.
2. **Propose two options:**
   - **Global install** — copy to `~/.claude/skills/` (available across all projects).
   - **Project-specific install** — copy to the target project's `.claude/skills/` directory.

### Hosted in other repos

| Skill | Repo | Description |
|-------|------|-------------|
| `security_audit` | hydration-node | Security audit for Substrate runtimes. References context from this repo via GitHub. |

## Reference material

Protocol context documents available for WebFetch from other repos:

| Document | Raw URL |
|----------|---------|
| Protocol overview (products, architecture, governance, tokenomics) | `https://raw.githubusercontent.com/galacticcouncil/hydration/main/general/hydration.md` |
| Omnipool deep dive (mechanics, math, risk model) | `https://raw.githubusercontent.com/galacticcouncil/hydration/main/general/omnipool.md` |

Fetch whichever documents are relevant to the task at hand.
