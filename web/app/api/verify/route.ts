// POST /api/verify — HTTPS fallback for the TEE photo check (SPEC 6.6).
// Body: { estate, evidenceId }. Reads the exact worker input from the estate (`check_input`), runs the worker on
// OutLayer's HTTPS API, and submits the verdict with submit_verdict, signed by the relayer (the estate's
// verdict_relayer). Weaker than yield/resume: the relayer is trusted to pass the result through, and the
// proof page says "verdict via HTTPS".

import { z } from "zod";
import { ESTATES } from "@/lib/config";
import { estateAccount } from "@/lib/estates";
import { fnCall, viewUncached } from "@/lib/near";
import type { EstateView, EvidenceView } from "@/lib/types";
import { clientIp, jsonError, notConfigured, ok, parseJson } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";
import { callAsRelayer, relayerCredentials } from "@/lib/server/relayer";
import { extractVerdict, toContractVerdict } from "@/lib/server/verify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ estate: z.string().min(2).max(64), evidenceId: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]) });

export async function POST(req: Request) {
  const url = process.env.OUTLAYER_HTTPS_URL?.trim();
  const key = process.env.OUTLAYER_PAYMENT_KEY?.trim();
  const creds = relayerCredentials();
  if (!url || !key || !creds) {
    return notConfigured("The HTTPS verifier", ["OUTLAYER_HTTPS_URL", "OUTLAYER_PAYMENT_KEY", "RELAYER_ACCOUNT_ID", "RELAYER_PRIVATE_KEY"]);
  }
  const p = await parseJson(req, Body);
  if (!p.ok) return p.res;
  const estate = estateAccount(p.data.estate);
  if (!ESTATES.includes(estate)) return jsonError("E_BAD_ARGS", "Unknown estate.");
  const id = String(p.data.evidenceId);
  const rl = rateLimit(`verify:${clientIp(req)}`, 6, 60_000);
  if (!rl.ok) return jsonError("RATE_LIMITED", `Try again in ${rl.retryAfterS}s.`, 429);

  const [e, ev, input] = await Promise.all([
    viewUncached<EstateView>(estate, "get_estate"),
    viewUncached<EvidenceView | null>(estate, "get_evidence", { id }),
    viewUncached<string | null>(estate, "check_input", { evidence_id: id }),
  ]);
  if (!ev || !input) return jsonError("E_BAD_ARGS", "No such evidence.", 404);
  if (ev.status !== "Pending" && ev.status !== "Error") return ok({ status: ev.status, already: true });
  if (e.verdict_relayer !== creds.accountId) {
    return jsonError("E_NOT_RELAYER", `This estate's verdict relayer is ${e.verdict_relayer ?? "unset"}, not ${creds.accountId}.`, 403);
  }

  let raw: unknown;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-payment-key": key },
      body: JSON.stringify({ input }),
      signal: AbortSignal.timeout(55_000),
    });
    const text = await r.text();
    if (!r.ok) return jsonError("WORKER_FAILED", `OutLayer returned ${r.status}: ${text.slice(0, 200)}`, 502);
    raw = JSON.parse(text);
  } catch (err) {
    return jsonError("WORKER_FAILED", `OutLayer call failed: ${(err as Error).message}`, 502);
  }
  const found = extractVerdict(raw);
  if (!found) return jsonError("WORKER_FAILED", "Couldn't find a verdict in OutLayer's response.", 502);
  const verdict = toContractVerdict(found.verdict, found.attestation);
  const tx = await callAsRelayer(fnCall(estate, "submit_verdict", { evidence_id: id, verdict }, 50));
  return ok({ pass: verdict.pass, reasons: verdict.reasons, tx });
}
