# Addendum: PoC findings on running Hydration inside ZisK

Companion to [zisk-feasibility.md](./zisk-feasibility.md). The original note
was speculative — based on docs, source reading, and order-of-magnitude
estimates. This addendum records what was actually built and measured in
the [hydration-zisk-poc](../../hydration-zisk-poc/) sibling repo (8 layered
milestones v1–v8, plus 4 isolated benchmarks).

**TL;DR (updated).** A native-Rust port of Hydration to ZisK is **more
feasible than the original note predicted**, and the headline risks flip:

- BLAKE2-256 is **not** the dominant cost; it's ~50× cheaper than feared.
- sr25519 is the single biggest cost as predicted — ~735 k cycles per
  verify, 75–83 % of any extrinsic's budget — and there's no syscall, so
  it's a hard floor.
- A full *block-level* proof (signed extrinsics → post-state root)
  works end-to-end at the recompiled-native-Rust level, with budget to
  spare under the ZisK step ceiling.

What we couldn't measure: **realtime GPU proving on this hardware**.
ZisK 0.17.0's released GPU binary is sm_120/Blackwell-only and won't run
on RTX 3090 / 4090. CPU-only proving is ~10 hours per busy block, which
confirms the original note's "needs GPU" warning but doesn't give us the
actual GPU number — see § 5.

---

## 1. What was built

Eight layered milestones, each adding one band of "real STF" on top of the
previous. Every layer was measured end-to-end on the ZisK emulator with
a deterministic fixture. The last layer produces a complete
extrinsic-level state-transition proof.

| Layer | What it does                                                  | ZisK steps | Δ from prev |
| ----- | ------------------------------------------------------------- | ---------: | ----------: |
| v1    | SCALE-decode args → `calculate_sell_state_changes` → commit   |     16,858 | —           |
| v2    | + decode `Call::Omnipool(sell{..})` envelope strictly         |     17,654 | +796        |
| v3    | + sr25519 verify (schnorrkel) over the call bytes             |    766,594 | **+748,940** |
| v4    | + verify storage proof for both asset states under state_root |    812,637 | +46,043     |
| v5    | + write back through proof-backed MemoryDB, commit new root   |    891,328 | +78,691     |
| v6    | + real Substrate storage keys (`twox128 ++ blake2_128_concat`) + 134-byte SignedPayload | 916,156 | +24,828 |
| v7    | + read signer's `System::Account`, check nonce, deduct fee, bump nonce | 976,924 | +60,768  |
| v8    | block of 2 sells: in-block state evolution + single pre/post-root | 1,918,371 | ~+941 k / extrinsic |

The v8 guest does the full lifecycle: signature verify, call decode,
key re-derivation, storage proof verification, state read, math,
slippage check, fee + nonce update, write-back, post-root computation.
Anyone with the witness and `(pre_state_root, post_state_root,
extrinsics_hash)` can independently verify the state transition.

---

## 2. Per-primitive costs (isolated benchmarks)

Bench guests in `bench/` measure each primitive standalone, subtracting
the ~9.6 k cycle ZisK runtime overhead.

| Primitive                       | ZisK steps    | Notes                                      |
| ------------------------------- | ------------: | ------------------------------------------ |
| Runtime baseline (`bench-noop`) |         9,618 | entrypoint + alloc + commit one byte       |
| sr25519 verify (`bench-sr25519`)|       735,591 | schnorrkel, no precompile                  |
| BLAKE2-256 hash, ≤ 128 B input  |   ~3,400 (+~2,800/extra block) | `blake2b_simd`, no precompile |
| Keccak-256 (`tiny-keccak` patched) | ~900/block | uses `syscall_keccakf`                  |
| Keccak-256 (`sha3` unpatched)   | ~7,100/block | pure RV64IMA — Substrate's actual path     |
| `sp_trie::verify_trie_proof`    | ~7.5–14 k per proof node | BLAKE2-bound                  |

The keccak comparison confirms ZisK's syscall mechanism works — **~8×
speedup** when the `tiny-keccak` patched fork is wired via
`[patch.crates-io]`. Substrate's `sp_crypto_hashing::keccak_256` uses
`sha3` which has no equivalent patch fork; would need to be written or
the call sites replaced.

---

## 3. Risk model: what flipped

| Original note (speculative)            | After measurement                       |
| -------------------------------------- | --------------------------------------- |
| **BLAKE2 dominates trie cost**         | ~13 k per typical trie-node hash; ~50× cheaper than worst-case estimate |
| **sr25519 expensive — needs Schnorrkel patch fork** | ~735 k cycles confirmed; no patch fork exists today |
| **secp256k1 / k256 may need patching** | Not exercised here; the Frontier EVM path wasn't part of v8 |
| **WASM-runtime path is catastrophic**  | Confirmed — but native-Rust port works |
| Trie verify cost handwaved              | Measured: linear in proof nodes; per-key with sharing ≈ 30–60 k cycles |
| Per-block cost handwaved                | Per-extrinsic ≈ 941 k; per 300-tx block ≈ 282 M cycles, 0.4 % of step ceiling |

