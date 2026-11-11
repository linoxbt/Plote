"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { clsx } from "clsx";
import { EstateBanners } from "@/components/banners";
import { AccountChip, StatusBadge } from "@/components/chain";
import { ProofChecklist } from "@/components/milestones";
import { StaticMap } from "@/components/static-map";
import { BracketCard, ChainLink, Collapsible, ErrorState, KV, LoadingCard, Page, explorerTxUrl } from "@/components/ui";
import { NEAR_AI_URL } from "@/lib/config";
import { estateAccount, estateSlug } from "@/lib/estates";
import { formatDateTime, formatDuration, nsToMs, shortHash } from "@/lib/format";
import { hamming } from "@/lib/geo";
import { useEstate, useEvidence, useEvidenceList, useMilestones } from "@/lib/hooks";
import { reasonText, verdictSentence } from "@/lib/proof";
import { recentEvents, supabaseConfigured } from "@/lib/supabase";

export function ProofClient({ slug, id }: { slug: string; id: string }) {
  const account = estateAccount(slug);
  const est = useEstate(account);
  // Poll only while the check is still running; Pass / Fail / Error are final, so stop there.
  const evq = useEvidence(account, id, { poll: (d) => (d && d.status !== "Pending" ? false : 5000) });
  const all = useEvidenceList(account);
  const ms = useMilestones(account);
  const ev = evq.data;
  const txs = useQuery({
    queryKey: ["proof-txs", account, id],
    enabled: supabaseConfigured() && !!ev,
    retry: 0,
    queryFn: async () => {
      const rows = await recentEvents(account, { limit: 200 });
      const find = (name: string, pred: (d: Record<string, unknown>) => boolean) => rows.find((r) => r.event === name && pred(r.data))?.tx_hash ?? null;
      return {
        submit: find("evidence_submitted", (d) => String(d.evidence_id) === id),
        verdict: find("verdict", (d) => String(d.evidence_id) === id),
        sign: ev ? find("qs_signed", (d) => Number(d.milestone) === ev.milestone) : null,
      };
    },
  });

  if (est.isLoading || evq.isLoading) return <Page><LoadingCard lines={8} /></Page>;
  if (!est.data) return <Page><ErrorState error={est.error} onRetry={() => est.refetch()} /></Page>;
  if (evq.error) return <Page><ErrorState error={evq.error} onRetry={() => evq.refetch()} /></Page>;
  const e = est.data;
  if (!ev) return <Page narrow><ErrorState error={{ message: "VIEW_FAILED" }} title={`There is no evidence #${id} on ${e.name}`} /></Page>;
  const v = ev.verdict;
  const m = ms.data?.[ev.milestone];
  const pass = ev.status === "Pass";

  // nearest previous photo by pHash (thumbnail side by side when < 16)
  const prior = (all.data ?? []).filter((x) => x.id !== ev.id && x.verdict?.phash && BigInt(x.id) < BigInt(ev.id));
  const nearest = v?.phash ? prior.map((x) => ({ x, d: hamming(v.phash, x.verdict!.phash) })).sort((a, b) => a.d - b.d)[0] : undefined;
  const gps = v?.gps ? ([v.gps[0] / 1e6, v.gps[1] / 1e6] as [number, number]) : ev.device_gps ? ([ev.device_gps[0] / 1e6, ev.device_gps[1] / 1e6] as [number, number]) : null;
  const center: [number, number] = [e.geofence.lat_e6 / 1e6, e.geofence.lon_e6 / 1e6];
  const exifMs = v?.exif_time ? nsToMs(v.exif_time) : null;
  const subMs = nsToMs(ev.submitted_at);
  // The model that judged the stage, as the worker recorded it; with no record we don't guess (and hide the links).
  const aiModel = v?.ai_model?.trim() || null;
  // The model's own notes (SPEC 6.4 "observations"), stored with the verdict (INTERFACE `Verdict.ai_observations`).
  const notes = (v?.ai_observations ?? []).filter((o) => o.trim() !== "");

  return (
    <Page>
      <EstateBanners estate={e} />
      <nav className="mono mb-4 text-xs text-muted" aria-label="Breadcrumb">
        <Link href={`/estates/${estateSlug(account)}`} className="hover:text-text">{e.name}</Link> / <Link href={`/estates/${estateSlug(account)}/milestones`} className="hover:text-text">milestones</Link> / proof #{ev.id}
      </nav>
      <header className="mb-6 space-y-3">
        <p className="mono text-xs tracking-[0.12em] text-orange">PROOF #{ev.id} · {m ? m.title.toUpperCase() : `MILESTONE ${ev.milestone + 1}`}</p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className={clsx("text-3xl font-normal sm:text-[40px]", pass ? "text-orange" : ev.status === "Pending" ? "text-amber" : "text-red")}>
            {pass ? "Passed" : ev.status === "Pending" ? "Checking…" : ev.status === "Fail" ? "Failed" : "Check error"}
          </h1>
          <StatusBadge kind="evidence" status={ev.status} />
          {v?.source === "https" ? <span className="mono bg-amber/10 px-2 py-1 text-xs text-amber">VERDICT VIA HTTPS RELAY</span> : null}
        </div>
        <p className="max-w-3xl text-lg">{verdictSentence(ev)}</p>
      </header>

      {/* min-w-0 on both columns: long hashes, account chips and mono values wrap or truncate instead of widening the track (390px overflow). */}
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="min-w-0 space-y-6">
          <figure className={clsx("corners p-2", pass ? "corners-orange" : ev.status === "Pending" ? "corners-amber" : "corners-red")}>
            <img src={ev.url} alt={`Site photo for ${m?.title ?? "the milestone"}`} className="w-full bg-surface-2 object-contain" />
            <figcaption className="mono mt-2 break-all text-xs text-muted">
              SHA-256 {ev.sha256} {v && !v.reasons.includes("hash_mismatch") ? <span className="text-orange">· hash matches on-chain commitment ✓</span> : null}
            </figcaption>
          </figure>

          {v?.warnings.length ? (
            <BracketCard tone="amber" className="space-y-2">
              <p className="flex items-center gap-2 font-medium text-amber"><AlertTriangle className="h-4 w-4" aria-hidden /> Warnings ({e.params.playground ? "Playground" : "demo mode"})</p>
              <ul className="list-disc pl-5 text-sm text-amber">{v.warnings.map((w) => <li key={w}>{reasonText(w)} <span className="mono text-xs">({w})</span></li>)}</ul>
            </BracketCard>
          ) : null}
          {ev.status === "Error" && ev.error ? (
            <BracketCard tone="red" className="space-y-2">
              <p className="flex items-center gap-2 font-medium text-red"><XCircle className="h-4 w-4" aria-hidden /> The check didn&apos;t produce a verdict</p>
              <p className="text-sm">{ev.error}. The milestone is open again, so the surveyor can submit a new photo.</p>
            </BracketCard>
          ) : null}
          {v && !v.pass ? (
            <BracketCard tone="red" className="space-y-2">
              <p className="flex items-center gap-2 font-medium text-red"><XCircle className="h-4 w-4" aria-hidden /> Why it failed</p>
              <ul className="list-disc pl-5 text-sm">{v.reasons.map((r) => <li key={r}>{reasonText(r)} <span className="mono text-xs text-muted">({r})</span></li>)}</ul>
            </BracketCard>
          ) : null}

          <BracketCard>
            <h2 className="mb-3 text-lg font-normal">Nearest previous photo</h2>
            {nearest ? (
              <div className="space-y-3">
                <p className="mono break-words text-sm">Hamming distance {nearest.d}/64 <span className="text-muted">(reuse if ≤ {e.params.max_phash_distance})</span>{v ? <span className="text-muted"> · on-chain nearest {v.nearest_distance}/64</span> : null}</p>
                {nearest.d < 16 ? (
                  <div className="grid grid-cols-2 gap-2">
                    <img src={ev.url} alt="This photo" className="aspect-[4/3] w-full object-cover" />
                    <Link href={`/proof/${estateSlug(account)}/${nearest.x.id}`}><img src={nearest.x.url} alt={`Previous photo #${nearest.x.id}`} className="aspect-[4/3] w-full object-cover" /></Link>
                  </div>
                ) : <p className="text-sm text-muted">Not similar to any earlier photo (#{nearest.x.id} is the closest).</p>}
              </div>
            ) : <p className="text-sm text-muted">{v ? `No earlier photos to compare in this estate (on-chain nearest distance ${v.nearest_distance}/64).` : "Waiting for the verdict."}</p>}
          </BracketCard>
        </div>

        <div className="min-w-0 space-y-6">
          <BracketCard>
            <h2 className="mb-3 text-lg font-normal">Checks</h2>
            <ProofChecklist evidence={ev} geofenceRadius={e.geofence.radius_m} />
          </BracketCard>

          <BracketCard className="space-y-3">
            <h2 className="text-lg font-normal">Challenge code</h2>
            <div className="grid grid-cols-2 gap-3">
              <div><p className="label">Issued on-chain</p><p className="mono text-2xl tracking-[0.2em]">{ev.challenge}</p></div>
              <div><p className="label">Read by the model</p><p className={clsx("mono text-2xl tracking-[0.2em]", v?.challenge_read ? (v.reasons.some((r) => r.startsWith("challenge")) ? "text-red" : "text-orange") : "text-muted")}>{v?.challenge_read ?? "—"}</p></div>
            </div>
            <p className="mono text-xs text-muted">Capture opened {formatDateTime(ev.challenge_opened_at)}</p>
          </BracketCard>

          <BracketCard className="space-y-3">
            <h2 className="text-lg font-normal">Location</h2>
            {e.geofence.radius_m > 0 || gps ? (
              <StaticMap center={gps && e.geofence.radius_m === 0 ? gps : center} radiusM={e.geofence.radius_m} pin={gps} pinLabel={v?.distance_m != null ? `${v.distance_m} m` : undefined} />
            ) : null}
            <dl>
              <KV k="Distance from site">{v?.distance_m != null ? `${v.distance_m} m` : "—"}</KV>
              <KV k="Geofence radius">{e.geofence.radius_m ? `${e.geofence.radius_m} m` : "none (Playground)"}</KV>
              <KV k="GPS source">{v?.gps_source === "device" ? <span className="text-amber">phone GPS (lower trust)</span> : v?.gps_source === "exif" ? "photo EXIF" : "—"}</KV>
            </dl>
          </BracketCard>

          <BracketCard>
            <h2 className="mb-2 text-lg font-normal">Time</h2>
            <dl>
              <KV k="EXIF capture time">{v?.exif_time ? formatDateTime(v.exif_time) : "—"}</KV>
              <KV k="Submitted">{formatDateTime(ev.submitted_at)}</KV>
              <KV k="Gap">{exifMs ? formatDuration(subMs - exifMs) : "—"}</KV>
              <KV k="Submitted by"><AccountChip account={ev.submitted_by} /></KV>
            </dl>
          </BracketCard>

          <BracketCard className="space-y-2">
            <h2 className="text-lg font-normal">AI stage check</h2>
            <dl>
              <KV k="Stage">{v?.ai_stage ?? "—"}</KV>
              <KV k="Confidence">{v?.ai_confidence != null ? `${v.ai_confidence}% (min ${e.params.min_ai_confidence}%)` : "—"}</KV>
              <KV k="Claimed milestone">{m?.key ?? ev.milestone}</KV>
            </dl>
            {notes.length ? (
              <div>
                <p className="label">What the model saw</p>
                <ul className="list-disc pl-5 text-sm">{notes.map((o, i) => <li key={i}>{o}</li>)}</ul>
              </div>
            ) : v ? <p className="text-xs text-muted">The model recorded no observations for this photo.</p> : null}
            {aiModel ? <dl><KV k="Model">{aiModel}</KV></dl> : null}
            {v?.ai_chat_id && aiModel ? (
              <p className="text-sm">
                <a className="underline hover:text-orange" href={`${NEAR_AI_URL}/signature/${encodeURIComponent(v.ai_chat_id)}?model=${encodeURIComponent(aiModel)}&signing_algo=ecdsa`} target="_blank" rel="noreferrer">NEAR AI signature ↗</a>{" · "}
                <a className="underline hover:text-orange" href={`${NEAR_AI_URL}/attestation/report?model=${encodeURIComponent(aiModel)}`} target="_blank" rel="noreferrer">model attestation ↗</a>
              </p>
            ) : v?.ai_chat_id ? (
              <p className="break-all text-xs text-muted">NEAR AI chat <span className="mono">{v.ai_chat_id}</span>. This verdict doesn&apos;t record which model answered, so the signature and attestation links aren&apos;t shown.</p>
            ) : <p className="text-xs text-muted">The NEAR AI signature link appears when the worker records a NEAR AI chat id and model.</p>}
          </BracketCard>
        </div>
      </div>

      <div className="mt-6">
        <Collapsible title="How to verify this yourself">
          <dl>
            <KV k="Worker repo">{e.verifier.repo ? (e.verifier.repo.startsWith("project:") ? <span className="mono">OutLayer project {e.verifier.repo.slice(8)}</span> : <a className="underline" href={e.verifier.repo} target="_blank" rel="noreferrer">{e.verifier.repo} ↗</a>) : "—"}</KV>
            <KV k="Worker commit (estate)">{e.verifier.repo ? <a className="underline" href={`${e.verifier.repo.replace(/\/$/, "")}/tree/${e.verifier.commit}`} target="_blank" rel="noreferrer">{shortHash(e.verifier.commit, 8)} ↗</a> : shortHash(e.verifier.commit, 8)}</KV>
            <KV k="Worker commit (verdict)">{v ? shortHash(v.worker_commit, 8) : "—"} {v && v.worker_commit !== e.verifier.commit ? <span className="text-amber">differs</span> : v ? <CheckCircle2 className="inline h-3.5 w-3.5 text-orange" aria-label="matches" /> : null}</KV>
            <KV k="Build target">{e.verifier.build_target}</KV>
            <KV k="OutLayer execution / attestation">{v?.attestation ?? "—"}</KV>
            <KV k="Verdict source">{v?.source ?? "—"}</KV>
            <KV k="Raw response hash">{ev.raw_response_hash ?? "—"}</KV>
            <KV k="OutLayer contract"><span>{e.outlayer_id} <ChainLink account={e.outlayer_id} /></span></KV>
            <KV k="submit_evidence tx">{txs.data?.submit ? <a className="underline" href={explorerTxUrl(txs.data.submit)} target="_blank" rel="noreferrer">{shortHash(txs.data.submit)} ↗</a> : <span>see estate history <ChainLink account={account} /></span>}</KV>
            <KV k="verdict tx">{txs.data?.verdict ? <a className="underline" href={explorerTxUrl(txs.data.verdict)} target="_blank" rel="noreferrer">{shortHash(txs.data.verdict)} ↗</a> : "—"}</KV>
            <KV k="QS sign tx">{txs.data?.sign ? <a className="underline" href={explorerTxUrl(txs.data.sign)} target="_blank" rel="noreferrer">{shortHash(txs.data.sign)} ↗</a> : m?.signed_at ? `signed ${formatDateTime(m.signed_at)}` : "not signed yet"}</KV>
          </dl>
          <ol className="mt-4 list-decimal space-y-1 pl-5">
            <li>Download the photo and run <span className="mono">sha256sum</span>; it must equal the SHA-256 above, which the contract stored before the check ran.</li>
            <li>Open the worker repo at the commit above; OutLayer built that exact source inside an Intel TDX enclave.</li>
            <li>Call <span className="mono">get_evidence {`{"id":"${ev.id}"}`}</span> on <span className="mono">{account}</span> to read this verdict straight from the chain.</li>
          </ol>
        </Collapsible>
      </div>
    </Page>
  );
}
