// HTTPS fallback for photo checks (SPEC 6.6): run the worker through OutLayer's HTTPS API and pass the
// attested verdict to the estate via submit_verdict, signed by the estate's verdict relayer.

import type { SupabaseClient } from "@supabase/supabase-js";

export type WorkerVerdict = Record<string, unknown> & { pass: boolean };

/** The relayer may only submit verdicts to estates in `verify_mode: "https"` (contract: E_VERIFY_MODE). */
export function relayAllowed(verifyMode: string | null | undefined): boolean {
  return verifyMode === "https";
}

/**
 * JSON.parse that keeps large integers exact: an integer literal of 16+ digits outside a string (the worker's
 * `exif_time` in ns is above 2^53) becomes a string of the same digits. The estate accepts `exif_time` as a number or
 * a string, so the verdict reaches it unchanged in value.
 */
export function parseJsonExact(text: string): unknown {
  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      continue;
    }
    if (c === "-" || (c >= "0" && c <= "9")) {
      let j = i + 1;
      while (j < text.length && /[0-9.eE+-]/.test(text[j])) j++;
      const tok = text.slice(i, j);
      out += /^-?\d{16,}$/.test(tok) ? `"${tok}"` : tok;
      i = j - 1;
      continue;
    }
    out += c;
  }
  return JSON.parse(out);
}

/** Find the verdict in whatever OutLayer returns: a bare verdict, a JSON string, or a wrapper. Mirrors the contract. */
export function extractVerdict(v: unknown, depth = 0): { verdict: WorkerVerdict; attestation: string | null } | null {
  if (depth > 4 || v == null) return null;
  if (typeof v === "string") {
    try {
      return extractVerdict(parseJsonExact(v.trim()), depth + 1);
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

/**
 * submit_verdict's `verdict` (INTERFACE §1.2 `VerdictArg`): the worker's stdout object as is — every Verdict field
 * plus its `evidence_id` / `sha256` echo and `ai_model`; the estate ignores fields it doesn't know. Only `attestation`
 * is filled in, from OutLayer's wrapper, when the worker didn't set one.
 */
export function toVerdictArg(v: WorkerVerdict, attestation: string | null): Record<string, unknown> {
  return v.attestation == null && attestation ? { ...v, attestation } : { ...v };
}

/**
 * The echo the estate requires (else E_VERDICT_MISMATCH): `evidence_id` equal to this evidence (number or string) and
 * `sha256` equal to its committed hash, case-insensitive. Checked before paying gas for a transaction that would fail.
 */
export function verdictBinds(v: Record<string, unknown>, evidenceId: string, sha256: string): boolean {
  const id = typeof v.evidence_id === "number" || typeof v.evidence_id === "string" ? String(v.evidence_id) : null;
  return id === evidenceId && typeof v.sha256 === "string" && v.sha256.toLowerCase() === sha256.toLowerCase();
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
