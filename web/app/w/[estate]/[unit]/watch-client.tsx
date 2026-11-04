"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Film, Heart, Share2 } from "lucide-react";
import { EstateBanners } from "@/components/banners";
import { MonoAmount, StatusBadge } from "@/components/chain";
import { UnitImage } from "@/components/unit-bits";
import { useTx } from "@/components/toast";
import { useWallet } from "@/components/wallet";
import { Bar, BracketCard, Button, EmptyState, ErrorState, Field, LoadingCard, Page } from "@/components/ui";
import { APP_URL } from "@/lib/config";
import { approvedCount } from "@/lib/estate";
import { estateAccount, estateSlug } from "@/lib/estates";
import { formatDate, formatUsd, parseUsdc, pct, unitDisplay } from "@/lib/format";
import { useEstate, useEvidenceList, useMilestones, useUnit } from "@/lib/hooks";
import { sendTx } from "@/lib/near";
import { chipins, supabaseConfigured } from "@/lib/supabase";
import { usdc } from "@/lib/usdc";
import type { EvidenceView } from "@/lib/types";

function chipText(ev: EvidenceView): string {
  const v = ev.verdict;
  if (!v) return ev.status === "Pending" ? "checking…" : ev.status.toLowerCase();
  const parts: string[] = [];
  if (v.distance_m != null) parts.push(`${v.distance_m} m from site`);
  if (!v.reasons.some((r) => r.startsWith("phash_reuse"))) parts.push("not reused");
  if (v.ai_stage) parts.push(`${v.ai_stage} ${v.ai_confidence ?? "?"}%`);
  return parts.join(" · ");
}

