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
| **v9**| **ZisK-native** sell: ECDSA + Poseidon2 SMT replace all Substrate-isms |  **51,584** | **−925 k / extrinsic (18.9× cheaper than v7)** |
| v10   | full `hydradx-runtime` crate as native RISC-V | **structurally blocked** | — (see § 9) |

The v8 guest does the full lifecycle: signature verify, call decode,
key re-derivation, storage proof verification, state read, math,
slippage check, fee + nonce update, write-back, post-root computation.
Anyone with the witness and `(pre_state_root, post_state_root,
extrinsics_hash)` can independently verify the state transition.

v9 is the *other end of the spectrum* — keep only the Omnipool math
shared with the Substrate chain, replace everything around it with
primitives that hit ZisK syscalls (ECDSA via `k256` patched, Poseidon2
sparse Merkle tree, content-addressed storage). v10 is the *third*
end — try to recompile the production WASM runtime crate as native
RISC-V. v10 fails for structural reasons, not cycle budget. § 9
covers the three-way comparison.

---

## 2. Per-primitive costs (isolated benchmarks)

Bench guests in `bench/` measure each primitive standalone, subtracting
the ~9.6 k cycle ZisK runtime overhead.

| Primitive                       | ZisK steps    | Notes                                      |
| ------------------------------- | ------------: | ------------------------------------------ |
| Runtime baseline (`bench-noop`) |         9,618 | entrypoint + alloc + commit one byte       |
| sr25519 verify (`bench-sr25519`)|       735,591 | schnorrkel, no precompile                  |
| **ECDSA secp256k1** (`k256` patched) | **18,200** | uses `syscall_secp256k1_add` + `_dbl`. **~40× cheaper than sr25519.** |
| BLAKE2-256 hash, ≤ 128 B input  |   ~3,400 (+~2,800/extra block) | `blake2b_simd`, no precompile |
| **Poseidon2 permutation** (`syscall_poseidon2`) | **~7 amortized** | syscall protocol cost only; work proven in a specialised circuit. **~400× cheaper per permutation than BLAKE2.** |
| Keccak-256 (`tiny-keccak` patched) | ~900/block | uses `syscall_keccakf`                  |
| Keccak-256 (`sha3` unpatched)   | ~7,100/block | pure RV64IMA — Substrate's actual path     |
| `sp_trie::verify_trie_proof`    | ~7.5–14 k per proof node | BLAKE2-bound                  |

The keccak comparison confirms ZisK's syscall mechanism works — **~8×
speedup** when the `tiny-keccak` patched fork is wired via
`[patch.crates-io]`. Substrate's `sp_crypto_hashing::keccak_256` uses
`sha3` which has no equivalent patch fork; would need to be written or
the call sites replaced.

The ECDSA and Poseidon2 numbers are what enable the v9 design (§ 9).
With both ZisK-native primitives in the proving path, per-extrinsic
cost drops from v7's ~977 k to v9's measured **51,584 cycles** — an
~18.9× shrinkage on the same Omnipool semantics.

---

## 3. Risk model: what flipped

| Original note (speculative)            | After measurement                       |
| -------------------------------------- | --------------------------------------- |
| **BLAKE2 dominates trie cost**         | ~13 k per typical trie-node hash; ~50× cheaper than worst-case estimate |
| **sr25519 expensive — needs Schnorrkel patch fork** | ~735 k cycles confirmed; no patch fork exists today |
| **secp256k1 / k256 may need patching** | k256-patched fork exists at `0xPolygonHermez/zisk-patch-elliptic-curves` and works; measured **18.2 k cycles** per ECDSA verify |
| **WASM-runtime path is catastrophic**  | Cycle-budget worry was wrong, but path is **structurally blocked** at the `#[runtime_interface]` macro level (see § 9) |
| Trie verify cost handwaved              | Measured: linear in proof nodes; per-key with sharing ≈ 30–60 k cycles (BLAKE2 trie); ~1 k cycles (Poseidon2 SMT) |
| Per-block cost handwaved                | Per-extrinsic ≈ 977 k (v7) or **52 k (v9 ZisK-native)**; per 300-tx block 290 M / 15.5 M cycles respectively, both under 0.5 % of step ceiling |
| **One option for proving Hydration**    | **Three options** with very different effort/cycle tradeoffs (§ 9) |

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

### Real Hydration block end-to-end

