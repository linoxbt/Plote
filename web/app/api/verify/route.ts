// POST /api/verify — HTTPS fallback for the TEE photo check (SPEC 6.6).
// Body: { estate, evidenceId }. Reads the exact worker input from the estate (`check_input`), runs the worker on
// OutLayer's HTTPS API (capped at WORKER_TIMEOUT_MS), stores the paid verdict (verify_results), then submits it with
// submit_verdict, signed by the reporter key (REPORTER_*, the estate's verdict_relayer; testnet falls back to the
// relayer key). Resumable: a stored, unsubmitted verdict is submitted again instead of paying for another run.
// The verdict is the worker's stdout object unchanged (VerdictArg: Verdict fields + its evidence_id / sha256 echo +
// ai_model); one that doesn't echo this evidence is never submitted (the estate refuses it, E_VERDICT_MISMATCH).
// Weaker than yield/resume: the reporter is trusted to pass the result through, and the proof page says "verdict via HTTPS". Only for estates whose verify_mode is "https": an OutLayer-mode estate
// gets its verdict from OutLayer's yield/resume callback, and the contract rejects relayed ones (E_VERIFY_MODE).

import { NextResponse } from "next/server";
import { z } from "zod";
import { ESTATES } from "@/lib/config";
import { estateAccount } from "@/lib/estates";
import { fnCall, viewUncached } from "@/lib/near";
import type { EstateView, EvidenceView } from "@/lib/types";
import { clientIp, jsonError, notConfigured, ok, parseJson } from "@/lib/server/http";
import { PloteError } from "@/lib/errors";
import { claimOnce, claimVerify, releaseVerify } from "@/lib/server/once";
import { rateLimitShared } from "@/lib/server/rate-limit";
import { callAsReporter, reporterCredentials, reporterEnvNames } from "@/lib/server/relayer";
import { logError } from "@/lib/server/alert";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { extractVerdict, paidStore, parseJsonExact, relayAllowed, toVerdictArg, verdictBinds, type PaidStore } from "@/lib/server/verify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_ATTEMPTS = 3;
/** The worker call must leave time to store and submit the verdict inside maxDuration (60 s). */
export const WORKER_TIMEOUT_MS = 35_000;

const Body = z.object({ estate: z.string().min(2).max(64), evidenceId: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]) });

export async function POST(req: Request) {
  const url = process.env.OUTLAYER_HTTPS_URL?.trim();
  const key = process.env.OUTLAYER_PAYMENT_KEY?.trim();
  const creds = reporterCredentials();
  if (!url || !key || !creds) {
    return notConfigured("The HTTPS verifier", ["OUTLAYER_HTTPS_URL", "OUTLAYER_PAYMENT_KEY", ...reporterEnvNames()]);
  }
  const p = await parseJson(req, Body);
  if (!p.ok) return p.res;
  const estate = estateAccount(p.data.estate);
  if (!ESTATES.includes(estate)) return jsonError("E_BAD_ARGS", "Unknown estate.");
  const id = String(p.data.evidenceId);
  const rl = await rateLimitShared(`verify:${clientIp(req)}`, 6, 60_000);
  if (!rl.ok) return jsonError("RATE_LIMITED", `Try again in ${rl.retryAfterS}s.`, 429);

  let e: EstateView, ev: EvidenceView | null, input: string | null;
  try {
    [e, ev, input] = await Promise.all([
      viewUncached<EstateView>(estate, "get_estate"),
      viewUncached<EvidenceView | null>(estate, "get_evidence", { id }),
      viewUncached<string | null>(estate, "check_input", { evidence_id: id }),
    ]);
  } catch (err) {
    const x = err instanceof PloteError ? err.code : "RPC_UNAVAILABLE";
    if (x === "CONTRACT_NOT_DEPLOYED") return jsonError(x, `${estate} isn't deployed on this network.`, 404);
    return jsonError("RPC_UNAVAILABLE", "Couldn't read the estate from NEAR. Try again in a moment.", 503);
  }
  if (!relayAllowed(e.verify_mode)) {
    return jsonError(
      "E_VERIFY_MODE",
      `This estate's verify_mode is "${e.verify_mode}", so its verdicts come only from OutLayer's on-chain callback. The HTTPS fallback is for estates deployed with verify_mode "https".`,
      409,
    );
  }
  if (!ev || !input) return jsonError("E_BAD_ARGS", "No such evidence.", 404);
  if (ev.status !== "Pending" && ev.status !== "Error") return ok({ status: ev.status, already: true });
  if (e.verdict_relayer !== creds.accountId) {
    return jsonError("E_NOT_RELAYER", `This estate's verdict relayer is ${e.verdict_relayer ?? "unset"}, not ${creds.accountId}.`, 403);
  }

  // A run that OutLayer was already paid for, whose submit_verdict failed: submit that verdict again, don't pay twice.
  // Leased separately (60 s) so it doesn't use up one of the MAX_ATTEMPTS paid runs.
  const paid = paidStore(supabaseAdmin());
  let stored = await paid.load(estate, id).catch(() => null);
  if (stored && !verdictBinds(stored.verdict, id, ev.sha256)) {
    // Saved before the estate required the evidence_id/sha256 echo: it can never be accepted, so close it.
    await paid.submitted(estate, id, null).catch(() => undefined);
    stored = null;
  }
  if (stored) {
    if (!(await claimOnce("verify-submit", `${estate}:${id}`, 60_000))) {
      return jsonError("VERIFY_IN_PROGRESS", "This photo's verdict is being submitted right now. Try again in a minute.", 409);
    }
    return submitVerdict(estate, id, stored.verdict, paid, true);
  }

  // One run at a time per evidence (concurrent callers would each pay OutLayer), and a cap on re-runs of Error evidence.
  const claim = await claimVerify(estate, id, { leaseMs: 90_000, maxAttempts: MAX_ATTEMPTS });
  if (!claim.ok) {
    return claim.reason === "exhausted"
      ? jsonError("VERIFY_RETRIES_EXHAUSTED", `This photo was already checked ${MAX_ATTEMPTS} times over HTTPS. Submit a new photo.`, 409)
      : jsonError("VERIFY_IN_PROGRESS", "A check of this photo is already running. Try again in a minute.", 409);
  }
  try {
    return await runWorker(url, key, estate, id, ev.sha256, input, paid);
  } finally {
    await releaseVerify(estate, id);
  }
}