The original note's biggest worry — that the runtime + proof verification
+ trie work would blow past the 2³⁶ step ceiling — was wrong by ~250×.
Even a generous block sits comfortably in the budget.

---

## 4. New blockers discovered (not in the original note)

These bit the implementation but aren't visible from docs alone:

1. **ZisK SDK's public output is capped at 64 × u32 = 256 bytes**
   (`ziskos/entrypoint/src/lib.rs:271`). The 64 KiB number from
   `core/src/mem.rs` is the underlying memory map limit, not the
   public-output cap surfaced by `commit_slice`. v8 had to commit only
   `(pre_state_root, post_state_root, blake2_256(extrinsics_encoded))`
   = 96 bytes; per-tx details aren't directly committed. Production
   block-proofs need a Merkle-tree-of-results pattern.

2. **`cargo-zisk` builds the entire workspace for the riscv64 target**.
   Native-only crates (with `sp-trie/std` → `substrate-prometheus-endpoint`
   → tokio etc.) must be excluded via `default-members` in the workspace
   `Cargo.toml`. Otherwise the riscv64 build tries to cross-compile
   `mio`/`socket2`/`secp256k1-sys` and fails.

3. **`sp-runtime` in the guest pulls `sp-io` → `secp256k1@0.28` → C build
   script with `-mabi=lp64`** which the host `cc` can't cross-compile.
   Workaround: roll a local `hash_db::Hasher` over `blake2b_simd`
   directly. Don't depend on `sp-runtime` or `sp-core` from the guest.

4. **`generate_trie_proof` is verification-only** — it produces a compact
   proof not usable for in-circuit mutation. For "read + write" state
   transitions the proof must come from a recording trie
   (`sp_trie::recorder::Recorder` with both reads and *simulated writes*
   recorded). The naive flow panics with `IncompleteDatabase` partway
   through `TrieDBMut::insert`.

5. **`ziskos` default `user-hints` feature pulls tokio**. Even though the
   deps are gated on `cfg(not(target_os = "zkvm"))`, the host build path
   has to compile them. Disable via `default-features = false` at the
   workspace dep level.

6. **The ZisK Rust fork drops the guest ELF at the workspace-root
   `target/`**, not `<pkg>/target/`. A stale ELF at the latter location
   is a common confusion source.

These are all in [`hydration-zisk-poc/README.md`](../../hydration-zisk-poc/README.md)
with reproducer steps.

---

## 5. Real proving time (CPU; GPU blocked)

Beyond emulation step counts, we measured wall-clock proving time on the
PoC machine (16 physical cores, 125 GB RAM, no usable GPU — see below).

| Measurement                  | Value          |
| ---------------------------- | -------------: |
| v8 fixture (1.92 M cycles)   |                |
|  Wall-clock prove time       | **236.49 s**   |
|  Proof file size             | 335,932 B (~328 KB STARK proof) |
|  Verify time                 | **156 ms**     |
|  Peak prover RAM             | ~44 GB         |
|  Throughput                  | **~8,100 cycles/sec (CPU)** |

Phase breakdown shows the actual STARK work (`GENERATING_INNER_PROOFS`)
is **195 s**, dominating the 236 s total; setup/aggregation is the
remaining 41 s.

Two operational gotchas surfaced:

- **`RLIMIT_MEMLOCK = infinity`** is required. ZisK's ASM-emulator
  subsystem mmaps multi-GB shared-memory regions and fails with
  `EAGAIN` on the systemd default 8 MB ulimit. Workaround:
  `sudo systemd-run --uid=$(id -u) --property=LimitMEMLOCK=infinity …`.
- **First-run constant tree generation is slow.** `ziskup --provingkey`
  downloads ~10 GB of proving key, then runs `cargo-zisk check-setup -a`
  to generate Vadcop constant tree files. On this box that took ~10
  minutes; total disk footprint is **25 GB** after generation.

### CPU block-time projection

| Block size      | Cycles | Prove time @ ~8.1 k cycles/s |
| --------------: | -----: | ---------------------------: |
| 1 tx            | 977 k  | ~2 min                       |
| 2 (measured)    | 1.92 M | 3:56                         |
| 100 txs         | 94 M   | ~3.4 hours                   |
| 300 txs (busy)  | 282 M  | ~10 hours                    |

**CPU-only is not realtime.** Confirmed.

### GPU is currently locked to Blackwell hardware

ZisK 0.17.0's released `cargo-zisk-gpu` binary is **compiled for
sm_120 only** (`strings cargo-zisk-gpu | grep target` shows only
`.target sm_120`). No PTX fallback. Running on RTX 3090 (sm_86) gives:

```
[CUDA] cudaMemcpyToSymbol(GPU_C_4, ...) failed:
  no kernel image is available for execution on the device (209)
  at src/goldilocks/src/poseidon2_goldilocks.cu:68
```

