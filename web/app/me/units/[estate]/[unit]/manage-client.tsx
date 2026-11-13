"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DoorOpen, Mail } from "lucide-react";
import { EstateBanners } from "@/components/banners";
import { Celebration } from "@/components/celebration";
import { AccountChip, CountdownChip, MonoAmount, StatusBadge } from "@/components/chain";
import { PlanTable, PositionCard, UnitImage } from "@/components/unit-bits";
import { useTx } from "@/components/toast";
import { RequireWallet, useWallet } from "@/components/wallet";
import { BracketCard, Button, ErrorState, Field, LinkButton, LoadingCard, Page } from "@/components/ui";
import { approvedCount, estate as E, MAX_GUARDIANS, nftApprovedCount } from "@/lib/estate";
import { estateAccount, estateSlug, isValidAccountId } from "@/lib/estates";
import { formatUsd, nsToMs, parseUsdc, toBig, unitDisplay } from "@/lib/format";
import { assertPayable } from "@/lib/genuine";
import { useEstate, useMilestones, useNftToken, useNow, usePendingLien, useUnit, useUsdcBalance } from "@/lib/hooks";
import { bytesToBase64, getWallet, sendTx, sendTxs, type TxResult, type TxSpec } from "@/lib/near";
import { assertFtCallAccepted, depositSuccessText } from "@/lib/tx-outcome";
import { notifyMessage, timestampedNonce } from "@/lib/nep413";
import { isRegistered, usdc } from "@/lib/usdc";

/**
 * Whether this deployment can send milestone emails (GET /api/notify/status → { configured }). A 404 (older server),
 * any other failure or a malformed answer all count as "not configured", so the form never promises an email that can't be sent.
 */
function useNotifyConfigured() {
  return useQuery({
    queryKey: ["notify-status"],
    staleTime: 300_000,
    retry: 0,
    queryFn: async (): Promise<boolean> => {
      try {
        const res = await fetch("/api/notify/status", { headers: { accept: "application/json" } });
        if (!res.ok) return false;
        const j = (await res.json()) as { configured?: unknown };
        return j.configured === true;
      } catch {
        return false;
      }
    },
  });
}

function Section({ id, title, children, tone }: { id: string; title: string; children: ReactNode; tone?: "red" | "accent" | "amber" }) {
  return (
    <BracketCard as="section" id={id} tone={tone} className="scroll-mt-20 space-y-3" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="text-xl font-normal">{title}</h2>
      {children}
    </BracketCard>
  );
}

