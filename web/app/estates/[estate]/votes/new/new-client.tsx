"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { clsx } from "clsx";
import { EstateBanners } from "@/components/banners";
import { useTx } from "@/components/toast";
import { RequireWallet, useWallet } from "@/components/wallet";
import { BracketCard, Button, ErrorState, Field, LoadingCard, Page, PageHeader } from "@/components/ui";
import { estate as E } from "@/lib/estate";
import { estateAccount, estateSlug, isValidAccountId } from "@/lib/estates";
import { formatDate, msToNs, nsToMs } from "@/lib/format";
import { useEstate, useMilestones } from "@/lib/hooks";
import { sendTx } from "@/lib/near";
import type { ProposalKind } from "@/lib/types";

type Template = "ReplaceSurveyor" | "Veto" | "Freeze" | "Unfreeze" | "ExtendDeadline" | "StepIn";

const TEMPLATES: { id: Template; title: string; effect: string; devOk?: boolean }[] = [
  { id: "ReplaceSurveyor", title: "Replace surveyor", effect: "surveyor_id changes; emits surveyor_changed." },
  { id: "Veto", title: "Veto this sign-off", effect: "Milestone → Vetoed; evidence must be resubmitted (only during the veto window)." },
  { id: "Freeze", title: "Freeze releases", effect: "claim_release fails with E_FROZEN; refunds open if you ask." },
  { id: "Unfreeze", title: "Unfreeze", effect: "Lifts the freeze." },
  { id: "ExtendDeadline", title: "Extend deadline", effect: "The deadline moves; a Missed milestone goes back to Open.", devOk: true },
  { id: "StepIn", title: "Step in", effect: "Future releases go to a replacement contractor's account." },
];

