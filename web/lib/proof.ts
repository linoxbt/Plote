// Turns an EvidenceView + Verdict into the proof checklist (SPEC §6.1, §6.7).

import { formatDuration, nsToMs } from "./format";
import type { EvidenceView, Verdict } from "./types";

export type CheckKey = "integrity" | "freshness" | "location" | "reuse" | "stage" | "challenge";
export type CheckState = "pass" | "fail" | "warn" | "pending" | "skipped";

export type CheckItem = { key: CheckKey; label: string; state: CheckState; detail: string; codes: string[] };

const GROUP: Record<string, CheckKey> = {
  fetch_failed: "integrity", hash_mismatch: "integrity", bad_image: "integrity",
  exif_missing: "freshness", exif_stale: "freshness", exif_future: "freshness",
  outside_geofence: "location", gps_missing: "location",
  phash_reuse: "reuse",
  ai_stage_mismatch: "stage", ai_low_confidence: "stage", ai_screen_photo: "stage", ai_unavailable: "stage",
  challenge_missing: "challenge", challenge_mismatch: "challenge", challenge_unverified: "challenge", worker_commit_mismatch: "integrity", exif_before_capture: "challenge",
};

export const REASON_TEXT: Record<string, string> = {
  fetch_failed: "The checker couldn't download the photo.",
  hash_mismatch: "The file doesn't match the SHA-256 committed on-chain.",
  bad_image: "The file isn't a readable photo of at least 800 px.",
  exif_missing: "The photo has no capture time (EXIF).",
  exif_stale: "The photo is older than the allowed window.",
  exif_future: "The photo's capture time is in the future.",
  outside_geofence: "The photo was taken outside the site's boundary.",
  gps_missing: "Neither the photo nor the phone recorded a location.",
  phash_reuse: "The photo matches one used before.",
  ai_stage_mismatch: "The model doesn't see the claimed stage in the photo.",
  ai_low_confidence: "The model wasn't confident enough about the stage.",
  ai_screen_photo: "This looks like a photo of a screen, a printout or a render.",
  ai_unavailable: "The stage check (NEAR AI) was unavailable.",
  challenge_missing: "No challenge code was visible in the photo.",
  challenge_mismatch: "The code in the photo doesn't match the one issued on-chain.",
  challenge_unverified: "The challenge code couldn't be read from the photo, so the check fails.",
  worker_commit_mismatch: "The check ran on a different version of the checking code than the one pinned on-chain.",
  exif_before_capture: "The photo was taken before the capture was opened.",
};

export function reasonBase(code: string): string {
  return code.split(":")[0];
}

export function reasonText(code: string): string {
  const base = reasonBase(code);
  const t = REASON_TEXT[base] ?? code.replace(/_/g, " ");
  if (base === "phash_reuse" && code.includes(":")) return `${t} (distance ${code.split(":")[1]}/64)`;
  return t;
}

function codesFor(list: string[] | undefined, key: CheckKey): string[] {
  return (list ?? []).filter((c) => GROUP[reasonBase(c)] === key);
}

export function proofChecks(ev: EvidenceView, opts: { geofenceRadius?: number; maxPhash?: number; minAi?: number } = {}): CheckItem[] {
  const v: Verdict | null = ev.verdict;
  const mk = (key: CheckKey, label: string, okDetail: string): CheckItem => {
    if (!v) return { key, label, state: ev.status === "Error" ? "skipped" : "pending", detail: ev.status === "Error" ? "Check didn't run" : "Checking…", codes: [] };
    const fails = codesFor(v.reasons, key);
    const warns = codesFor(v.warnings, key);
    if (fails.length) return { key, label, state: "fail", detail: fails.map(reasonText).join(" "), codes: fails };
    if (warns.length) return { key, label, state: "warn", detail: warns.map(reasonText).join(" ") + " (downgraded to a warning)", codes: warns };
    return { key, label, state: "pass", detail: okDetail, codes: [] };
  };

  const exifMs = v?.exif_time ? nsToMs(v.exif_time) : null;
  const subMs = nsToMs(ev.submitted_at);
  const age = exifMs ? subMs - exifMs : null;
  const loc =
    opts.geofenceRadius === 0 && v && v.distance_m === null
      ? { key: "location" as const, label: "Location", state: "skipped" as const, detail: "No geofence on this estate (Playground).", codes: [] }
      : mk("location", "Taken on site", v?.distance_m != null ? `${v.distance_m} m from the site (${v.gps_source === "device" ? "phone GPS, lower trust" : "photo GPS"})` : "Inside the site boundary");

  return [
    mk("integrity", "Hash matches on-chain commitment", `SHA-256 ${ev.sha256.slice(0, 10)}… matches`),
    mk("freshness", "Fresh photo", age !== null ? `Taken ${formatDuration(age)} before upload` : "Capture time checked"),
    loc,
    mk("reuse", "Never used before", v ? `Nearest match ${v.nearest_distance}/64` : ""),
    mk("stage", "Shows the right stage", v?.ai_stage ? `Shows ${v.ai_stage.replace(/_/g, " ")} — ${v.ai_confidence ?? "?"}% confidence` : "Stage recognised"),
    mk("challenge", "Challenge code in frame", v?.challenge_read ? `Read “${v.challenge_read}”, issued “${ev.challenge}”` : `Issued “${ev.challenge}”`),
  ];
}

/** "This photo was taken 23 m from the site, 1 hour before it was submitted, has not been used before, and shows roofing work." */
export function verdictSentence(ev: EvidenceView): string {
  const v = ev.verdict;
  if (!v) return ev.status === "Error" ? `The check didn't complete${ev.error ? `: ${ev.error}` : ""}. The surveyor can resubmit.` : "The photo is being checked inside secure hardware.";
  if (!v.pass) return `This photo failed the check: ${v.reasons.map(reasonText).join(" ")}`;
  const parts: string[] = [];
  if (v.distance_m != null) parts.push(`was taken ${v.distance_m} m from the site`);
  if (v.exif_time) {
    const age = nsToMs(ev.submitted_at) - nsToMs(v.exif_time);
    if (age >= 0) parts.push(`${formatDuration(age)} before it was submitted`);
  }
  parts.push("has not been used before");
  if (v.ai_stage) parts.push(`and shows ${v.ai_stage.replace(/_/g, " ")} work`);
  const body = parts.length > 1 ? parts.slice(0, -1).join(", ") + ", " + parts[parts.length - 1] : parts[0];
  return `This photo ${body}.${v.warnings.length ? " Some checks were downgraded to warnings on this estate." : ""}`;
}
