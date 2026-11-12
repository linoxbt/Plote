"use client";

// "Is unit X taken?" — shared by the landing hero, the final CTA and /check.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AlertOctagon, Clock, Home, Lock, Search, Share2, Unlock } from "lucide-react";
import { clsx } from "clsx";
import { checkedViews as V } from "@/lib/estate";
import { estateSlug, parseUnitQuery, type UnitRef } from "@/lib/estates";
import { expectedUnitAccount, isGenuineEstate, type Genuineness } from "@/lib/genuine";
import { formatDate, pct, unitDisplay } from "@/lib/format";
import type { TakenView } from "@/lib/types";
import { AccountChip, CountdownChip, MonoAmount } from "./chain";
import { BracketCard, Button, ErrorState, LinkButton } from "./ui";

export type CheckOutcome =
  | { kind: "taken" | "reserved" | "available" | "handed_over"; ref: UnitRef; view: TakenView }
  | { kind: "not_plote"; ref: UnitRef | null; input: string; why: string }
  | { kind: "error"; ref: UnitRef; error: unknown };

type CheckDeps = { genuine?: (estate: string) => Promise<Genuineness>; isTaken?: typeof V.isTaken };

/**
 * Anything that isn't a genuine Plote estate (configured, or a root subaccount running a published estate build) is
 * "NOT A PLOTE UNIT", whatever its contract answers: a look-alike contract can claim a unit is available.
 */
export async function runCheck(input: string, deps: CheckDeps = {}): Promise<CheckOutcome> {
  const ref = parseUnitQuery(input);
  if (!ref) return { kind: "not_plote", ref: null, input, why: "That doesn't look like a Plote unit name." };
  try {
    const g = await (deps.genuine ?? isGenuineEstate)(ref.estate);
    if (!g.genuine) return { kind: "not_plote", ref, input, why: g.why };
    const v = await (deps.isTaken ?? V.isTaken)(ref.estate, ref.unit);
    if (!v || !v.exists) return { kind: "not_plote", ref, input, why: `There is no unit ${unitDisplay(ref.unit)} in ${ref.estate}.` };
    if (v.account && v.account !== expectedUnitAccount(ref.estate, ref.unit)) {
      return { kind: "not_plote", ref, input, why: `${ref.estate} reports ${v.account} as the unit's account; a Plote unit's account is always ${expectedUnitAccount(ref.estate, ref.unit)}.` };
    }
    if (v.status === "HandedOver") return { kind: "handed_over", ref, view: v };
    if (v.status === "Allocated" || v.status === "InDefault") return { kind: "taken", ref, view: v };
    if (v.status === "Reserved") return { kind: "reserved", ref, view: v };
    return { kind: "available", ref, view: v };
  } catch (e) {
    return { kind: "error", ref, error: e };
  }
}

const RECENT_KEY = "plote:recent-checks";

export function loadRecent(): string[] {
  try {
    const j = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(j) ? j.filter((x) => typeof x === "string").slice(0, 6) : [];
  } catch {
    return [];
  }
}

export function saveRecent(q: string) {
  try {
    const list = [q, ...loadRecent().filter((x) => x !== q)].slice(0, 6);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* storage blocked */
  }
}

export function CheckInput({
  initial = "", autoFocus = false, onResult, navigate = false, id = "check-input",
}: { initial?: string; autoFocus?: boolean; onResult?: (o: CheckOutcome) => void; navigate?: boolean; id?: string }) {
  const [q, setQ] = useState(initial);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = q.trim();
    if (!v) return;
    if (navigate) {
      router.push(`/check?u=${encodeURIComponent(v)}`);
      return;
    }
    setBusy(true);
    const out = await runCheck(v);
    saveRecent(v);
    setBusy(false);
    onResult?.(out);
  };
  return (
    <form onSubmit={submit} className="flex w-full max-w-xl gap-2" role="search">
      <label htmlFor={id} className="sr-only">
        Unit name or account
      </label>
      <input
        id={id}
        className="input flex-1"
        placeholder="a-4b.harmattan-court"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus={autoFocus}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        inputMode="text"
      />
      <Button type="submit" variant="primary" loading={busy}>
        <Search className="h-4 w-4" aria-hidden /> Check
      </Button>
    </form>
  );
}

