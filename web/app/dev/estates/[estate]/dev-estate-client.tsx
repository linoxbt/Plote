"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { formatNear, formatUsd, msToNs, nearToYocto, nsToMs, parseUsdc, toBig, unitDisplay } from "@/lib/format";
import { usdc } from "@/lib/usdc";
import { useEstate, useNow, useUnits } from "@/lib/hooks";
import { sendTx } from "@/lib/near";
import { PloteError } from "@/lib/errors";
import type { UnitInput, UnitView } from "@/lib/types";

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
  // request/finalize_surplus_booking: the developer or the estate's recovery account.
  const canBook = !!accountId && (isDev || accountId === e.recovery_id);
  const set = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["units", account] }), qc.invalidateQueries({ queryKey: ["estate", account] })]);

  const retrySetup = async (unitId: string) => {
    const r = await run(`Retry setup of ${unitDisplay(unitId)}`, async () => {
      const res = await sendTx(E.retryUnitSetup(account, unitId));
      if (res.returnValue === false) throw new PloteError("SETUP_PENDING", "retry_unit_setup returned false", `${unitDisplay(unitId)} still isn't ready (the unit account didn't answer or USDC registration failed). Its record is kept; try again in a minute.`);
      return res;
    }, { success: `${unitDisplay(unitId)} is ready: it can take reservations and payments now.` });
    if (r) await refresh();
  };

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
    const added = new Set<string>();
    try {
      for (let i = 0; i < list.length; i += MAX_UNITS_PER_ADD) {
        const batch = list.slice(i, i + MAX_UNITS_PER_ADD);
        const r = await run(`Add ${batch.length} unit(s)`, () => sendTx(E.addUnits(account, batch)), {
          success: `Added ${batch.map((b) => unitDisplay(b.id)).join(", ")}. Each unit's account is being created and registered on USDC; a unit shows "being set up" until that finishes (retry it below if it doesn't).`,
        });
        if (!r) {
          if (added.size) setErr(`Added ${added.size} unit(s); the rest weren't. Their rows are still here to retry.`);
          return;
        }
        batch.forEach((b) => added.add(b.id));
      }
    } finally {
      // Drop the rows that were added (also after a later batch failed), so a retry doesn't re-send them (E_UNIT_EXISTS).
      if (added.size) setRows((rs) => {
        const left = rs.filter((r) => !added.has(r.id));
        return left.length ? left : [{ id: "", label: "", price: "", plan: [] }];
      });
      if (added.size) await refresh();
    }
  };

  return (
    <Page>
      <EstateBanners estate={e} account={account} />
      <EstateHeader e={e} slug={estateSlug(account)} right={<><LinkButton href={`/dev/estates/${estateSlug(account)}/releases`} variant="primary" size="sm">Claim releases</LinkButton><LinkButton href={`/gate/${estateSlug(account)}`} size="sm" prefetch={false}>Gate scanner</LinkButton></>} />
      <RequireWallet what="the developer console">
        {!isDev ? <BracketCard tone="amber" className="mb-6">You&apos;re signed in as <span className="mono">{accountId}</span>; only <span className="mono">{e.developer_id}</span> can add units.</BracketCard> : null}
        <div className="space-y-6">
          <BracketCard>
            <h2 className="mb-3 text-xl font-normal">Units</h2>
            {units.data ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-sm">
                  <thead><tr className="text-left"><th className="label">Unit</th><th className="label">Status</th><th className="label text-right">Price</th><th className="label text-right">Paid</th><th className="label text-right">Released</th><th className="label text-right">Instalments</th>{canBook ? <th className="label text-right" title="Stray USDC on units with no holder, reservation or booked escrow">Stray USDC</th> : null}</tr></thead>
                  <tbody>
                    {units.data.map((u) => {
                      const nowNs = BigInt(msToNs(now));
                      const opens = defaultOpensAt(u, e.params);
                      const overdue = opens !== null && nowNs > opens - BigInt(e.params.default_grace_ns);
                      return (
                        <tr key={u.id} className="border-t border-line">
                          <td className="py-2"><span className="mono font-normal">{unitDisplay(u.id)}</span> <span className="text-muted">{u.label}</span></td>
                          <td>
                            {u.ready ? <StatusBadge status={u.status} /> : (
                              <span className="flex flex-wrap items-center gap-2">
                                <span className="mono bg-amber/10 px-2 py-1 text-xs text-amber">BEING SET UP</span>
                                {isDev ? <Button size="sm" onClick={() => retrySetup(u.id)}>Retry setup (0.00125 NEAR)</Button> : null}
                              </span>
                            )}
                          </td>
                          <td className="text-right"><MonoAmount value={u.price} naira={false} /></td>
                          <td className="text-right"><MonoAmount value={u.paid} naira={false} account={u.account} /></td>
                          <td className="text-right"><MonoAmount value={u.released} naira={false} /></td>
                          <td className="py-2 text-right">
                            {!overdue ? <span className="mono text-xs text-muted">{u.status === "InDefault" ? "listed after default" : "on track"}</span>
                              : canDeclareDefault(u, e.params, nowNs) ? <DeclareDefaultButton estate={account} e={e} u={u} size="sm" />
                              : <CountdownChip until={opens!.toString()} label="overdue · default in" tone="amber" endedLabel="any moment now" />}
                          </td>
                          {canBook ? <td className="py-2 text-right"><SurplusCell estate={account} u={u} /></td> : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : units.error ? <ErrorState error={units.error} /> : <LoadingCard />}
          </BracketCard>

          <BracketCard className="space-y-4">
            <h2 className="text-xl font-normal">Add units</h2>
            <p className="text-sm text-muted">Each unit becomes its own account under the estate, registered on USDC. Sent in batches of {MAX_UNITS_PER_ADD}; attach 0.035 NEAR per unit (unit account funding, USDC registration and the unit record).</p>
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
              <h2 className="text-xl font-normal">Day-to-day key</h2>
              <p className="text-sm text-muted">
                Adds a function-call key to <span className="mono">{e.developer_id}</span> that can only call <span className="mono">{DEV_KEY_METHODS.join(", ")}</span> on{" "}
                <span className="mono">{account}</span> (0.25 NEAR gas allowance, can&apos;t move money). Claims then go through without a wallet popup. Proposals (such as a deadline extension) carry a 0.05 NEAR deposit, so they still open your wallet. The key stays on this device and can&apos;t be read back out of the browser where it supports that.
              </p>
              <AppKeyToggle contractId={account} role="dev" methods={DEV_KEY_METHODS} enableLabel="Add claim key" activeLabel="Claim key is on: claims sign without a popup." success="Key added. claim_release now signs from this browser." />
            </BracketCard>
          ) : null}

          <BracketCard className="space-y-3">
            <h2 className="text-xl font-normal">Verification budget</h2>
            <p>Balance: <span className="mono">{formatNear(e.verification_budget)} NEAR</span> — each photo check costs about 0.05 NEAR; submit_evidence fails with E_BUDGET below that.</p>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Top up (NEAR)" htmlFor="topup"><input id="topup" className="input w-32" inputMode="decimal" value={topup} onChange={(x) => setTopup(x.target.value)} /></Field>
              <Button onClick={async () => { const r = await run(`Fund verification ${topup} NEAR`, () => sendTx(E.fundVerification(account, nearToYocto(topup || "0")))); if (r) await qc.invalidateQueries({ queryKey: ["estate", account] }); }}>fund_verification</Button>
            </div>
            <p className="text-xs text-muted">Anyone can top up the budget.</p>
          </BracketCard>

          <BracketCard>
            <h2 className="mb-3 text-xl font-normal">Activity</h2>
            <Activity estate={account} />
          </BracketCard>
        </div>
      </RequireWallet>
    </Page>
  );
}

/** Books of a unit: what its USDC balance should be (contract `expected_balance`). */
function expectedBalance(u: Pick<UnitView, "paid" | "unattributed" | "released" | "refunded_out">): bigint {
  const v = toBig(u.paid) + toBig(u.unattributed) - toBig(u.released) - toBig(u.refunded_out);
  return v > 0n ? v : 0n;
}

/**
 * Stray USDC sitting on a unit nobody holds or reserves, with no escrow booked on it (e.g. a plain transfer outside
 * 1Click to an unsold unit), can be cleared by the developer or recovery account: request (one balance read) → 7 days →
 * finalize, which books it and sends it on in one step, like a sweep (to the last reserver within the late-claim
 * window, otherwise the recovery account). Units with a holder, a reservation or booked escrow aren't eligible.
 */
function surplusEligible(u: UnitView): boolean {
  const escrow = toBig(u.paid) - toBig(u.released) - toBig(u.refunded_out);
  return u.ready && !u.holder && !u.reservation && escrow <= 0n && toBig(u.in_flight) === 0n;
}

function SurplusCell({ estate, u }: { estate: string; u: UnitView }) {
  const { run } = useTx();
  const qc = useQueryClient();
  const now = useNow(30_000);
  const eligible = surplusEligible(u);
  const bal = useQuery({ queryKey: ["usdc-bal", u.account], queryFn: () => usdc.balanceOf(u.account), staleTime: 60_000, retry: 0, enabled: eligible });
  const req = useQuery({ queryKey: ["surplus-request", estate, u.id], queryFn: () => E.getSurplusRequest(estate, u.id), staleTime: 60_000, retry: 0, enabled: eligible });
  if (!eligible) return <span className="mono text-xs text-muted" title="Only units with no holder, no reservation and no booked escrow">—</span>;
  const surplus = bal.data ? toBig(bal.data) - expectedBalance(u) : 0n;
  const r = req.data ?? null;
  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ["surplus-request", estate, u.id] }),
    qc.invalidateQueries({ queryKey: ["usdc-bal", u.account] }),
    qc.invalidateQueries({ queryKey: ["units", estate] }),
  ]);
  if (r) {
    const ready = nsToMs(r.ready_at) <= now;
    return (
      <span className="flex flex-wrap items-center justify-end gap-2">
        <MonoAmount value={r.amount} naira={false} />
        {ready ? (
          <Button size="sm" onClick={async () => {
            const x = await run(`Clear stray USDC on ${unitDisplay(u.id)}`, () => sendTx(E.finalizeSurplusBooking(estate, u.id)), { success: "Booked and sent on in one step: to the last reserver if their reservation ended within the late-claim window, otherwise to the recovery account." });
            if (x) await refresh();
          }}>Book and send on</Button>
        ) : <CountdownChip until={r.ready_at} label="bookable in" tone="amber" />}
      </span>
    );
  }
  if (surplus <= 0n) return <span className="mono text-xs text-muted">{bal.isLoading ? "…" : "none"}</span>;
  return (
    <span className="flex flex-wrap items-center justify-end gap-2">
      <span className="mono text-xs text-amber" title="USDC on this unsold unit that no payment booked">{formatUsd(surplus.toString())}</span>
      <Button size="sm" onClick={async () => {
        const x = await run(`Request surplus booking on ${unitDisplay(u.id)}`, () => sendTx(E.requestSurplusBooking(estate, u.id)), { success: "Recorded. In 7 days, if it's still there and the unit is still unsold, it can be booked and sent on." });
        if (x) await refresh();
      }}>Start 7-day booking</Button>
    </span>
  );
}
