---
name: reset-fork
description: Reset a Hydration lark fork node (node, node2, node3, node4, node5) to the latest mainnet block. Re-snapshots the chain state and redeploys the fork. Use when asked to "reset fork", "reset lark", "update node to latest block", or similar.
allowed-tools: Read, Edit, Write, Bash, Glob, Grep
---

# Reset Lark Fork

Resets a lark fork node to a fresh state from the current mainnet head. Each lark fork (node, node2, node3, node4, node5) runs its own chain forked from a Hydration mainnet block hash. Over time the fork drifts and needs resetting to continue running against current mainnet state.

## Prerequisites

The `swarmpit-lark` MCP server must be configured. If calling any `mcp__swarmpit-lark__*` tool fails (tool not found / not loaded), walk the user through setup before proceeding:

### Setup — configure swarmpit-lark MCP

1. **Detect the client** — check for `.mcp.json` (Claude Code), `.opencode.json` (opencode), or ask which MCP client they use.

2. **Get the API token** — tell the user to open Swarmpit UI (https://swarmpit.lark.hydration.cloud), go to Profile → API Access → generate a token. Instruct them NOT to paste the token into the chat.

3. **Add the server config** — create or edit the MCP config file. Use `npx github:swarmpit/mcp` so no local install is needed.

   For Claude Code (`.mcp.json`):
   ```json
   {
     "mcpServers": {
       "swarmpit-lark": {
         "command": "npx",
         "args": ["github:swarmpit/mcp"],
         "env": {
           "SWARMPIT_URL": "https://swarmpit.lark.hydration.cloud",
           "SWARMPIT_TOKEN": "PASTE_TOKEN_HERE",
           "SWARMPIT_REDACT": "sensitive"
         }
       }
     }
   }
   ```

   For opencode (`.opencode.json`):
   ```json
   {
     "mcpServers": {
       "swarmpit-lark": {
         "type": "stdio",
         "command": "npx",
         "args": ["github:swarmpit/mcp"],
         "env": {
           "SWARMPIT_URL": "https://swarmpit.lark.hydration.cloud",
           "SWARMPIT_TOKEN": "PASTE_TOKEN_HERE",
           "SWARMPIT_REDACT": "sensitive"
         }
       }
     }
   }
   ```

4. **Tell the user to replace the token and restart** their MCP client (exit and re-enter, or use `/mcp` to reconnect).

5. **Verify** — once reconnected, call `mcp__swarmpit-lark__swarmpit_info` to confirm connection.

More details: https://github.com/swarmpit/mcp

## Arguments

- **Required**: node name (`node`, `node2`, `node3`, `node4`, `node5`)
- **Optional**: `--block-hash 0x...` — reset to a specific block instead of mainnet head

## Workflow

### Step 1 — Determine target block hash

If user provided `--block-hash`, use that. Otherwise fetch the current mainnet head:

```bash
curl -s -H "Content-Type: application/json" \
  -d '{"id":1,"jsonrpc":"2.0","method":"chain_getBlockHash","params":[]}' \
  https://rpc.hydradx.cloud | python3 -c "import sys,json; print(json.load(sys.stdin)['result'])"
```

### Step 2 — Fetch current deployed compose from Swarmpit

Call `mcp__swarmpit-lark__get_stack` with the node name. The response includes the `compose` field — this is the source of truth, **not** the local `lark/<node>.yml` file (which may have drifted).

Extract the current block hash from the compose. It appears in multiple places (typically 4):
- `STATE_BLOCK` env var on the `fork` service
- `volumes:` mount path on the `fork` service
- `REDEPLOY` env var on the `subway` service
- Top-level `volumes:` definition

Use grep to count occurrences and verify they all match.

### Step 3 — Confirm with user

Show the diff before applying:
- Old hash → new hash
- Number of replacements
- Changes to volume declaration (see below)

Wait for user approval.

### Step 4 — Update the compose

Take the compose from Step 2, replace all occurrences of the old hash with the new one. **Important**: if the volume is defined as `external: true`, change it to `driver: local` so Docker auto-creates it (the old volume was likely deleted and the new one doesn't exist yet).

Use a Python script to be precise about which `external: true` to replace — only the one in the `volumes:` section at the bottom, NOT the gateway network:

```python
# compose is the string from get_stack response
compose = compose.replace(OLD_HASH, NEW_HASH)
# Only change external:true inside volumes: block, not networks:
lines = compose.split('\n')
in_volumes = False
for i, line in enumerate(lines):
    if line.startswith('volumes:'):
        in_volumes = True
        continue
    if in_volumes and line and not line.startswith(' '):
        in_volumes = False
    if in_volumes and 'external: true' in line:
        lines[i] = line.replace('external: true', 'driver: local')
compose = '\n'.join(lines)
```

### Step 5 — Deploy via MCP

Use `mcp__swarmpit-lark__update_stack` with the updated compose. The stack update deploys to Swarmpit which applies it via Docker Swarm.

### Step 6 — Verify

1. Call `mcp__swarmpit-lark__get_stack` to confirm the stored compose matches
2. Call `mcp__swarmpit-lark__list_service_tasks` for `<node-name>_fork` to verify the new task is running
3. Wait ~30s then check `mcp__swarmpit-lark__service_logs` for `<node-name>_fork` with `since: "1m"` — look for `[Relaychain] Imported #N` lines indicating the fork is producing blocks
4. After ~2–3 min, try hitting the RPC: `https://<N>.lark.hydration.cloud` (subway) or `https://node<N>.lark.hydration.cloud` (direct fork)

### Step 7 — Save updated compose locally (optional)

If `lark/<node-name>.yml` exists in the repo, overwrite it with the updated compose so the git-tracked copy reflects the deployed state.

## Tips

- **Orphaned volumes**: resetting leaves the old `<stack>_0x<oldhash>` volume orphaned. Consider running volume cleanup later (list_volumes + cross-reference with mounts).
- **Fork bootstrap time**: the fork needs to download state from mainnet RPC (`STATE_RPC`), which can take 2-5 minutes for large chains. CPU usage in `list_service_tasks` stats is a good indicator it's working.
- **Network `external: true` must stay** — the gateway network is shared across all stacks. Only change the volume.
- **If `$env:` refs present**: the existing compose may have `$env:VAR` references for secrets. The `update_stack` tool resolves these locally before sending, so they'll continue working as long as the env vars are still set in the MCP server's env.
- **`[REDACTED]` values**: if the stored compose has `[REDACTED]` for some env vars (due to sensitive mode), the MCP server's `update_stack` automatically restores them from the current stack. Don't worry about them.

## Example invocation

User: "reset lark 5"
1. Fetch mainnet head: `0x4a7fdb26...`
2. Read `lark/node5.yml`, find old hash `0x30f62495...`
3. Show diff to user
4. User approves
5. Update compose, deploy via `update_stack`
6. Verify fork task is running
7. Save updated `lark/node5.yml`