A `chain-replay` guest consumes a witness built from a real Hydration
mainnet block. The host (`from-chain` subcommand) queries
`chain_getBlock` + `state_getReadProof` over JSON-RPC at the chain's
public RPC (`https://rpc.hydradx.cloud`), parses the signed extrinsic,
derives the storage keys for the assets it touches, and packs the
chain's compact storage proof + the actual values into a
`ChainSellWitness`. The guest verifies the proof against the chain's
*real* state root, decodes the values, runs `Omnipool::sell` math, and
commits `(block_number, state_root, signer, asset_ids, amounts)` as
the public statement.

Tested against block 12,389,503 (tx 2), an `Omnipool::sell` of asset
1000753 → 1000771:

| Metric                              | Value                          |
| ----------------------------------- | -----------------------------: |
| State root verified                 | `0x27038294…4e5d48a6`          |
| Storage proof from chain            | 18 nodes / 4,237 bytes         |
| ZisK emulation steps                | 214,265                        |
| **CPU prove time**                  | **228.4 s**                    |
| Proof file size                     | 335,932 bytes (STARK)          |
| Verify time                         | 173 ms                         |

The proof binds `(chain state at block 12,389,503, math inputs) →
(computed amount_out)`. Signature verification is deliberately
omitted: reconstructing the exact bytes the chain signed requires the
full `SignedExtra` chain (CheckNonce, CheckMortality,
ChargeTransactionPayment, CheckMetadataHash, …); that's a tractable
extension but wasn't needed to validate the storage-proof flow.

**What this proves:**
- ZisK guests can consume `state_getReadProof` output unchanged. No
  chain-side support is needed beyond standard Substrate RPC. The
  ergonomics of "fork a real chain block and prove its state
  transition" are good.
- The `sp_trie::verify_trie_proof` path (used in v4 and reused here)
  works correctly against production state without the recorder dance
  that v5+ needed for writes.

### CPU prove time has a fixed ~200 s floor

Comparing the v8 synthetic block (1.92 M cycles, prove = 236 s) with
the chain-replay (214 k cycles, prove = 228 s): **9× fewer cycles
proves in essentially the same wall-clock time**. The phase breakdown
shows the difference is tiny inside `GENERATING_INNER_PROOFS` (195 s
v8 vs 188 s chain-replay).

ZisK's STARK prover pads each component's trace to a minimum size; for
small workloads almost all the trace cells are padding. The CPU prove
cost is dominated by the fixed table sizes and the BLAKE2-Merkle work
on those tables, not by the actual RISC-V execution length.

**Practical implication for CPU proving:**
- The minimum cost of proving anything is ~200–230 s on this 16-core
  box. Smaller proofs don't get proportionally faster.
- For CPU-served block proving, the per-block cost is roughly constant
  up to ~2 M cycles per block. Beyond that it grows linearly.
- v9-style (52 k cycles) and v7-style (977 k cycles) per-extrinsic
  budgets *both* fit comfortably under the floor for single
  extrinsics — but a batched block of many extrinsics tips into the
  cycle-bound regime, where v9 wins by ~18×.

### GPU prove time would scale linearly

On Blackwell-class GPUs the picture is reversed. GPU traces don't
suffer from the same padding penalty — the proving cost scales close
to linearly with actual cycle count. ZisK's published "6.56 s avg /
Ethereum block on 24 × RTX 5090" (Aligned Layer blog) implies roughly
~720 M cycles/s aggregate throughput across the rig.

Translating to our measurements:

| Workload                                | Cycles    | Est. 24×5090 prove time | Est. single 5090 |
| --------------------------------------- | --------: | ----------------------: | ---------------: |
| v9 native sell (single tx)              |   52 k    |              ~70 µs     |        ~1.7 ms   |
| chain-replay (single real tx, no sig)   |  214 k    |             ~300 µs     |        ~7 ms     |
| v7 (single tx, sr25519 + BLAKE2)        |  977 k    |             ~1.4 ms     |       ~33 ms     |
| v8 (2-tx synthetic block)               |  1.92 M   |             ~2.7 ms     |       ~64 ms     |
| 300-tx Hydration block, v7-style        |  ~290 M   |              ~0.4 s     |       ~10 s      |
| 300-tx Hydration block, v9-style        |  ~16 M    |             ~22 ms      |       ~0.5 s     |

On GPU, the ~18× cycle savings of v9 *do* translate directly to ~18×
faster proving. This is the real argument for the v9 design: not the
absolute number on CPU (where the floor dominates), but the
GPU-budget headroom it buys, especially for busy blocks.

---

## 6. Headline numbers for the feasibility decision

