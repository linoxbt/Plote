"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Pause, Play } from "lucide-react";
import { Button, EmptyState, ErrorState, LoadingCard, Page } from "@/components/ui";
import { estateAccount, estateSlug } from "@/lib/estates";
import { formatDate, unitDisplay } from "@/lib/format";
import { useEstate, useEvidenceList, useMilestones } from "@/lib/hooks";

/** C6: plays every passed milestone photo in order, CSS crossfade. */
export function TimelapseClient({ slug, unitId }: { slug: string; unitId: string }) {
  const account = estateAccount(slug);
  const est = useEstate(account);
  const ms = useMilestones(account);
  const evs = useEvidenceList(account);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  const frames = (evs.data ?? []).filter((e) => e.status === "Pass").sort((a, b) => a.milestone - b.milestone || Number(BigInt(a.id) - BigInt(b.id)));
  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % frames.length), 2500);
    return () => clearInterval(t);
  }, [playing, frames.length]);
  if (est.isLoading || evs.isLoading) return <Page narrow><LoadingCard /></Page>;
  if (evs.error) return <Page narrow><ErrorState error={evs.error} onRetry={() => evs.refetch()} /></Page>;
  const cur = frames[i % Math.max(1, frames.length)];
  return (
    <Page narrow>
      <h1 className="mb-4 text-3xl font-semibold"><span className="mono">{unitDisplay(unitId)}</span> at {est.data?.name ?? slug}: the build</h1>
      {!frames.length ? <EmptyState title="No passed photos yet">The timelapse fills in as each stage&apos;s photo passes the check.</EmptyState> : (
        <div className="space-y-3">
          <div className="corners corners-teal relative aspect-video overflow-hidden bg-surface-2">
            {frames.map((f, k) => (
              <img key={f.id} src={f.url} alt={`${ms.data?.[f.milestone]?.title ?? "Stage"} photo`} className="fade-frame absolute inset-0 h-full w-full object-cover" style={{ opacity: k === i ? 1 : 0 }} aria-hidden={k !== i} />
            ))}
            <div className="mono absolute bottom-0 left-0 bg-bg/80 px-2 py-1 text-sm" aria-live="polite">
              {ms.data?.[cur.milestone]?.title ?? `Milestone ${cur.milestone + 1}`} · {formatDate(cur.submitted_at)}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}{playing ? "Pause" : "Play"}</Button>
            <span className="mono text-sm text-muted">{i + 1} / {frames.length}</span>
          </div>
        </div>
      )}
      <Link href={`/w/${estateSlug(account)}/${unitId}`} className="mt-6 inline-flex min-h-11 items-center underline">← Back to the watch page</Link>
    </Page>
  );
}
