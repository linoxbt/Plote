"use client";

// TanStack Query hooks over the typed chain clients. Every view failure becomes a query error the page
// renders as an ErrorState / "—"; nothing here throws into React.

import { useQuery, useQueries, type UseQueryOptions } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ESTATES } from "./config";
import { checkedViews as V, estate as E } from "./estate";
import { isGenuineEstate } from "./genuine";
import { getFxRate } from "./format";
import { usdc } from "./usdc";
import type { CaptureView, EstateView, EvidenceView, MilestoneView, NftToken, PendingLien, ProposalView, UnitView } from "./types";

/** `poll` may be a function of the latest data, so a page can stop polling once what it waits for is final. */
type Opts<T = unknown> = { poll?: number | false | ((data: T | undefined) => number | false); enabled?: boolean };

function base<T>(key: unknown[], fn: () => Promise<T>, o: Opts<T> = {}): UseQueryOptions<T, Error, T, unknown[]> {
  const poll = o.poll;
  return {
    queryKey: key,
    queryFn: fn,
    retry: 1,
    staleTime: 5000,
    refetchInterval: typeof poll === "function" ? (q) => poll(q.state.data) : (poll ?? false),
    enabled: o.enabled ?? true,
  };
}

const UNITS_PAGE = 100;
const UNITS_MAX_PAGES = 50; // 5,000 units: far beyond any estate, but a hard stop if a node misbehaves

/** Every unit of an estate: `list_units` pages of 100 until a short page. */
export async function listAllUnits(e: string): Promise<UnitView[]> {
  const out: UnitView[] = [];
  for (let page = 0; page < UNITS_MAX_PAGES; page++) {
    const batch = (await V.listUnits(e, page * UNITS_PAGE, UNITS_PAGE)) ?? [];
    out.push(...batch);
    if (batch.length < UNITS_PAGE) break;
  }
  return out;
}

export const useEstate = (e: string, o?: Opts<EstateView>) => useQuery(base<EstateView>(["estate", e], () => V.getEstate(e), o));
export const useUnits = (e: string, o?: Opts<UnitView[]>) => useQuery(base<UnitView[]>(["units", e], () => listAllUnits(e), o));
export const useUnit = (e: string, id: string, o?: Opts<UnitView | null>) => useQuery(base<UnitView | null>(["unit", e, id], () => V.getUnit(e, id), o));
export const useMilestones = (e: string, o?: Opts<MilestoneView[]>) => useQuery(base<MilestoneView[]>(["milestones", e], () => V.getMilestones(e), o));
export const useEvidence = (e: string, id: string, o?: Opts<EvidenceView | null>) =>
  useQuery(base<EvidenceView | null>(["evidence", e, id], () => V.getEvidence(e, id), o));
export const useEvidenceList = (e: string, milestone?: number, o?: Opts<EvidenceView[]>) =>
  useQuery(base<EvidenceView[]>(["evidence-list", e, milestone ?? "all"], () => V.listEvidence(e, { milestone, limit: 50 }), o));
export const useProposals = (e: string, o?: Opts<ProposalView[]>) => useQuery(base<ProposalView[]>(["proposals", e], () => V.listProposals(e, 0, 50), o));
export const useCapture = (e: string, milestone: number | null, o?: Opts<CaptureView | null>) =>
  useQuery(base<CaptureView | null>(["capture", e, milestone], () => (milestone === null ? Promise.resolve(null) : V.getCapture(e, milestone)), o));

/** Is `e` a genuine Plote estate (configured, or a root subaccount running a published estate build)? */
export const useGenuineEstate = (e: string) =>
  useQuery({ queryKey: ["genuine", e], queryFn: () => isGenuineEstate(e), staleTime: 300_000, retry: 1 });

/** A lien on this unit that its lender hasn't accepted yet. Null when none (or when the estate predates the view). */
export const usePendingLien = (e: string, unitId: string, o?: Opts<PendingLien | null>) =>
  useQuery(base<PendingLien | null>(["pending-lien", e, unitId], () => E.getPendingLien(e, unitId).catch((err) => {
    // Estates deployed before two-step liens have no such view: that just means "no pending lien".
    if (/MethodNotFound|method.*not found|CodeDoesNotExist|BAD_VIEW/i.test(String((err as Error)?.message ?? err) + String((err as { raw?: string })?.raw ?? ""))) return null;
    throw err;
  }), o));
