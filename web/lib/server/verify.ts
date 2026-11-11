// HTTPS fallback for photo checks (SPEC 6.6): run the worker through OutLayer's HTTPS API and pass the
// attested verdict to the estate via submit_verdict, signed by the estate's verdict relayer.

import type { SupabaseClient } from "@supabase/supabase-js";

export type WorkerVerdict = Record<string, unknown> & { pass: boolean };

/** The relayer may only submit verdicts to estates in `verify_mode: "https"` (contract: E_VERIFY_MODE). */
export function relayAllowed(verifyMode: string | null | undefined): boolean {
  return verifyMode === "https";
}

/** Find the verdict in whatever OutLayer returns: a bare verdict, a JSON string, or a wrapper. Mirrors the contract. */
export function extractVerdict(v: unknown, depth = 0): { verdict: WorkerVerdict; attestation: string | null } | null {
  if (depth > 4 || v == null) return null;
  if (typeof v === "string") {
    try {
      return extractVerdict(JSON.parse(v.trim()), depth + 1);
    } catch {
      return null;
    }
  }
  if (typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.pass === "boolean") return { verdict: o as WorkerVerdict, attestation: null };
  for (const k of ["output", "result", "data", "stdout", "value", "Ok", "ok", "response", "execution"]) {
    const inner = extractVerdict(o[k], depth + 1);
    if (inner) return { verdict: inner.verdict, attestation: inner.attestation ?? attestationRef(o) };
  }
  return null;
}

function attestationRef(o: Record<string, unknown>): string | null {
  for (const k of ["attestation", "attestation_id", "execution_id", "request_id", "tx_hash", "id"]) {
    const x = o[k];
    if (typeof x === "string" && x) return x.slice(0, 200);
    if (typeof x === "number") return String(x);
    if (x && typeof x === "object") return JSON.stringify(x).slice(0, 200);
  }
  return null;
}

/** Shape the worker's verdict into the contract's `Verdict` JSON (U64 as string, bounded lists). */
export function toContractVerdict(v: WorkerVerdict, attestation: string | null): Record<string, unknown> {
  const str = (x: unknown) => (typeof x === "string" ? x : x == null ? null : String(x));
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((s) => typeof s === "string").slice(0, 16) : []);
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const gps = Array.isArray(v.gps) && v.gps.length === 2 && v.gps.every((n) => typeof n === "number") ? v.gps : null;
  return {
    pass: v.pass,
    reasons: list(v.reasons),
    warnings: list(v.warnings),
    phash: typeof v.phash === "string" ? v.phash : "",
    nearest_distance: Math.min(255, Math.max(0, num(v.nearest_distance) ?? 64)),
    exif_time: v.exif_time == null ? null : String(v.exif_time),
    gps,
    gps_source: str(v.gps_source),
    distance_m: num(v.distance_m),
    ai_stage: str(v.ai_stage),
    ai_confidence: num(v.ai_confidence),
    challenge_read: str(v.challenge_read),
    ai_observations: list(v.ai_observations).slice(0, 4).map((o) => o.slice(0, 160)),
    ai_chat_id: str(v.ai_chat_id),
    worker_commit: typeof v.worker_commit === "string" ? v.worker_commit : "unknown",
    attestation: str(v.attestation) ?? attestation,
    source: null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Paid results (table verify_results, migration 0004). OutLayer is paid per run; if submit_verdict then fails (RPC
// down, relayer out of gas), the verdict is kept so a retry submits it again instead of paying for another run.

export type PaidStore = {
  load(estate: string, evidenceId: string): Promise<{ verdict: Record<string, unknown> } | null>;
  save(estate: string, evidenceId: string, verdict: Record<string, unknown>, error: string): Promise<boolean>;
  submitted(estate: string, evidenceId: string, txHash: string | null): Promise<void>;
};

export function paidStore(sb: Pick<SupabaseClient, "from"> | null): PaidStore {
  return {
    async load(estate, evidenceId) {
      if (!sb) return null;
      const r = await sb.from("verify_results").select("verdict").eq("estate", estate).eq("evidence_id", evidenceId).is("submitted_at", null).maybeSingle();
      return r.error || !r.data ? null : { verdict: r.data.verdict as Record<string, unknown> };
    },
    async save(estate, evidenceId, verdict, error) {
      if (!sb) return false;
      const now = new Date().toISOString();
      const r = await sb.from("verify_results").upsert({ estate, evidence_id: evidenceId, verdict, last_error: error.slice(0, 500), submitted_at: null, updated_at: now });
      return !r.error;
    },
    async submitted(estate, evidenceId, txHash) {
      if (!sb) return;
      await sb.from("verify_results").update({ submitted_at: new Date().toISOString(), submitted_tx: txHash, updated_at: new Date().toISOString() }).eq("estate", estate).eq("evidence_id", evidenceId);
    },
  };
}
