// Seeds the demo estates so every page has something real to show (SPEC 13.9), through the same paths the app uses.
//   Harmattan Court: a-4b taken (10%), b-3b taken (30%), a-2a reserved; the rest available. Milestones 1–2 approved
//     with real photos (open_capture → upload to the `evidence` bucket → submit_evidence → TEE verdict → qs_sign), their
//     share released (claim_release), and one failed proof: the foundation photo submitted again for the next
//     milestone, which the worker rejects as `phash_reuse` (the red proof page).
//   Baobab Heights: the judge wallet holds b-2a, b-2b, b-2c with refunds already open (missed foundation).
//   Playground: units come from add-units (60); one passed proof and one failed proof (the same reuse case, or the
//     verifier's synthetic fixture photo if no proof has passed yet).
//
// What can't be automated honestly: a passing proof needs a photo taken AFTER open_capture, on site (inside the
// geofence, except on the playground), with the issued code written on paper in frame. No fixture can contain a code
// that didn't exist yet, and the worker fails an unread or wrong code in every mode. So:
//   - with --photos on a terminal, the script opens the capture, prints the code, and waits for you to give it the
//     path of the photo you just took (copy it off the phone as the original file; don't re-save it);
//   - without --photos (or without a TTY), it prints exactly which capture is still needed and how to do it in the
//     surveyor app (/qs/<estate>), then does every step that doesn't need a new photo.
//
// Keys: ~/.near-credentials/<network>/<account>.json or NEAR_KEY_<ACCOUNT> (scripts/lib.ts). The surveyor
// (qs-adaeze) signs captures, evidence and sign-offs; ROOT_ACCOUNT pays for claim_release (anyone may call it).
// Upload: NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY from the environment, never from code.
//
// Flags: --refund-only   only re-create the Baobab refund units (after judges used them)
//        --skip-buys     skip the purchases
//        --photos        interactive captures for the passing proofs (needs a TTY)
//        --no-proofs     purchases only
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  ROOT, ROOT_ACCOUNT, TGAS, USDC, account, call, deployments, estateId, loadConfig, log, near, resolveAccount, view,
  type EstateConfig,
} from "./lib.js";

const argv = process.argv.slice(2);
const refundOnly = argv.includes("--refund-only");
const skipBuys = argv.includes("--skip-buys");
const interactive = argv.includes("--photos") && !!process.stdin.isTTY;
const noProofs = argv.includes("--no-proofs") || refundOnly;
if (argv.includes("--photos") && !process.stdin.isTTY) log("! --photos needs a terminal; printing the manual steps instead.");
const usdc = deployments().usdc;
if (!usdc) throw new Error("deploy mock USDC first");
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://plote.vercel.app").replace(/\/$/, "");
const SB_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const BUCKET = "evidence";

/** Steps a human still has to do; printed at the end. */
const manual: string[] = [];

// ---------------------------------------------------------------- types (INTERFACE §1.3)

type MilestoneView = { index: number; key: string; title: string; status: string; evidence_ids: string[]; veto_until: string | null };
type EvidenceView = {
  id: string; milestone: number; url: string; sha256: string; status: "Pending" | "Pass" | "Fail" | "Error";
  verdict: { pass: boolean; reasons: string[]; warnings: string[] } | null; error: string | null;
};
type EstateView = { verify_mode: "outlayer" | "https"; surveyor_id: string; params: { playground: boolean; veto_window_ns: string } };

// ---------------------------------------------------------------- purchases

async function buy(buyerId: string, estate: string, unitId: string, amount: bigint) {
  const buyer = account(buyerId);
  const unit = await view<{ status: string; account: string; price: string } | null>(estate, "get_unit", { unit_id: unitId });
  if (!unit) throw new Error(`no unit ${unitId} on ${estate}`);
  if (unit.status !== "Available") {
    log(`= ${estate}/${unitId} is ${unit.status}; skipping`);
    return;
  }
  await call(buyer, usdc!, "mint", { amount: amount.toString() }, { deposit: near("0.00125"), gas: 30n * TGAS });
  await call(buyer, estate, "reserve", { unit_id: unitId }, { deposit: near("0.05"), gas: 30n * TGAS });
  if (amount > 0n) {
    await call(buyer, usdc!, "ft_transfer_call", { receiver_id: unit.account, amount: amount.toString(), msg: "" }, {
      deposit: 1n,
      gas: 200n * TGAS,
    });
  }
  const after = await view<{ status: string; paid: string }>(estate, "get_unit", { unit_id: unitId });
  log(`+ ${buyerId} → ${estate}/${unitId}: ${after.status}, paid ${Number(BigInt(after.paid) / USDC)} USDC`);
}

