"use client";

// S7 "links every number to its source": each dev_stats input for one estate, with links to the on-chain records
// behind it — proof pages per photo, the milestones page, unit pages, and NearBlocks transactions from the event cache.

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { StatusBadge } from "@/components/chain";
import { ChainLink, Collapsible, KV, explorerAccountUrl, explorerTxUrl } from "@/components/ui";
import { estateSlug } from "@/lib/estates";
import { formatDate, unitDisplay } from "@/lib/format";
import { useEvidenceList, useProposals, useUnits } from "@/lib/hooks";
import { proposalKindName } from "@/lib/estate";
import { recentEvents, supabaseConfigured, type EventRecord } from "@/lib/supabase";
import type { DevStats, EstateView, MilestoneView } from "@/lib/types";

function Chip({ href, children, external }: { href: string; children: ReactNode; external?: boolean }) {
  const cls = "mono inline-flex min-h-8 items-center gap-1 bg-surface-2 px-2 text-xs hover:text-orange-ink";
  return external ? <a className={cls} href={href} target="_blank" rel="noreferrer">{children} ↗</a> : <Link className={cls} href={href}>{children}</Link>;
}

function TxChips({ rows, label }: { rows: EventRecord[]; label: (r: EventRecord) => string }) {
  if (!rows.length) return null;
  return <>{rows.slice(0, 12).map((r) => <Chip key={`${r.tx_hash}-${r.id}`} href={explorerTxUrl(r.tx_hash)} external>{label(r)}</Chip>)}</>;
}

function Row({ k, v, children }: { k: string; v: number; children: ReactNode }) {
  return (
    <KV k={<span><span className="mono">{k}</span> <span className="text-text">= {v}</span></span>}>
      <span className="flex flex-wrap justify-end gap-1">{children}</span>
    </KV>
  );
}

export function ScoreSources({ estate, e, milestones }: { estate: string; e: EstateView; milestones: MilestoneView[] }) {
  const s = estateSlug(estate);
  const st: DevStats = e.stats;
  const units = useUnits(estate);
  const evs = useEvidenceList(estate);
  const props = useProposals(estate);
  const events = useQuery({ queryKey: ["score-events", estate], queryFn: () => recentEvents(estate, { limit: 200 }), enabled: supabaseConfigured(), retry: 0 });
  const ev = (name: string) => (events.data ?? []).filter((r) => r.event === name);
  const nowNs = BigInt(e.now || "0");
  const due = milestones.filter((m) => BigInt(m.deadline) <= nowNs);
  const signed = milestones.filter((m) => m.signed_at);
  const sold = (units.data ?? []).filter((u) => u.allocated_at || u.status === "Allocated" || u.status === "InDefault" || u.status === "HandedOver");
  const handed = (units.data ?? []).filter((u) => u.status === "HandedOver");
  const vetoes = (props.data ?? []).filter((p) => proposalKindName(p.kind) === "Veto" && p.status === "Executed");
  const passed = (evs.data ?? []).filter((x) => x.status === "Pass");
  const msHref = `/estates/${s}/milestones`;

  return (
    <div id={`sources-${s}`} className="scroll-mt-20 space-y-2">
      <p className="label">Where each number comes from</p>
      <dl>
        <Row k="milestones_due" v={st.milestones_due}>
          {due.length ? due.map((m) => <Chip key={m.index} href={msHref}>{m.title} · due {formatDate(m.deadline)}</Chip>) : <Chip href={msHref}>milestones page</Chip>}
        </Row>
        <Row k="milestones_on_time" v={st.milestones_on_time}>
          {due.filter((m) => m.status === "Approved").map((m) => <Chip key={m.index} href={msHref}>{m.title} · signed {formatDate(m.signed_at)}</Chip>)}
          <TxChips rows={ev("qs_signed")} label={(r) => `qs_signed #${Number(r.data.milestone ?? 0) + 1}`} />
          {!due.some((m) => m.status === "Approved") && !ev("qs_signed").length ? <Chip href={msHref}>milestones page</Chip> : null}
        </Row>
        <Row k="units_sold" v={st.units_sold}>
          {sold.slice(0, 16).map((u) => <Chip key={u.id} href={`/estates/${s}/units/${u.id}`}>{unitDisplay(u.id)}</Chip>)}
          <TxChips rows={ev("allocated")} label={(r) => `allocated ${unitDisplay(r.unit ?? "")}`} />
          {!sold.length ? <Chip href={`/estates/${s}`}>unit grid</Chip> : null}
        </Row>
        <Row k="units_refunded" v={st.units_refunded}>
          <TxChips rows={ev("refunded")} label={(r) => `refunded ${unitDisplay(r.unit ?? "")}`} />
          {!ev("refunded").length ? <Chip href={explorerAccountUrl(estate)} external>estate transactions</Chip> : null}
        </Row>
        <Row k="evidence_submitted" v={st.evidence_submitted}>
          {(evs.data ?? []).slice(0, 16).map((x) => <Chip key={x.id} href={`/proof/${s}/${x.id}`}>#{x.id} <StatusBadge kind="evidence" status={x.status} className="!px-1 !py-0" /></Chip>)}
          {!evs.data?.length ? <Chip href={msHref}>milestones page</Chip> : null}
        </Row>
        <Row k="evidence_passed" v={st.evidence_passed}>
          {passed.slice(0, 16).map((x) => <Chip key={x.id} href={`/proof/${s}/${x.id}`}>#{x.id} proof</Chip>)}
          <TxChips rows={ev("verdict").filter((r) => r.data.pass)} label={(r) => `verdict #${String(r.data.evidence_id ?? "")}`} />
        </Row>
        <Row k="signoffs" v={st.signoffs}>
          {signed.map((m) => <Chip key={m.index} href={msHref}>{m.title} · {formatDate(m.signed_at)}</Chip>)}
          {!signed.length ? <Chip href={msHref}>milestones page</Chip> : null}
        </Row>
        <Row k="vetoes" v={st.vetoes}>
          {vetoes.map((p) => <Chip key={p.id} href={`/estates/${s}/votes`}>proposal #{p.id}</Chip>)}
          <TxChips rows={ev("proposal_executed")} label={(r) => `executed #${String(r.data.proposal_id ?? r.data.id ?? "")}`} />
          {!vetoes.length ? <Chip href={`/estates/${s}/votes`}>votes page</Chip> : null}
        </Row>
        <Row k="units_handed_over" v={st.units_handed_over}>
          {handed.map((u) => <Chip key={u.id} href={`/estates/${s}/units/${u.id}`}>{unitDisplay(u.id)}</Chip>)}
          <TxChips rows={ev("handed_over")} label={(r) => `handed_over ${unitDisplay(r.unit ?? "")}`} />
          {!handed.length && !ev("handed_over").length ? <Chip href={`/estates/${s}`}>unit grid</Chip> : null}
        </Row>
      </dl>
      <Collapsible title="Check it yourself">
        <p>Every input is the contract&apos;s <span className="mono">dev_stats</span> view on <span className="mono">{estate}</span> <ChainLink account={estate} />. Read it with:</p>
        <pre className="mono mt-2 overflow-auto bg-bg p-2 text-xs">{`near view ${estate} dev_stats '{}'`}</pre>
        <pre className="mono mt-2 overflow-auto bg-bg p-2 text-xs">{JSON.stringify(st, null, 2)}</pre>
        {!supabaseConfigured() ? <p className="mt-2 text-xs">Transaction links need the event cache; without it, see the estate&apos;s transactions on NearBlocks.</p> : null}
      </Collapsible>
    </div>
  );
}
