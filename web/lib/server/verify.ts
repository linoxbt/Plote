// HTTPS fallback for photo checks (SPEC 6.6): run the worker through OutLayer's HTTPS API and pass the
// attested verdict to the estate via submit_verdict, signed by the estate's verdict relayer.

export type WorkerVerdict = Record<string, unknown> & { pass: boolean };

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
    ai_chat_id: str(v.ai_chat_id),
    worker_commit: typeof v.worker_commit === "string" ? v.worker_commit : "unknown",
    attestation: str(v.attestation) ?? attestation,
    source: null,
  };
}
