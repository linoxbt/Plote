// NEP-297 `EVENT_JSON:` log parsing (INTERFACE §1.4).
// Plote events: {"standard":"plote","version":"1.0.0","event":"<snake_case>","data":[{...}]}
// NFT events:   standard "nep171" (nft_mint, nft_transfer, nft_burn).

export const PLOTE_EVENTS = [
  "unit_added", "reserved", "reservation_ended", "deposit_synced", "allocated",
  "capture_opened", "evidence_submitted", "verdict", "qs_signed", "released",
  "refunded", "excess_withdrawn", "unattributed_swept", "defaulted", "listed", "sold",
  "frozen", "unfrozen", "surveyor_changed", "handed_over", "proposal_created", "voted",
  "proposal_executed", "proposal_rejected", "playground_reset",
] as const;

export type PloteEventName = (typeof PLOTE_EVENTS)[number];

export type PloteEventLog = {
  standard: string;
  version: string;
  event: string;
  data: Record<string, unknown>[];
};

const PREFIX = "EVENT_JSON:";

/** Parse one log line. Returns null for anything that isn't a well-formed NEP-297 event. */
export function parseEventLog(line: string): PloteEventLog | null {
  if (typeof line !== "string") return null;
  const i = line.indexOf(PREFIX);
  if (i !== 0) return null;
  try {
    const j = JSON.parse(line.slice(PREFIX.length)) as Partial<PloteEventLog> & { data?: unknown };
    if (!j || typeof j.standard !== "string" || typeof j.event !== "string") return null;
    const data = Array.isArray(j.data) ? (j.data as Record<string, unknown>[]) : j.data && typeof j.data === "object" ? [j.data as Record<string, unknown>] : [];
    return { standard: j.standard, version: typeof j.version === "string" ? j.version : "", event: j.event, data };
  } catch {
    return null;
  }
}

export function parseEventLogs(lines: string[]): PloteEventLog[] {
  const out: PloteEventLog[] = [];
  for (const l of lines) {
    const e = parseEventLog(l);
    if (e) out.push(e);
  }
  return out;
}

export function isPloteEvent(e: PloteEventLog): boolean {
  return e.standard === "plote";
}

/** Flatten events into rows (one per data item), with the unit id pulled out when present. */
export type EventRow = { standard: string; event: string; unit: string | null; data: Record<string, unknown> };

export function eventRows(events: PloteEventLog[]): EventRow[] {
  const rows: EventRow[] = [];
  for (const e of events) {
    for (const d of e.data.length ? e.data : [{}]) {
      let unit: string | null = null;
      if (typeof d.unit_id === "string") unit = d.unit_id;
      else if (Array.isArray(d.token_ids) && typeof d.token_ids[0] === "string") unit = d.token_ids[0] as string;
      rows.push({ standard: e.standard, event: e.event, unit, data: d });
    }
  }
  return rows;
}

/** Find the first event with this name in a list of logs. */
export function findEvent(events: PloteEventLog[], name: string): Record<string, unknown> | null {
  for (const e of events) if (e.event === name && e.data[0]) return e.data[0];
  return null;
}

/** Plain-English one-liner for activity feeds. */
export function describeEvent(row: { event: string; data: Record<string, unknown> }): string {
  const d = row.data;
  const s = (k: string) => (d[k] === undefined || d[k] === null ? "" : String(d[k]));
  const unit = s("unit_id").toUpperCase();
  switch (row.event) {
    case "unit_added": return `Unit ${unit} added`;
    case "reserved": return `${unit} reserved by ${s("by")}`;
    case "reservation_ended": return `Reservation on ${unit} ended`;
    case "deposit_synced": return `Payment recorded on ${unit}`;
    case "allocated": return `${unit} allocated to ${s("holder")}`;
    case "capture_opened": return `Capture opened for milestone ${Number(s("milestone")) + 1}`;
    case "evidence_submitted": return `Photo #${s("evidence_id")} submitted`;
    case "verdict": return `Photo #${s("evidence_id")} ${d.pass ? "passed" : "failed"} the check`;
    case "qs_signed": return `Surveyor signed milestone ${Number(s("milestone")) + 1}`;
    case "released": return `Released from ${unit} to ${s("to")}`;
    case "refunded": return `Refund from ${unit} to ${s("to")}`;
    case "excess_withdrawn": return `Excess withdrawn from ${unit}`;
    case "unattributed_swept": return `Unclaimed payment on ${unit} swept to ${s("to")}`;
    case "defaulted": return `${unit} declared in default`;
    case "listed": return `${unit} listed for sale (${s("kind")})`;
    case "sold": return `${unit} sold to ${s("to")}`;
    case "frozen": return `Releases frozen: ${s("reason")}`;
    case "unfrozen": return "Releases unfrozen";
    case "surveyor_changed": return `Surveyor changed to ${s("new")}`;
    case "handed_over": return `${unit} handed over`;
    case "proposal_created": return `Proposal #${s("proposal_id")} opened by ${s("proposer")}`;
    case "voted": return `${s("voter")} voted ${d.approve ? "yes" : "no"} on #${s("proposal_id")}`;
    case "proposal_executed": return `Proposal #${s("proposal_id")} passed`;
    case "proposal_rejected": return `Proposal #${s("proposal_id")} rejected`;
    case "playground_reset": return "Playground reset";
    case "nft_mint": return `Allocation token minted`;
    case "nft_transfer": return `Allocation token transferred`;
    case "nft_burn": return `Allocation token burned`;
    default: return row.event.replace(/_/g, " ");
  }
}
