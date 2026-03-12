# Omnipool — Deep Context

> **Purpose:** Dedicated reference for any Claude task involving the Hydration Omnipool (audits, integrations, content, research). Builds on `hydration.md`.
> **Last updated:** 2025-09-22
> **Sources:** docs.hydration.net/products/trading/pools/omnipool, pallets/omnipool/src/lib.rs, math/src/omnipool/math.rs, docs.hydration.net/security/intro

---

## 1. What is the Omnipool?

The Omnipool is Hydration's flagship AMM — a novel multi-asset pool that consolidates all liquidity into **one single pool** rather than isolated trading pairs. It is implemented as a Substrate runtime pallet (`pallet-omnipool`) using a `u128` balance type throughout.

The core design insight: instead of fragmenting liquidity across N*(N-1)/2 pairs, every asset is paired with a synthetic hub token (LRNA/H2O) internally. From a trader's perspective, they swap any asset for any other asset in a single transaction with no multi-hop routing overhead.

**Key properties:**
- Single-pool architecture — no liquidity fragmentation across pairs
- Single-sided LP provisioning — LPs deposit one asset only
- LP positions are represented as NFTs (not fungible share tokens)
- Listings are permissioned — HDX governance vote required per asset
- All arithmetic is runtime-level (Substrate pallet), not EVM smart contracts
- Fully audited (Runtime Verification for Rust implementation; BlockScience for economic/math model)

---

## 2. The Hub Token — LRNA (H2O)

LRNA (also referenced as H2O in the math spec) is the **internal hub token** of the Omnipool. It never exists as a user-held asset in the traditional sense — it is minted and burned by the protocol to facilitate pricing and routing.

**How it works:**
- Every asset in the Omnipool is internally paired with LRNA in a virtual TKN/LRNA sub-pool
- When a user adds liquidity of asset TKN, a corresponding amount of LRNA is **minted** against it
- When liquidity is removed, the corresponding LRNA is **burned**
- All trades route through LRNA: selling TKN1 → buying TKN2 executes as TKN1→LRNA→TKN2 internally

**Mental model:** Every asset in the Omnipool can be thought of as a synthetic 50/50 liquidity pool where the second leg is always LRNA — i.e., TKN:H2O. LRNA acts as a price proxy reflecting the aggregate value locked across all Omnipool assets, including trading activity and price fluctuations. Because LRNA has a liquidity pair with every asset in the pool, it functions as a **weighted price index** of the entire Omnipool basket (which includes both stablecoins and volatile crypto assets).

**LRNA tradability:** LRNA itself has a restricted tradable state — it is only allowed to be **sold** into the pool (not bought directly). H2O/LRNA is explicitly made **unavailable for purchase on the open market**. The only way to obtain LRNA is to receive it as partial IL compensation when withdrawing an LP position (when TKN price has risen). This caps total LRNA outflow and limits how much LRNA could suddenly be sold back into the Omnipool. Tradability is enforced at the storage level via `DefaultHubAssetTradability`.

**HubAssetImbalance:** The pallet tracks a global `HubAssetImbalance` storage value (`SimpleImbalance<Balance>`). This represents the net imbalance between LRNA minted on liquidity provision and LRNA burned or collected as protocol fees. It is a key input to the impermanent loss mitigation mechanism.

### H2O Imbalance Mechanisms

When an LP withdraws with a price-up scenario, they receive LRNA as IL compensation. If that LRNA is then sold back into the Omnipool it creates a negative LRNA imbalance, which could depress LRNA's value and affect all other LP positions. Three mechanisms counteract this:

**1. Protocol fee burning**
Every swap charges a protocol fee paid in LRNA. Whenever a negative LRNA imbalance exists, the protocol continuously **burns** collected protocol fees until it has recovered 2× the amount of LRNA that was sold back into the pool.

**2. Dynamic protocol fees**
Protocol fees are adjusted based on current market volatility. Higher volatility → higher protocol fees → faster LRNA burn rate, accelerating imbalance recovery.

