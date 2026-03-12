# Hydration — General Protocol Context

> **Purpose:** Foundational reference for any Claude task involving Hydration (security audits, content, integrations, research). All vertical-specific context files should build on this document.
> **Last updated:** 2025-09-22 (reflects HOLLAR launch)
> **Sources:** hydration.net, docs.hydration.net, official press releases

---

## 1. What is Hydration?

Hydration (formerly HydraDX) is the largest DeFi protocol on Polkadot by TVL (~$330M+ at launch of HOLLAR). It is a purpose-built, app-specific Layer-1 blockchain (parachain) running on the Polkadot network, built using the Substrate framework.

Its mission is to consolidate the three foundational pillars of DeFi into a single, vertically integrated environment:

1. **Trading** — via the Omnipool AMM and ancillary tools
2. **Lending/Borrowing** — via an Aave v3 fork (money market)
3. **Stable Value** — via HOLLAR, its native over-collateralized stablecoin

The key design philosophy is vertical integration: all three pillars interact natively at the runtime level, enabling composability that smart-contract-based systems cannot replicate (e.g., using an Omnipool LP position as collateral for borrowing).

---

## 2. Technical Foundation

- **Chain type:** Polkadot parachain (app-specific blockchain / appchain)
- **Framework:** Substrate (Rust-based runtime)
- **Security model:** Inherits shared security from Polkadot's relay chain
- **Cross-chain:** XCM (Cross-Consensus Messaging) for interoperability with other parachains and Asset Hub
- **Execution environment:** Runtime-level pallets, not EVM smart contracts — deeper integration than typical DeFi protocols
- **Hub token:** LRNA (also referred to as H2O in some contexts) — the internal hub token used for Omnipool routing

---

## 3. Core Products

### 3.1 Omnipool (Trading)
- A novel multi-asset AMM that concentrates all liquidity into a single pool instead of isolated pairs
- Uses LRNA as a synthetic hub token — all trades route through LRNA internally
- Supports **single-sided liquidity provisioning** (LPs deposit one asset; LRNA is minted synthetically)
- Eliminates multi-hop routing for long-tail pairs (e.g., HDX→KSM in one transaction)
- Features dynamic trading fees — higher fees for more volatile assets, discouraging manipulation
- Risk controls: liquidity caps, circuit breakers, protocol fees
- Omnipool listings are **permissioned via on-chain governance** (HDX holders vote)
- Fully audited with an active bug bounty program

### 3.2 Additional Pool Types
- **StableSwap pools** — optimized for stablecoin-to-stablecoin swaps with low slippage
- **XYK (Isolated) pools** — classic constant-product AMM; permissionless listing for any project
- **Stablecoin pools for HOLLAR** — four dedicated pools outside the Omnipool, seeded by the protocol

### 3.3 Trading Tools
- **DCA (Dollar-Cost Averaging)** — automated recurring trades over time using the Omnipool
- **Split Trade / Easy DCA** — splits a single large trade into smaller chunks, targeting <0.1% estimated slippage
- **OTC (Over-the-Counter)** — peer-to-peer trades at user-defined prices, no slippage, no intermediaries
- **LBP (Liquidity Bootstrapping Pool)** — for projects launching tokens, anti-sniping bot mechanics
- **ICE (Intent Composing Engine)** — upcoming intent-based trading model to further minimize slippage

### 3.4 Lending & Borrowing (Hydration Borrow)
- Fork of **Aave v3** with risk tooling adapted for the Polkadot ecosystem
- Users can supply assets and earn yield, or borrow against collateral
- Supported collateral includes DOT, ETH, BTC variants, stablecoins
- Integrates natively with the Omnipool and HOLLAR (e.g., mint HOLLAR by borrowing against LP positions)
- Risk factors: Loan-to-Value (LTV) ratio, health factor, liquidation thresholds

### 3.5 HOLLAR (Stablecoin)
- Hydration's native **over-collateralized, decentralized stablecoin**, pegged to $1
- Backed by: DOT, ETH, BTC variants, USDT, USDC
- Built on the architectural framework of **Aave's GHO stablecoin**
- **HOLLAR Stability Module (HSM):** asymmetric price support mechanism
  - Caps upside: users can mint at predictable rates
  - Defends downside: intelligent buybacks when HOLLAR trades below $1
- **Partial automated liquidations** at the start of each block — restores health factors incrementally rather than full liquidation; this mechanism also applies to the Aave-based money market, not just HOLLAR
- Initial supply cap: 2,000,000 HOLLAR; initial borrow rate: 5% APR
- Revenues from minting flow back into yield strategies
- Integrates with trading, lending, and staking products

### 3.6 Strategy Tokens
- **GDOT** — bundles DOT staking yield (via vDOT), lending yield (via aDOT), and liquidity incentives into a single token
- **GETH** — bundles ETH staking yield (via wstETH), lending yield (via aETH), and pool fees
- **GSOL** — strategy token for SOL exposure, following the same yield-bundling model as GDOT and GETH

---

## 4. Governance & Tokenomics