export const useNftToken = (e: string, id: string, o?: Opts<NftToken | null>) => useQuery(base<NftToken | null>(["nft", e, id], () => E.nftToken(e, id), o));

export const useUsdcBalance = (account: string | null | undefined, o?: Opts<string>) =>
  useQuery(base<string>(["usdc-bal", account], () => usdc.balanceOf(account!), { ...o, enabled: !!account && (o?.enabled ?? true) }));
export const useUsdcRegistered = (account: string | null | undefined, o?: Opts<boolean>) =>
  useQuery(base<boolean>(["usdc-reg", account], () => usdc.storageBalanceOf(account!).then((b) => !!b), { ...o, enabled: !!account && (o?.enabled ?? true) }));

/** All configured estates' get_estate, each succeeding or failing on its own. */
export function useAllEstates(estates: string[] = ESTATES) {
  const qs = useQueries({ queries: estates.map((e) => base<EstateView>(["estate", e], () => V.getEstate(e))) });
  return estates.map((account, i) => ({ account, q: qs[i] }));
}

export function useAllMilestones(estates: string[] = ESTATES) {
  const qs = useQueries({ queries: estates.map((e) => base<MilestoneView[]>(["milestones", e], () => V.getMilestones(e))) });
  return estates.map((account, i) => ({ account, q: qs[i] }));
}

/** Units held by an account across every configured estate (nft_tokens_for_owner, then get_unit). */
export function useMyUnits(account: string | null | undefined, estates: string[] = ESTATES) {
  return useQuery({
    queryKey: ["my-units", account, estates.join(",")],
    enabled: !!account,
    retry: 1,
    staleTime: 5000,
    queryFn: async () => {
      const out: { estate: string; token: NftToken; unit: UnitView | null; error?: string }[] = [];
      const errors: { estate: string; error: string }[] = [];
      await Promise.all(
        estates.map(async (e) => {
          try {
            const toks = (await E.nftTokensForOwner(e, account!)) ?? [];
            const units = await Promise.all(toks.map((t) => V.getUnit(e, t.token_id).catch(() => null)));
            toks.forEach((t, i) => out.push({ estate: e, token: t, unit: units[i] }));
          } catch (err) {
            errors.push({ estate: e, error: err instanceof Error ? err.message : String(err) });
          }
        }),
      );
      if (errors.length === estates.length && estates.length > 0) throw new Error(errors[0].error);
      return { units: out, errors };
    },
  });
}

/**
 * What else an account has across the configured estates: active reservations (so a reserver sees the unit they
 * still have to pay for) and owed balances (failed resale payouts / reservation refunds, `withdraw_owed`).
 */
export function useMyPositions(account: string | null | undefined, estates: string[] = ESTATES) {
  return useQuery({
    queryKey: ["my-positions", account, estates.join(",")],
    enabled: !!account,
    retry: 1,
    staleTime: 5000,
    queryFn: async () => {
      const reservations: { estate: string; unit: UnitView }[] = [];
      const owed: { estate: string; amount: string }[] = [];
      const errors: { estate: string; error: string }[] = [];
      await Promise.all(
        estates.map(async (e) => {
          try {
            const [units, o] = await Promise.all([listAllUnits(e), E.owedOf(e, account!).catch(() => "0")]);
            for (const u of units) if (u.status === "Reserved" && u.reservation?.by === account) reservations.push({ estate: e, unit: u });
            if (typeof o === "string" && /^\d+$/.test(o) && BigInt(o) > 0n) owed.push({ estate: e, amount: o });
          } catch (err) {
            errors.push({ estate: e, error: err instanceof Error ? err.message : String(err) });
          }
        }),
      );
      return { reservations, owed, errors };
    },
  });
}

/** Which estates this account is the developer / surveyor of. */
export function useRoles(account: string | null | undefined) {
  const all = useAllEstates();
  const developerOf = all.filter((x) => x.q.data?.developer_id === account).map((x) => x.account);
  const surveyorOf = all.filter((x) => x.q.data && (x.q.data.surveyor_id === account || x.q.data.params.playground)).map((x) => x.account);
  return { all, developerOf, surveyorOf, loading: all.some((x) => x.q.isLoading) };
}

/** USD→NGN rate (cached 1 h); null when unavailable. */
export function useFx(): number | null {
  const [rate, setRate] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    getFxRate().then((r) => alive && setRate(r));
    return () => {
      alive = false;
    };
  }, []);
  return rate;
}

/** Re-render every `ms` (for countdowns). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
