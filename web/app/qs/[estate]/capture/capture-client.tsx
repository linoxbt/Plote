"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Camera, CheckCircle2, CircleDashed, Loader2, Upload, XCircle } from "lucide-react";
import { clsx } from "clsx";
import { EstateBanners } from "@/components/banners";
import { CountdownChip, StatusBadge } from "@/components/chain";
import { StaticMap } from "@/components/static-map";
import { SignerBadge, useSurveyorSigner } from "@/components/surveyor";
import { useTx } from "@/components/toast";
import { BracketCard, Button, ErrorState, LinkButton, LoadingCard, Page } from "@/components/ui";
import { captureEligibility, captureReuse, STALE_CHECK_MS, VERDICT_POLL_TIMEOUT_MS } from "@/lib/capture";
import { checkedViews as V, estate as E } from "@/lib/estate";
import { explainError } from "@/lib/errors";
import { estateAccount, estateSlug } from "@/lib/estates";
import { formatDateTime, formatDuration, msToNs, nowMs, nsToMs } from "@/lib/format";
import { haversineM } from "@/lib/geo";
import { useCapture, useEstate, useMilestones, useNow } from "@/lib/hooks";
import { bytesToBase64 } from "@/lib/near";
import { timestampedNonce, uploadMessage } from "@/lib/nep413";
import { reasonBase } from "@/lib/proof";
import type { EvidenceView } from "@/lib/types";

type Pre = { exifTime: number | null; gps: [number, number] | null; device: [number, number] | null; deviceErr: string | null };
type Phase = "pick" | "code" | "preview" | "uploading" | "checking" | "verdict";

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function putWithProgress(url: string, body: ArrayBuffer, contentType: string, onProgress: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", contentType);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload failed: HTTP ${xhr.status} ${xhr.responseText.slice(0, 200)}`)));
    xhr.onerror = () => reject(new Error("upload failed: network error"));
    xhr.send(body);
  });
}

function getDevicePosition(): Promise<[number, number]> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("no geolocation"));
    navigator.geolocation.getCurrentPosition((p) => resolve([p.coords.latitude, p.coords.longitude]), (e) => reject(new Error(e.message)), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });
}

const LOG: { key: string; label: string; codes: string[] }[] = [
  { key: "hash", label: "hash", codes: ["fetch_failed", "hash_mismatch", "bad_image"] },
  { key: "exif", label: "EXIF", codes: ["exif_missing", "exif_stale", "exif_future"] },
  { key: "loc", label: "location", codes: ["outside_geofence", "gps_missing", "gps_device_missing"] },
  { key: "reuse", label: "not reused", codes: ["phash_reuse"] },
  { key: "ai", label: "AI", codes: ["ai_stage_mismatch", "ai_low_confidence", "ai_screen_photo", "ai_unavailable"] },
  { key: "code", label: "code", codes: ["challenge_missing", "challenge_mismatch", "exif_before_capture"] },
];

