# Feasibility note: running Hydration inside ZisK

**TL;DR.** Running the full Hydration runtime under ZisK end-to-end is not feasible today as a drop-in. The fundamental mismatch is not RISC-V vs. anything — it's that Hydration is a *WASM-hosted* Substrate runtime whose hot path leans on host functions ZisK doesn't accelerate (sr25519 verify, BLAKE2, twox, trie root, EVM execution). A meaningful PoC is feasible at the granularity of *one extrinsic's state transition function*, not a block. ZisK itself is alpha (v0.17, unaudited, single-host-OS), so any production target is at least 12+ months out independent of Hydration work.

## 1. The architectural mismatch

|                       | Hydration runtime                       | ZisK guest                             |
| --------------------- | --------------------------------------- | -------------------------------------- |
| Target                | `wasm32-unknown-unknown`                | `riscv64ima-zisk-zkvm-elf`             |
| Hosted by             | Substrate client (provides host fns)    | ZisK emulator (only `ziskos` syscalls) |
| Environment           | `no_std` + sp-std + heap                | `std`-ish (ZisK Rust fork) + heap      |
| Entry point           | `Core::execute_block(block) → state_root` | `fn main()` with `ziskos::io::read/commit` |
| Determinism boundary  | host fn ABI                             | RISC-V ISA + ziskos syscalls           |
| Allocator             | `frame_support` host-provided           | bump / dlmalloc / talc / tlfs          |

The runtime cannot be compiled "for ZisK" by changing a target triple. Either the WASM blob runs inside an interpreter that runs on ZisK (cycle disaster), or the runtime is *re-compiled natively to RISC-V*, which means replacing every `sp_io::*` host call with a pure-Rust or syscalled equivalent. There is no third option.

## 2. What ZisK gives you

Pulled from `0xPolygonHermez/zisk` v0.17.0 (May 2026):

- **ISA:** RV64IMA (no F/D, no C). Float ops emulated via softlib at `0xBFFF_0000`. Single hart, no real threading.
- **Memory:** 1 GiB input region, 512 MiB RAM, **64 KiB public output cap**, ~36-bit step counter (≈ 68 G steps practical ceiling).
- **Toolchain:** Custom Rust fork `0xPolygonHermez/rust` branch `zisk`, installed via `ziskup` + `cargo-zisk`. Linux x86_64 only for proving; Mac emulation only.
- **I/O:** bincode-framed input via `ziskos::io::read::<T>()` (zero-copy slice into INPUT region — large inputs OK); outputs via `ziskos::io::commit*()`, capped at 64 KiB. A separate "hints stream" (128 KiB chunks) for host-assisted deterministic computation.
- **Precompiles (syscalls):**
  - Hashing: keccak-f[1600], SHA-256 compression, BLAKE2b *round* function (not full hash), Poseidon2
  - Arithmetic: 256-bit add/mul/mul-mod, 384-bit mul-mod
  - Curves: secp256k1, secp256r1, BN254, BLS12-381 — point add/double + Fp2 ops (no Miller loop, no pairing precompile)
  - Patched via Cargo `[patch]` (e.g. tiny-keccak); no automatic substitution
- **Proving:** Plonky3 + PIL2 STARK over Goldilocks, wrapped to a BN254 PLONK SNARK with a shipped Solidity verifier (`zisk-contracts/PlonkVerifier.sol`). Recursive aggregation ("VADCOP"). Distributed proving needs ~25 GB RAM per worker + ≥2 GB proving key.
- **Status:** Repo README is explicit: *"not been audited ... not for production"*. Only one binary audit on file. No mainnet deployments.

Notable absences relative to Hydration's needs: **no sr25519, no Ristretto/Schnorrkel, no full BLAKE2 hash, no twox/xxhash, no pairings.**

## 3. What Hydration demands from its host

The Substrate runtime ABI Hydration depends on, broken down by where each call lives:

**Cryptographic verification (every block, every extrinsic)**