export function WatchClient({ slug, unitId, chip }: { slug: string; unitId: string; chip: boolean }) {
  const account = estateAccount(slug);
  const s = estateSlug(account);
  const est = useEstate(account);
  const unit = useUnit(account, unitId);
  const ms = useMilestones(account);
  const evs = useEvidenceList(account);
  const [copied, setCopied] = useState(false);

  if (est.isLoading || unit.isLoading) return <Page narrow><LoadingCard lines={6} /></Page>;
  if (!est.data) return <Page narrow><ErrorState error={est.error} onRetry={() => est.refetch()} /></Page>;
  if (!unit.data) return <Page narrow><ErrorState error={unit.error ?? { message: "E_UNIT_NOT_FOUND" }} /></Page>;
  const e = est.data;
  const u = unit.data;
  const built = Math.round(u.progress_bps / 100);
  const url = `${APP_URL}/w/${s}/${u.id}`;
  const text = `${unitDisplay(u.id)} at ${e.name} is ${built}% built. Every stage, with proof:`;

  return (
    <Page narrow>
      <EstateBanners estate={e} />
      <div className="grid gap-6 sm:grid-cols-[220px_1fr] sm:items-center">
        <BracketCard className="p-2"><UnitImage e={e} u={u} ms={ms.data} /></BracketCard>
        <div className="space-y-3">
          <h1 className="text-[32px] font-semibold leading-tight sm:text-[44px]">
            <span className="mono">{unitDisplay(u.id)}</span> at {e.name} is <span className="text-teal">{built}% built</span>
          </h1>
          <StatusBadge status={u.status} />
          <div className="flex flex-wrap gap-2">
            <a className="btn btn-primary" href={`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`} target="_blank" rel="noreferrer"><Share2 className="h-4 w-4" aria-hidden /> WhatsApp</a>
            <a className="btn btn-ghost corners" href={`https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`} target="_blank" rel="noreferrer">Post on X</a>
            <Button onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* blocked */ } }}>
              <Copy className="h-4 w-4" aria-hidden /> {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
        </div>
      </div>

      <BracketCard className="mt-8 space-y-4">
        <div className="space-y-1">
          <div className="flex justify-between text-sm"><span className="text-muted">Paid into the unit</span><MonoAmount value={u.paid} account={u.account} /></div>
          <Bar value={pct(u.paid, u.price)} label="Paid of price" />
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-sm"><span className="text-muted">Released to the developer on proof</span><MonoAmount value={u.released} account={e.payout_id} /></div>
          <Bar value={pct(u.released, u.price)} tone="gold" label="Released of price" />
        </div>
        <p className="mono text-xs text-muted">Price {formatUsd(u.price)} · the rest stays in the unit&apos;s own account until the next stage is proven.</p>
      </BracketCard>

      <section className="mt-8">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-2xl font-semibold">The build, stage by stage</h2>
          <Link href={`/w/${s}/${u.id}/timelapse`} className="btn btn-ghost corners btn-sm"><Film className="h-4 w-4" aria-hidden /> Timelapse</Link>
        </div>
        {!ms.data ? (ms.error ? <ErrorState error={ms.error} /> : <LoadingCard />) : (
          <ol className="space-y-4">
            {ms.data.map((m) => {
              const list = (evs.data ?? []).filter((x) => x.milestone === m.index);
              const best = list.find((x) => x.status === "Pass") ?? list[0];
              const done = m.status === "Approved" && m.veto_passed;
              return (
                <li key={m.index}>
                  <BracketCard tone={done ? "teal" : "default"} className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-xl font-semibold">{m.title}</h3>
                      <StatusBadge kind="milestone" status={m.status} />
                    </div>
                    {best ? (
                      <Link href={`/proof/${s}/${best.id}`} className="block">
                        <img src={best.url} alt={`${m.title} photo`} className="aspect-video w-full object-cover" loading="lazy" />
                        <p className="mono mt-2 text-xs text-muted">{chipText(best)} · {formatDate(best.submitted_at)} · open proof →</p>
                      </Link>
                    ) : <p className="text-sm text-muted">No photo yet · due {formatDate(m.deadline)}</p>}
                  </BracketCard>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <FamilyWall estate={account} unitAccount={u.account} unitId={u.id} open={chip} paid={u.paid} />
      <p className="mt-8 text-center text-xs text-muted">{approvedCount(ms.data)} of {ms.data?.length ?? 4} stages approved · read live from NEAR · <Link className="underline" href={`/estates/${s}/units/${u.id}`}>unit details</Link></p>
    </Page>
  );
}

function FamilyWall({ estate, unitAccount, unitId, open, paid }: { estate: string; unitAccount: string; unitId: string; open: boolean; paid: string }) {
  const q = useQuery({ queryKey: ["chipins", estate, unitId], queryFn: () => chipins(estate, unitId), enabled: supabaseConfigured(), retry: 0 });
  const [show, setShow] = useState(open);
  const family = (q.data ?? []).reduce((n, c) => n + BigInt(c.amount ?? "0"), 0n);
  return (
    <section className="mt-10 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-semibold">Family wall</h2>
        <Button variant="gold" onClick={() => setShow((x) => !x)}><Heart className="h-4 w-4" aria-hidden /> Chip in</Button>
      </div>
      {show ? <ChipInForm estate={estate} unitAccount={unitAccount} unitId={unitId} /> : null}
      {!supabaseConfigured() ? (
        <EmptyState title="Family wall offline">Names and notes are stored off-chain and that store isn&apos;t connected here. Amounts are always on the chain.</EmptyState>
      ) : q.data?.length ? (
        <>
          <p className="mono text-sm text-muted">Family contributed {formatUsd(family)} of {formatUsd(paid)} paid so far.</p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {q.data.map((c) => (
              <li key={c.id}><BracketCard className="space-y-1">
                <p className="font-medium">{c.display_name ?? "Someone"}</p>
                {c.note ? <p className="text-sm text-muted">“{c.note}”</p> : null}
                <p className="mono flex justify-between text-xs text-muted"><span>{c.amount ? formatUsd(c.amount) : "—"}</span><span>{c.created_at.slice(0, 10)}</span></p>
              </BracketCard></li>
            ))}
          </ul>
        </>
      ) : <EmptyState title="No chip-ins yet">Send this page to family: anyone can pay toward the next stage.</EmptyState>}
    </section>
  );
}

function ChipInForm({ estate, unitAccount, unitId }: { estate: string; unitAccount: string; unitId: string }) {
  const { accountId, connect } = useWallet();
  const { run } = useTx();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("50");
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setErr(null);
    let base: string;
    try { base = parseUsdc(amount); } catch (e) { return setErr((e as Error).message); }
    if (!accountId) return connect();
    const msg = JSON.stringify({ from: name.slice(0, 40), note: note.slice(0, 140) });
    const r = await run(`Chip in ${formatUsd(base)} to ${unitDisplay(unitId)}`, () => sendTx(usdc.ftTransferCall(unitAccount, base, msg)), { success: "Thank you — the money is in the unit's own account." });
    if (r) {
      try {
        await fetch("/api/chipin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ estate, unit: unitId, txHash: r.hash, sender: accountId, displayName: name, note }) });
      } catch { /* the wall is best-effort; the payment is on-chain */ }
      qc.invalidateQueries();
    }
  };
  return (
    <BracketCard tone="gold" className="space-y-3">
      <p className="text-sm text-muted">Your USDC goes straight into <span className="mono text-text">{unitAccount}</span> and counts toward the holder&apos;s payments. It can&apos;t be sent anywhere else except by the estate&apos;s rules.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Your name" htmlFor="chip-name"><input id="chip-name" className="input" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="Aunty Bisi" /></Field>
        <Field label="Amount (USDC)" htmlFor="chip-amt" error={err ?? undefined}><input id="chip-amt" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Note" htmlFor="chip-note"><input id="chip-note" className="input" maxLength={140} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For the roof!" /></Field>
      </div>
      <Button variant="gold" onClick={submit}>Send from NEAR wallet</Button>
    </BracketCard>
  );
}
