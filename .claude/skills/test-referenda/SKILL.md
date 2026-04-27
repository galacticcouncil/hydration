---
name: test-referenda
description: Create governance referenda on a Hydration lark testnet for testing. Submits N referenda from Alice (//Alice) in a single utility.forceBatch, rotating across root → treasurer → general_admin → omnipool_admin → economic_parameters tracks. Use when asked to "create X referenda on lark Y for testing", "create N test referenda on lark N", "submit test referenda", "populate lark with referenda", or similar — typically when populating a lark fork with votable referenda for QA / governance UI work.
allowed-tools: Read, Bash, Glob
---

# Create Test Referenda

Submits a configurable number of governance referenda on a Hydration lark testnet, all in a single `utility.forceBatch` transaction signed by Alice (`//Alice`). Each referendum bundles three calls inside the batch:

1. `preimage.notePreimage(system.remark(<unique text>))`
2. `referenda.submit(<track>, Lookup{hash, len}, After 1)`
3. `referenda.placeDecisionDeposit(<index>)`

All N referenda land in the same block. Per-call status is parsed from `utility.ItemCompleted` / `ItemFailed` events in dispatch order (groups of 3 → one referendum).

Tracks rotate across the requested count in this order: `root → treasurer → general_admin → omnipool_admin → economic_parameters → root → ...`. All five have `prepare_period=1` block on testnet runtime, so referenda enter Deciding immediately and are votable as soon as the forceBatch is in-block.

## Arguments

- **count** — how many referenda to create (e.g. "create 12 referenda" → 12).
- **lark** — the lark fork to target. "lark 2", "on 2.lark", "on 2" → `wss://2.lark.hydration.cloud`.

If either is unclear from the user's prompt, ask before proceeding.

## Workflow

### Step 1 — Resolve arguments

Parse the user's request into `count` and `lark` (an integer). Examples:
- "create 12 referenda on lark 2 for testing" → count=12, lark=2
- "create 5 test referenda on 3.lark" → count=5, lark=3
- "populate lark 4 with 8 referenda" → count=8, lark=4

### Step 2 — Locate the script

The runnable script lives at `.claude/skills/test-referenda/script/` inside this repo. If the user's working directory isn't the hydration repo root, use `Glob` with pattern `**/test-referenda/script/index.js` to resolve the absolute path.

### Step 3 — Install dependencies (first run only)

If `node_modules/` doesn't exist in the script directory, run:

```bash
cd <script-dir> && npm install --no-audit --no-fund
```

### Step 4 — Run the script

```bash
cd <script-dir> && node index.js --count <N> --lark <X>
```

The `--lark <X>` flag maps to `wss://<X>.lark.hydration.cloud`. Use `--rpc <wss-url>` instead if the user wants a non-standard endpoint.

### Step 5 — Report results

The script prints:
- A per-track distribution table with decision-deposit costs.
- Alice's free / frozen / spendable balance and a warning if locked.
- Per-referendum status: `[i/N] track ref #<index> preimage=<hash> OK` (or `FAIL`).
- A final summary listing every newly created referendum (index + track + preimage hash).

Pass the summary to the user.

## Notes

- **Single-tx, single-block design.** Sequential per-referendum `signAndSend` is the wrong pattern here — it hangs silently if any tx stalls (WS drop, dropped from tx pool). `forceBatch` puts everything in one block with one failure surface; per-inner-call status is on `utility.ItemCompleted` / `utility.ItemFailed`.
- **180s WS timeout.** `signAndWait` rejects after 180s if `inBlock` never arrives — the script won't hang.
- **Alice locks.** On lark forks Alice's HDX may be frozen by past conviction-voting. The script warns when spendable < estimated deposits. If short, run `aave-v3-deploy/scripts/unlock-alice-votes.ts` first.
- **Referendum indices.** The script reads `referenda.referendumCount` once before building the call list; new referenda get `startIndex, startIndex+1, ...`. Safe on lark where Alice is the sole submitter.
- **Decision deposits per ref (lark testnet):** root 1,000,000 HDX · treasurer 750,000 · general_admin 250,000 · omnipool_admin 250,000 · economic_parameters 750,000. Plus 100 HDX submission deposit per ref.
- **Cleanup.** After testing, decision deposits can be reclaimed via `refund-decision-deposits/` (sibling tooling outside this repo) once each referendum concludes.

## Example invocation

User: "create 12 referenda on lark 2 for testing"

1. Parse → count=12, lark=2.
2. Resolve script dir → `.claude/skills/test-referenda/script/`.
3. `npm install` if `node_modules/` missing.
4. `node index.js --count 12 --lark 2`.
5. Script prints distribution (3 root + 3 treasurer + 2 general_admin + 2 omnipool_admin + 2 economic_parameters), submits forceBatch, prints OK lines for refs at the new indices.
6. Pass the summary to the user.
