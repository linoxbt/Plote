"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { EstateBanners } from "@/components/banners";
import { AppKeyToggle } from "@/components/app-key";
import { CountdownChip, MonoAmount, StatusBadge } from "@/components/chain";
import { DeclareDefaultButton } from "@/components/default-resale";
import { Activity, EstateHeader } from "@/components/estate-bits";
import { useTx } from "@/components/toast";
import { RequireWallet, useWallet } from "@/components/wallet";
import { BracketCard, Button, ErrorState, Field, LinkButton, LoadingCard, Page } from "@/components/ui";
import { canDeclareDefault, defaultOpensAt } from "@/lib/default";
import { DEV_KEY_METHODS, estate as E, MAX_UNITS_PER_ADD } from "@/lib/estate";
import { estateAccount, estateSlug, UNIT_ID_RE } from "@/lib/estates";
import { formatNear, msToNs, nearToYocto, parseUsdc, unitDisplay } from "@/lib/format";
import { useEstate, useNow, useUnits } from "@/lib/hooks";
import { sendTx } from "@/lib/near";
import type { UnitInput } from "@/lib/types";

type Row = { id: string; label: string; price: string; plan: { date: string; cumulative: string }[] };

export function DevEstateClient({ slug }: { slug: string }) {
  const account = estateAccount(slug);
  const est = useEstate(account);
  const units = useUnits(account);
  const { accountId } = useWallet();
  const { run } = useTx();
  const qc = useQueryClient();
  const [rows, setRows] = useState<Row[]>([{ id: "", label: "", price: "", plan: [] }]);
  const [err, setErr] = useState<string | null>(null);
  const [topup, setTopup] = useState("5");
  const now = useNow(15_000);

  if (est.isLoading) return <Page><LoadingCard lines={5} /></Page>;
  if (!est.data) return <Page><ErrorState error={est.error} onRetry={() => est.refetch()} /></Page>;
  const e = est.data;
  const isDev = accountId === e.developer_id;
  const set = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  const submit = async () => {
    setErr(null);
    let list: UnitInput[];
    try {
      list = rows.filter((r) => r.id).map((r) => {
        if (!UNIT_ID_RE.test(r.id)) throw new Error(`${r.id}: unit IDs are lowercase letters, digits and dashes, 1–16 chars`);
        return {
          id: r.id, label: r.label || unitDisplay(r.id), price: parseUsdc(r.price),
          plan: r.plan.filter((p) => p.date && p.cumulative).map((p) => ({ due_at: msToNs(Date.parse(p.date + "T12:00:00Z")), cumulative: parseUsdc(p.cumulative) })),
        };
      });
    } catch (x) {
      return setErr((x as Error).message);
    }
    if (!list.length) return setErr("Add at least one unit");
    for (let i = 0; i < list.length; i += MAX_UNITS_PER_ADD) {
      const batch = list.slice(i, i + MAX_UNITS_PER_ADD);
      const r = await run(`Add ${batch.length} unit(s)`, () => sendTx(E.addUnits(account, batch)), { success: "Unit accounts created and registered on USDC." });
      if (!r) return;
    }
    setRows([{ id: "", label: "", price: "", plan: [] }]);
    qc.invalidateQueries();
  };

  return (
    <Page>
      <EstateBanners estate={e} />
      <EstateHeader e={e} slug={estateSlug(account)} right={<LinkButton href={`/dev/estates/${estateSlug(account)}/releases`} variant="primary" size="sm">Claim releases</LinkButton>} />
      <RequireWallet what="the developer console">
        {!isDev ? <BracketCard tone="amber" className="mb-6">You&apos;re signed in as <span className="mono">{accountId}</span>; only <span className="mono">{e.developer_id}</span> can add units.</BracketCard> : null}
        <div className="space-y-6">
          <BracketCard>
            <h2 className="mb-3 text-xl font-semibold">Units</h2>
            {units.data ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-sm">
                  <thead><tr className="text-left"><th className="label">Unit</th><th className="label">Status</th><th className="label text-right">Price</th><th className="label text-right">Paid</th><th className="label text-right">Released</th><th className="label text-right">Instalments</th></tr></thead>
                  <tbody>
                    {units.data.map((u) => {
                      const nowNs = BigInt(msToNs(now));
                      const opens = defaultOpensAt(u, e.params);
                      const overdue = opens !== null && nowNs > opens - BigInt(e.params.default_grace_ns);
                      return (
                        <tr key={u.id} className="border-t border-line">
                          <td className="py-2"><span className="mono font-semibold">{unitDisplay(u.id)}</span> <span className="text-muted">{u.label}</span></td>
                          <td><StatusBadge status={u.status} /></td>
                          <td className="text-right"><MonoAmount value={u.price} naira={false} /></td>
                          <td className="text-right"><MonoAmount value={u.paid} naira={false} account={u.account} /></td>
                          <td className="text-right"><MonoAmount value={u.released} naira={false} /></td>
                          <td className="py-2 text-right">
                            {!overdue ? <span className="mono text-xs text-muted">{u.status === "InDefault" ? "listed after default" : "on track"}</span>
                              : canDeclareDefault(u, e.params, nowNs) ? <DeclareDefaultButton estate={account} e={e} u={u} size="sm" />
                              : <CountdownChip until={opens!.toString()} label="overdue · default in" tone="amber" endedLabel="any moment now" />}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : units.error ? <ErrorState error={units.error} /> : <LoadingCard />}
          </BracketCard>

          <BracketCard className="space-y-4">
            <h2 className="text-xl font-semibold">Add units</h2>
            <p className="text-sm text-muted">Each unit becomes its own account under the estate, registered on USDC. Sent in batches of {MAX_UNITS_PER_ADD}; attach 0.03 NEAR per unit.</p>
            {rows.map((r, i) => (
              <div key={i} className="space-y-2 border-t border-line pt-3">
                <div className="grid gap-2 sm:grid-cols-[120px_1fr_140px_auto]">
                  <Field label="ID" htmlFor={`uid${i}`}><input id={`uid${i}`} className="input" value={r.id} onChange={(x) => set(i, { id: x.target.value.toLowerCase().trim() })} placeholder="a-4b" /></Field>
                  <Field label="Label" htmlFor={`ul${i}`}><input id={`ul${i}`} className="input" value={r.label} onChange={(x) => set(i, { label: x.target.value })} placeholder="Block A · 4B · 3-bed" /></Field>
                  <Field label="Price (USDC)" htmlFor={`up${i}`}><input id={`up${i}`} className="input" inputMode="decimal" value={r.price} onChange={(x) => set(i, { price: x.target.value })} placeholder="85000" /></Field>
                  <Button className="self-end" aria-label="Remove row" onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4" aria-hidden /></Button>
                </div>
                <div className="space-y-2 pl-2">
                  <p className="label">Instalment plan (cumulative total due by each date)</p>
                  {r.plan.map((p, k) => (
                    <div key={k} className="grid grid-cols-[1fr_1fr] gap-2">
                      <input aria-label="Due date" type="date" className="input" value={p.date} onChange={(x) => set(i, { plan: r.plan.map((q, j) => (j === k ? { ...q, date: x.target.value } : q)) })} />
                      <input aria-label="Cumulative USDC" className="input" inputMode="decimal" placeholder="cumulative USDC" value={p.cumulative} onChange={(x) => set(i, { plan: r.plan.map((q, j) => (j === k ? { ...q, cumulative: x.target.value } : q)) })} />
                    </div>
                  ))}
                  <Button size="sm" onClick={() => set(i, { plan: [...r.plan, { date: "", cumulative: "" }] })}><Plus className="h-4 w-4" aria-hidden /> Instalment</Button>
                </div>
              </div>
            ))}
            {err ? <p className="text-sm text-red" role="alert">{err}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setRows((r) => [...r, { id: "", label: "", price: "", plan: [] }])}><Plus className="h-4 w-4" aria-hidden /> Row</Button>
              <Button variant="primary" disabled={!isDev} onClick={submit}>add_units</Button>
            </div>
          </BracketCard>

          {isDev ? (
            <BracketCard className="space-y-3">
              <h2 className="text-xl font-semibold">Day-to-day key</h2>
              <p className="text-sm text-muted">
                Adds a function-call key to <span className="mono">{e.developer_id}</span> that can only call <span className="mono">{DEV_KEY_METHODS.join(", ")}</span> on{" "}
                <span className="mono">{account}</span> (0.25 NEAR gas allowance, can&apos;t move money). Claims and deadline-extension proposals then go through without a wallet popup. The key stays in this browser.
              </p>
              <AppKeyToggle contractId={account} role="dev" methods={DEV_KEY_METHODS} enableLabel="Add claim key" activeLabel="Claim key is on: claims and proposals sign without a popup." success="Key added. claim_release and propose now sign from this browser." />
            </BracketCard>
          ) : null}

          <BracketCard className="space-y-3">
            <h2 className="text-xl font-semibold">Verification budget</h2>
            <p>Balance: <span className="mono">{formatNear(e.verification_budget)} NEAR</span> — each photo check costs about 0.05 NEAR; submit_evidence fails with E_BUDGET below that.</p>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Top up (NEAR)" htmlFor="topup"><input id="topup" className="input w-32" inputMode="decimal" value={topup} onChange={(x) => setTopup(x.target.value)} /></Field>
              <Button onClick={async () => { const r = await run(`Fund verification ${topup} NEAR`, () => sendTx(E.fundVerification(account, nearToYocto(topup || "0")))); if (r) qc.invalidateQueries(); }}>fund_verification</Button>
            </div>
            <p className="text-xs text-muted">Anyone can top up the budget.</p>
          </BracketCard>

          <BracketCard>
            <h2 className="mb-3 text-xl font-semibold">Activity</h2>
            <Activity estate={account} />
          </BracketCard>
        </div>
      </RequireWallet>
    </Page>
  );
}
