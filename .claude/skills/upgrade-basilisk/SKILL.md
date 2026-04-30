---
name: upgrade-basilisk
description: Upgrade the basilisk binary on Basilisk mainnet RPC nodes from the snapshots server and restart the blockchain service. Use when asked to "upgrade basilisk", "update basilisk binary", "deploy new basilisk", or similar.
allowed-tools: Bash, Read
---

# Upgrade Basilisk RPC Node

Replaces `/data/bin/basilisk` on a Basilisk mainnet RPC host with the latest build from `https://snapshots.play.hydration.cloud/basilisk` and restarts `blockchain.service`. The snapshots URL always serves the current release build.

## Known hosts

Basilisk mainnet RPC nodes (`basilisk-mainnet-rpc-01..03`):

- `147.135.255.106`
- `141.95.2.178`
- `146.59.47.189`

If the user says "all basilisk RPC nodes" or doesn't specify, ask which host(s) — don't assume all three.

## Prerequisites

- SSH access as user `Mrq` with passwordless sudo on the target host. The user's local SSH key must already be authorized.
- Outbound HTTPS from the host to `snapshots.play.hydration.cloud`.

## Layout on each host

- Binary: `/data/bin/basilisk` (owner `basilisk:basilisk`, mode `750`)
- Service: `blockchain.service` (systemd, runs `/usr/local/bin/run_node.sh` as user `basilisk`)
- Wrapper: `/data/bin/run_node.sh` — usually doesn't need touching during a binary swap

## Workflow

### Step 1 — Inspect the host

```bash
ssh Mrq@<HOST> 'sudo ls -la /data/bin/basilisk; sudo -u basilisk /data/bin/basilisk --version; sudo systemctl is-active blockchain.service'
```

Record the current version so you can report old → new in the summary.

### Step 2 — Download new binary to a staging path and verify

```bash
ssh Mrq@<HOST> 'sudo curl -sSfL -o /data/bin/basilisk.new https://snapshots.play.hydration.cloud/basilisk \
  && sudo chmod +x /data/bin/basilisk.new \
  && sudo chown basilisk:basilisk /data/bin/basilisk.new \
  && sudo -u basilisk /data/bin/basilisk.new --version'
```

If `--version` fails or prints garbage, abort — the binary is corrupt or unsupported on the host.

### Step 3 — Back up, swap, restart

```bash
ssh Mrq@<HOST> 'set -e
DATE=$(date +%Y%m%d-%H%M%S)
sudo cp -p /data/bin/basilisk /data/bin/basilisk.bak-$DATE
sudo mv /data/bin/basilisk.new /data/bin/basilisk
sudo chown basilisk:basilisk /data/bin/basilisk
sudo chmod 750 /data/bin/basilisk
sudo systemctl restart blockchain.service
sleep 5
sudo systemctl is-active blockchain.service
sudo -u basilisk /data/bin/basilisk --version'
```

`cp -p` preserves the original mode/owner on the backup. Keeping `.bak-<timestamp>` files in `/data/bin/` is the rollback path — `mv` it back and restart if anything goes wrong.

### Step 4 — Verify the node is syncing

After restart, tail the journal briefly to confirm the node is importing blocks and connecting to relay-chain RPC peers:

```bash
ssh Mrq@<HOST> 'sudo journalctl -u blockchain.service -n 30 --no-pager'
```

Look for:
- `Parachain id: 2090`
- `[Relaychain] Trying to connect to next external relaychain node` followed by a successful connection
- `[Parachain] Imported #<N>` lines within ~1–2 minutes

### Step 5 — Multiple hosts

If upgrading multiple hosts in one request, run Steps 2–3 in **parallel** (one Bash call per host, sent in the same message). The hosts are independent — there's no coordination requirement.

## Reporting

Summarize per host: old version, new version, backup filename, service state. Mention any non-fatal warnings in the journal (e.g. deprecated CLI flags) so the user can clean them up in `run_node.sh` later.

## Rollback

```bash
ssh Mrq@<HOST> 'sudo mv /data/bin/basilisk /data/bin/basilisk.failed-$(date +%s) \
  && sudo cp -p /data/bin/basilisk.bak-<TIMESTAMP> /data/bin/basilisk \
  && sudo systemctl restart blockchain.service \
  && sudo systemctl is-active blockchain.service'
```