async function runWorker(url: string, key: string, estate: string, id: string, sha256: string, input: string, paid: PaidStore) {
  let raw: unknown;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-payment-key": key },
      body: JSON.stringify({ input }),
      signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
    });
    const text = await r.text();
    if (!r.ok) {
      logError("plote:verify-worker-failed", `OutLayer HTTP ${r.status}`, { estate, evidence: id, body: text.slice(0, 200) });
      return jsonError("WORKER_FAILED", "The photo check service returned an error. Try again in a minute.", 502);
    }
    raw = parseJsonExact(text); // large integers (exif_time in ns) kept exact
  } catch (err) {
    logError("plote:verify-worker-failed", err, { estate, evidence: id });
    return jsonError("WORKER_FAILED", "The photo check didn't finish in time or its answer couldn't be read. Try again in a minute.", 502);
  }
  const found = extractVerdict(raw);
  if (!found) {
    logError("plote:verify-worker-failed", "no verdict in OutLayer's response", { estate, evidence: id });
    return jsonError("WORKER_FAILED", "The photo check didn't return a verdict. Try again in a minute.", 502);
  }
  // The worker's stdout as is (VerdictArg): Verdict fields plus its evidence_id / sha256 echo and ai_model.
  const verdict = toVerdictArg(found.verdict, found.attestation);
  if (!verdictBinds(verdict, id, sha256)) {
    // The estate would refuse it (E_VERDICT_MISMATCH): don't spend gas, and don't keep it for a resubmit.
    logError("plote:verify-verdict-unbound", "the worker's verdict doesn't echo this evidence", { estate, evidence: id });
    return jsonError("VERDICT_MISMATCH", "The photo check answered for a different photo (or without naming it), so it can't be used. Try again.", 502);
  }
  // OutLayer is paid now: keep the verdict before anything else can fail (submit error, the 60 s limit), so a retry
  // submits this one instead of paying for another run.
  const saved = await paid.save(estate, id, verdict, "not submitted yet").catch(() => false);
  if (!saved) logError("plote:verify-verdict-not-saved", "verify_results write failed", { estate, evidence: id });
  return submitVerdict(estate, id, verdict, paid, false, saved);
}

/**
 * submit_verdict as the reporter (the estate's verdict_relayer). On a contract rejection (E_* panic: e.g. the evidence
 * is no longer pending) the stored result is closed, since resubmitting can't help. On any other failure (RPC, gas)
 * the paid verdict stays stored and the caller gets 502; the next POST resubmits it without another OutLayer run.
 */
async function submitVerdict(estate: string, id: string, verdict: Record<string, unknown>, paid: PaidStore, reused: boolean, saved = true) {
  try {
    const tx = await callAsReporter(fnCall(estate, "submit_verdict", { evidence_id: id, verdict }, 50));
    await paid.submitted(estate, id, tx.hash || null).catch(() => undefined);
    return ok({ pass: verdict.pass, reasons: verdict.reasons, tx, ...(reused ? { reused: true } : {}) });
  } catch (err) {
    const pe = err instanceof PloteError ? err : null;
    if (pe?.code.startsWith("E_")) {
      await paid.submitted(estate, id, null).catch(() => undefined);
      return jsonError(pe.code, `The estate rejected the verdict: ${pe.message}`, 409);
    }
    logError("plote:verify-submit-failed", err, { estate, evidence: id });
    const internal = (pe ? pe.raw : err instanceof Error ? err.message : String(err)).slice(0, 300);
    const kept = (await paid.save(estate, id, verdict, internal).catch(() => false)) || saved;
    return NextResponse.json(
      {
        code: "VERDICT_SUBMIT_FAILED",
        message: kept
          ? "The photo was checked, but sending the verdict to the estate failed. Retry: the saved verdict is sent again without another paid check."
          : "The photo was checked, but sending the verdict to the estate failed, and the verdict couldn't be saved.",
        details: { saved: kept, pass: verdict.pass, reasons: verdict.reasons },
      },
      { status: 502 },
    );
  }
}