**3. Protocol-Owned Liquidity (POL) as liquidity of last resort**
The protocol holds a substantial amount of POL inside the Omnipool. POL is never withdrawn speculatively — it acts as a floor, ensuring a base level of liquidity remains even if all third-party LPs exit. This sets a lower bound on how far LRNA's value could fall in a mass-withdrawal scenario.

---

## 3. AMM Model — Constant Product per Virtual Sub-Pool

Each TKN/LRNA virtual sub-pool behaves as a **constant product CFMM** (x*y = k), though the spec notes other CFMMs are under investigation.

Let:
- `Q_i` = quantity of LRNA in the TKN_i sub-pool
- `T_i` = quantity of TKN_i in the sub-pool
- The invariant per sub-pool: `Q_i * T_i = constant`

**Asset price** of TKN_i in terms of LRNA = `Q_i / T_i`

**Asset weight** of TKN_i in the Omnipool = ratio of `Q_i` to total LRNA reserve across all sub-pools. This weight determines how much systemic exposure each asset represents.

---

## 4. Swap Execution — Mathematical Specification

### Notation conventions
- `ΔA` = change in pool variable A (positive = entering pool, negative = leaving pool)
- `Δa` = change in user variable a (positive = flow to user, negative = flow from user)
- `Δt = -ΔT` for any token T transferred between user and pool
- `A⁺ = A + ΔA` (post-state value)

### Sell flow: user sells ΔT₁ of TKN1 for TKN2

Two fees apply:
- `fA` = asset fee (charged in the output asset, stays in the pool as LP rewards)
- `fP` = protocol/LRNA fee (charged in LRNA, flows to the protocol)

```
ΔQ₁ = Q₁ * (-ΔT₁ / T₁⁺)          # LRNA gained in TKN1 sub-pool
ΔQ₂ = -ΔQ₁ * (1 - fP)             # LRNA allocated to TKN2 sub-pool, net of protocol fee
ΔT₂ = T₂ * (-ΔQ₂ / Q₂⁺) * (1 - fA)  # TKN2 out to trader, net of asset fee
```

Protocol fee collected: `-fP * ΔQ₁` (positive, since ΔQ₁ < 0 for a sale)
Asset fee collected: `-fA * T₂ * (-ΔQ₂ / Q₂⁺)` (remains in the pool)

### Buy flow
The buy direction (`sell` and `buy` are separate extrinsics) applies the same constant-product invariant in reverse — the pallet computes how much TKN1 must be sold to acquire a specified amount of TKN2.

### Fee distribution
- **Asset fees** (`fA`): remain inside the pool, accruing to LPs of that specific asset
- **Protocol fees** (`fP`): collected as LRNA; used for HDX buybacks distributed to stakers

---

## 5. Liquidity Provisioning

### Single-Sided LP
LPs deposit **one asset only**. They do not need to provide a matching asset pair. In exchange they receive an NFT representing their position. The NFT stores:
- Number of shares issued
- Price of the asset at time of provision (`p₀`)

### NFT-Based Positions
LP positions are stored in the `Positions` storage map, keyed by `PositionItemId`. Each `Position<Balance, AssetId>` contains:
- `shares` — number of pool shares owned by the LP
- `price` — price at time of entry (used for IL calculation and withdrawal mechanics)
- `asset_id` — which asset the position belongs to

This NFT model allows partial withdrawals and precise per-LP accounting without fungible share tokens.

### Adding Liquidity (`add_liquidity`)
1. LP calls `add_liquidity(asset, amount)`
2. The pallet checks:
   - Asset's `Tradability` flags must include `ADD_LIQUIDITY`
   - Spot price vs. oracle price deviation must be within the `PriceBarrier` threshold (≤1%)
3. Shares are minted proportional to the deposit at current price
4. Corresponding LRNA is minted and added to the sub-pool
5. An NFT position is created and assigned to the LP

**Precondition for new token listings:** Initial liquidity must be manually transferred to the pool account **before** calling `add_token`. All tokens must also be registered in the Asset Registry.