- **Native token:** HDX
- **Governance:** On-chain referenda via Polkadot's **OpenGov** framework; all HDX holders can vote on protocol changes, Omnipool listings, and treasury management. There are no multisigs or council intermediaries — the founding team relinquished control at mainnet launch. OpenGov uses tiered tracks (9 tracks), where the required approval threshold scales with the impact of the referendum (e.g., small tips vs. Root-level chain upgrades). The Technical Committee retains only emergency intervention powers.
- **Staking:** HDX can be staked to earn protocol revenue (LP fees from Hydration's HDX position + treasury subsidies); uses a **bonding curve** — early claimers receive a fraction, remainder redistributed to other stakers
- **Action points:** Governance participation (voting in referenda) accelerates the bonding curve for stakers
- **Referrals:** Users earn from trading volume of referred users; 50% of asset fees that would otherwise go to HDX stakers are redirected to referral rewards
- **Protocol-Owned Liquidity (POL):** Treasury accumulates and diversifies POL via on-chain governance; DAOs on Polkadot can also manage their treasuries on Hydration via XCM
- **Bonds:** Users can purchase HDX bonds to grow POL in exchange for fixed-rate yield over a set period

### Treasury
The Hydration Treasury is one of the most diversified on-chain treasuries in the Polkadot ecosystem. Key characteristics:

- **Governance:** All treasury decisions are made exclusively by HDX holders via OpenGov referenda — no multisigs, no team control
- **Origin of funds:** The treasury was seeded with ~22.5M DAI raised during the Hydration LBP (March 2021); 5M DAI was set aside for 2 years of protocol development, the remainder approved for diversification via governance referenda
- **Asset diversity:** The treasury holds a wide range of assets spanning crypto and real-world asset proxies, including BTC (WBTC/iBTC), ETH (WETH), DOT, stablecoins (DAI, sDAI, sUSDe), HDX, and tokenized gold — making it one of the few DeFi treasuries with exposure beyond crypto-native assets
- **Active deployment:** Treasury assets are not idle — they are actively deployed across Hydration's own products (Omnipool LP positions, Money Market deposits, yield-bearing stablecoins) to generate returns
- **HDX buybacks:** Protocol revenue is used to continuously buy back HDX, which is then distributed to HDX stakers
- **Transparency:** Full treasury composition and deployment breakdown is publicly visible at `https://app.hydration.net/stats/treasury`; all allocation decisions are traceable on-chain via SubSquare

---

## 5. Cross-Chain Architecture

- Hydration operates as a Polkadot parachain, inheriting relay chain security
- **XCM** is used for all cross-chain communication within the Polkadot ecosystem (no external bridges required)
- **Remote swaps** — Hydration can compose XCM instructions so users swap and receive assets on a different chain in one UX flow (e.g., DOT on Relay Chain → USDT on Asset Hub)
- **Asset Hub** is Polkadot's system chain for asset issuance and a common landing zone for stablecoins
- Supports cross-chain assets including vDOT (Bifrost), USDT, USDC, wrapped BTC, and other parachain tokens
- DAOs across the Polkadot ecosystem can manage treasury operations on Hydration using XCM — no multisigs required

### Bridges
- **Snowbridge** — trustless, native bridge between Polkadot and Ethereum; no external trust assumptions
- **Wormhole** — additional bridge for broader cross-chain connectivity beyond the Polkadot ecosystem

### Intents (Cross-Chain)
- Hydration is actively working on **cross-chain intent-based trading**, extending ICE (Intent Composing Engine) beyond single-chain execution
- Intents abstract routing complexity — users express a desired outcome, the protocol finds the optimal path across chains

### EVM Compatibility
- EVM compatibility is achieved via **pallet-evm / pallet-frontier** — a Substrate pallet that embeds an EVM execution environment directly in the runtime
- Enables Solidity-based tooling and EVM wallets (e.g., MetaMask) to interact with Hydration without a separate EVM chain

---

## 6. Security Posture

- Active auditing by third-party security firms
- Active bug bounty program on Immunefi
- Runtime-level risk controls: liquidity caps, circuit breakers, dynamic fees
- HOLLAR introduces new smart contract attack surface (HSM, liquidation engine)
- Deeper security guarantees than EVM-based protocols due to runtime-level execution
- Polkadot shared security model underpins the chain

---

## 7. Ecosystem Position

- **Largest DeFi protocol on Polkadot** by TVL
- Rebranded from HydraDX to Hydration in May 2024 as the product expanded beyond trading
- Provides liquidity infrastructure for other Polkadot DAOs and parachains
- SDK available for frontend developers building on Hydration

---

## 8. Key Terminology Reference

| Term | Definition |
|------|-----------|
| LRNA / H2O | Internal hub token used for Omnipool routing |
| Omnipool | Single multi-asset AMM pool |
| HSM | HOLLAR Stability Module — peg defense mechanism |
| XCM | Cross-Consensus Messaging — Polkadot's native cross-chain protocol |
| LBP | Liquidity Bootstrapping Pool — for token launches |
| GSOL | Strategy token for SOL — bundles staking and lending yield |
| Snowbridge | Trustless native bridge between Polkadot and Ethereum |
| Wormhole | Bridge for broader cross-chain connectivity beyond Polkadot |
| pallet-frontier | Substrate pallet enabling EVM compatibility on Hydration |
| ICE | Intent Composing Engine — intent-based trading, cross-chain in progress |
| POL | Protocol-Owned Liquidity |
| HDX | Native governance and incentive token |
| HOLLAR | Native over-collateralized stablecoin ($1 peg) |
| Parachain | App-specific blockchain secured by Polkadot relay chain |
| Pallet | Substrate module (equivalent of a smart contract in Polkadot) |
| Asset Hub | Polkadot system chain for asset management |