// Each template has its own fields (a Veto milestone and an ExtendDeadline milestone are separate), so switching
// templates never carries a stale choice into the proposal.
const schema = z.object({
  account: z.string().optional(),
  veto_milestone: z.string().optional(),
  extend_milestone: z.string().optional(),
  reason: z.string().max(200).optional(),
  refunds_open: z.boolean().optional(),
  new_deadline: z.string().optional(),
  new_payout_id: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

function buildKind(t: Template, v: FormValues): { kind?: ProposalKind; error?: string } {
  switch (t) {
    case "ReplaceSurveyor":
      if (!v.account || !isValidAccountId(v.account)) return { error: "Enter a valid NEAR account for the new surveyor." };
      return { kind: { ReplaceSurveyor: { account: v.account } } };
    case "Veto":
      if (v.veto_milestone === undefined || v.veto_milestone === "") return { error: "Pick the milestone to veto." };
      return { kind: { Veto: { milestone: Number(v.veto_milestone) } } };
    case "Freeze":
      if (!v.reason?.trim()) return { error: "Say why, in one sentence." };
      return { kind: { Freeze: { reason: v.reason.trim(), refunds_open: !!v.refunds_open } } };
    case "Unfreeze":
      return { kind: "Unfreeze" };
    case "ExtendDeadline": {
      if (v.extend_milestone === undefined || v.extend_milestone === "") return { error: "Pick the milestone." };
      const ms = v.new_deadline ? Date.parse(v.new_deadline) : NaN;
      if (!Number.isFinite(ms)) return { error: "Pick the new deadline." };
      if (ms <= Date.now()) return { error: "The new deadline must be in the future." };
      return { kind: { ExtendDeadline: { milestone: Number(v.extend_milestone), new_deadline: msToNs(ms) } } };
    }
    case "StepIn":
      if (!v.new_payout_id || !isValidAccountId(v.new_payout_id)) return { error: "Enter the replacement contractor's NEAR account." };
      return { kind: { StepIn: { new_payout_id: v.new_payout_id } } };
  }
}

export function NewProposalClient({ slug }: { slug: string }) {
  const account = estateAccount(slug);
  const est = useEstate(account);
  const ms = useMilestones(account);
  const { accountId } = useWallet();
  const { run } = useTx();
  const router = useRouter();
  const qc = useQueryClient();
  const [t, setT] = useState<Template>("ReplaceSurveyor");
  const supply = useQuery({ queryKey: ["nft-supply", account, accountId], queryFn: () => E.nftSupplyForOwner(account, accountId!), enabled: !!accountId, retry: 0 });
  const { register, control, handleSubmit, formState: { isSubmitting } } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { refunds_open: true } });
  const values = useWatch({ control });
  const built = useMemo(() => buildKind(t, values as FormValues), [t, values]);

  if (est.isLoading) return <Page><LoadingCard /></Page>;
  if (!est.data) return <Page><ErrorState error={est.error} onRetry={() => est.refetch()} /></Page>;
  const e = est.data;
  const isHolder = Number(supply.data ?? 0) > 0;
  const isDev = accountId === e.developer_id;
  const allowed = TEMPLATES.find((x) => x.id === t)!;
  const canPropose = isHolder || (isDev && allowed.devOk);
  const vetoable = (ms.data ?? []).filter((m) => m.status === "Approved" && !m.veto_passed);

  const onSubmit = handleSubmit(async () => {
    if (!built.kind || !accountId) return;
    const r = await run("Open proposal", () => sendTx(E.propose(account, built.kind!)), { success: "Proposal opened. Holders can vote now." });
    if (r) {
      await qc.invalidateQueries({ queryKey: ["proposals", account] });
      router.push(`/estates/${estateSlug(account)}/votes`);
    }
  });

  return (
    <Page narrow>
      <EstateBanners estate={e} account={account} />
      <PageHeader eyebrow={`${e.name.toUpperCase()} · HOLDER VOTE`} title="New proposal">
        One open proposal per account. Opening one costs 0.05 NEAR, kept by the estate so proposals can&apos;t be spammed. Holders can propose any kind; the developer can only propose a deadline extension. Every kind except a veto needs a quorum (at least 3 tokens and a quarter of the units allocated) and, to pass, both a USDC-weighted majority and a majority of distinct holders.
      </PageHeader>
      <RequireWallet what="proposals">
        <div className="space-y-6">
          <fieldset>
            <legend className="label">Template</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {TEMPLATES.map((x) => (
                <label key={x.id} className={clsx("corners corners-hover flex min-h-14 cursor-pointer items-start gap-3 bg-surface p-3", t === x.id && "corners-active")}>
                  <input type="radio" name="tpl" className="mt-1 accent-orange" checked={t === x.id} onChange={() => setT(x.id)} />
                  <span>
                    <span className="font-medium">{x.title}</span>
                    <span className="block text-xs text-muted">{x.effect}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <BracketCard className="space-y-4">
            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              {t === "ReplaceSurveyor" ? (
                <Field label="New surveyor account" htmlFor="account"><input id="account" className="input" placeholder="qs-new.testnet" {...register("account")} /></Field>
              ) : null}
              {t === "Veto" ? (
                <Field label="Milestone in its veto window" htmlFor="milestone" hint={vetoable.length ? undefined : "No milestone is in its veto window right now."}>
                  <select id="milestone" className="input" {...register("veto_milestone")}>
                    <option value="">Choose…</option>
                    {vetoable.map((m) => <option key={m.index} value={m.index}>{m.index + 1}. {m.title}</option>)}
                  </select>
                </Field>
              ) : null}
              {t === "Freeze" ? (
                <>
                  <Field label="Reason" htmlFor="reason"><input id="reason" className="input" placeholder="No work on site for 6 weeks" {...register("reason")} /></Field>
                  <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 accent-orange" {...register("refunds_open")} /> Also open refunds for every holder</label>
                </>
              ) : null}
              {t === "ExtendDeadline" ? (
                <>
                  <Field label="Milestone" htmlFor="milestone">
                    <select id="milestone" className="input" {...register("extend_milestone")}>
                      <option value="">Choose…</option>
                      {(ms.data ?? []).map((m) => <option key={m.index} value={m.index}>{m.index + 1}. {m.title} — now {formatDate(m.deadline)}</option>)}
                    </select>
                  </Field>
                  <Field label="New deadline (your local time)" htmlFor="new_deadline"><input id="new_deadline" type="datetime-local" className="input" {...register("new_deadline")} /></Field>
                </>
              ) : null}
              {t === "StepIn" ? (
                <Field label="Replacement contractor's payout account" htmlFor="new_payout_id"><input id="new_payout_id" className="input" placeholder="contractor.testnet" {...register("new_payout_id")} /></Field>
              ) : null}
              <div>
                <p className="label">Exact propose arguments</p>
                <pre className="mono overflow-auto bg-bg p-3 text-xs">{built.kind ? JSON.stringify({ kind: built.kind }, null, 2) : `// ${built.error}`}</pre>
                <p className="mono text-xs text-muted">near call {account} propose &apos;{built.kind ? JSON.stringify({ kind: built.kind }) : "…"}&apos; --accountId {accountId} --deposit 0.05</p>
              </div>
              {!canPropose ? (
                <p className="text-sm text-amber">{isDev ? "As the developer you can only propose a deadline extension." : "Only holders of a token in this estate can propose."}</p>
              ) : null}
              <Button type="submit" variant="primary" loading={isSubmitting} disabled={!built.kind || !canPropose}>Open proposal · 0.05 NEAR</Button>
            </form>
          </BracketCard>
          <p className="text-xs text-muted">Votes last {Math.round(nsToMs(e.params.proposal_period_ns) / 60000)} minutes on this estate. A veto also expires when the milestone&apos;s veto window closes.</p>
        </div>
      </RequireWallet>
    </Page>
  );
}
