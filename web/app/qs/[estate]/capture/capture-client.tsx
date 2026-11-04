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
import { estate as E } from "@/lib/estate";
import { explainError } from "@/lib/errors";
import { estateAccount, estateSlug } from "@/lib/estates";
import { formatDuration, msToNs, nowMs, nsToMs } from "@/lib/format";
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
  { key: "loc", label: "location", codes: ["outside_geofence", "gps_missing"] },
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
  const fileRef = useRef<HTMLInputElement>(null);
  const now = useNow(1000);

  // poll get_evidence until the verdict lands
  useEffect(() => {
    if (phase !== "checking" || !evidence) return;
    let alive = true;
    const t = setInterval(async () => {
      try {
        const ev = await E.getEvidence(account, evidence.id);
        if (alive && ev) {
          setEvidence(ev);
          if (ev.status !== "Pending") {
            setPhase("verdict");
            qc.invalidateQueries();
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
  }, [phase, evidence, account, qc]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  if (est.isLoading) return <Page narrow><LoadingCard lines={4} /></Page>;
  if (!est.data) return <Page narrow><ErrorState error={est.error} onRetry={() => est.refetch()} /></Page>;
  const e = est.data;
  const allowed = e.params.playground || signer.accountId === e.surveyor_id;
  const openMs = (ms.data ?? []).filter((m) => m.status === "Open" || m.status === "Checking" || m.status === "Vetoed" || m.status === "Missed");
  const cap = capture.data;
  const capValid = cap && nsToMs(cap.expires_at) > now;

  const openCapture = async (m: number) => {
    setMilestone(m);
    setErr(null);
    const existing = await E.getCapture(account, m).catch(() => null);
    if (existing && nsToMs(existing.expires_at) - nowMs() > 5 * 60_000) {
      setPhase("code");
      return;
    }
    const r = await run("Open capture", () => signer.call(E.openCapture(account, m)), { success: "Challenge code issued on-chain." });
    if (r) {
      await capture.refetch();
      setPhase("code");
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
    setErr(null);
    setPhase("uploading");
    setProgress(0);
    try {
      const bytes = await file.arrayBuffer(); // original bytes — never re-encoded
      const sha = await sha256Hex(bytes);
      const nonce = timestampedNonce();
      const message = uploadMessage(account, sha);
      const signed = await signer.signNep413({ message, nonce, recipient: account });
      const contentType = file.type || "image/jpeg";
      const res = await fetch("/api/evidence/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ estate: account, contentType, size: file.size, sha256: sha, ...signed, nonce: bytesToBase64(nonce), message, recipient: account, exif: pre ? { time: pre.exifTime, gps: pre.gps } : null }),
      });
      const j = (await res.json()) as { code?: string; message?: string; signedUrl?: string; publicUrl?: string };
      if (!res.ok || !j.signedUrl || !j.publicUrl) throw Object.assign(new Error(j.message ?? "upload-url failed"), { code: j.code });
      await putWithProgress(j.signedUrl, bytes, contentType, setProgress);
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
        e.geofence.radius_m > 0
          ? { ok: dist !== null ? dist <= e.geofence.radius_m : null, text: dist !== null ? `${dist} m from site (limit ${e.geofence.radius_m} m)` : "Location unknown" }
          : { ok: true, text: "No geofence on this estate" },
      ]
    : [];

  return (
    <Page narrow>
      <EstateBanners estate={e} />
      <h1 className="mb-2 text-3xl font-semibold">Capture · {e.name}</h1>
      <div className="mb-4"><SignerBadge s={signer} /></div>
      {!signer.mode ? <BracketCard tone="amber" className="mb-4">Connect the surveyor wallet or <Link className="underline" href="/qs/setup">install a phone key</Link> first.</BracketCard> : !allowed ? (
        <BracketCard tone="red" className="mb-4">Only the estate&apos;s surveyor ({e.surveyor_id}) can capture here.</BracketCard>
      ) : null}
      {err ? <ErrorState error={err} title="That didn't work" className="mb-4" /> : null}

      {phase === "pick" ? (
        <BracketCard className="space-y-3">
          <h2 className="text-lg font-semibold">Which milestone?</h2>
          {!ms.data ? <LoadingCard lines={2} /> : !openMs.length ? <p className="text-sm text-muted">No milestone is open for evidence right now.</p> : (
            <ul className="space-y-2">
              {openMs.map((m) => (
                <li key={m.index}>
                  <button type="button" disabled={!signer.mode || !allowed || signer.locked} onClick={() => openCapture(m.index)} className="corners corners-hover flex min-h-16 w-full items-center justify-between gap-3 bg-surface-2 p-3 text-left disabled:opacity-50">
                    <span><span className="font-medium">{m.index + 1}. {m.title}</span></span>
                    <StatusBadge kind="milestone" status={m.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </BracketCard>
      ) : null}

      {phase === "code" && milestone !== null ? (
        <BracketCard tone="teal" className="space-y-5 text-center">
          {!cap ? <LoadingCard lines={1} label="Reading the challenge code" /> : (
            <>
              <p className="label">Write this on paper</p>
              <p className="mono select-all text-[56px] font-semibold leading-none tracking-[0.25em] text-teal sm:text-[88px]" aria-label={`Challenge code ${cap.code.split("").join(" ")}`}>{cap.code}</p>
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
                {c.ok === true ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-teal" aria-hidden /> : c.ok === false ? <AlertTriangle className="mt-0.5 h-4 w-4" aria-hidden /> : <CircleDashed className="mt-0.5 h-4 w-4 text-muted" aria-hidden />}
                <span><span className="sr-only">{c.ok === true ? "OK: " : c.ok === false ? "Warning: " : ""}</span>{c.text}</span>
              </li>
            ))}
          </ul>
          {e.geofence.radius_m > 0 && pre ? <div className="max-w-xs"><StaticMap center={center} radiusM={e.geofence.radius_m} pin={loc} pinLabel={dist !== null ? `${dist} m` : undefined} /></div> : null}
          <p className="text-xs text-muted">These are hints. The real checks run in secure hardware after upload.</p>
          {phase === "uploading" ? (
            <div className="space-y-1"><p className="mono text-sm">Uploading original bytes… {progress}%</p><div className="h-2 bg-surface-2"><div className="h-full bg-teal" style={{ width: `${progress}%` }} /></div></div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" className="min-h-14 flex-1" onClick={submit} disabled={!pre || !capValid}><Upload className="h-5 w-5" aria-hidden /> Upload and submit</Button>
              <Button className="min-h-14" onClick={() => { setPhase("code"); setFile(null); setPre(null); }}>Retake</Button>
            </div>
          )}
        </BracketCard>
      ) : null}

      {(phase === "checking" || phase === "verdict") && evidence ? (
        <BracketCard tone={phase === "verdict" ? (evidence.status === "Pass" ? "teal" : "red") : "amber"} className="space-y-4">
          <p className="font-display text-xl font-semibold">{phase === "checking" ? "Checking in secure hardware…" : evidence.status === "Pass" ? "Passed ✓" : evidence.status === "Fail" ? "Failed" : "The check errored"}</p>
          <ol className="mono flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" aria-live="polite">
            {LOG.map((l, i) => {
              const v = evidence.verdict;
              const fail = v?.reasons.some((r) => l.codes.includes(reasonBase(r)));
              const warn = v?.warnings.some((r) => l.codes.includes(reasonBase(r)));
              const label = l.key === "ai" && v?.ai_stage ? `AI: ${v.ai_stage} ${v.ai_confidence ?? "?"}%` : l.label;
              return (
                <li key={l.key} className={clsx("flex items-center gap-1", !v ? "text-muted" : fail ? "text-red" : warn ? "text-amber" : "text-teal")}>
                  {i > 0 ? <span className="text-muted" aria-hidden>→</span> : null}
                  {label} {!v ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : fail ? <XCircle className="h-3.5 w-3.5" aria-label="failed" /> : warn ? <AlertTriangle className="h-3.5 w-3.5" aria-label="warning" /> : <CheckCircle2 className="h-3.5 w-3.5" aria-label="passed" />}
                </li>
              );
            })}
          </ol>
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