ZisK's published "6.56 s average / Ethereum block on 24 × RTX 5090"
([Aligned Layer blog, Nov 2026](https://blog.alignedlayer.com/the-year-of-zkvm-real-time-proving-milestones-present-and-future/))
is real but requires that specific class of hardware. To run on RTX
3090 / 4090, `cargo-zisk-gpu` must be rebuilt from source with
multi-arch CUDA flags (`-gencode=arch=compute_86,code=sm_86` etc.).
Out of scope for this PoC.

**Operational implication for Hydration.** A production zk-proving
deployment today requires either (a) Blackwell-class data-center GPUs
(H100 / B100) or RTX 5090, or (b) a community-maintained source build
of the GPU prover. Both are real procurement / engineering constraints
worth flagging in any roadmap planning.

---

## 6. Headline numbers for the feasibility decision

| Cost item                              | Per extrinsic | Per 300-tx block (estimated) |
| -------------------------------------- | ------------: | ---------------------------: |
| sr25519 verify (75–83 % of total)      |     ~735 k    |                       ~220 M |
| Trie reads + writes + new root         |     ~145 k    |                        ~44 M |
| Storage key derivation                 |      ~25 k    |                       ~7.5 M |
| Math (`calculate_sell_state_changes`)  |       ~7 k    |                         ~2 M |
| SCALE encode/decode + asserts          |      ~55 k    |                        ~17 M |
| ZisK runtime overhead (per-program)    |      ~10 k    |             ~10 k (one-time) |
| **Total**                              |   **~977 k**  |                **~290 M cycles** |

Versus the **2³⁶ ≈ 68.7 G step ceiling**: a 300-tx block uses **0.42 %**.
Versus the **6 s Hydration block time** (AURA target): possibly
achievable on Blackwell hardware (ZisK's reference 6.56 s for Ethereum
implies ~0.4 s for a Hydration block on 24 × RTX 5090; ~10–30 s on a
single RTX 5090); not achievable on CPU (~10 hours).

---

## 7. What's *not* in the PoC

Honest about coverage:

- **Only one extrinsic kind.** `Omnipool::sell` only. No `buy`,
  `add_liquidity`, `remove_liquidity`, no other pallets.
- **Synthetic state.** The trie is built host-side from a 17-entry
  fixture, not extracted from a live Hydration chain. A real-state
  measurement would have larger proof sizes per key (deeper trie, more
  fanout).
- **No `pallet-transaction-payment` integration.** Fees are a flat
  `1_000_000_000_000` constant in the witness, not computed from weight
  × fee multiplier × length + tip.
- **No oracle reads.** Omnipool dynamic fees are stubbed as fixed PPMs.
- **No Frontier / EVM path.** Hydration's AAVE v3 + HOLLAR stack is EVM-
  inside-Substrate. Proving an EVM call would need the `evm` crate
  inside the guest and presumably much higher cycle counts. Not
  attempted.
- **No `TransactionExtension` chain modelled individually.** v6's
  `SignedPayloadV6` lumps everything into one struct.
- **STARK proof only, no PLONK wrap.** On-chain EVM verification would
  need `cargo-zisk wrap-proof` + the PLONK proving key (separate ~2 GB
  download via `ziskup setup_snark`). Skipped — STARK proof is enough
  to validate the cycle counts.
- **No actual on-chain verifier integration.** ZisK ships a Solidity
  verifier (`zisk-contracts/PlonkVerifier.sol`); deploying it against
  Hydration's EVM layer would be a separate exercise.

Each of these is a tractable v9+ task. None of them change the headline
budget analysis materially — they add more cycles to the per-extrinsic
budget but stay well within the 2³⁶ ceiling.

---

## 8. Updated recommendation

The original note recommended Option C (prove one extrinsic's STF
standalone) as the realistic PoC. **Option C is done.** The PoC has also
extended into Option B territory (block-level proof with real signature
verification + trie + state evolution), which the original note called
"6–12 person-months". The actual time was 2 sessions of focused work to
get to v8, leveraging that the Substrate Rust stack compiles cleanly
under ZisK's Rust fork once a few workspace traps are avoided.

For a production roadmap the next priorities are:

1. **Multi-pallet coverage.** Pull in `pallet-balances`, the
   `OrmlTokens`-backed asset balances, `pallet-stableswap` math. Each
   adds storage paths and math operations, not new architecture.
2. **Real-state proof generation.** Run a fork of a Hydration node with
   a recorder; extract real storage proofs for real blocks. Confirm the
   cycle estimates hold at production state sizes (~10⁶ keys vs the 17
   we measured against).
3. **EVM path.** The Frontier + AAVE + HOLLAR slice is its own thing —
   needs the `evm` crate compiling for ZisK, secp256k1 / bn128 syscalls
   wired up via `[patch.crates-io]`. Probably the biggest remaining
   uncertainty in budget terms.
4. **GPU proving infrastructure.** Either provision Blackwell hardware
   or contribute multi-arch CUDA flags upstream to ZisK. Without this,
   proving is offline-only (hours per block) and not viable for live
   chain head proving.
5. **Public-output design.** Plan around the 256-byte cap from day one —
   commit Merkle roots over per-tx results, not inline data.

The original feasibility note's bottom-line — "6–12 months to a working
block-level proof" — held for the core engineering. What's added by the
PoC is **concrete numbers** to replace the order-of-magnitude estimates,
and a working reference implementation that the production effort can
fork.
