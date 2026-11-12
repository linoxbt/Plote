"use client";

import Link from "next/link";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PenLine } from "lucide-react";
import { EstateBanners } from "@/components/banners";
import { CountdownChip, StatusBadge } from "@/components/chain";
import { EvidenceThumb } from "@/components/evidence-image";
import { ProofChecklist } from "@/components/milestones";
import { SignerBadge, useSurveyorSigner } from "@/components/surveyor";
import { useTx } from "@/components/toast";
import { BracketCard, Button, EmptyState, ErrorState, LoadingCard, Page } from "@/components/ui";
import { estate as E } from "@/lib/estate";
import { estateAccount, estateSlug } from "@/lib/estates";
import { formatDateTime } from "@/lib/format";
import { useEstate, useEvidenceList, useMilestones } from "@/lib/hooks";
import { verdictSentence } from "@/lib/proof";

export function SignClient({ slug }: { slug: string }) {
  const account = estateAccount(slug);
  const s = estateSlug(account);
  const est = useEstate(account);
  const ms = useMilestones(account, { poll: 10_000 });
  const evs = useEvidenceList(account, undefined, { poll: 10_000 });
  const signer = useSurveyorSigner();
  const { run } = useTx();
  const qc = useQueryClient();
  const [checked, setChecked] = useState<Record<number, boolean>>({});

  if (est.isLoading) return <Page narrow><LoadingCard /></Page>;
  if (!est.data) return <Page narrow><ErrorState error={est.error} onRetry={() => est.refetch()} /></Page>;
  const e = est.data;
  const verified = (ms.data ?? []).filter((m) => m.status === "Verified");
  const awaitingVeto = (ms.data ?? []).filter((m) => m.status === "Approved" && !m.veto_passed);
  const allowed = e.params.playground || signer.accountId === e.surveyor_id;

  return (
    <Page narrow>
      <EstateBanners estate={e} account={account} />
      <h1 className="mb-2 text-3xl font-normal">Review and sign · {e.name}</h1>
      <div className="mb-4"><SignerBadge s={signer} /></div>
      {!signer.mode ? <BracketCard tone="amber" className="mb-4">Connect the surveyor wallet or <Link className="underline" href="/qs/setup">install a phone key</Link> first.</BracketCard> : !allowed ? <BracketCard tone="red" className="mb-4">Only {e.surveyor_id} can sign here.</BracketCard> : null}
      {!ms.data ? <LoadingCard /> : !verified.length ? (
        <EmptyState title="Nothing waiting for your signature" action={<Link className="btn btn-primary" href={`/qs/${s}/capture`}>Capture evidence</Link>}>
          A milestone appears here once its photo has passed the check.
        </EmptyState>
      ) : (
        <ul className="space-y-4">
          {verified.map((m) => {
            const ev = (evs.data ?? []).find((x) => x.milestone === m.index && x.status === "Pass");
            return (
              <li key={m.index}>
                <BracketCard tone="orange" className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-normal">{m.index + 1}. {m.title}</h2><StatusBadge kind="milestone" status={m.status} /></div>
                  {ev ? (
                    <>
                      <Link href={`/proof/${s}/${ev.id}`}><EvidenceThumb src={ev.url} alt={`${m.title} photo`} className="aspect-video w-full object-cover" width={960} height={540} sizes="(max-width: 768px) 100vw, 720px" /></Link>
                      <p className="text-sm">{verdictSentence(ev)}</p>
                      <ProofChecklist evidence={ev} geofenceRadius={e.geofence.radius_m} compact />
                    </>
                  ) : <p className="text-sm text-muted">Verified {formatDateTime(m.verified_at)}.</p>}
                  <label className="flex min-h-11 flex-wrap items-center gap-3 text-sm">
                    <input type="checkbox" className="h-5 w-5 accent-orange" checked={!!checked[m.index]} onChange={(x) => setChecked((c) => ({ ...c, [m.index]: x.target.checked }))} />
                    I inspected this site in person and the photo shows this stage.
                  </label>
                  <Button variant="primary" className="min-h-14 w-full" disabled={!checked[m.index] || !allowed || signer.locked} onClick={async () => {
                    const r = await run(`Sign ${m.title}`, () => signer.call(E.qsSign(account, m.index)), { success: "Signed. The holder veto window has started." });
                    if (r) await Promise.all([qc.invalidateQueries({ queryKey: ["milestones", account] }), qc.invalidateQueries({ queryKey: ["estate", account] }), qc.invalidateQueries({ queryKey: ["units", account] })]);
                  }}><PenLine className="h-5 w-5" aria-hidden /> Sign</Button>
                </BracketCard>
              </li>
            );
          })}
        </ul>
      )}
      {awaitingVeto.length ? (
        <section className="mt-6 space-y-2">
          <h2 className="label">Signed, in the veto window</h2>
          {awaitingVeto.map((m) => <p key={m.index} className="flex items-center gap-2 text-sm">{m.title} <CountdownChip until={m.veto_until} label="veto" /></p>)}
        </section>
      ) : null}
    </Page>
  );
}