export function CaptureClient({ slug }: { slug: string }) {
  const account = estateAccount(slug);
  const s = estateSlug(account);
  const est = useEstate(account);
  const ms = useMilestones(account, { poll: 10_000 });
  const signer = useSurveyorSigner();
  const { run } = useTx();
  const qc = useQueryClient();
  const [milestone, setMilestone] = useState<number | null>(null);
  const capture = useCapture(account, milestone, { poll: 5000, enabled: milestone !== null });
  const [phase, setPhase] = useState<Phase>("pick");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pre, setPre] = useState<Pre | null>(null);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<unknown>(null);
  const [evidence, setEvidence] = useState<EvidenceView | null>(null);
  const [blocked, setBlocked] = useState<{ by: string; until: string } | null>(null);
  const [opening, setOpening] = useState<number | null>(null);
  const [pollStart, setPollStart] = useState<number>(0);
  const [locating, setLocating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const now = useNow(1000);
  const evidenceId = evidence?.id ?? null;
  const timedOut = phase === "checking" && pollStart > 0 && now - pollStart > VERDICT_POLL_TIMEOUT_MS;

  // Poll get_evidence until the verdict lands, for at most VERDICT_POLL_TIMEOUT_MS; then offer the stale-check path.
  useEffect(() => {
    if (phase !== "checking" || !evidenceId || timedOut) return;
    let alive = true;
    const t = setInterval(async () => {
      try {
        const ev = await V.getEvidence(account, evidenceId, { fresh: true });
        if (alive && ev) {
          setEvidence(ev);
          if (ev.status !== "Pending") {
            setPhase("verdict");
            void Promise.all([
              qc.invalidateQueries({ queryKey: ["milestones", account] }),
              qc.invalidateQueries({ queryKey: ["evidence-list", account] }),
              qc.invalidateQueries({ queryKey: ["evidence", account, evidenceId] }),
            ]);
          }
        }
      } catch {
        /* keep polling */
      }
    }, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [phase, evidenceId, account, qc, timedOut]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  if (est.isLoading) return <Page narrow><LoadingCard lines={4} /></Page>;
  if (!est.data) return <Page narrow><ErrorState error={est.error} onRetry={() => est.refetch()} /></Page>;
  const e = est.data;
  const allowed = e.params.playground || signer.accountId === e.surveyor_id;
  const needsDeviceGps = !e.params.playground;
  const all = ms.data ?? [];
  // Show every milestone not yet approved; only the next one in order (previous Approved) can be captured.
  const listMs = all.filter((m) => m.status !== "Approved");
  const cap = capture.data;
  const capMine = !!cap && cap.by === signer.accountId;
  const capValid = !!cap && capMine && nsToMs(cap.expires_at) > now;

  const openCapture = async (m: number) => {
    setErr(null);
    setBlocked(null);
    setOpening(m);
    try {
      const existing = await V.getCapture(account, m, { fresh: true }).catch(() => null);
      const plan = captureReuse(existing, signer.accountId, nowMs(), { surveyorId: e.surveyor_id });
      if (plan.action === "blocked") {
        setBlocked(plan);
        return;
      }
      setMilestone(m);
      if (plan.action === "reuse") {
        setPhase("code");
        return;
      }
      const r = await run("Open capture", () => signer.call(E.openCapture(account, m)), { success: "Challenge code issued on-chain." });
      if (r) {
        await qc.invalidateQueries({ queryKey: ["capture", account, m] });
        await capture.refetch();
        setPhase("code");
      }
    } finally {
      setOpening(null);
    }
  };

  const reopenStale = async (m: number) => {
    const r = await run("Reopen stale check", () => signer.call(E.reopenStaleCheck(account, m)), { success: "Check reopened. The milestone is open again: take a new photo." });
    if (r) {
      await Promise.all([qc.invalidateQueries({ queryKey: ["milestones", account] }), qc.invalidateQueries({ queryKey: ["evidence-list", account] })]);
      setPhase("pick");
      setEvidence(null);
      setFile(null);
      setPre(null);
    }
  };

  const retryLocation = async () => {
    setLocating(true);
    try {
      const d = await getDevicePosition();
      setPre((p) => (p ? { ...p, device: d, deviceErr: null } : p));
    } catch (er) {
      setPre((p) => (p ? { ...p, deviceErr: (er as Error).message } : p));
    } finally {
      setLocating(false);
    }
  };

  const onFile = async (f: File | null) => {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setPhase("preview");
    const p: Pre = { exifTime: null, gps: null, device: null, deviceErr: null };
    try {
      const exifr = (await import("exifr")).default;
      const x = (await exifr.parse(f, { pick: ["DateTimeOriginal", "OffsetTimeOriginal", "latitude", "longitude", "GPSLatitude", "GPSLongitude"] }).catch(() => null)) as
        | { DateTimeOriginal?: Date; latitude?: number; longitude?: number } | null;
      if (x?.DateTimeOriginal instanceof Date && !isNaN(x.DateTimeOriginal.getTime())) p.exifTime = x.DateTimeOriginal.getTime();
      if (typeof x?.latitude === "number" && typeof x?.longitude === "number") p.gps = [x.latitude, x.longitude];
    } catch {
      /* EXIF unreadable */
    }
    try {
      p.device = await getDevicePosition();
    } catch (er) {
      p.deviceErr = (er as Error).message;
    }
    setPre(p);
  };

  const submit = async () => {
    if (!file || milestone === null || !cap) return;
    if (needsDeviceGps && !pre?.device) {
      setErr(new Error("This estate needs your phone's location for every photo (the check fails with gps_device_missing without it). Allow location for this site and try again."));
      return;
    }
    setErr(null);
    setPhase("uploading");
    setProgress(0);
    try {
      const bytes = await file.arrayBuffer(); // original bytes — never re-encoded
      const sha = await sha256Hex(bytes);
      const contentType = file.type || "image/jpeg";
      // Each signed upload URL lives 5 minutes (`expiresAt`). Ask for one right before uploading, and ask again if it
      // has (nearly) run out — e.g. the wallet prompt sat open — or the upload failed after it expired.
      type UploadUrl = { signedUrl: string; publicUrl: string; expiresAtMs: number };
      const requestUrl = async (): Promise<UploadUrl> => {
        const nonce = timestampedNonce();
        const message = uploadMessage(account, sha);
        const signed = await signer.signNep413({ message, nonce, recipient: account });
        const res = await fetch("/api/evidence/upload-url", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ estate: account, contentType, size: file.size, sha256: sha, ...signed, nonce: bytesToBase64(nonce), message, recipient: account, exif: pre ? { time: pre.exifTime, gps: pre.gps } : null }),
        });
        const j = (await res.json()) as { code?: string; message?: string; signedUrl?: string; publicUrl?: string; expiresAt?: string };
        if (!res.ok || !j.signedUrl || !j.publicUrl) throw Object.assign(new Error(j.message ?? "upload-url failed"), { code: j.code });
        const exp = j.expiresAt ? Date.parse(j.expiresAt) : NaN;
        return { signedUrl: j.signedUrl, publicUrl: j.publicUrl, expiresAtMs: Number.isFinite(exp) ? exp : Date.now() + 5 * 60_000 };
      };
      const URL_MARGIN_MS = 20_000; // don't start an upload in the URL's last 20 s
      let up = await requestUrl();
      if (Date.now() + URL_MARGIN_MS >= up.expiresAtMs) up = await requestUrl();
      try {
        await putWithProgress(up.signedUrl, bytes, contentType, setProgress);
      } catch (putErr) {
        if (Date.now() < up.expiresAtMs) throw putErr;
        setProgress(0);
        up = await requestUrl();
        await putWithProgress(up.signedUrl, bytes, contentType, setProgress);
      }
      const j = { publicUrl: up.publicUrl };
      const capturedAt = msToNs(pre?.exifTime ?? nowMs());
      const dgps = pre?.device ? ([Math.round(pre.device[0] * 1e6), Math.round(pre.device[1] * 1e6)] as [number, number]) : null;
      const r = await signer.call(E.submitEvidence(account, { milestone, url: j.publicUrl, sha256: sha, captured_at: capturedAt, device_gps: dgps }));
      let id: string | null = r.returnValue !== undefined && r.returnValue !== null ? String(r.returnValue) : null;
      if (!id) {
        const list = await E.listEvidence(account, { milestone, limit: 5 }).catch(() => []);
        id = list.find((x) => x.sha256 === sha)?.id ?? null;
      }
      const ev = id ? await E.getEvidence(account, id).catch(() => null) : null;
      setEvidence(ev ?? { id: id ?? "?", milestone, url: j.publicUrl, sha256: sha, captured_at: capturedAt, device_gps: dgps, challenge: cap.code, challenge_opened_at: cap.opened_at, submitted_by: signer.accountId ?? "", submitted_at: msToNs(nowMs()), status: "Pending", verdict: null, raw_response_hash: null, error: null });
      setPollStart(Date.now());
      setPhase(ev && ev.status !== "Pending" ? "verdict" : "checking");
      // HTTPS-mode estates (SPEC 6.6): the server runs the worker on OutLayer's API and relays the verdict.
      if (e.verify_mode === "https" && id) {
        void fetch("/api/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ estate: account, evidenceId: id }) }).catch(() => undefined);
      }
    } catch (x) {
      setErr(x);
      setPhase("preview");
    }
  };

  const center: [number, number] = [e.geofence.lat_e6 / 1e6, e.geofence.lon_e6 / 1e6];
  const loc = pre?.gps ?? pre?.device ?? null;
  const dist = loc && e.geofence.radius_m > 0 ? Math.round(haversineM(center, loc)) : null;
  const age = pre?.exifTime ? now - pre.exifTime : null;
  const preChecks: { ok: boolean | null; text: string }[] = pre
    ? [
        { ok: !!pre.exifTime && age! <= e.params.max_exif_age_h * 3600_000, text: pre.exifTime ? `Capture time in photo: ${formatDuration(age!)} ago` : "No capture time in photo — check your camera app saves EXIF" },
        { ok: !!pre.exifTime && cap ? pre.exifTime >= nsToMs(cap.opened_at) - 5 * 60_000 : null, text: "Taken after the capture was opened" },
        { ok: !!pre.gps, text: pre.gps ? "GPS in photo" : `No GPS in photo — turn on location for Camera${pre.device ? " (phone GPS will be used, lower trust)" : ""}` },
        needsDeviceGps
          ? { ok: !!pre.device, text: pre.device ? "Phone location recorded" : `Phone location is required on this estate${pre.deviceErr ? ` (${pre.deviceErr})` : ""}: allow location for this site` }
          : { ok: pre.device ? true : null, text: pre.device ? "Phone location recorded" : "No phone location (optional on the Playground)" },
        e.geofence.radius_m > 0
          ? { ok: dist !== null ? dist <= e.geofence.radius_m : null, text: dist !== null ? `${dist} m from site (limit ${e.geofence.radius_m} m)` : "Location unknown" }
          : { ok: true, text: "No geofence on this estate" },
      ]
    : [];

  return (
    <Page narrow>
      <EstateBanners estate={e} account={account} />
      <h1 className="mb-2 text-3xl font-normal">Capture · {e.name}</h1>
      <div className="mb-4"><SignerBadge s={signer} /></div>
      {!signer.mode ? <BracketCard tone="amber" className="mb-4">Connect the surveyor wallet or <Link className="underline" href="/qs/setup">install a phone key</Link> first.</BracketCard> : !allowed ? (
        <BracketCard tone="red" className="mb-4">Only the estate&apos;s surveyor ({e.surveyor_id}) can capture here.</BracketCard>
      ) : null}
      {err ? <ErrorState error={err} title="That didn't work" className="mb-4" /> : null}

      {phase === "pick" ? (
        <BracketCard className="space-y-3">
          <h2 className="text-lg font-normal">Which milestone?</h2>
          {blocked ? (
            <p className="text-sm text-amber" role="alert">
              <span className="mono">{blocked.by}</span> has an open capture for that milestone until {formatDateTime(blocked.until)}. Only they (or the estate&apos;s surveyor) can use it; try again after it ends.
            </p>
          ) : null}
          {!ms.data ? <LoadingCard lines={2} /> : !listMs.length ? <p className="text-sm text-muted">Every milestone is approved.</p> : (
            <ul className="space-y-2">
              {listMs.map((m) => {
                const el = captureEligibility(all, m.index);
                const lastEv = m.evidence_ids.length ? m.evidence_ids[m.evidence_ids.length - 1] : null;
                return (
                  <li key={m.index}>
                    <button type="button" disabled={!el.ok || !signer.mode || !allowed || signer.locked || opening !== null} onClick={() => openCapture(m.index)} aria-busy={opening === m.index || undefined} className="corners corners-hover flex min-h-16 w-full items-center justify-between gap-3 bg-surface-2 p-3 text-left disabled:opacity-50">
                      <span className="min-w-0">
                        <span className="font-medium">{m.index + 1}. {m.title}</span>
                        {!el.ok ? <span className="block text-xs text-muted">{el.why}</span> : m.late ? <span className="block text-xs text-amber">Past its deadline: refunds are open, but it can still be proven.</span> : null}
                      </span>
                      <span className="flex items-center gap-2">
                        {opening === m.index ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                        <StatusBadge kind="milestone" status={m.status} />
                      </span>
                    </button>
                    {m.status === "Checking" ? <StaleCheck estate={account} milestone={m.index} evidenceId={lastEv} onReopen={() => reopenStale(m.index)} /> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </BracketCard>
      ) : null}

      {phase === "code" && milestone !== null ? (
        <BracketCard tone="orange" className="space-y-5 text-center">
          {!cap ? <LoadingCard lines={1} label="Reading the challenge code" /> : (
            <>
              <p className="label">Write this on paper</p>
              <p className="mono select-all text-[56px] font-normal leading-none tracking-[0.25em] text-orange-ink sm:text-[88px]" aria-label={`Challenge code ${cap.code.split("").join(" ")}`}>{cap.code}</p>
              <p className="text-lg">Write <strong className="mono">{cap.code}</strong> on paper and keep it in the photo.</p>
              <CountdownChip until={cap.expires_at} label="code valid" />
              <input ref={fileRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(x) => onFile(x.target.files?.[0] ?? null)} aria-label="Take the site photo" />
              <Button variant="primary" className="min-h-16 w-full text-lg" disabled={!capValid} onClick={() => fileRef.current?.click()}><Camera className="h-6 w-6" aria-hidden /> Take the photo</Button>
              <p className="text-xs text-muted">Use the rear camera. The photo must show the {ms.data?.[milestone]?.title.toLowerCase()} work and the paper with the code.</p>
            </>
          )}
        </BracketCard>
      ) : null}

      {(phase === "preview" || phase === "uploading") && preview ? (
        <BracketCard className="space-y-4">
          <img src={preview} alt="Your photo" className="max-h-[50vh] w-full object-contain" />
          <ul className="space-y-1">
            {!pre ? <li className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Reading EXIF and location…</li> : preChecks.map((c) => (
              <li key={c.text} className={clsx("flex items-start gap-2 text-sm", c.ok === false && "text-amber")}>
                {c.ok === true ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-orange-ink" aria-hidden /> : c.ok === false ? <AlertTriangle className="mt-0.5 h-4 w-4" aria-hidden /> : <CircleDashed className="mt-0.5 h-4 w-4 text-muted" aria-hidden />}
                <span><span className="sr-only">{c.ok === true ? "OK: " : c.ok === false ? "Warning: " : ""}</span>{c.text}</span>
              </li>
            ))}
          </ul>
          {needsDeviceGps && pre && !pre.device ? (
            <BracketCard tone="amber" className="space-y-2">
              <p className="text-sm">This estate checks every photo against your phone&apos;s location. Allow location for this site in your browser settings, then:</p>
              <Button size="sm" loading={locating} onClick={retryLocation}>Try location again</Button>
            </BracketCard>
          ) : null}
          {e.geofence.radius_m > 0 && pre ? <div className="max-w-xs"><StaticMap center={center} radiusM={e.geofence.radius_m} pin={loc} pinLabel={dist !== null ? `${dist} m` : undefined} /></div> : null}
          <p className="text-xs text-muted">These are hints. The real checks run in secure hardware after upload.</p>
          {phase === "uploading" ? (
            <div className="space-y-1"><p className="mono text-sm">Uploading original bytes… {progress}%</p><div className="h-2 bg-surface-2"><div className="h-full bg-orange" style={{ width: `${progress}%` }} /></div></div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" className="min-h-14 flex-1" onClick={submit} disabled={!pre || !capValid || (needsDeviceGps && !pre.device)}><Upload className="h-5 w-5" aria-hidden /> Upload and submit</Button>
              <Button className="min-h-14" onClick={() => { setPhase("code"); setFile(null); setPre(null); }}>Retake</Button>
            </div>
          )}
        </BracketCard>
      ) : null}

      {(phase === "checking" || phase === "verdict") && evidence ? (
        <BracketCard tone={phase === "verdict" ? (evidence.status === "Pass" ? "orange" : "red") : "amber"} className="space-y-4">
          <p className="font-display text-xl font-normal">{phase === "checking" ? "Checking in secure hardware…" : evidence.status === "Pass" ? "Passed ✓" : evidence.status === "Fail" ? "Failed" : "The check errored"}</p>
          <ol className="mono flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" aria-live="polite">
            {LOG.map((l, i) => {
              const v = evidence.verdict;
              const fail = v?.reasons.some((r) => l.codes.includes(reasonBase(r)));
              const warn = v?.warnings.some((r) => l.codes.includes(reasonBase(r)));
              const label = l.key === "ai" && v?.ai_stage ? `AI: ${v.ai_stage} ${v.ai_confidence ?? "?"}%` : l.label;
              return (
                <li key={l.key} className={clsx("flex items-center gap-1", !v ? "text-muted" : fail ? "text-red" : warn ? "text-amber" : "text-orange-ink")}>
                  {i > 0 ? <span className="text-muted" aria-hidden>→</span> : null}
                  {label} {!v ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : fail ? <XCircle className="h-3.5 w-3.5" aria-label="failed" /> : warn ? <AlertTriangle className="h-3.5 w-3.5" aria-label="warning" /> : <CheckCircle2 className="h-3.5 w-3.5" aria-label="passed" />}
                </li>
              );
            })}
          </ol>
          {timedOut ? (
            <div className="space-y-2 text-sm" role="status">
              <p className="text-amber">No verdict after {formatDuration(VERDICT_POLL_TIMEOUT_MS)}. The worker may still answer; a check stuck for an hour can be reopened so you can submit a new photo.</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setPollStart(Date.now())}>Keep waiting</Button>
                {nsToMs(evidence.submitted_at) + STALE_CHECK_MS <= now ? (
                  <Button size="sm" variant="primary" onClick={() => reopenStale(evidence.milestone)}>Reopen stale check</Button>
                ) : (
                  <CountdownChip until={msToNs(nsToMs(evidence.submitted_at) + STALE_CHECK_MS)} label="can reopen in" />
                )}
              </div>
            </div>
          ) : null}
          {evidence.error ? <p className="text-sm text-red">{explainError(evidence.error).message} <span className="mono text-xs">{evidence.error}</span></p> : null}
          <p className="mono text-xs text-muted">Evidence #{evidence.id} · SHA-256 {evidence.sha256.slice(0, 16)}… committed on-chain before the check.</p>
          <div className="flex flex-wrap gap-2">
            <LinkButton href={`/proof/${s}/${evidence.id}`} variant={evidence.status === "Pass" ? "ghost" : "primary"}>Open the proof</LinkButton>
            {evidence.status === "Pass" ? <LinkButton href={`/qs/${s}/sign`} variant="primary">Review and sign →</LinkButton> : phase === "verdict" ? <Button onClick={() => { setPhase("pick"); setEvidence(null); setFile(null); setPre(null); }}>Try again</Button> : null}
          </div>
        </BracketCard>
      ) : null}
    </Page>
  );
}

/** A milestone stuck in Checking: offer reopen_stale_check once its latest evidence is an hour old. */
function StaleCheck({ estate, milestone, evidenceId, onReopen }: { estate: string; milestone: number; evidenceId: string | null; onReopen: () => Promise<void> }) {
  const now = useNow(15_000);
  const [ev, setEv] = useState<EvidenceView | null>(null);
  useEffect(() => {
    if (!evidenceId) return;
    let alive = true;
    V.getEvidence(estate, evidenceId).then((x) => alive && setEv(x)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [estate, evidenceId]);
  if (!ev) return null;
  const at = nsToMs(ev.submitted_at) + STALE_CHECK_MS;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 pl-3 text-xs text-muted">
      <span>Photo #{ev.id} submitted {formatDateTime(ev.submitted_at)} is still being checked.</span>
      {at <= now ? <Button size="sm" onClick={onReopen}>Reopen stale check (milestone {milestone + 1})</Button> : <CountdownChip until={msToNs(at)} label="can reopen in" />}
    </div>
  );
}