- `ext_crypto_sr25519_verify` — primary signature scheme for native accounts. **No ZisK precompile.** Pure-Rust `schnorrkel` would run as bare RV64IMA: ~10⁵–10⁶ cycles per verify, × thousands of extrinsics per block.
- `ext_crypto_ecdsa_verify`, `ext_crypto_secp256k1_ecdsa_recover` — used by EVM accounts and `pallet-ethereum`. ZisK has secp256k1 point ops but no fully-fused recover; patching `k256` to use the curve syscalls is the realistic path.

**Hashing**

- `ext_hashing_blake2_128/256` — the default Substrate hash for storage keys and trie nodes. **No full BLAKE2b precompile** — only a round function. Hot path inside `StorageMap` lookups → every storage read hashes the key.
- `ext_hashing_twox_64/128/256` — fast non-cryptographic hashes for storage prefixes. **No precompile.** Pure-Rust xxhash.
- `ext_hashing_keccak_256` — used in `permit.rs` and `erc20_mapping.rs`. ZisK keccak-f syscall covers this cleanly (patch `tiny-keccak`).
- `ext_hashing_sha2_256` — covered by SHA-256 compression syscall.

**Trie / state**

- `ext_trie_blake2_256_root`, `ext_trie_blake2_256_ordered_root` — Merkle Patricia root computation over storage changes. BLAKE2b-bound, no precompile. Heavy.
- `ext_storage_*` family — these are the *hardest* to port: in Substrate they delegate to the client's overlay + backend DB. In a zkVM you must replace them with an in-circuit trie that takes the pre-state as `read_input` and emits the post-root via `commit`. This is the bulk of the engineering.

**Frontier EVM**

- `pallet-evm` runs the `sputnikvm`/`evm` interpreter on every EVM call. Interpreter-in-zkVM is the slowest path but tolerable for short txs.
- EVM precompiles: modexp, bn128 (covered by ZisK BN254 syscalls if patched), blake2 (partial — only round function), identity, ec recover (k256 patched).

**Allocator.** Substrate's WASM runtime uses the client's allocator via `ext_allocator_malloc/free`. Native build would use `ziskos`'s bump or `embedded-dlmalloc`. No-op concern.

**Misc.** `ext_misc_print_*` → drop or route to ZisK's debug write. `ext_offchain_*` → not relevant inside a state-transition proof.

## 4. Effort sizing for three scoping options

**Option A — "wasmi inside ZisK, ship the existing WASM blob unchanged."**

- Engineering: small (port `wasmi`/`wasm3`, wire host functions to pure-Rust implementations).
- Proving: catastrophic. WASM op ≈ 50–200 RV ops × ~10⁷–10⁸ ops per Hydration block = ~10⁹–10¹⁰ ZisK steps, brushing the 2³⁶ step ceiling. Unpatched sr25519/BLAKE2/twox on top.
- Verdict: **not viable** as anything but a "does it compile" exercise. Useful negative result only.

**Option B — recompile the runtime natively to RISC-V, prove `execute_block`.**

- Engineering: major. Fork or recompile sp-io's host functions as Rust libraries, build a stateless trie that ingests storage proof + diff via ZisK input/output, replace `wasm-builder` with a `cargo-zisk` build, route sr25519/BLAKE2/twox to either patched implementations or new ZisK syscalls (would require upstream contributions to ZisK).
- Proving: plausibly bounded if precompiles are added for the two missing primitives. Without them, sr25519 alone on a busy block is probably > step ceiling.
- Verdict: research project, **6–12 person-months**, dependent on ZisK upstream cooperation.

**Option C — pick one extrinsic's STF, prove it standalone.**

- Engineering: small to medium. `Omnipool::sell` is a good candidate: pure math over `FixedU128`, balance maps, asset registry — no signatures, no trie root, no EVM. Pull `pallet-omnipool`'s math module as a library, write a ZisK guest that:
  - reads `(pre_state_subtree, sell_inputs)` via `ziskos::io::read`,
  - executes the unchanged Omnipool math,
  - commits `(post_state_root, swap_result)` via `ziskos::io::commit`.
