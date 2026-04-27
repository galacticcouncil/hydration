import { ApiPromise, WsProvider, Keyring } from "@polkadot/api";
import { cryptoWaitReady } from "@polkadot/util-crypto";

// Create N governance referenda on a Hydration lark testnet, signed by Alice.
//
// All N referenda land in a single utility.forceBatch transaction containing
// 3·N inner calls — for each referendum:
//   1. preimage.notePreimage(system.remark(<unique text>))
//   2. referenda.submit(<track>, Lookup{hash,len}, After 1)
//   3. referenda.placeDecisionDeposit(<index>)
//
// Per-inner-call status is read from utility.ItemCompleted / ItemFailed events
// in dispatch order (groups of 3 → one referendum). One block, one tx, no
// per-tx hang risk.
//
// Tracks rotate in this order across the requested count:
//   root → treasurer → general_admin → omnipool_admin → economic_parameters →
//   root → ... (repeat)
//
//   1 ref  → root
//   2 refs → root, treasurer
//   3 refs → root, treasurer, general_admin
//  15 refs → 3 of each (full rotations)
//
// All five tracks have prepare_period=1 block on lark testnets, so each
// referendum enters Deciding immediately and is votable as soon as the
// forceBatch is in-block.
//
// referenda.referendumCount is read once before building the call list; each
// successful submit increments it by one, so indices run startIndex,
// startIndex+1, ... Safe on lark where Alice is the only submitter.
//
// Setup (first run only):
//   cd create-referenda && npm install
//
// Usage:
//   node index.js --count 10 --lark 2
//   node index.js --count 10 --rpc wss://2.lark.hydration.cloud
//
// --lark <N>     maps to wss://<N>.lark.hydration.cloud (e.g. --lark 2)
// --rpc <url>    explicit websocket override
// --count <N>    number of referenda to create (required)

const ROTATION = [
  "root",
  "treasurer",
  "general_admin",
  "omnipool_admin",
  "economic_parameters",
];

const TRACKS = {
  root: { id: 0, origin: { system: "Root" } },
  treasurer: { id: 5, origin: { Origins: "Treasurer" } },
  general_admin: { id: 4, origin: { Origins: "GeneralAdmin" } },
  omnipool_admin: { id: 8, origin: { Origins: "OmnipoolAdmin" } },
  economic_parameters: { id: 9, origin: { Origins: "EconomicParameters" } },
};

function getArg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function buildRpc() {
  const explicit = getArg("rpc");
  if (explicit) return explicit;
  const lark = getArg("lark");
  if (lark != null) return `wss://${lark}.lark.hydration.cloud`;
  throw new Error(
    "Provide --rpc <wss-url> or --lark <N> (e.g. --lark 2 → wss://2.lark.hydration.cloud)"
  );
}