### Removing Liquidity (`remove_liquidity`)
Partial withdrawals are permitted. The pallet checks:
- Asset's `Tradability` flags must include `REMOVE_LIQUIDITY`
- Spot vs. oracle price deviation must be within `PriceBarrier` (≤1%)

**What the LP receives depends on price movement since entry:**

Let `p` = current price, `p₀` = price at LP entry, `Δs` = shares to withdraw (negative), `B` = protocol-owned shares, `S` = total shares.

**If price fell (p < p₀):** LP receives only TKN (no LRNA). The protocol claims a portion of the LP's shares:
```
ΔB = max(-(p₀ - p)/(p + p₀) * Δs, 0)   # protocol share claim
ΔS = Δs + ΔB                             # shares burned
ΔT = T * (ΔS / S)                        # TKN returned to LP
```

**If price rose (p > p₀):** LP receives TKN + LRNA. The protocol distributes accumulated LRNA back to the LP:
```
Δq = -p * (2p/(p + p₀) * (Δs/S) * T + Δt)   # LRNA to LP
ΔQ = Q * (ΔT / T)                             # LRNA burned from sub-pool
```
Note: `ΔQ ≠ -Δq` — the excess LRNA (not distributed to the withdrawing LP) is **burned** by the protocol.

### Impermanent Loss Profile

For a single-asset LP, the IL formula relative to holding is:

```
IL = 2*sqrt(p * p₀) / (p₀ + p) - 1
```

