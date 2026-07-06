# Hydration

[Hydration](https://hydration.net) is a Polkadot-native DeFi protocol best known for the Omnipool — a single shared liquidity pool that lets every supported asset trade against every other asset without fragmenting LP capital across pairs. On top of the AMM the protocol runs a money-market, stablecoin HOLLAR, an order book, derivatives, and stableswap pools, all unified inside one Substrate-based runtime with full EVM support.

The actual protocol lives in several repositories:

| Component | Repository |
|-----------|-----------|
| Runtime (Substrate / Rust) | [galacticcouncil/hydration-node](https://github.com/galacticcouncil/hydration-node) |
| AAVE v3 fork (EVM, on Frontier) | [galacticcouncil/aave-v3-deploy](https://github.com/galacticcouncil/aave-v3-deploy) |
| Frontend | [galacticcouncil/hydration-ui](https://github.com/galacticcouncil/hydration-ui) |
| SDK | [galacticcouncil/sdk](https://github.com/galacticcouncil/sdk) |

## What this repo is

This repository is **not** where Hydration's code lives. It's a context hub for AI coding agents (Claude Code, Codex, opencode, etc.) working across the Hydration codebase. It collects the things an agent needs to be useful that don't naturally belong inside any single component repo:

- **Top-level orientation** — `CLAUDE.md` tells an agent which repo holds what, where to look for code, and how the components fit together.
- **Cross-repo skills** — `.claude/skills/` holds procedures that span multiple systems or operate on infrastructure (e.g. resetting a lark fork, upgrading a basilisk RPC node, writing a feature spec that touches both runtime and UI).
- **Background documents** — `general/` collects protocol overviews, design notes, research, and deployment plans that inform agent decisions but aren't tied to a specific PR.
- **Infra manifests** — `lark/` holds Docker Swarm compose files for the lark fork environment used by skills like `reset-fork`.

Component-specific context (architecture, conventions, pallet structure) lives in each component's own `CLAUDE.md`. This repo only carries what's shared across them.

## Skills

Run via the agent's skill system (`/<skill-name>` in Claude Code, or whatever your client uses).

| Skill | What it does |
|-------|--------------|
| [`spec-writer`](.claude/skills/spec-writer/) | Draft feature specs. Defaults to runtime; `--ui` for frontend, `--full` for both. |
| [`reset-fork`](.claude/skills/reset-fork/) | Reset a lark fork node to the current mainnet head. Requires the `swarmpit-lark` MCP. |
| [`upgrade-basilisk`](.claude/skills/upgrade-basilisk/) | Upgrade the basilisk binary on a Basilisk mainnet RPC host and restart `blockchain.service`. |

Skills hosted in component repos (e.g. `security_audit` in hydration-node) reference this repo's `general/` docs over GitHub raw URLs, so an agent doesn't need this repo cloned to use them.

## Reference documents

Available for direct fetch from `https://raw.githubusercontent.com/galacticcouncil/hydration/main/general/`:

- `hydration.md` — protocol overview (products, architecture, governance, tokenomics)
- `omnipool.md` — Omnipool deep dive (mechanics, math, risk model)