Per-extrinsic budget under each strategy:

| Cost item                              | v7 (Substrate-faithful) | **v9 (ZisK-native)** |
| -------------------------------------- | ----------------------: | -------------------: |
| Signature verify                       |   735 k (sr25519)       |  **18 k (ECDSA)**    |
| Trie / Merkle reads + writes + new root|             ~145 k      |          **~3 k**    |
| Storage key derivation                 |              ~25 k      |          **~0.1 k**  |
| Math (`calculate_sell_state_changes`)  |               ~7 k      |              ~7 k    |
| SCALE encode/decode + asserts          |              ~55 k      |             ~13 k    |
| ZisK runtime overhead                  |              ~10 k      |             ~10 k    |
| **Total**                              | **~977 k (measured)**   | **~52 k (measured)** |

Per 300-tx block: 290 M cycles (v7) vs 15.5 M cycles (v9). Versus the
**2³⁶ ≈ 68.7 G step ceiling**: 0.42 % (v7) or 0.023 % (v9).

Versus the **6 s Hydration block time** (AURA target):

| Hardware                                      | v7 estimate | v9 estimate |
| --------------------------------------------- | ----------: | ----------: |
| This CPU (~8.1 k cycles/s, measured)          | ~10 h       | ~32 min     |
| Single RTX 5090 (~30 M cycles/s, scaled)      | ~9 s        | **~0.5 s**  |
| Hypothetical rebuilt sm_86 binary on RTX 3090 | ~20 s       | **~1 s**    |
| 24 × RTX 5090 (ZisK's reference)              | ~0.4 s      | **~21 ms**  |

The v9 design moves "realtime Hydration block proving" from a Blackwell-
only target to single-consumer-GPU territory.

---

## 7. The three design choices (and what each costs)

After v9 and v10, the spectrum of "Hydration on ZisK" looks like this:

| | **v7-style** (Substrate-faithful manual STF) | **v9-style** (ZisK-native rollup) | **v10-style** (recompile WASM runtime) |
| ---: | --- | --- | --- |
| Per-extrinsic cycles | ~977 k | **~52 k** | would be > v7 |
| Signature | sr25519 (no syscall) | ECDSA secp256k1 (k256 patched) | sr25519 (same as Substrate) |
| State hashing | BLAKE2 MPT (no full-hash syscall) | Poseidon2 SMT (syscall) | BLAKE2 MPT |
| Storage keys | `twox128 ++ twox128 ++ blake2_128_concat` | `Poseidon2(asset_id)` flat | full Substrate prefixes |
| Substrate ecosystem compatibility | full | none | full |
| Polkadot relay-chain settlement | yes | no | yes |
| Hardware needed for realtime block proving | Blackwell only | **single consumer GPU** | Blackwell only |
| Engineering status | **measured at v8** (1 extrinsic, single signer) | **measured at v9** (1 extrinsic, simplified SMT) | **structurally blocked** at compile time |
| Production effort estimate | ~6–12 PMs to cover all relevant pallets + EVM | ~3–6 PMs for the rollup design, multi-pallet, sequencer | minimum 2–4 weeks to compile, 2–4 weeks to execute, then re-do v7 work on top |

The math is portable between v7 and v9 — the `hydra-dx-math` crate is
identical in both paths, so Omnipool's economic invariants are
preserved either way. What differs is the wrapper layer (signatures,
state model, key derivation, fee mechanics).

**v10 is not a faster shortcut to v7**, even though intuitively
"recompile the WASM runtime" sounds simpler than "reimplement the
STF". It blocks at Substrate's `#[runtime_interface]` macro, which
emits target-specific code that doesn't understand ZisK; fixing it
requires forking `sp-runtime-interface` and porting every
`#[runtime_interface]` use site (~30+ across the dependency tree).
Once that's done you still have to provide native implementations of
every sp-io host function — i.e. the work of v7, plus the work of
making it compatible with Substrate's runtime ABI. § 9 has the
details.

The honest recommendation for production roadmap:

- **If the goal is "Hydration with ZK-proofs while staying a Polkadot
  parachain":** pursue **v7-style** — keep extending the manual STF
  approach to cover more pallets. The ~6 s block-time on Blackwell is
  the operational constraint.
- **If the goal is "the cheapest possible ZK-proofs of Omnipool
  semantics":** pursue **v9-style** as a sidecar / L2-style rollup
  that doesn't try to be Polkadot-compatible. Realtime on consumer
  GPUs is the operational win.
- **The "recompile the WASM runtime" path is not viable** without
  upstream changes to Substrate or a willingness to maintain a
  ZisK-specific Substrate fork indefinitely.

---

## 8. v10 deep-dive: why "just recompile the WASM runtime" doesn't work

I attempted to compile `hydradx-runtime` directly for
`riscv64ima-zisk-zkvm-elf` to complete the spectrum of design choices.

**Got past one expected wall.** Installing `riscv64-elf-gcc` and
`riscv64-elf-newlib` from Arch repos, then setting
`CC_riscv64ima_zisk_zkvm_elf=riscv64-elf-gcc`, let `secp256k1-sys` and
other C-FFI build scripts cross-compile successfully. After that, ~100
Rust crates built clean for the riscv64 target — including sp-core,
schnorrkel, the patched k256, and many pallets.

**Hit a deeper wall.** Substrate's `#[runtime_interface]` proc-macro
emits *different code* depending on the target:

| Target | Generated code |
| --- | --- |
| `target = "wasm32-*"` | `extern "C"` import stubs (the runtime calls into the client) |
| native (`x86_64-*-linux` etc.) | host-side functions with `ExternalitiesExt` |
| `riscv64ima-zisk-zkvm-elf` | falls through to the native variant, references `Vec` and `ExternalitiesExt` that aren't in scope → **compile failure** |

First crate that fails: `cumulus-primitives-proof-size-hostfunction`:

```
error[E0282]: type annotations needed
error[E0433]: failed to resolve: use of undeclared type `Vec`
   --> cumulus/primitives/proof-size-hostfunction/src/lib.rs:35
   = note: this error originates in the attribute macro `runtime_interface`
```

About 30+ other crates in the runtime's dependency tree use
`#[runtime_interface]` similarly. Each would need either the macro to
recognise the ZisK target, or a manual workaround per call site.

**What it would take to fix:**

1. Fork `sp-runtime-interface` to treat the ZisK target as
   WASM-equivalent (emit import stubs rather than host code), or as a
   *third* class with its own codegen.
2. Provide native Rust implementations of every sp-io host function
   for the ZisK side — exactly the work v4–v8 did manually, but for
   the entire sp-io ABI rather than the subset Omnipool::sell needs.
3. Build a driver crate that loads the runtime, sets up an
   externalities backend backed by the storage-proof MemoryDB, and
   calls `Core::execute_block`.
4. Resolve remaining target-specific `cfg` blocks across the
   dependency tree (many have explicit `wasm32` / `not(wasm32)` splits
   that don't account for a third target).

Optimistic estimate: 2–4 weeks of focused fork-and-patch work to get a
clean build, plus another 2–4 weeks for actual single-extrinsic
execution. The end result would have *worse* cycle counts than v7
(more pallet dispatch indirection, full XCM/EVM stack pulled in even
if unused). So this path is strictly dominated by v7-style work for
the same outcome.

**Operational takeaway.** The "recompile the runtime as RISC-V"
shortcut isn't a shortcut. Production ZisK proving for Hydration is a
v7 or v9 conversation, not a v10 one.

---

## 9. What's *not* in the PoC

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

Each of these is a tractable next task. None of them change the
headline budget analysis materially — they add more cycles to the
per-extrinsic budget but stay well within the 2³⁶ ceiling.

---

## 10. Updated recommendation

The original note recommended Option C (prove one extrinsic's STF
standalone) as the realistic PoC. **Option C is done.** The PoC also
extended into Option B territory (block-level proof with real signature
verification + trie + state evolution), and into a fourth option the
original note didn't envisage — **Option D: a ZisK-native redesign**
(v9) that's not a Hydration runtime at all but reuses the
`hydra-dx-math` crate. And we hit Option E (recompile the WASM
runtime, v10) and found it structurally blocked.

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
6. **Pick a path before scaling up.** v7-style and v9-style are both
   tractable but produce different products (Polkadot-compatible
   parachain with ZK proofs vs. ZisK-native Omnipool rollup). The
   choice affects everything from sequencer architecture to wallet
   integration to liquidity bridging. The PoC gives the numbers to
   make that decision with data; the decision itself is a
   product/governance call, not a technical one.

The original feasibility note's bottom-line — "6–12 months to a working
block-level proof" — held for the v7-style path. The PoC adds two
things to it: **concrete numbers** to replace the order-of-magnitude
estimates, and a **second viable path** (v9-style) that's ~18× cheaper
per extrinsic at the cost of giving up Substrate ecosystem
compatibility. The decision between them is the next conversation.
