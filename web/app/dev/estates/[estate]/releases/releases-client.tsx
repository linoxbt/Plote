"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { EstateBanners } from "@/components/banners";
import { MonoAmount, StatusBadge } from "@/components/chain";
import { EstateHeader } from "@/components/estate-bits";
import { useTx } from "@/components/toast";
import { AppKeyToggle } from "@/components/app-key";
import { RequireWallet, useWallet } from "@/components/wallet";
import { BracketCard, Button, EmptyState, ErrorState, LoadingCard, Page, explorerTxUrl } from "@/components/ui";
import { DEV_KEY_METHODS, estate as E, MAX_UNITS_PER_CLAIM } from "@/lib/estate";
import { estateAccount, estateSlug } from "@/lib/estates";
import { formatUsd, timeAgo, toBig, unitDisplay } from "@/lib/format";
import { useEstate, useUnits } from "@/lib/hooks";
import { callNoPopup, sendTx } from "@/lib/near";
import { PloteError } from "@/lib/errors";
import { recentEvents, supabaseConfigured } from "@/lib/supabase";

export function ReleasesClient({ slug }: { slug: string }) {
  const account = estateAccount(slug);
  const est = useEstate(account);
  const units = useUnits(account, { poll: 15_000 });
  const history = useQuery({ queryKey: ["release-history", account], queryFn: async () => (await recentEvents(account, { limit: 100 })).filter((r) => r.event === "released"), enabled: supabaseConfigured(), retry: 0 });
  const { run } = useTx();
  const { accountId } = useWallet();
  const qc = useQueryClient();
  const [sel, setSel] = useState<Set<string>>(new Set());
  if (est.isLoading) return <Page><LoadingCard lines={5} /></Page>;
  if (!est.data) return <Page><ErrorState error={est.error} onRetry={() => est.refetch()} /></Page>;
  const e = est.data;
  const list = (units.data ?? []).filter((u) => toBig(u.paid) > 0n);
  const claimable = list.filter((u) => toBig(u.releasable_now) > 0n);
  const total = claimable.filter((u) => sel.has(u.id)).reduce((n, u) => n + toBig(u.releasable_now), 0n);
  const claim = async () => {
    const ids = [...sel];
    const to = e.payout_redirect ?? e.payout_id;
    for (let i = 0; i < ids.length; i += MAX_UNITS_PER_CLAIM) {
      const chunk = ids.slice(i, i + MAX_UNITS_PER_CLAIM);
      const r = await run(`Claim ${chunk.length} unit(s)`, async () => {
        const res = accountId ? await callNoPopup(accountId, E.claimRelease(account, chunk)) : await sendTx(E.claimRelease(account, chunk));
        // claim_release returns how many transfers it started; 0 means nothing was releasable after all.
        const started = typeof res.returnValue === "number" ? res.returnValue : Number(res.returnValue ?? NaN);
        if (started === 0) throw new PloteError("NOTHING_RELEASED", "claim_release started 0 transfers", "Nothing was released: none of these units had money releasable at that moment (a veto window may still be open, or a transfer is already settling).");
        return res;
      }, { success: `Transfers started to ${to}. They land in a few seconds.` });
      if (!r) break;
    }
    setSel(new Set());
    await Promise.all([qc.invalidateQueries({ queryKey: ["units", account] }), qc.invalidateQueries({ queryKey: ["estate", account] }), qc.invalidateQueries({ queryKey: ["release-history", account] })]);
  };
  return (
    <Page>
      <EstateBanners estate={e} account={account} />
      <EstateHeader e={e} slug={estateSlug(account)} />
      <RequireWallet what="claiming releases">
        <BracketCard className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-normal">Releases</h2>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => setSel(new Set(claimable.map((u) => u.id)))}>Select all claimable</Button>
              <Button variant="primary" disabled={!sel.size || !!e.frozen || e.refunds_open} onClick={claim}>claim_release {sel.size ? `· ${formatUsd(total)}` : ""}</Button>
            </div>
          </div>
          <p className="text-sm text-muted">Anyone can call claim_release; funds always go to <span className="mono">{e.payout_redirect ?? e.payout_id}</span>. Only milestones whose veto window has passed count. {e.frozen ? <span className="text-red">Releases are frozen.</span> : e.refunds_open ? <span className="text-red">Refunds are open (a deadline was missed), so nothing is released until holders vote to extend it.</span> : null}</p>
          {accountId === e.developer_id ? <AppKeyToggle contractId={account} role="dev" methods={DEV_KEY_METHODS} enableLabel="Add claim key (no popup per claim)" activeLabel="Claim key is on: claims sign without a popup." success="Key added. claim_release now signs from this browser." /> : null}
          {units.error ? <ErrorState error={units.error} /> : !units.data ? <LoadingCard /> : !list.length ? <EmptyState title="No paid units yet" /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead><tr className="text-left"><th className="w-10"><span className="sr-only">Select</span></th><th className="label">Unit</th><th className="label text-right">Paid</th><th className="label text-right">Approved</th><th className="label text-right">Released</th><th className="label text-right">Releasable now</th></tr></thead>
                <tbody>
                  {list.map((u) => {
                    const can = toBig(u.releasable_now) > 0n;
                    return (
                      <tr key={u.id} className="border-t border-line">
                        <td><input type="checkbox" className="h-5 w-5 accent-orange" disabled={!can} checked={sel.has(u.id)} aria-label={`Select ${unitDisplay(u.id)}`} onChange={(x) => setSel((s) => { const n = new Set(s); if (x.target.checked) n.add(u.id); else n.delete(u.id); return n; })} /></td>
                        <td className="py-2"><span className="mono font-normal">{unitDisplay(u.id)}</span> <StatusBadge status={u.status} /></td>
                        <td className="text-right"><MonoAmount value={u.paid} naira={false} account={u.account} /></td>
                        <td className="mono text-right">{u.approved_bps / 100}%</td>
                        <td className="text-right"><MonoAmount value={u.released} naira={false} /></td>
                        <td className="text-right"><MonoAmount value={u.releasable_now} naira={false} className={can ? "text-orange" : ""} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </BracketCard>
        <BracketCard className="mt-6">
          <h2 className="mb-3 text-xl font-normal">History</h2>
          {!supabaseConfigured() ? <p className="text-sm text-muted">The event cache isn&apos;t connected; see the payout account on NearBlocks. Released to date: <MonoAmount value={e.totals.released} account={e.payout_id} /></p> : history.data?.length ? (
            <ul className="divide-y divide-line text-sm">{history.data.map((h) => <li key={h.id} className="flex justify-between py-2"><span className="mono">{String(h.data.unit_id ?? "").toUpperCase()} · {formatUsd(String(h.data.amount ?? "0"))} → {String(h.data.to ?? "")}</span><a className="mono text-xs text-muted hover:text-orange" href={explorerTxUrl(h.tx_hash)} target="_blank" rel="noreferrer">{timeAgo(String(Date.parse(h.block_time) * 1e6))} ↗</a></li>)}</ul>
          ) : <p className="text-sm text-muted">No releases yet.</p>}
        </BracketCard>
      </RequireWallet>
    </Page>
  );
}