// ---------------------------------------------------------------- evidence helpers

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const slug = (estate: string) => estate.split(".")[0];
const milestones = (estate: string) => view<MilestoneView[]>(estate, "get_milestones");
const evidence = (estate: string, id: string) => view<EvidenceView | null>(estate, "get_evidence", { id });

async function listEvidence(estate: string): Promise<EvidenceView[]> {
  return (await view<EvidenceView[]>(estate, "list_evidence", { limit: 100 })) ?? [];
}

/** Upload original bytes to the public `evidence` bucket, like /api/evidence/upload-url + the signed PUT. */
async function upload(estate: string, bytes: Uint8Array, contentType: "image/jpeg" | "image/png", uploadedBy: string): Promise<string | null> {
  if (!SB_URL || !SB_KEY) return null;
  const path = `${slug(estate)}/${randomUUID()}.${contentType === "image/png" ? "png" : "jpg"}`;
  const auth = { apikey: SB_KEY, authorization: `Bearer ${SB_KEY}` };
  const r = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: { ...auth, "content-type": contentType, "x-upsert": "false" },
    body: new Blob([new Uint8Array(bytes)], { type: contentType }),
  });
  if (!r.ok) throw new Error(`upload failed: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  // Same bookkeeping row the upload route writes (best effort; display only).
  await fetch(`${SB_URL}/rest/v1/evidence_files`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify({ estate, path, sha256: sha256(bytes), uploaded_by: uploadedBy }),
  }).catch(() => undefined);
  return `${SB_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

function deviceGps(): [number, number] | null {
  const m = /^\s*(-?\d+)\s*,\s*(-?\d+)\s*$/.exec(process.env.SEED_DEVICE_GPS ?? "");
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** open_capture → upload → submit_evidence → wait for the verdict. Returns the final evidence. */
async function submitPhoto(
  estate: string,
  surveyorId: string,
  m: number,
  bytes: Uint8Array,
  contentType: "image/jpeg" | "image/png",
  capturedAtMs: number,
  code?: string,
): Promise<EvidenceView | null> {
  const qs = account(surveyorId);
  const issued = code ?? (await call<string>(qs, estate, "open_capture", { milestone: m }, { gas: 30n * TGAS }));
  const url = await upload(estate, bytes, contentType, surveyorId);
  if (!url) {
    manual.push(`Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY so the seed can upload photos, then rerun.`);
    return null;
  }
  const id = await call<string>(
    qs,
    estate,
    "submit_evidence",
    {
      milestone: m,
      url,
      sha256: sha256(bytes),
      captured_at: (BigInt(Math.round(capturedAtMs)) * 1_000_000n).toString(),
      device_gps: deviceGps(),
    },
    { gas: 300n * TGAS },
  );
  log(`  evidence ${id} submitted for milestone ${m + 1} (code ${issued}); waiting for the TEE verdict…`);
  return waitVerdict(estate, String(id));
}

async function waitVerdict(estate: string, id: string): Promise<EvidenceView | null> {
  const e = await view<EstateView>(estate, "get_estate");
  if (e.verify_mode === "https") {
    // HTTPS-mode estates: the app's server runs the worker and relays the verdict (SPEC 6.6).
    await fetch(`${APP_URL}/api/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ estate, evidenceId: id }),
    }).catch(() => undefined);
  }
  for (let i = 0; i < 72; i++) {
    const ev = await evidence(estate, id);
    if (ev && ev.status !== "Pending") {
      const why = ev.verdict ? `reasons [${ev.verdict.reasons.join(", ")}] warnings [${ev.verdict.warnings.join(", ")}]` : ev.error ?? "";
      log(`  evidence ${id}: ${ev.status} ${why}`);
      return ev;
    }
    await sleep(5_000);
  }
  log(`  evidence ${id} is still Pending after 6 minutes`);
  manual.push(`Evidence ${id} on ${estate} never got a verdict. Check OutLayer, then open ${APP_URL}/proof/${slug(estate)}/${id}.`);
  return null;
}

/** Interactive capture of a genuine photo: issue the code, then read the file the operator took. */
async function capturePassing(estate: string, surveyorId: string, m: MilestoneView, onSite: string): Promise<EvidenceView | null> {
  const how =
    `${estate} milestone ${m.index + 1} (${m.title}) needs a genuine photo: on the surveyor's phone open ${APP_URL}/qs/${slug(estate)}, ` +
    `sign in as ${surveyorId}, tap "${m.title}" → open capture, write the code on paper, and photograph the work with the paper in frame ${onSite}. ` +
    `Then rerun this script (it signs and releases what has passed).`;
  if (!interactive) {
    manual.push(how);
    return null;
  }
  const qs = account(surveyorId);
  const code = await call<string>(qs, estate, "open_capture", { milestone: m.index }, { gas: 30n * TGAS });
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    log(`\n▶ ${estate} · milestone ${m.index + 1} (${m.title})\n  Write ${code} on paper and photograph the work with the paper in frame ${onSite}.\n  The code expires in 30 minutes.`);
    const p = (await rl.question("  Path to the original photo file (empty to skip): ")).trim();
    if (!p) {
      manual.push(how);
      return null;
    }
    const file = resolve(p);
    const bytes = new Uint8Array(readFileSync(file));
    const type = /\.png$/i.test(file) ? "image/png" : "image/jpeg";
    return await submitPhoto(estate, surveyorId, m.index, bytes, type, statSync(file).mtimeMs, code);
  } finally {
    rl.close();
  }
}

/** The red proof page: the bytes of an already-accepted photo, uploaded again for another milestone. */
async function reusedPhoto(estate: string, surveyorId: string, passed: EvidenceView, m: number): Promise<void> {
  const r = await fetch(passed.url);
  if (!r.ok) {
    manual.push(`Couldn't download ${passed.url} to resubmit it as the reused-photo proof (HTTP ${r.status}).`);
    return;
  }
  const bytes = new Uint8Array(await r.arrayBuffer());
  const type = (r.headers.get("content-type") ?? "").includes("png") ? "image/png" : "image/jpeg";
  log(`+ ${estate}: resubmitting evidence ${passed.id}'s photo for milestone ${m + 1} (expect phash_reuse)`);
  const ev = await submitPhoto(estate, surveyorId, m, bytes, type, Date.now());
  if (ev && ev.status === "Fail" && !ev.verdict?.reasons.some((x) => x.startsWith("phash_reuse"))) {
    log(`  ! it failed, but not as reuse (the worker checks freshness first; the original may be older than 72 h).`);
  }
}

/** The verifier's synthetic fixture photo (no challenge code in it), submitted as a genuine failed proof. */
function fixturePhoto(): Uint8Array | null {
  const f = join(ROOT, "verifier/fixtures/offline-input.json");
  if (!existsSync(f)) return null;
  const b64 = (JSON.parse(readFileSync(f, "utf8")) as { image_base64?: string }).image_base64;
  return b64 ? new Uint8Array(Buffer.from(b64.replace(/^data:[^,]*,/, ""), "base64")) : null;
}

async function evidenceWhere(estate: string, pred: (e: EvidenceView) => boolean): Promise<EvidenceView | undefined> {
  return (await listEvidence(estate)).find(pred);
}
const isReuse = (e: EvidenceView) => e.status === "Fail" && !!e.verdict?.reasons.some((r) => r.startsWith("phash_reuse"));

// ---------------------------------------------------------------- Harmattan Court: milestones 1–2, releases, reuse

async function seedHarmattan(cfg: EstateConfig, taken: string[]) {
  const estate = estateId(cfg);
  const e = await view<EstateView>(estate, "get_estate");
  const qsId = e.surveyor_id;
  const onSite = `on site at ${cfg.name} (within ${cfg.geofence.radius_m} m of ${cfg.geofence.lat_e6 / 1e6}, ${cfg.geofence.lon_e6 / 1e6})`;
  for (const idx of [0, 1]) {
    let m = (await milestones(estate))[idx];
    if (m.status === "Checking") {
      const last = m.evidence_ids[m.evidence_ids.length - 1];
      if (last) await waitVerdict(estate, last);
      m = (await milestones(estate))[idx];
    }
    if (m.status === "Open" || m.status === "Vetoed") {
      const ev = await capturePassing(estate, qsId, m, onSite);
      if (!ev || ev.status !== "Pass") break; // milestones are sequential in the demo story
      m = (await milestones(estate))[idx];
    }
    if (m.status === "Verified") {
      await call(account(qsId), estate, "qs_sign", { milestone: idx }, { gas: 30n * TGAS });
      log(`+ ${qsId} signed milestone ${idx + 1} (${m.title}); veto window running`);
      m = (await milestones(estate))[idx];
    }
    if (m.status !== "Approved") break;
  }

  // Release once the veto windows are over.
  const ms = await milestones(estate);
  const approved = ms.filter((m) => m.status === "Approved");
  if (approved.length) {
    const until = approved.reduce((a, m) => (m.veto_until && BigInt(m.veto_until) > a ? BigInt(m.veto_until) : a), 0n);
    const waitMs = Number(until / 1_000_000n) - Date.now();
    if (waitMs > 0 && waitMs < 10 * 60_000) {
      log(`  waiting ${Math.ceil(waitMs / 1000)} s for the holder veto window…`);
      await sleep(waitMs + 5_000);
    }
    if (waitMs < 10 * 60_000) {
      const due = [];
      for (const u of taken) {
        const v = await view<{ releasable_now: string } | null>(estate, "get_unit", { unit_id: u });
        if (v && BigInt(v.releasable_now) > 0n) due.push(u);
      }
      if (due.length) {
        await call(account(ROOT_ACCOUNT), estate, "claim_release", { unit_ids: due }, { gas: 300n * TGAS });
        log(`+ released the approved share of ${due.join(", ")} to the payout account`);
      }
    } else {
      manual.push(`Veto window on ${estate} ends at ${new Date(Number(until / 1_000_000n)).toISOString()}; rerun to claim_release.`);
    }
  }

  // The failed (reused-photo) proof.
  if (await evidenceWhere(estate, isReuse)) {
    log(`= ${estate} already has a reused-photo proof`);
    return;
  }
  const passed = await evidenceWhere(estate, (x) => x.status === "Pass");
  const next = (await milestones(estate)).find((m) => m.status === "Open" || m.status === "Vetoed");
  if (passed && next) await reusedPhoto(estate, qsId, passed, next.index);
  else manual.push(`${estate}: the reused-photo proof needs a passed photo first (milestone 1); rerun after it passes.`);
}

// ---------------------------------------------------------------- Playground: one passed, one failed proof

async function seedPlayground(cfg: EstateConfig) {
  const estate = estateId(cfg);
  const e = await view<EstateView>(estate, "get_estate");
  const qsId = e.surveyor_id; // anyone may capture on the playground; use the demo surveyor's key
  const all = await listEvidence(estate);
  let passed = all.find((x) => x.status === "Pass");
  if (!passed) {
    const m = (await milestones(estate)).find((x) => x.status === "Open" || x.status === "Vetoed");
    if (m) passed = (await capturePassing(estate, qsId, m, "anywhere (the playground has no geofence)")) ?? undefined;
    if (passed && passed.status !== "Pass") passed = undefined;
  } else log(`= ${estate} already has a passed proof (${passed.id})`);

  if (all.some((x) => x.status === "Fail")) {
    log(`= ${estate} already has a failed proof`);
    return;
  }
  const next = (await milestones(estate)).find((m) => m.status === "Open" || m.status === "Vetoed");
  if (!next) return;
  if (passed) {
    await reusedPhoto(estate, qsId, passed, next.index);
    return;
  }
  const bytes = fixturePhoto();
  if (!bytes) {
    manual.push(`${estate}: no passed proof and no verifier fixture photo to submit as the failed proof.`);
    return;
  }
  // A real submission of a photo that doesn't show this capture's code: the worker genuinely fails it.
  log(`+ ${estate}: submitting the verifier's synthetic fixture photo (it carries no challenge code) as the failed proof`);
  await submitPhoto(estate, qsId, next.index, bytes, "image/jpeg", Date.now());
}

// ---------------------------------------------------------------- run

const hcCfg = loadConfig(join(ROOT, "config/harmattan-court.testnet.json"));
const pgCfg = loadConfig(join(ROOT, "config/playground.testnet.json"));
const hc = estateId(hcCfg);
const bh = estateId(loadConfig(join(ROOT, "config/baobab-heights.testnet.json")));
const judge = resolveAccount("judge");
const taken = ["a-4b", "b-3b"];

if (!refundOnly && !skipBuys) {
  await buy(resolveAccount("buyer-1"), hc, "a-4b", 8_500n * USDC);
  await buy(resolveAccount("buyer-2"), hc, "b-3b", 25_500n * USDC);
  await buy(resolveAccount("buyer-3"), hc, "a-2a", 0n);
}
if (!skipBuys) {
  for (const u of ["b-2a", "b-2b", "b-2c"]) {
    await buy(judge, bh, u, 100n * USDC);
  }
}
if (!noProofs) {
  await seedHarmattan(hcCfg, taken);
  await seedPlayground(pgCfg);
}

if (manual.length) {
  log("\nStill to do by hand (these need a real photo or a setting this script can't fake):");
  for (const [i, m] of manual.entries()) log(`  ${i + 1}. ${m}`);
} else {
  log("✓ seeded.");
}