export function ManageClient({ slug, unitId }: { slug: string; unitId: string }) {
  const account = estateAccount(slug);
  const s = estateSlug(account);
  const est = useEstate(account);
  const unit = useUnit(account, unitId, { poll: 10_000 });
  const ms = useMilestones(account);
  const token = useNftToken(account, unitId);
  const pendingLien = usePendingLien(account, unitId, { poll: 15_000 });
  const { accountId } = useWallet();
  const bal = useUsdcBalance(accountId);
  const owed = useQuery({ queryKey: ["owed", account, accountId], queryFn: () => E.owedOf(account, accountId!), enabled: !!accountId, retry: 0 });
  const { run } = useTx();
  const qc = useQueryClient();
  const notify = useNotifyConfigured();
  const [amount, setAmount] = useState("");
  const [ask, setAsk] = useState("");
  const [beneficiary, setBeneficiary] = useState("");
  const [guardians, setGuardians] = useState("");
  const [lender, setLender] = useState("");
  const [cap, setCap] = useState("");
  const [email, setEmail] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const now = useNow(30_000);
  const seenKey = `plote:seen-approved:${account}:${unitId}`;
  const [prevSeen] = useState<number>(() => {
    try {
      return typeof window === "undefined" ? -1 : Number(window.localStorage.getItem(seenKey) ?? "-1");
    } catch {
      return -1;
    }
  });
  const [dismissed, setDismissed] = useState(false);
  const done = approvedCount(ms.data);
  const celebrate = !dismissed && !!ms.data && !!accountId && prevSeen >= 0 && done > prevSeen;

  // C7: celebrate on the first visit after a new approval.
  useEffect(() => {
    if (!ms.data || !accountId) return;
    try {
      window.localStorage.setItem(seenKey, String(done));
    } catch {
      /* storage blocked */
    }
  }, [ms.data, done, seenKey, accountId]);

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["unit", account, unitId] }),
      qc.invalidateQueries({ queryKey: ["units", account] }),
      qc.invalidateQueries({ queryKey: ["nft", account, unitId] }),
      qc.invalidateQueries({ queryKey: ["pending-lien", account, unitId] }),
      qc.invalidateQueries({ queryKey: ["owed", account] }),
      qc.invalidateQueries({ queryKey: ["estate", account] }),
      qc.invalidateQueries({ queryKey: ["usdc-bal"] }),
      qc.invalidateQueries({ queryKey: ["my-units"] }),
      qc.invalidateQueries({ queryKey: ["my-positions"] }),
    ]);

  /** `check` runs on the result (e.g. a payment refused by the unit throws, so the toast shows a failure). */
  const exec = async (title: string, spec: TxSpec | TxSpec[], success?: string | (() => string), check?: (r: TxResult[]) => Promise<void> | void) => {
    setErr(null);
    const r = await run(title, async (): Promise<unknown> => {
      const res = Array.isArray(spec) ? await sendTxs(spec) : [await sendTx(spec)];
      await check?.(res);
      return Array.isArray(spec) ? res : res[0];
    }, { success: typeof success === "function" ? () => success() : success });
    if (r) await refresh();
    return r;
  };

  if (est.isLoading || unit.isLoading) return <Page><LoadingCard lines={6} /></Page>;
  if (!est.data) return <Page><ErrorState error={est.error} onRetry={() => est.refetch()} /></Page>;
  if (!unit.data) return <Page><ErrorState error={unit.error ?? { message: "E_UNIT_NOT_FOUND" }} /></Page>;
  const e = est.data;
  const u = unit.data;
  const isHolder = !!accountId && u.holder === accountId;
  const isGuardian = !!accountId && u.guardians.includes(accountId);
  const isLender = !!accountId && u.lien?.lender === accountId;
  const pending = pendingLien.data ?? null;
  const isPendingLender = !!accountId && pending?.lender === accountId;
  const lienToLender = !!u.lien && toBig(u.lien.cap) > 0n;
  const recoveryReady = !!u.recovery?.ready_at && nsToMs(u.recovery.ready_at) <= now;
  const refundable = toBig(u.refundable_now);
  const nextRefundOpen = (ms.data ?? []).filter((m) => !(m.status === "Approved" && m.veto_passed)).map((m) => m.refunds_open_at).sort()[0];
  const handoverMs = ms.data?.[ms.data.length - 1];
  // handover needs EVERY milestone Approved and the last one's veto window over (contract E_HANDOVER).
  const allApproved = !!ms.data?.length && ms.data.every((m) => m.status === "Approved");
  const canHandover = u.status === "Allocated" && allApproved && !!handoverMs?.veto_passed;
  const handoverWhy = u.status !== "Allocated" || canHandover ? null : !allApproved ? "Handover opens once every stage is approved." : "Handover opens when the last stage's veto window ends.";
  const latestTitle = done > 0 ? ms.data?.[done - 1]?.title : null;

  return (
    <Page>
      <EstateBanners estate={e} account={account} />
      <Celebration
        open={celebrate}
        onClose={() => setDismissed(true)}
        title={latestTitle ? `Your ${latestTitle.toLowerCase()} is done.` : "A new stage was approved."}
        sub={`${unitDisplay(u.id)} at ${e.name} is ${u.progress_bps / 100}% built.`}
        house={{ estateName: e.name, unitLabel: u.label, unitId: u.id, approvedCount: nftApprovedCount(ms.data), total: ms.data?.length || 4, status: u.status, paid: u.paid, price: u.price }}
        share={<LinkButton href={`/w/${s}/${u.id}`} variant="primary">Share it</LinkButton>}
      />
      <nav className="mono mb-4 text-xs text-muted"><Link href="/me" className="hover:text-text">My units</Link> / {s} / {unitDisplay(u.id)}</nav>
      <RequireWallet what="managing this unit">
        {isPendingLender && pending ? (
          <BracketCard tone="accent" className="mb-6 space-y-2" id="accept-lien">
            <p className="font-display text-lg font-normal">The holder named you as lender on {unitDisplay(u.id)}.</p>
            <p className="text-sm text-muted">Accepting activates a lien up to <MonoAmount value={pending.cap} naira={false} />: while it&apos;s set the token can&apos;t be moved or listed, and a refund pays you first, up to the cap. Only you can clear it later.</p>
            <Button variant="primary" onClick={() => exec("Accept lien", E.acceptLien(account, u.id), "Lien accepted. It's now active on this unit.")}>Accept lien</Button>
          </BracketCard>
        ) : null}
        {!isHolder && !isGuardian && !isLender && !isPendingLender ? (
          <BracketCard tone="amber" className="mb-6">You don&apos;t hold {unitDisplay(u.id)}. <Link className="underline" href={`/estates/${s}/units/${u.id}`}>See the public unit page</Link>.</BracketCard>
        ) : null}
        {err ? <p className="mb-4 text-sm text-red" role="alert">{err}</p> : null}
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <div className="space-y-3 lg:sticky lg:top-20 lg:self-start">
            <BracketCard className="p-2"><UnitImage e={e} u={u} ms={ms.data} token={token.data} /></BracketCard>
            <div className="flex flex-wrap items-center gap-2"><span className="mono text-2xl font-normal">{unitDisplay(u.id)}</span><StatusBadge status={u.status} /></div>
            <p className="text-sm text-muted">{u.label}</p>
            <nav className="mono flex flex-wrap gap-x-3 gap-y-1 text-xs" aria-label="Sections">
              {["overview", "pay", "refund", "sell", "beneficiary", "lien", "notifications", "danger"].map((x) => <a key={x} href={`#${x}`} className="inline-flex min-h-8 items-center text-muted hover:text-orange-ink">{x}</a>)}
            </nav>
          </div>
          <div className="space-y-6">
            <Section id="overview" title="Overview">
              <PositionCard e={e} u={u} />
              {toBig(u.excess_now) > 0n && isHolder ? <Button onClick={() => exec("Withdraw excess", E.withdrawExcess(account, u.id))}>Withdraw excess <MonoAmount value={u.excess_now} naira={false} /></Button> : null}
              {owed.data && toBig(owed.data) > 0n ? <Button onClick={() => exec("Withdraw owed", E.withdrawOwed(account))}>Withdraw owed <MonoAmount value={owed.data} naira={false} /></Button> : null}
              {isHolder && u.status === "Allocated" && handoverMs?.status === "Approved" ? (
                <div className="space-y-1">
                  <Button variant="accent" disabled={!canHandover} onClick={() => exec("Take handover", E.handover(account, u.id), "Handed over. Your token is now your gate pass.")}><DoorOpen className="h-4 w-4" aria-hidden /> Take handover</Button>
                  {handoverWhy ? <p className="text-xs text-muted">{handoverWhy}</p> : null}
                </div>
              ) : null}
              {u.status === "HandedOver" ? <LinkButton href={`/me/units/${s}/${u.id}/pass`} variant="accent"><DoorOpen className="h-4 w-4" aria-hidden /> Gate pass</LinkButton> : null}
            </Section>

            <Section id="pay" title="Pay instalment">
              <PlanTable u={u} />
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-48 flex-1"><Field label="Amount (USDC)" htmlFor="pay-amt" hint={`Your USDC: ${bal.data ? formatUsd(bal.data) : "—"}`}><input id="pay-amt" className="input" inputMode="decimal" value={amount} onChange={(x) => setAmount(x.target.value)} placeholder={u.next_due ? String(Number(u.next_due.shortfall) / 1e6) : "1000"} /></Field></div>
                {u.next_due ? <Button size="sm" onClick={() => setAmount(String(Number(u.next_due!.shortfall) / 1e6))}>Next due {formatUsd(u.next_due.shortfall)}</Button> : null}
              </div>
              <Button variant="primary" onClick={async () => {
                let base: string;
                try { base = parseUsdc(amount || (u.next_due ? String(Number(u.next_due.shortfall) / 1e6) : "")); } catch (x) { return setErr((x as Error).message); }
                if (toBig(base) <= 0n) return setErr("Amount must be more than 0");
                if (bal.data && toBig(bal.data) < toBig(base)) return setErr(`You have ${formatUsd(bal.data)} USDC.`);
                try {
                  await assertPayable(account, u);
                } catch (x) {
                  return setErr((x as Error).message);
                }
                const specs: TxSpec[] = [];
                if (accountId && !(await isRegistered(accountId).catch(() => true))) specs.push(usdc.storageDeposit(accountId));
                specs.push(usdc.ftTransferCall(u.account, base, ""));
                let deferred = false;
                const ok = await exec(`Pay ${formatUsd(base)} into ${unitDisplay(u.id)}`, specs, () => depositSuccessText({ status: deferred ? "deferred" : "accepted" }, "Payment credited to the unit's own account."), (res) => {
                  deferred = assertFtCallAccepted(res[res.length - 1], base, "deposit").status === "deferred";
                });
                if (ok && deferred) for (const ms of [20_000, 60_000]) setTimeout(() => void refresh(), ms);
              }}>Pay from NEAR wallet</Button>
              <p className="text-xs text-muted">Family can pay too, from the <Link className="underline" href={`/w/${s}/${u.id}?chip=1`}>watch page</Link>.</p>
            </Section>

            <Section id="refund" title="Refund" tone={refundable > 0n ? "red" : undefined}>
              {refundable > 0n ? (
                <>
                  <p>A deadline passed without a verified stage{e.frozen?.refunds_open ? " (or holders opened refunds with a freeze)" : ""}. You can take back everything not yet released: <MonoAmount value={u.refundable_now} account={u.account} size="lg" />.</p>
                  <p className="text-sm text-muted">Your allocation token will be burned once everything is refunded, and the unit goes back on sale. This can&apos;t be undone.</p>
                  {lienToLender ? <p className="text-sm text-amber">A lender&apos;s lien is set: this refund goes to the lender <span className="mono">{u.lien!.lender}</span> first, up to its cap of {formatUsd(u.lien!.cap)}. Ask again afterwards for anything left.</p> : null}
                  <Button variant="danger" disabled={!isHolder} onClick={() => {
                    const msg = lienToLender
                      ? `Refund ${formatUsd(u.refundable_now)}?\n\nA lien is set, so up to ${formatUsd(u.lien!.cap)} goes to the lender ${u.lien!.lender} first, not to you. Anything above the cap stays refundable to you afterwards.`
                      : `Refund ${formatUsd(u.refundable_now)} to ${accountId}? Your token for ${unitDisplay(u.id)} will be burned.`;
                    if (!window.confirm(msg)) return;
                    return exec("Get my money back", E.refund(account, u.id), lienToLender ? `Refund sent to the lender ${u.lien!.lender} (up to its cap).` : "Refund sent to your account.");
                  }}>Get my money back</Button>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted">Refunds open automatically when a milestone&apos;s deadline plus its grace period passes without approval. No vote needed.</p>
                  {nextRefundOpen ? <CountdownChip until={nextRefundOpen} label="refunds would open in" tone="orange" endedLabel="awaiting the next view" /> : <p className="text-sm text-muted">Every milestone is approved.</p>}
                </>
              )}
            </Section>

            <Section id="sell" title="Sell">
              {u.listing ? (
                <p>Listed for <MonoAmount value={u.listing.ask} /> ({u.listing.kind}).</p>
              ) : u.lien ? (
                <p className="text-sm text-amber">A lender&apos;s lien is set, so this unit can&apos;t be listed until the lender clears it.</p>
              ) : (
                <>
                  <p className="text-sm text-muted">Set your price. When a buyer pays, you&apos;re paid and the token moves to them in one transaction. No fees on a voluntary sale. The escrow stays with the unit.</p>
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-48 flex-1"><Field label="Ask (USDC)" htmlFor="ask"><input id="ask" className="input" inputMode="decimal" value={ask} onChange={(x) => setAsk(x.target.value)} placeholder={String(Number(u.paid) / 1e6)} /></Field></div>
                    <Button disabled={!isHolder} onClick={() => { try { return exec("List for sale", E.listForSale(account, u.id, parseUsdc(ask))); } catch (x) { setErr((x as Error).message); } }}>List for sale</Button>
                  </div>
                </>
              )}
            </Section>

            <Section id="beneficiary" title="Beneficiary & guardians">
              <p className="text-sm text-muted">Name a next of kin, and up to {MAX_GUARDIANS} guardians. If you lose access, 2 guardians can move the token to a new account after a delay you can cancel.</p>
              <p className="text-sm">Beneficiary: <AccountChip account={u.beneficiary} /> · Guardians: {u.guardians.length ? u.guardians.map((g) => <AccountChip key={g} account={g} className="mr-1" />) : "none"}</p>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <Field label="Beneficiary account" htmlFor="ben"><input id="ben" className="input" value={beneficiary} onChange={(x) => setBeneficiary(x.target.value.trim())} placeholder="mum.testnet" /></Field>
                <Button className="self-end" disabled={!isHolder} onClick={() => (beneficiary && !isValidAccountId(beneficiary) ? setErr("Not a valid NEAR account") : exec("Set beneficiary", E.setBeneficiary(account, u.id, beneficiary || null)))}>{beneficiary ? "Save" : "Clear"}</Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <Field label="Guardians (comma-separated, max 3)" htmlFor="guards"><input id="guards" className="input" value={guardians} onChange={(x) => setGuardians(x.target.value)} placeholder="sister.testnet, friend.testnet" /></Field>
                <Button className="self-end" disabled={!isHolder} onClick={() => {
                  const list = guardians.split(",").map((g) => g.trim()).filter(Boolean);
                  if (list.length > MAX_GUARDIANS || list.some((g) => !isValidAccountId(g))) return setErr("Up to 3 valid NEAR accounts");
                  return exec("Set guardians", E.setGuardians(account, u.id, list));
                }}>Save guardians</Button>
              </div>
              {u.recovery ? (
                <BracketCard tone="amber" className="space-y-2">
                  <p className="text-sm">Recovery to <AccountChip account={u.recovery.new_owner} /> · approvals {u.recovery.approvals.length}/2 {u.recovery.ready_at ? <CountdownChip until={u.recovery.ready_at} label="ready" /> : null}</p>
                  {!u.recovery.ready_at ? <p className="text-xs text-muted">The timer starts once 2 guardians approve.</p> : !recoveryReady ? <p className="text-xs text-muted">Anyone can finish the recovery once the timer ends; the holder can cancel it until then.</p> : null}
                  <div className="flex flex-wrap gap-2">
                    {isHolder ? <Button variant="danger" size="sm" onClick={() => exec("Cancel recovery", E.cancelRecovery(account, u.id))}>Cancel recovery</Button> : null}
                    {recoveryReady ? <Button size="sm" onClick={() => exec("Finish recovery", E.finishRecovery(account, u.id))}>Finish recovery</Button> : null}
                  </div>
                </BracketCard>
              ) : null}
              {isGuardian && !isHolder ? <GuardianRecover onGo={(to) => exec("Approve recovery", E.guardianRecover(account, u.id, to))} /> : null}
            </Section>

            <Section id="lien" title="Lender lien">
              {u.lien ? (
                <>
                  <p className="text-sm">Lien held by <AccountChip account={u.lien.lender} /> up to <MonoAmount value={u.lien.cap} naira={false} />. While it&apos;s set the token can&apos;t be moved or listed, and refunds go to the lender up to the cap.</p>
                  {isLender ? <Button onClick={() => exec("Clear lien", E.clearLien(account, u.id))}>Clear lien</Button> : <p className="text-xs text-muted">Only the lender can clear it.</p>}
                </>
              ) : pending ? (
                <p className="text-sm">A lien naming <AccountChip account={pending.lender} /> up to <MonoAmount value={pending.cap} naira={false} /> is waiting for the lender to accept it. It has no effect until they do.</p>
              ) : (
                <>
                  <p className="text-sm text-muted">Name a lender (e.g. a bank financing the rest). The lien only becomes active when the lender accepts it from their own account.</p>
                  <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                    <Field label="Lender account" htmlFor="lender"><input id="lender" className="input" value={lender} onChange={(x) => setLender(x.target.value.trim())} placeholder="bank.testnet" /></Field>
                    <Field label="Cap (USDC)" htmlFor="cap"><input id="cap" className="input" inputMode="decimal" value={cap} onChange={(x) => setCap(x.target.value)} /></Field>
                    <Button className="self-end" disabled={!isHolder} onClick={() => { try { if (!isValidAccountId(lender)) throw new Error("Not a valid NEAR account"); return exec("Propose lien", E.setLien(account, u.id, lender, parseUsdc(cap)), "Lien proposed. It becomes active when the lender accepts it."); } catch (x) { setErr((x as Error).message); } }}>Propose lien</Button>
                  </div>
                </>
              )}
            </Section>

            <Section id="notifications" title="Notifications">
              <p className="text-sm text-muted">Get an email when a stage is signed or money is released. Opt-in: your wallet signs a message to prove it&apos;s you, then you confirm from the email we send. You can delete it any time.</p>
              {notify.isLoading ? <p className="text-sm text-muted" aria-busy="true">Checking whether email is available…</p> : !notify.data ? (
                <p className="text-sm text-muted" role="note">
                  Email notifications aren&apos;t set up on this deployment, so there&apos;s nothing to subscribe to here. You can still follow every stage on the{" "}
                  <Link className="underline hover:text-orange-ink" href={`/w/${s}/${u.id}`}>watch page</Link>.
                </p>
              ) : (
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <Field label="Email" htmlFor="email"><input id="email" type="email" className="input" value={email} onChange={(x) => setEmail(x.target.value)} autoComplete="email" /></Field>
                <Button className="self-end" onClick={async () => {
                  if (!accountId || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setErr("Enter a valid email");
                  await run("Subscribe to milestone emails", async () => {
                    const nonce = timestampedNonce();
                    const message = notifyMessage(s, u.id, email);
                    const w = await getWallet();
                    const signed = await w.signMessage({ message, recipient: account, nonce });
                    const res = await fetch("/api/notify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId, publicKey: signed.publicKey, signature: signed.signature, nonce: bytesToBase64(nonce), message, recipient: account, estate: account, unit: u.id, email }) });
                    const j = await res.json();
                    if (!res.ok) throw new Error(`${j.code}: ${j.message}`);
                  }, { success: "Check your inbox: click the link we sent to confirm." });
                }}><Mail className="h-4 w-4" aria-hidden /> Subscribe</Button>
              </div>
              )}
            </Section>

            <Section id="danger" title="Danger zone" tone="red">
              {u.listing?.kind === "Voluntary" ? <Button variant="danger" disabled={!isHolder} onClick={() => exec("Cancel listing", E.cancelListing(account, u.id))}>Cancel listing</Button> : <p className="text-sm text-muted">{u.listing?.kind === "Default" ? "A default listing can't be cancelled; it closes when the unit sells." : "No open listing."}</p>}
              {u.next_due && Number(u.next_due.due_at) / 1e6 < now ? (
                <p className="text-sm text-muted">An instalment is overdue. After the grace period anyone can declare a default, which lists the unit for what you&apos;ve paid (minus a fixed {e.params.penalty_bps / 100}%) instead of forfeiting it.</p>
              ) : null}
            </Section>
          </div>
        </div>
      </RequireWallet>
    </Page>
  );
}

function GuardianRecover({ onGo }: { onGo: (to: string) => unknown }) {
  const [to, setTo] = useState("");
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
      <Field label="You are a guardian. Recover to account" htmlFor="rec"><input id="rec" className="input" value={to} onChange={(x) => setTo(x.target.value.trim())} /></Field>
      <Button className="self-end" disabled={!isValidAccountId(to)} onClick={() => onGo(to)}>Approve recovery</Button>
    </div>
  );
}