/** Compact chip shown in place under the hero input. */
export function CheckChip({ o }: { o: CheckOutcome }) {
  const name = o.ref ? `${unitDisplay(o.ref.unit)} · ${estateSlug(o.ref.estate)}` : "—";
  const map = {
    taken: { t: "TAKEN", c: "text-orange bg-orange-dim/40", I: Lock },
    handed_over: { t: "HANDED OVER", c: "text-accent bg-accent/10", I: Home },
    reserved: { t: "RESERVED", c: "text-amber bg-amber/10", I: Clock },
    available: { t: "AVAILABLE", c: "text-text bg-surface-2", I: Unlock },
    not_plote: { t: "NOT A PLOTE UNIT", c: "text-red bg-red/10", I: AlertOctagon },
    error: { t: "COULDN'T CHECK", c: "text-red bg-red/10", I: AlertOctagon },
  }[o.kind];
  const href = o.ref && o.kind !== "not_plote" ? `/estates/${estateSlug(o.ref.estate)}/units/${o.ref.unit}` : `/check?u=${encodeURIComponent(o.kind === "not_plote" ? o.input : "")}`;
  return (
    <Link href={href} className={clsx("mono inline-flex min-h-11 items-center gap-2 px-3 text-sm", map.c)}>
      <map.I className="h-4 w-4" strokeWidth={1.75} aria-hidden />
      <span className="font-normal">{map.t}</span>
      <span className="text-muted">{name}</span>
      {o.kind === "taken" ? <span className="text-muted">· {pct(o.view.paid, o.view.price)}% paid</span> : null}
      <span aria-hidden>→</span>
    </Link>
  );
}

export function CheckResult({ o, onShare }: { o: CheckOutcome; onShare?: () => void }) {
  if (o.kind === "error") return <ErrorState error={o.error} title={`Couldn't check ${unitDisplay(o.ref.unit)}`} />;
  if (o.kind === "not_plote") {
    return (
      <BracketCard tone="red" className="space-y-4">
        <div className="flex items-center gap-3">
          <AlertOctagon className="h-7 w-7 text-red" strokeWidth={1.5} aria-hidden />
          <p className="font-display text-2xl font-normal text-red">NOT A PLOTE UNIT</p>
        </div>
        <p>{o.why}</p>
        <p className="font-medium">This estate doesn&apos;t use Plote escrow. Ask the developer why.</p>
        <div>
          <p className="label">What to ask your developer</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            <li>Where exactly does my deposit sit until the building goes up?</li>
            <li>Can I look up my unit and see that nobody else was sold it?</li>
            <li>Who checks each construction stage before money is released to you?</li>
            <li>If you miss a deadline, how do I get my money back, and who decides?</li>
            <li>Can I see the C of O or governor&apos;s consent for this land?</li>
          </ul>
        </div>
      </BracketCard>
    );
  }
  const v = o.view;
  const slug = estateSlug(o.ref.estate);
  const unitHref = `/estates/${slug}/units/${o.ref.unit}`;
  const head = {
    taken: { t: "TAKEN", c: "text-orange", tone: "orange" as const, I: Lock },
    handed_over: { t: "HANDED OVER", c: "text-accent", tone: "accent" as const, I: Home },
    reserved: { t: "RESERVED", c: "text-amber", tone: "amber" as const, I: Clock },
    available: { t: "AVAILABLE", c: "text-text", tone: "default" as const, I: Unlock },
  }[o.kind];
  return (
    <BracketCard tone={head.tone} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <head.I className={clsx("h-7 w-7", head.c)} strokeWidth={1.5} aria-hidden />
          <p className={clsx("font-display text-3xl font-normal", head.c)}>{head.t}</p>
        </div>
        <p className="mono text-sm text-muted">
          {unitDisplay(o.ref.unit)} · {v.label ?? ""}
        </p>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="label">Unit account</dt>
          <dd>
            <AccountChip account={v.account} max={34} />
          </dd>
        </div>
        {o.kind === "taken" || o.kind === "handed_over" ? (
          <>
            <div>
              <dt className="label">Holder</dt>
              <dd>
                <AccountChip account={v.holder} />
              </dd>
            </div>
            <div>
              <dt className="label">Paid</dt>
              <dd className="flex flex-wrap items-baseline gap-2">
                <MonoAmount value={v.paid} account={v.account} /> <span className="mono text-sm text-muted">{pct(v.paid, v.price)}% of price</span>
              </dd>
            </div>
            <div>
              <dt className="label">Released to developer</dt>
              <dd>
                <MonoAmount value={v.released} account={v.account} />
              </dd>
            </div>
            <div>
              <dt className="label">Allocated since</dt>
              <dd className="mono">{formatDate(v.allocated_at)}</dd>
            </div>
          </>
        ) : null}
        {o.kind === "reserved" ? (
          <div>
            <dt className="label">Reserved until</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <span className="mono">{formatDate(v.reserved_until)}</span>
              <CountdownChip until={v.reserved_until} />
            </dd>
          </div>
        ) : null}
        {o.kind === "available" ? (
          <div>
            <dt className="label">Price</dt>
            <dd>
              <MonoAmount value={v.price} account={v.account} size="lg" />
            </dd>
          </div>
        ) : null}
      </dl>
      <div className="flex flex-wrap gap-2">
        {o.kind === "available" ? (
          <LinkButton href={`/buy/${slug}/${o.ref.unit}`} variant="primary">
            Reserve →
          </LinkButton>
        ) : null}
        <LinkButton href={unitHref}>View unit</LinkButton>
        {onShare ? (
          <Button onClick={onShare}>
            <Share2 className="h-4 w-4" aria-hidden /> Share result
          </Button>
        ) : null}
      </div>
    </BracketCard>
  );
}
