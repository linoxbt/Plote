"use client";

import Link from "next/link";
import { useQueries } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { MonoAmount } from "@/components/chain";
import { DevScoreChip } from "@/components/estate-bits";
import { RequireWallet, useWallet } from "@/components/wallet";
import { BracketCard, EmptyState, LinkButton, LoadingCard } from "@/components/ui";
import { currentMilestone, estate as E } from "@/lib/estate";
import { estateSlug } from "@/lib/estates";
import { formatNear, nsToMs, toBig } from "@/lib/format";
import { useAllMilestones, useNow, useRoles } from "@/lib/hooks";

const DAY = 86_400_000;

export function DevHomeClient() {
  const { accountId } = useWallet();
  const now = useNow(60_000);
  const roles = useRoles(accountId);
  const ms = useAllMilestones(roles.developerOf);
  const units = useQueries({ queries: roles.developerOf.map((e) => ({ queryKey: ["units", e], queryFn: () => E.listUnits(e, 0, 100), retry: 1 })) });
  return (
    <RequireWallet what="the developer console">
      {roles.loading ? <LoadingCard lines={4} /> : !roles.developerOf.length ? (
        <EmptyState title="You're not the developer of any estate here" action={<LinkButton href="/dev/estates/new" variant="primary"><Plus className="h-4 w-4" aria-hidden /> Put your estate on Plote</LinkButton>}>
          Signed in as <span className="mono">{accountId}</span>. Estates list their developer on-chain; this console unlocks for that account.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          <div className="flex justify-end"><LinkButton href="/dev/estates/new" size="sm"><Plus className="h-4 w-4" aria-hidden /> New estate</LinkButton></div>
          <ul className="grid gap-4 md:grid-cols-2">
            {roles.developerOf.map((acc, i) => {
              const e = roles.all.find((x) => x.account === acc)!.q.data!;
              const list = units[i]?.data ?? [];
              const releasable = list.reduce((n, u) => n + toBig(u.releasable_now), 0n);
              const cur = currentMilestone(ms[i]?.q.data);
              const risk = cur && nsToMs(cur.deadline) - now < 14 * DAY ? list.filter((u) => u.holder).length : 0;
              const s = estateSlug(acc);
              return (
                <li key={acc}>
                  <BracketCard className="space-y-3">
                    <div className="flex items-center justify-between gap-2"><Link href={`/dev/estates/${s}`} className="text-xl font-normal hover:text-orange">{e.name}</Link><DevScoreChip e={e} /></div>
                    <dl className="grid grid-cols-2 gap-3 text-sm">
                      <div><dt className="label">In escrow</dt><dd><MonoAmount value={e.totals.in_escrow} account={acc} naira={false} /></dd></div>
                      <div><dt className="label">Releasable now</dt><dd><MonoAmount value={units[i]?.data ? releasable.toString() : null} account={acc} naira={false} /></dd></div>
                      <div><dt className="label">Refund risk</dt><dd className={risk ? "mono text-amber" : "mono"}>{risk ? `${risk} units · ${cur?.title} due soon` : "none"}</dd></div>
                      <div><dt className="label">Verification budget</dt><dd className={toBig(e.verification_budget) < 50_000_000_000_000_000_000_000n ? "mono text-red" : "mono"}>{formatNear(e.verification_budget)} NEAR</dd></div>
                    </dl>
                    <div className="flex flex-wrap gap-2">
                      <LinkButton size="sm" href={`/dev/estates/${s}/releases`} variant="primary">Claim releases</LinkButton>
                      <LinkButton size="sm" href={`/dev/estates/${s}`}>Units & budget</LinkButton>
                      <LinkButton size="sm" href={`/estates/${s}`}>Public page</LinkButton>
                    </div>
                  </BracketCard>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </RequireWallet>
  );
}