async function signAndWait(api, tx, signer, label, timeoutMs = 180000) {
  const nonce = await api.rpc.system.accountNextIndex(signer.address);
  return new Promise((resolve, reject) => {
    let unsub;
    let timer;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (unsub) unsub();
    };
    timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${label}: timed out after ${timeoutMs}ms (no inBlock status)`));
    }, timeoutMs);

    tx.signAndSend(signer, { nonce }, ({ status, dispatchError, events }) => {
      if (!(status.isInBlock || status.isFinalized)) return;
      if (dispatchError) {
        cleanup();
        if (dispatchError.isModule) {
          const meta = api.registry.findMetaError(dispatchError.asModule);
          return reject(new Error(`${label}: ${meta.section}.${meta.name}`));
        }
        return reject(new Error(`${label}: ${dispatchError.toString()}`));
      }
      // Only outer extrinsic-level failure aborts here; forceBatch tolerates
      // inner-call failures and surfaces them via ItemFailed events instead.
      for (const { event } of events) {
        if (event.section === "system" && event.method === "ExtrinsicFailed") {
          cleanup();
          return reject(new Error(`${label}: ExtrinsicFailed ${event.data.toString()}`));
        }
      }
      cleanup();
      resolve(events);
    })
      .then((u) => { unsub = u; })
      .catch((e) => { cleanup(); reject(e); });
  });
}

function trackForIndex(i) {
  const name = ROTATION[i % ROTATION.length];
  return { name, ...TRACKS[name] };
}

async function main() {
  await cryptoWaitReady();

  const countStr = getArg("count");
  if (!countStr) throw new Error("Missing --count <N>");
  const count = parseInt(countStr, 10);
  if (!(count > 0)) throw new Error(`Invalid --count: ${countStr}`);

  const rpc = buildRpc();
  console.log(`Connecting to ${rpc}...`);
  const api = await ApiPromise.create({
    provider: new WsProvider(rpc),
    noInitWarn: true,
  });
  const chain = (await api.rpc.system.chain()).toString();
  console.log(`Connected: ${chain}`);

  const alice = new Keyring({ type: "sr25519" }).addFromUri("//Alice");
  console.log(`Signer (Alice): ${alice.address}`);

  // Resolve decision deposits for every track in the rotation from on-chain
  // runtime constants — testnet vs mainnet may differ.
  const trackDeposits = {};
  for (const [id, info] of api.consts.referenda.tracks) {
    const idNum = id.toNumber();
    for (const [name, t] of Object.entries(TRACKS)) {
      if (t.id === idNum) {
        trackDeposits[name] = info.decisionDeposit.toBigInt();
      }
    }
  }
  for (const name of ROTATION) {
    if (!(name in trackDeposits)) {
      throw new Error(
        `Track ${name} (id ${TRACKS[name].id}) not found on this chain — wrong runtime?`
      );
    }
  }
  const submissionDeposit = api.consts.referenda.submissionDeposit.toBigInt();

  const decimals = api.registry.chainDecimals[0] ?? 12;
  const symbol = api.registry.chainTokens[0] ?? "HDX";
  const fmt = (b) => `${(b / 10n ** BigInt(decimals)).toString()} ${symbol}`;

  // Per-track count + total cost
  const perTrackCount = {};
  for (const name of ROTATION) perTrackCount[name] = 0;
  for (let i = 0; i < count; i++) perTrackCount[trackForIndex(i).name]++;

  let totalDecision = 0n;
  for (const [name, n] of Object.entries(perTrackCount)) {
    totalDecision += BigInt(n) * trackDeposits[name];
  }
  const totalSubmission = BigInt(count) * submissionDeposit;
  const totalDeposit = totalDecision + totalSubmission;

  console.log(`\nTrack distribution (${count} referenda):`);
  const nameW = Math.max(...ROTATION.map((n) => n.length));
  for (const name of ROTATION) {
    const n = perTrackCount[name];
    const dep = BigInt(n) * trackDeposits[name];
    console.log(
      `  ${name.padEnd(nameW)}  ${String(n).padStart(3)} × ${fmt(trackDeposits[name]).padStart(15)}  =  ${fmt(dep)}`
    );
  }
  console.log(
    `  submission deposit       ${count} × ${fmt(submissionDeposit)}  =  ${fmt(totalSubmission)}`
  );
  console.log(
    `Estimated total reserved by Alice: ~${fmt(totalDeposit)} (+ preimage byte deposits + tx fees)\n`
  );

  const acc = await api.query.system.account(alice.address);
  const free = acc.data.free.toBigInt();
  const frozen = acc.data.frozen.toBigInt();
  const spendable = free > frozen ? free - frozen : 0n;
  console.log(
    `Alice balance: free ${fmt(free)}, frozen ${fmt(frozen)}, spendable ~${fmt(spendable)}`
  );
  if (spendable < totalDeposit) {
    console.warn(
      `\n⚠️  Spendable balance (${fmt(spendable)}) < estimated deposits (${fmt(totalDeposit)}).`
    );
    console.warn(
      `   If Alice is locked from past voting, run aave-v3-deploy/scripts/unlock-alice-votes.ts first.`
    );
    console.warn(`   Continuing — the chain will reject calls if she can't reserve.\n`);
  }

  // Each batchAll below produces exactly one new referendum, so indices run
  // startIndex, startIndex+1, ... On lark Alice is the only submitter.
  const startIndex = (await api.query.referenda.referendumCount()).toNumber();
  console.log(`Next referendum index on chain: ${startIndex}`);

  const runId = Date.now().toString(36);
  console.log(`Run id (for unique remarks): ${runId}\n`);

  const trackNameW = Math.max(...ROTATION.map((n) => n.length));

  // Build per-referendum metadata + flat call list (3 calls per ref).
  const refs = [];
  const calls = [];
  for (let i = 0; i < count; i++) {
    const refIndex = startIndex + i;
    const track = trackForIndex(i);
    const remark = `lark-test-referendum ${runId} #${i}`;
    const remarkCall = api.tx.system.remark(remark).method;
    const proposalHex = remarkCall.toHex();
    const proposalHash = remarkCall.hash.toHex();
    const proposalLen = remarkCall.encodedLength;

    refs.push({ index: refIndex, track: track.name, hash: proposalHash, remark });
    calls.push(
      api.tx.preimage.notePreimage(proposalHex),
      api.tx.referenda.submit(
        track.origin,
        { Lookup: { hash: proposalHash, len: proposalLen } },
        { After: 1 }
      ),
      api.tx.referenda.placeDecisionDeposit(refIndex)
    );
  }

  console.log(
    `Submitting utility.forceBatch with ${calls.length} inner calls (${count} referenda × 3 ops)...`
  );
  const tx = api.tx.utility.forceBatch(calls);
  const events = await signAndWait(api, tx, alice, "forceBatch");
  console.log("forceBatch in block — parsing per-item results\n");

  // forceBatch emits utility.ItemCompleted / ItemFailed in dispatch order.
  // Each consecutive group of 3 maps to one referendum (note, submit, placeDD).
  const itemResults = [];
  for (const { event } of events) {
    if (event.section !== "utility") continue;
    if (event.method === "ItemCompleted") {
      itemResults.push({ ok: true });
    } else if (event.method === "ItemFailed") {
      const err = event.data[0];
      let msg;
      if (err && err.isModule) {
        const meta = api.registry.findMetaError(err.asModule);
        msg = `${meta.section}.${meta.name}`;
      } else {
        msg = (err ?? event.data).toString();
      }
      itemResults.push({ ok: false, error: msg });
    }
  }

  const submitted = [];
  const failed = [];
  for (let i = 0; i < count; i++) {
    const r = refs[i];
    const noteRes = itemResults[i * 3];
    const submitRes = itemResults[i * 3 + 1];
    const ddRes = itemResults[i * 3 + 2];

    const errs = [];
    // notePreimage failing with AlreadyNoted is harmless if submit + placeDD work.
    if (noteRes && !noteRes.ok && !/AlreadyNoted/i.test(noteRes.error)) {
      errs.push(`notePreimage: ${noteRes.error}`);
    }
    if (!submitRes || !submitRes.ok) {
      errs.push(`submit: ${submitRes?.error ?? "missing event"}`);
    }
    if (!ddRes || !ddRes.ok) {
      errs.push(`placeDD: ${ddRes?.error ?? "missing event"}`);
    }

    const label = `[${String(i + 1).padStart(String(count).length)}/${count}] ${r.track.padEnd(trackNameW)} ref #${r.index}`;
    if (errs.length === 0) {
      console.log(`${label} preimage=${r.hash.slice(0, 18)}... OK`);
      submitted.push(r);
    } else {
      console.log(`${label} preimage=${r.hash.slice(0, 18)}... FAIL: ${errs.join("; ")}`);
      failed.push({ ...r, error: errs.join("; ") });
    }
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`Submitted ${submitted.length}/${count} referenda`);
  console.log("=".repeat(70));
  for (const r of submitted) {
    console.log(`  #${r.index}  ${r.track.padEnd(trackNameW)}  preimage=${r.hash}`);
  }
  if (failed.length) {
    console.log("\nFailures:");
    for (const f of failed) console.log(`  #${f.index}  ${f.error}`);
  }

  await api.disconnect();
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
