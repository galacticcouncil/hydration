# UI Spec Guidance

Guidance for writing frontend specs for Hydration UI.

## General

- Hydration UI is a React application.
- Specs should reference runtime extrinsics and queries by name — the UI team needs to know exactly which chain calls to make.
- If a runtime spec exists for this feature, reference it and don't duplicate the protocol logic — focus on the user experience layer.

## User Experience

- **Who is the user?** Retail DeFi user, liquidity provider, governance participant, power trader? This affects complexity tolerance.
- **Entry points:** How does the user discover this feature? Navigation path, deep links, contextual CTAs.
- **Happy path first:** Describe the complete flow step-by-step before covering edge cases.
- **Feedback:** What does the user see during transaction submission, confirmation, and failure? Loading states, toast notifications, tx hash links.

## State & Data

- What on-chain data needs to be queried? List storage keys or RPC calls.
- What derived/computed data is needed? (e.g., USD values, APR calculations, share percentages)
- Caching and refresh strategy: how stale can data be? What triggers a refresh?
- Optimistic updates: should the UI update before tx confirmation?

## Component Design

- Describe the feature in terms of user-visible sections/panels, not internal components.
- For forms: list every input field, its type, validation rules, and default value.
- For displays: what data is shown, in what format, and what actions are available?
- Responsive behavior: any mobile-specific considerations?

## Wallet & Transaction

- Which extrinsics are called? With what parameters?
- Fee estimation: does the user need to see estimated fees before confirming?
- Multi-step flows: batch calls? Sequential transactions?
- Error mapping: map runtime errors to user-friendly messages.

## Edge Cases

Common UI edge cases to address:
- Wallet not connected
- Insufficient balance (for tx fee, for the operation, for ED)
- Asset not in wallet / unknown asset
- Transaction rejected by user
- Transaction fails on-chain after submission
- Stale data (price moved between preview and submission)
- Concurrent transactions
