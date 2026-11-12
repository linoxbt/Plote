// Evidence storage housekeeping, run by the poller for each estate. Never deletes a file an on-chain evidence points
// at (list_evidence urls). Deletes by default on a production deployment; STORAGE_CLEANUP_DELETE=0 makes it report
// only, =1 forces deletion elsewhere (lib/server/env.ts cleanupDeletes).
//  - playground_expired: playground photos older than 14 days (the judge sandbox is public; keep it from becoming
//    free hosting).
//  - uploaded_late: the bytes arrived after the 5-minute upload deadline recorded by /api/evidence/upload-url
//    (Supabase signed upload URLs themselves live 2 h and can't be shortened).
//  - size_mismatch: the stored size isn't the size the surveyor declared and signed for.

import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_BUCKET, TABLES } from "../config";
import { estateSlug } from "../estates";

export const UPLOAD_URL_TTL_MS = 5 * 60_000; // SPEC §17.2
export const PLAYGROUND_RETENTION_MS = 14 * 86_400_000;
const LATE_GRACE_MS = 60_000; // clock skew between the app and Storage
const RECENT_MS = 3 * 3600_000; // late/size checks look at uploads from the last 3 h
const MAX_DELETES = 200;

export type StoredObject = { path: string; createdAt: string | null; size: number | null };
export type UploadRow = { path: string; size_bytes?: number | null; upload_expires_at?: string | null };
export type CleanupReason = "playground_expired" | "uploaded_late" | "size_mismatch";
export type CleanupItem = { path: string; reason: CleanupReason };

/** True when an on-chain evidence url points at this storage path. */
export function isReferenced(path: string, urls: string[]): boolean {
  return urls.some((u) => u.endsWith(`/${path}`) || u === path);
}

export function planCleanup(input: { objects: StoredObject[]; rows: UploadRow[]; referencedUrls: string[]; playground: boolean; now?: number }): CleanupItem[] {
  const now = input.now ?? Date.now();
  const rows = new Map(input.rows.map((r) => [r.path, r]));
  const out: CleanupItem[] = [];
  for (const o of input.objects) {
    if (isReferenced(o.path, input.referencedUrls)) continue;
    const created = o.createdAt ? Date.parse(o.createdAt) : NaN;
    const row = rows.get(o.path);
    const deadline = row?.upload_expires_at ? Date.parse(row.upload_expires_at) : NaN;
    if (input.playground && Number.isFinite(created) && now - created > PLAYGROUND_RETENTION_MS) out.push({ path: o.path, reason: "playground_expired" });
    else if (Number.isFinite(created) && Number.isFinite(deadline) && created > deadline + LATE_GRACE_MS) out.push({ path: o.path, reason: "uploaded_late" });
    else if (row?.size_bytes != null && o.size != null && Number(row.size_bytes) !== o.size) out.push({ path: o.path, reason: "size_mismatch" });
  }
  return out.slice(0, MAX_DELETES);
}

export type CleanupReport = { checked: number; flagged: number; deleted: number; dryRun: boolean; reasons: Partial<Record<CleanupReason, number>>; error?: string };

type FileObject = { name: string; id?: string | null; created_at?: string | null; metadata?: { size?: number } | null };

/**
 * List this estate's folder (oldest 1000 for the 14-day rule, newest 100 for the upload checks), read the matching
 * rows and the on-chain evidence urls, and delete (or just count, in dry-run) what planCleanup flags.
 */
export async function cleanupEstateStorage(
  sb: SupabaseClient,
  estate: string,
  opts: { playground: boolean; referencedUrls: () => Promise<string[]>; deleteFiles: boolean; now?: number },
): Promise<CleanupReport> {
  const now = opts.now ?? Date.now();
  const folder = estateSlug(estate);
  const bucket = sb.storage.from(SUPABASE_BUCKET);
  const report: CleanupReport = { checked: 0, flagged: 0, deleted: 0, dryRun: !opts.deleteFiles, reasons: {} };
  const toObj = (f: FileObject): StoredObject | null =>
    f.id ? { path: `${folder}/${f.name}`, createdAt: f.created_at ?? null, size: typeof f.metadata?.size === "number" ? f.metadata.size : null } : null; // id null = sub-folder
  const objects = new Map<string, StoredObject>();
  if (opts.playground) {
    const old = await bucket.list(folder, { limit: 1000, sortBy: { column: "created_at", order: "asc" } });
    if (old.error) throw new Error(`storage list: ${old.error.message}`);
    for (const f of (old.data ?? []) as FileObject[]) {
      const o = toObj(f);
      if (o && o.createdAt && now - Date.parse(o.createdAt) > PLAYGROUND_RETENTION_MS) objects.set(o.path, o);
    }
  }
  const recent = await bucket.list(folder, { limit: 100, sortBy: { column: "created_at", order: "desc" } });
  if (recent.error) throw new Error(`storage list: ${recent.error.message}`);
  const recentPaths: string[] = [];
  for (const f of (recent.data ?? []) as FileObject[]) {
    const o = toObj(f);
    if (o && o.createdAt && now - Date.parse(o.createdAt) < RECENT_MS) {
      objects.set(o.path, o);
      recentPaths.push(o.path);
    }
  }
  report.checked = objects.size;
  if (!objects.size) return report;
  let rows: UploadRow[] = [];
  if (recentPaths.length) {
    const r = await sb.from(TABLES.evidenceFiles).select("path,size_bytes,upload_expires_at").in("path", recentPaths);
    if (!r.error) rows = (r.data ?? []) as UploadRow[]; // before migration 0004 the columns don't exist: no upload checks
  }
  const plan = planCleanup({ objects: [...objects.values()], rows, referencedUrls: await opts.referencedUrls(), playground: opts.playground, now });
  report.flagged = plan.length;
  for (const p of plan) report.reasons[p.reason] = (report.reasons[p.reason] ?? 0) + 1;
  if (!opts.deleteFiles || !plan.length) return report;
  const paths = plan.map((p) => p.path);
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    const del = await bucket.remove(chunk);
    if (del.error) {
      report.error = `storage remove: ${del.error.message}`;
      break;
    }
    report.deleted += chunk.length;
    await sb.from(TABLES.evidenceFiles).delete().in("path", chunk).is("evidence_id", null);
  }
  return report;
}
