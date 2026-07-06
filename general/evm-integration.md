# Hydration EVM — Integration Guide

> **Purpose:** Reference for third-party teams integrating with Hydration's EVM — wallets, bridges, contract deployers, and tooling authors.
> **Last updated:** 2026-07-06
> **Sources:** `hydration-node` runtime source, live RPC verification, `hydration-ui` production config

---

## 1. Overview

Hydration's EVM compatibility is provided by `pallet_evm` + `pallet_ethereum` — a Moonbeam-maintained fork of [Frontier](https://github.com/paritytech/frontier) embedded directly in the Substrate runtime, not a separate parachain or sidechain. This means:

- Standard Solidity tooling (Hardhat, Foundry) and EVM wallets (MetaMask) work against Hydration without a bridge or wrapped-chain layer.
- EVM transactions and Substrate extrinsics settle in the same block, on the same state.
- The EVM sits alongside Hydration's native pallets (Omnipool, money market, HOLLAR, etc.), and several of those pallets are exposed to EVM contracts via precompiles (see §4).

## 2. Networks & RPC

**Mainnet** — EVM chain ID `222222` (`0x3640e`). All endpoints below serve both Substrate WSS and Ethereum JSON-RPC (`eth_*`) on the same host — there is no separate EVM-only endpoint:

| Provider | Endpoint |
|---|---|
| Dwellir (default) | `wss://hydration-rpc.n.dwellir.com` |
| Dotters | `wss://hydration.dotters.network` |
| IBP | `wss://hydration.ibp.network` |
| LATAM (stkd) | `wss://hydration.rpc.stkd.io` |
| zipp | `wss://rpc.zipp.hydration.cloud` |
| roach | `wss://rpc.roach.hydration.cloud` |
| lait | `wss://rpc.lait.hydration.cloud` |
| sin | `wss://rpc.sin.hydration.cloud` |
| coke | `wss://rpc.coke.hydration.cloud` |

For `eth_*` JSON-RPC, use the same hostnames over `https://` (e.g. `https://hydration-rpc.n.dwellir.com`).

**Test networks** — Hydration doesn't run a separate long-lived public testnet with independent state; instead, mainnet-forked "lark" nodes serve as the disposable test environment, regularly reset to current mainnet state:

| Endpoint | Notes |
|---|---|
| `https://0.lark.hydration.cloud` | |
| `https://1.lark.hydration.cloud` | |
| `https://2.lark.hydration.cloud` | |
| `https://3.lark.hydration.cloud` | |

Same chain ID as mainnet (`222222`) — there is no chain-ID-based way to distinguish a lark fork from mainnet. State can be reset at any time; don't rely on persistent test data across sessions.

**Wallet configuration (EIP-3085 `wallet_addEthereumChain`):**

```json
{
  "chainId": "0x3640e",
  "chainName": "Hydration",
  "rpcUrls": ["https://hydration-rpc.n.dwellir.com"],
  "nativeCurrency": { "name": "Wrapped Ether", "symbol": "WETH", "decimals": 18 }
}
```

Note the EVM "native" gas currency is a WETH-wrapped asset (`WethCurrency`), not HDX — Hydration's dynamic multi-currency fee system can also accept other registered assets for gas, but WETH is the default/primary one.

## 3. JSON-RPC surface

**Supported:** `eth_*` (including filters and `eth_subscribe` pubsub), `net_*`, `web3_*`.

**Not supported:** `debug_*`, `trace_*`, `txpool_*` — there is no `debug_traceTransaction` or mempool introspection.

**Gas estimation:** `eth_estimateGas` had a known reliability issue for bounded Substrate accounts; this was fixed in a `hydration-node` runtime upgrade (April 2026). Standard `eth_estimateGas`-based flows (MetaMask, ethers/viem defaults) should work without needing a manual safety multiplier.

## 4. Precompiles

Registered in `HydraDXPrecompiles<R>`:

