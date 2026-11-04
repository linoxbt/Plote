"use client";

import Link from "next/link";
import { Camera, KeyRound, PenLine } from "lucide-react";
import { StatusBadge } from "@/components/chain";
import { SignerBadge, useSurveyorSigner } from "@/components/surveyor";
import { useWallet } from "@/components/wallet";
import { BracketCard, Button, EmptyState, LinkButton, LoadingCard } from "@/components/ui";
import { currentMilestone } from "@/lib/estate";
import { estateSlug } from "@/lib/estates";
import { formatDate } from "@/lib/format";
import { useAllEstates, useAllMilestones } from "@/lib/hooks";

export function QsHomeClient() {
  const signer = useSurveyorSigner();
  const { connect } = useWallet();
  const all = useAllEstates();
  const ms = useAllMilestones();
  const loading = all.some((x) => x.q.isLoading);
  const mine = all.filter((x) => x.q.data && (x.q.data.params.playground || (signer.accountId && x.q.data.surveyor_id === signer.accountId)));
  return (
    <div className="space-y-4">
      {signer.mode ? <SignerBadge s={signer} /> : (
        <BracketCard className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm">Connect the surveyor wallet, or install a phone key so this device can sign without gas.</p>
          <div className="flex gap-2"><Button variant="primary" onClick={connect}>Connect wallet</Button><LinkButton href="/qs/setup"><KeyRound className="h-4 w-4" aria-hidden /> Phone key</LinkButton></div>
        </BracketCard>
      )}
      {loading ? <LoadingCard lines={3} /> : !mine.length ? (
        <EmptyState title="No estates to survey">Your account isn&apos;t the surveyor of any estate here. The Playground estate lets any wallet try the flow.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {mine.map(({ account, q }) => {
            const e = q.data!;
            const list = ms.find((m) => m.account === account)?.q.data;
            const cur = currentMilestone(list);
            const toSign = (list ?? []).filter((m) => m.status === "Verified");
            const s = estateSlug(account);
            return (
              <li key={account}>
                <BracketCard className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-xl font-semibold">{e.name}</h2>
                    {e.params.playground ? <span className="mono bg-amber/10 px-2 py-1 text-xs text-amber">PLAYGROUND</span> : null}
                  </div>
                  {cur ? (
                    <p className="flex flex-wrap items-center gap-2 text-sm">Next: <strong>{cur.title}</strong> <StatusBadge kind="milestone" status={cur.status} /> <span className="mono text-muted">due {formatDate(cur.deadline)}</span></p>
                  ) : <p className="text-sm text-gold">All milestones approved.</p>}
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/qs/${s}/capture`} className="btn btn-primary min-h-14 flex-1 text-base"><Camera className="h-5 w-5" aria-hidden /> Capture</Link>
                    <Link href={`/qs/${s}/sign`} className="btn btn-ghost corners min-h-14 flex-1 text-base"><PenLine className="h-5 w-5" aria-hidden /> Sign {toSign.length ? `(${toSign.length})` : ""}</Link>
                  </div>
                </BracketCard>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