This is structurally identical to the classic two-asset CFMM IL formula but with sensitivity **only** to the TKN/LRNA price divergence, not to prices of other assets in the Omnipool (except indirectly via LRNA's aggregate value).

**IL vs. XYK comparison:**
Because LRNA is a weighted price index of the whole Omnipool basket (stablecoins + volatile assets), a TKN that moves in line with the broader crypto market (e.g. correlated with DOT or BTC) will experience **lower IL than a TKN/stablecoin XYK pool** (where all upward TKN price movement creates IL). However, it will experience **higher IL than an isolated TKN/DOT XYK pool** (where both assets move together). The Omnipool's IL profile sits between these two extremes for market-correlated assets.

**Impact of asset weight on IL:**
An asset's weight in the Omnipool (its share of total LRNA reserve) affects IL exposure. A TKN with a **larger weight** has a stronger influence on LRNA's aggregate price, meaning LRNA moves more in line with TKN — resulting in **lower IL** for isolated TKN price movements. A TKN with a small weight has almost no influence on LRNA, so its IL profile is closer to a standard XYK pair.

As a reference point from the official IL model: at 1% TKN weight in the Omnipool, a 35% TKN price decrease relative to LRNA results in approximately 2% IL.

### IL Worked Examples

#### Example 1 — Price rose (LP receives LRNA compensation)

Bob provides 1,000 DAI at entry price `p₀ = 1` LRNA/DAI, receiving `s₀ = 500` shares. Total pool: `S = 10,000` shares, `R = 19,000` DAI.

Bob withdraws when current price `p = 1.2` LRNA/DAI. Since price rose, DAI inventory in the pool has decreased. Bob's share count is **not confiscated** by the protocol. Instead, the protocol distributes LRNA to Bob to compensate for the IL, and the remaining excess LRNA (the portion not distributed) is **burned**.

#### Example 2 — Price fell (protocol claims shares as POL)

Alice provides 100 DOT at entry price `p₀ = 10` LRNA/DOT, receiving `s₀ = 200` shares. Total pool: `S = 1,000` shares, `R = 710` DOT.

Alice withdraws when current price `p = 5` LRNA/DOT. Since price fell, the DOT inventory in the pool increased. Alice receives **only DOT** (no LRNA). The protocol calculates:

```
ΔB = -(p₀ - p)/(p + p₀) * Δs
   = -(10 - 5)/(5 + 10) * (-200)
   = 66.667 shares transferred to protocol (POL)
```

Alice retains 133.333 shares. She is entitled to:
```
133.333 / 1,000 * 710 ≈ 94.67 DOT
```

Alice entered with 100 DOT and exits with ~94.67 DOT — a loss that could have been offset by sufficient fee accumulation in the pool (higher `R` than 710 would yield more DOT per share).

---

## 6. Fee Structure

### Trading Fees (Omnipool)
Two-component fee per trade:

| Fee | Symbol | Charged In | Recipient | Purpose |
|-----|--------|-----------|-----------|---------|
| Asset fee | `fA` | Output asset | Remains in pool (LP reward) | LP compensation |
| Protocol fee | `fP` | LRNA | Protocol treasury | HDX buybacks / staker rewards |

Trading fees in the Omnipool are **dynamic** — they adjust based on asset volatility to make price manipulation less profitable.

### Dynamic Withdrawal Fee
Applied when removing liquidity from the Omnipool. Calculated as:

```rust
fn calculate_withdrawal_fee(
    spot_price: FixedU128,
    oracle_price: FixedU128,
    min_withdrawal_fee: Permill,
) -> FixedU128 {
    price_diff.div(oracle_price).clamp(min_fee, FixedU128::one())
}
```

- **Range:** 0.01% to 1% of the withdrawn amount
- **Logic:** Fee = percentage difference between spot price and oracle price
- **Purpose:** Disincentivizes withdrawing immediately after a price manipulation event; ensures spot price manipulation is not profitable
- **Safe withdrawal exception:** If an asset's trading is fully disabled (`safe_withdrawal == true`), the dynamic fee is waived — the pallet checks `asset_state.tradable.is_safe_withdrawal()` before applying the fee

### Transaction Fees
All Hydration network transactions (including Omnipool trades) can be paid in **any Omnipool asset** — not just HDX. This is handled by `pallet-transaction-multi-payment`.

---

## 7. Asset State — On-Chain Data Model

Each asset in the Omnipool is tracked in the `Assets` storage map:

```
Assets<T>: StorageMap<AssetId, AssetState<Balance>>
```

### `AssetState<Balance>` fields
- `hub_reserve` — current LRNA reserve in this asset's sub-pool (`Q_i`)
- `shares` — total outstanding LP shares for this asset
- `protocol_shares` — shares owned by the protocol (from IL mitigation claims)
- `cap` — maximum weight cap (`Permill`) — bounds this asset's share of total LRNA
- `tradable` — bitflags (`Tradability`) controlling which operations are permitted

### `Tradability` Bitflags
A bitmask controlling per-operation permissions for each asset:

| Flag | Meaning |
|------|---------|
| `SELL` | Asset can be sold into the pool |
| `BUY` | Asset can be bought from the pool |
| `ADD_LIQUIDITY` | LPs can add liquidity for this asset |
| `REMOVE_LIQUIDITY` | LPs can remove liquidity for this asset |

LRNA has a hardcoded default of `SELL` only (`DefaultHubAssetTradability`).

A `safe_withdrawal` state is inferred when both `SELL` and `BUY` are disabled — the protocol treats this as a graceful shutdown mode and waives the dynamic withdrawal fee.

### Global State
- `HubAssetImbalance` — `StorageValue<SimpleImbalance<Balance>>` — net global LRNA imbalance; tracks deviation from the theoretically ideal LRNA supply
- `HubAssetTradability` — `StorageValue<Tradability>` — tradability state for LRNA itself

---

## 8. Pallet Extrinsics

| Extrinsic | Description |
|-----------|-------------|
| `add_token(asset, initial_price, weight_cap, position_owner)` | Lists a new asset in the Omnipool. Initial liquidity must be pre-transferred to the pool account. Asset must be registered in Asset Registry. |
| `add_liquidity(asset, amount)` | Adds liquidity for an existing asset. Mints an NFT position. Requires `ADD_LIQUIDITY` tradability flag and price within `PriceBarrier`. |
| `remove_liquidity(position_id, amount)` | Removes liquidity (partial allowed). Requires `REMOVE_LIQUIDITY` flag and price within `PriceBarrier`. Applies dynamic withdrawal fee. |
| `sell(asset_in, asset_out, amount, min_buy_amount)` | Sells a specified amount of `asset_in` for `asset_out`. Slippage protected by `min_buy_amount`. |
| `buy(asset_in, asset_out, amount, max_sell_amount)` | Buys a specified amount of `asset_out` by selling `asset_in`. Slippage protected by `max_sell_amount`. |
| `set_asset_tradable_state(asset, state)` | Updates an asset's tradability flags. Called by governance or Technical Committee in emergency. |
| `set_asset_weight_cap(asset, cap)` | Updates the maximum weight cap (`Permill`) for an asset. Governance-controlled. |
| `refund_refused_asset(asset, amount, recipient)` | Refunds initial liquidity if a proposed token listing was rejected by governance. |
| `sacrifice_position(position_id)` | Donates an LP position to the protocol. Deprecated path — protocol shares are used for POL management. |

---

## 9. Math Module (`math/src/omnipool/math.rs`)

The math is separated from the pallet into a dedicated crate (`hydra-dx-math`) for auditability and reuse.

### Core functions

| Function | Purpose |
|----------|---------|
| `calculate_sell_state_changes` | Computes all state deltas for a sell operation (ΔQ₁, ΔQ₂, ΔT₂, fees) |
| `calculate_buy_state_changes` | Computes all state deltas for a buy operation |
| `calculate_add_liquidity_state_changes` | Computes shares minted, LRNA minted, and position data for an LP deposit |
| `calculate_remove_liquidity_state_changes` | Computes TKN and LRNA returned to LP, protocol share adjustments, shares burned |
| `calculate_withdrawal_fee` | Computes dynamic withdrawal fee from spot price, oracle price, and minimum fee floor |
| `calculate_cap_difference` | Checks whether adding liquidity would breach the asset's weight cap |

### Return types
Functions return `Option<StateChange>` types (e.g., `LiquidityStateChange<Balance>`, `TradeStateChange<Balance>`) wrapping per-pool and per-LP delta structs. Returning `None` signals an arithmetic failure (overflow, division by zero) and the pallet maps this to a dispatch error.

### Numeric precision
All math uses Substrate's `FixedU128` for fixed-point arithmetic and `u128` for balances. The math crate is designed to be deterministic and overflow-safe — all operations use checked or saturating arithmetic.

---

## 10. Risk Controls

The Omnipool has a layered defense-in-depth security architecture:

### TVL / Weight Caps
Each asset has a maximum weight cap (`Permill`) set via `set_asset_weight_cap`. This bounds the fraction of total Omnipool LRNA any single asset can represent. Lower caps are assigned to riskier/lower-mcap assets, limiting maximum loss from toxic asset flows or inflationary token attacks.

### Circuit Breaker (`pallet-circuit-breaker`)
A dedicated pallet enforces per-block trade volume limits. Key rules:
- No more than **50% of an asset's liquidity** can be traded in a single block
- Per-block limits on liquidity additions and removals are also tracked
- The circuit breaker tracks `AllowedTradeVolumeLimitPerAsset` and `AllowedAddLiquidityLimitPerAsset` / `AllowedRemoveLiquidityLimitPerAsset` in storage
- Hub asset (LRNA) is excluded from circuit breaker tracking (it is internal)
- Trades exceeding the block limit must be split across multiple blocks

### Price Barrier (`PriceBarrier`)
Applied on `add_liquidity` and `remove_liquidity`. Compares the on-chain spot price (derived from pool reserves) against an EMA oracle price. If the deviation exceeds the configured threshold (currently **1%**), the liquidity operation is paused for that asset. This prevents manipulation of LP entry/exit conditions.

### Dynamic Withdrawal Fee
As detailed in Section 6 — deters withdrawing immediately after a spot price manipulation.

### On-Chain EMA Oracle
The Omnipool maintains an exponential moving average (EMA) oracle for each asset. Provides time-weighted average price data over a configurable window (e.g., 10 blocks). Used by the Price Barrier and withdrawal fee calculation.

### Targeted Function Pausing
The Technical Committee can invoke `set_asset_tradable_state` to selectively disable any combination of SELL/BUY/ADD_LIQUIDITY/REMOVE_LIQUIDITY for any asset in an emergency. This is the primary circuit-breaking tool for responding to an active exploit.

The `set_asset_tradable_state` extrinsic is a candidate for `Operational` dispatch class (highest weight priority, bypasses block weight limits) — ensuring pausing can succeed even during high-throughput attacks.

---

## 11. Governance — Asset Listings and Parameter Changes

All Omnipool listings and risk parameter changes are governed by HDX holders via Polkadot's **OpenGov** framework. There are no multisigs or privileged team addresses.

**Token listing process:**
1. Project submits an on-chain governance referendum proposing to list their asset
2. HDX holders vote; approval requires meeting the threshold for the relevant OpenGov track
3. If approved, initial liquidity is transferred to the pool account
4. `add_token` is called with the agreed initial price and weight cap
5. If rejected, `refund_refused_asset` returns the pre-transferred liquidity to the submitter

**Parameters governed on-chain:**
- Per-asset weight caps (`set_asset_weight_cap`)
- Tradability flags for any asset
- Circuit breaker volume limits
- Protocol and asset fee rates
- Addition of new assets to the pool

---

## 12. Security Audits

| Audit | Auditor | Scope | Date |
|-------|---------|-------|------|
| Rust implementation audit | Runtime Verification | Omnipool pallet, math crate, asset registry, 3rd-party Substrate deps | September 2022 |
| Economic/math audit | BlockScience | AMM specification, mathematical model, LP economics | March 2022 |
| Broad protocol audit (Code4rena) | Public competitive audit | Full HydraDX node including omnipool, stableswap, oracles | February 2024 |

Active bug bounty on **Immunefi** — rewards scale with vulnerability severity using the Immunefi Vulnerability Severity Classification System V2.2.

---

## 13. Integration Notes for Developers

- **SDK:** Hydration provides a TypeScript SDK for frontend integrations; swap routing through the Omnipool is exposed via the SDK
- **Router pallet:** The `pallet-route-executor` and `RouterT` trait abstract multi-hop routing — the Omnipool is one pool type the router can include in a trade path
- **OTC settlement pallet:** `pallet-otc-settlements` aligns OTC order prices with Omnipool spot prices via arbitrage; it uses `RouterT` internally with Omnipool as the reference price
- **EVM access:** EVM wallets (MetaMask) can interact with the Omnipool via `pallet-evm` / `pallet-frontier` — no separate EVM chain needed
- **Hooks:** The pallet exposes `OmnipoolHooks` (trait) for `on_trade`, `on_liquidity_changed`, and `on_trade_fee` — used by downstream pallets (e.g., circuit breaker, staking, referrals) to react to pool events

---

## 14. Key Constants and Types Reference

| Item | Type / Value | Description |
|------|-------------|-------------|
| `LRNA` / `H2O` | `AssetId` (hub asset) | Internal hub token; only SELL is permitted |
| `AssetState<Balance>` | Struct | Per-asset pool state (reserves, shares, cap, tradability) |
| `Position<Balance, AssetId>` | Struct (NFT payload) | LP position data: shares, entry price, asset |
| `Tradability` | Bitflags | SELL / BUY / ADD_LIQUIDITY / REMOVE_LIQUIDITY |
| `SimpleImbalance<Balance>` | Struct | Tracks net LRNA imbalance globally |
| `FixedU128` | Numeric type | Fixed-point arithmetic for prices and fees |
| `Permill` | Numeric type | Used for weight caps and fee floors |
| `PriceBarrier` | Config trait | Validates spot vs. oracle price on liquidity ops (1% default) |
| `ExternalPriceOracle` | Config trait | Provides EMA price for withdrawal fee calculation |
| `MinWithdrawalFee` | Config const | Floor for dynamic withdrawal fee (0.01%) |
| `fA` | Dynamic `Permill` | Asset fee — goes to LPs of the output asset |
| `fP` | Dynamic `Permill` | Protocol fee — collected as LRNA for treasury/stakers |