| Address | Name | Purpose |
|---|---|---|
| `0x...0001`–`0x...0009` | Standard Ethereum precompiles | ECRecover, SHA256, RIPEMD160, Identity, Modexp, BN128Add, BN128Mul, BN128Pairing, Blake2F |
| `0x...0401` | Dispatch | Executes a Substrate runtime call from EVM context — the general Substrate↔EVM bridge |
| `0x...0806` | LockManager | Backs GIGAHDX's `LockableAToken.sol`; restricted caller |
| `0x...080a` | CallPermit | EIP-712-style typed call permit (permit + relayer pattern) |
| `0x...090a` | FlashLoanReceiver | ERC-3156-compatible flashloan callback; restricted to the configured flash-minter |
| `0x00000000000000000000000000000001XXXXXXXX` | Per-asset ERC-20 | Every registered Hydration asset is exposed as a standard ERC-20 at this address (last 4 bytes = big-endian `AssetId`) — trade/transfer native Hydration assets from EVM contracts as if they were ordinary ERC-20 tokens |
| `0x000001XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX` | Chainlink-style oracle | AggregatorV3-compatible interface backed by Hydration's on-chain EMA oracle |

The EVM's execution target is **Osaka** (a superset of Shanghai/Cancun/Prague) — `PUSH0`, transient storage (`TSTORE`/`TLOAD`), and `MCOPY` are all supported.

## 5. Contract deployment

Standard Hardhat/Foundry deployment flows work against the mainnet RPC endpoints above (chain ID `222222`). Note: transactions must be **legacy (type-0)** — EIP-1559 typed transactions are not required and some deploy scripts explicitly pass `--legacy`/set `type: 0` for reliability.

**Contract-deployer allowlist:** Hydration gates who may deploy new contracts via `pallet_evm_accounts`'s `ContractDeployer` allowlist. Adding an address requires an on-chain governance action (`add_contract_deployer`, via root or an OpenGov `GeneralAdmin`-track referendum) — this is not self-serve. If you're planning to deploy contracts on Hydration mainnet, reach out to the Hydration team ahead of time to get your deployer address whitelisted through governance.

## 6. Contract verification

There is currently **no supported source-verification explorer** for Hydration's EVM (no Blockscout/Etherscan-equivalent workflow). Subscan provides basic transaction/block lookup for Hydration but does not offer contract source verification.

If you need verified-source publication for your contracts, contact the Hydration team directly — this is a known gap rather than a self-serve flow today.

## 7. Local mainnet-fork testing with Chopsticks

For local development against a fork of Hydration mainnet state, use the **`@galacticcouncil/chopsticks`** fork — not vanilla `@acala-network/chopsticks`, which lacks Frontier `eth_*` RPC support.

Simplest path (prebuilt image, includes EVM support):

```bash
docker run -d -p 8000:9988 galacticcouncil/fork
```

This serves both Substrate and `eth_*` JSON-RPC on `http://localhost:8000` / `ws://localhost:8000`, forked from current Hydration mainnet state.

**Gotchas:**
- `--build-block-mode Instant` doesn't take effect at startup — after boot, call `dev_setBlockBuildMode(["Instant"])` via RPC (pass the mode as a string, not an integer).
- `eth_feeHistory` and `eth_maxPriorityFeePerGas` are synthetic, derived from a static `eth_gasPrice` under a fork — don't rely on fee-history-based gas estimation in this environment.
- Legacy (type-0) transactions only, same as mainnet.

## 8. Wormhole integration notes

Hydration does not currently host a native Wormhole Core Bridge / Token Bridge deployment on its own EVM. Wormhole connectivity to Hydration today works transitively via **MRL (Moonbeam Routed Liquidity)**: Wormhole's Token Bridge is deployed on Moonbeam, and transfers destined for Hydration carry an XCM payload that Moonbeam forwards on arrival.

For a team evaluating a direct Wormhole deployment on Hydration's own EVM, the relevant facts from this doc apply directly:

- **Chain ID** `222222` and the **Osaka** EVM target (§1, §4) are stable and already support everything a modern Wormhole contract set would compile to.
- **Deployer whitelisting** (§5) applies the same way to any integrator — a CREATE2-factory deploy pattern would go through the same governance-gated allowlist process as any other deployer.
- **Finality**: Hydration is a Polkadot parachain — finality is inherited entirely from the Polkadot relay chain, not produced by a per-parachain gadget. Guardian-network designs that assume simple L1-style block-confirmation depth should treat this as a topic for a direct technical conversation with the Hydration team rather than assume standard heuristics apply.

## Sources

- `hydration-node` runtime source (`runtime/hydradx/src/evm/`)
- Live RPC verification (`eth_chainId`, `eth_getBalance`, block explorers) as of 2026-07-06
- `hydration-ui` production RPC configuration
