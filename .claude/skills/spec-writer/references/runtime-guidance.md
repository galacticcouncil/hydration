# Runtime Spec Guidance

Guidance for writing Substrate runtime (pallet) specs for Hydration.

## Pallet Design

- **One pallet per concern.** If the feature is a new domain (e.g., bonds, staking rewards), it gets its own pallet. If it extends an existing domain (e.g., new Omnipool operation), it goes in the existing pallet.
- **Config traits over hardcoding.** Anything that might vary between environments (thresholds, limits, fees) should be a `Config` associated type or constant, not a magic number.
- **Events for every state change.** Every dispatchable that mutates storage must emit an event. Events are the indexing layer for the UI and analytics.
- **Errors must be granular.** One error variant per failure reason — not a catch-all `OperationFailed`.

## Extrinsic Design

- Define origin requirements: `ensure_signed`, `ensure_root`, custom origin (e.g., `T::AuthorityOrigin`), or governance-gated.
- Specify weight model: which parameters affect computation? What's the worst case?
- Consider transactionality: if the extrinsic does multiple storage writes, what happens on partial failure?
- Slippage/deadline parameters for user-facing DeFi operations.

## Storage Design

- Prefer `BoundedVec` / `BoundedBTreeMap` over unbounded collections.
- Consider storage deposits for user-created entries.
- Document the access pattern: is this read-heavy or write-heavy? Does it need an index?
- Think about migration: if this storage changes later, how painful is the migration?

## Interactions

Hydration pallets commonly interact with:
- **Omnipool** — liquidity, pricing, hub asset (LRNA)
- **Stableswap** — stable asset pools
- **Multi-currency (ORML)** — token balances, transfers, reservations
- **Circuit breaker** — trade/liquidity limits
- **EMA oracle** — price feeds
- **Referrals** — fee sharing
- **Dynamic fees** — fee calculation based on oracle data

For each interaction, specify:
- Which trait or function is called
- What happens if the dependency returns an error
- Whether the interaction is synchronous or via hooks

## Math

- All balance/share calculations should go through `hydra-dx-math`, not inline arithmetic.
- Specify precision requirements: is rounding acceptable? In whose favor?
- Note any division operations and what happens when the denominator is zero.

## Testing Expectations

In the spec's acceptance criteria, indicate:
- Which scenarios need unit tests (per-pallet)
- Which need integration tests (cross-pallet, full runtime)
- Any property-based test candidates (invariants that must hold for arbitrary inputs)

## Governance

- Which parameters should be governable?
- Should the feature be pausable? (Circuit breaker integration)
- Does it need a staged rollout (feature flag / kill switch)?