- Proving: well within ZisK limits — Omnipool's hot path is ~10⁵–10⁶ cycles per sell.
- Verdict: **realistic PoC**. Demonstrates the proving cost per useful Hydration operation, surfaces the sr25519/BLAKE2 gap concretely, and produces a number to compare against RISC0/SP1 for the same operation.

## 5. Risks & open questions

1. **sr25519 is not negotiable for Hydration.** Without a ZisK syscall (or upstream Schnorrkel patch), even Option C grows expensive if you include signature verification in the proven scope. Most PoCs would exclude it and prove the *state transition* given a pre-validated extrinsic.
2. **Trie root computation is BLAKE2-bound.** Substrate's storage proofs assume blake2_256. ZisK only ships the round function, not the full hash. Either patch a BLAKE2 implementation to call the round syscall efficiently, or contribute a full-BLAKE2 syscall upstream. Without this, any state-root commit is a major cycle cost line item.
3. **64 KiB public output is tight.** A Substrate header (~200 B) + new state root (32 B) + events Merkle root (32 B) fits trivially. A storage diff does not — would have to commit only roots and supply diffs as private witness.
4. **ZisK maturity.** Alpha, unaudited, Linux-x86_64-only for proving. Production targeting is premature. The 0xPolygonHermez/rust fork tracks stable but is not a rustup channel — onboarding contributors is non-trivial.
5. **Polkadot/JAM substitution risk.** JAM uses PolkaVM (RISC-V derived). If JAM ships, the natural ZK story for Polkadot-adjacent runtimes is "prove PolkaVM execution" rather than retrofitting WASM-era Substrate. Worth scoping Option B against the timeline of JAM availability before committing.
6. **Why ZisK over RISC Zero / SP1?** Not addressed by ZisK's own materials. RISC0 has a more mature precompile catalog (including ed25519 and BLAKE2b in community crates) and a Substrate-style ecosystem story is no more advanced there — but it's no less, either. A side-by-side cycle count on the same Omnipool extrinsic is the cheapest way to decide.

## 6. Recommended next step

Build the Option-C PoC: ZisK guest that proves a single `Omnipool::sell` STF over a Merkle-proof-supplied pre-state. Two weeks of focused work, with deliverables: (a) measured cycle count and proof generation time, (b) a concrete list of host functions actually touched, (c) a side-by-side with the same PoC in RISC Zero so the zkVM choice is data-driven rather than narrative-driven. Anything more ambitious is premature until those numbers exist.

## Sources

- ZisK docs — https://0xpolygonhermez.github.io/zisk/
- ZisK source — https://github.com/0xPolygonHermez/zisk (v0.17.0, May 2026)
  - Memory map: `core/src/mem.rs`
  - Step ceiling: `core/src/zisk_definitions.rs`, `emulator-asm/src/constants.hpp`
  - Target triple: `ziskbuild/src/lib.rs`, `cli/src/common.rs`
  - Rust fork: `cli/src/commands/toolchain/build.rs` (clones `0xPolygonHermez/rust` branch `zisk`)
  - Guest API: `ziskos/entrypoint/src/{lib,io}.rs`
  - Syscalls: `ziskos/entrypoint/src/syscalls/mod.rs`
  - Solidity verifier: `zisk-contracts/{ZiskVerifier,PlonkVerifier}.sol`
- Cysic Venus (hardware-accelerated ZisK backend) — https://github.com/cysic-labs/venus
- Hydration host-fn surface — `hydration-node/runtime/hydradx/src/evm/permit.rs`, `evm/precompiles/erc20_mapping.rs`, `migrations/cleanup_hyperbridge.rs`; toolchain pinned `1.88.0`, target `wasm32-unknown-unknown`.
