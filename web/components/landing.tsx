"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { CheckCircle2 } from "lucide-react";
import { ESTATES } from "@/lib/config";
import { approvedCount, estate as E } from "@/lib/estate";
import { estateSlug, unitAccount } from "@/lib/estates";
import { formatUsd, formatDuration, nsToMs, toBig } from "@/lib/format";
import { useAllEstates, useAllMilestones } from "@/lib/hooks";
import { explainError } from "@/lib/errors";
import { chainName, oneclick, PICKER_CHAINS, STABLE_SYMBOLS } from "@/lib/oneclick";
import { CheckChip, CheckInput, type CheckOutcome } from "./check";
import { HouseNFT } from "./house-nft";
import { BracketCard, ChainLink, LinkButton } from "./ui";
import { HudTag } from "./hud";

const DEMO_ESTATE = ESTATES.find((e) => estateSlug(e) === "harmattan-court") ?? ESTATES[0] ?? "harmattan-court.plote.testnet";

export function HeroCheck() {
  const [o, setO] = useState<CheckOutcome | null>(null);
  return (
    <div className="space-y-3">
      <CheckInput onResult={setO} id="hero-check" />
      <div aria-live="polite" className="min-h-11">
        {o ? <CheckChip o={o} /> : null}
      </div>
    </div>
  );
}

// ---------------- hero stats (instrument readouts) ----------------

/** Live totals across the configured estates. An estate whose contract isn't deployed yet holds
 * nothing, so it counts as zero; anything else that fails leaves the number unknown (null). */
export function useLiveNumbers() {
  const estates = useAllEstates();
  const ms = useAllMilestones();
  const loading = estates.some((x) => x.q.isLoading);
  const absent = (e: unknown) => !!e && explainError(e).code === "CONTRACT_NOT_DEPLOYED";
  const known = estates.every((x) => x.q.data || absent(x.q.error));
  const okE = estates.filter((x) => x.q.data);
  const okM = ms.filter((x) => x.q.data);
  const any = okE.length > 0 || known;
  const deployed = okE.length;
  return {
    loading,
    deployed,
    pending: known && deployed === 0,
    link: okE[0]?.account ?? DEMO_ESTATE,
    units: any ? okE.reduce((n, x) => n + (x.q.data?.unit_count ?? 0), 0) : null,
    escrow: any ? okE.reduce((n, x) => n + toBig(x.q.data?.totals.in_escrow), 0n) : null,
    verified: any ? okM.reduce((n, x) => n + (x.q.data ?? []).filter((m) => m.status === "Verified" || m.status === "Approved").length, 0) : null,
    refunds: any ? okE.reduce((n, x) => n + (x.q.data?.stats.units_refunded ?? 0), 0) : null,
    paid: okE.reduce((n, x) => n + toBig(x.q.data?.totals.paid), 0n),
    released: okE.reduce((n, x) => n + toBig(x.q.data?.totals.released), 0n),
    refunded: okE.reduce((n, x) => n + toBig(x.q.data?.totals.refunded), 0n),
  };
}

function Stat({ label, value, loading, link }: { label: string; value: React.ReactNode; loading: boolean; link?: string }) {
  return (
    <div role="listitem" className="flex flex-col items-start gap-2">
      <HudTag className="text-[7.5px]">{label}</HudTag>
      <span className="readout inline-flex items-baseline gap-1 text-[26px] text-text/90 sm:text-[30px]" aria-busy={loading || undefined}>
        {loading ? <span className="skeleton inline-block h-6 w-16" /> : value}
        {link ? <ChainLink account={link} /> : null}
      </span>
    </div>
  );
}

/** The four live numbers under the hero: boxed label over a thin readout, one row on desktop. */
export function HeroStats({ className }: { className?: string }) {
  const n = useLiveNumbers();
  const dash = <span aria-label="not available">—</span>;
  const v = (x: string | null) => (x === null ? dash : x);
  const l = n.loading;
  return (
    <div className={className}>
      <div role="list" aria-label="Live numbers" className="grid grid-cols-2 gap-x-6 gap-y-6 border-t border-[var(--line-soft)] pt-6 lg:grid-cols-4">
        <Stat label="UNITS ON PLOTE" value={v(n.units === null ? null : String(n.units))} loading={l && n.units === null} link={n.link} />
        <Stat label="USDC IN ESCROW" value={v(n.escrow === null ? null : formatUsd(n.escrow))} loading={l && n.escrow === null} />
        <Stat label="MILESTONES VERIFIED" value={v(n.verified === null ? null : String(n.verified))} loading={l && n.verified === null} />
        <Stat label="REFUNDS PAID" value={v(n.refunds === null ? null : String(n.refunds))} loading={l && n.refunds === null} />
      </div>
      {n.pending ? <p className="tech mt-4 text-[8.5px] text-faint">Demo estates deploying to testnet · counters start at zero</p> : null}
    </div>
  );
}

// ---------------- the token that does something: live NFT with stage toggle ----------------

const STAGES = ["Foundation", "Roofing", "Finishing", "Handover"];

export function NftShowcase() {
  const unitQ = useQuery({ queryKey: ["unit", DEMO_ESTATE, "a-4b"], queryFn: () => E.getUnit(DEMO_ESTATE, "a-4b"), retry: 0 });
  const msQ = useQuery({ queryKey: ["milestones", DEMO_ESTATE], queryFn: () => E.getMilestones(DEMO_ESTATE), retry: 0 });
  const estQ = useQuery({ queryKey: ["estate", DEMO_ESTATE], queryFn: () => E.getEstate(DEMO_ESTATE), retry: 0 });
  const live = approvedCount(msQ.data);
  const [stage, setStage] = useState<number | null>(null);
  const shown = stage === null ? live : stage + 1;
  const u = unitQ.data;
  return (
    <BracketCard className="space-y-4">
      <HouseNFT
        estateName={estQ.data?.name ?? "Harmattan Court"}
        unitLabel="A-4B"
        unitId="a-4b"
        approvedCount={shown}
        total={msQ.data?.length || 4}
        status={stage === 3 ? "HandedOver" : (u?.status ?? "—")}
        paid={u?.paid ?? "0"}
        price={u?.price ?? "0"}
      />
      <div>
        <p className="label">Show at</p>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Show the token at a stage">
          {STAGES.map((s, i) => (
            <button
              key={s}
              type="button"
              aria-pressed={stage === i}
              onClick={() => setStage(stage === i ? null : i)}
              className={clsx("btn btn-sm corners", stage === i ? "corners-teal text-teal" : "btn-ghost")}
            >
              {s}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">
          {stage === null ? (u ? `Live: ${live} of ${msQ.data?.length ?? 4} milestones approved.` : "Live state unavailable — showing the drawing.") : "Preview. Tap again to go back to live."}
          <ChainLink account={unitAccount(DEMO_ESTATE, "a-4b")} />
        </p>
      </div>
    </BracketCard>
  );
}

// ---------------- proof, not promises: one real proof card ----------------

export function LiveProofCard() {
  const q = useQuery({
    queryKey: ["evidence-list", DEMO_ESTATE, "landing"],
    queryFn: () => E.listEvidence(DEMO_ESTATE, { limit: 20 }),
    retry: 0,
  });
  const est = useQuery({ queryKey: ["estate", DEMO_ESTATE], queryFn: () => E.getEstate(DEMO_ESTATE), retry: 0 });
  const ms = useQuery({ queryKey: ["milestones", DEMO_ESTATE], queryFn: () => E.getMilestones(DEMO_ESTATE), retry: 0 });
  const ev = q.data?.find((e) => e.status === "Pass" && e.verdict);
  const v = ev?.verdict;
  const age = v?.exif_time && ev ? nsToMs(ev.submitted_at) - nsToMs(v.exif_time) : null;
  const rows: [string, boolean][] = ev && v
    ? [
        [v.distance_m != null ? `Taken ${v.distance_m} m from site` : "Taken on site", true],
        [age !== null ? `Taken ${formatDuration(age)} before upload` : "Fresh capture", true],
        [`Never used before (nearest match ${v.nearest_distance}/64)`, true],
        [v.ai_stage ? `Shows ${v.ai_stage} — ${v.ai_confidence ?? "?"}% confidence` : "Stage checked", true],
        [`Challenge code ${ev.challenge} in frame`, true],
        ...(ms.data?.[ev.milestone]?.signed_at ? [[`Signed by QS ${est.data?.surveyor_id ?? "—"}`, true] as [string, boolean]] : []),
      ]
    : [];
  return (
    <BracketCard className="grid gap-5 md:grid-cols-[1fr_1.2fr]">
      <div className="corners corners-teal relative aspect-[4/3] overflow-hidden bg-surface-2">
        {ev ? <img src={ev.url} alt="Milestone photo from the demo estate" className="h-full w-full object-cover" loading="lazy" /> : (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted">
            {q.isLoading ? "Loading the latest proof…" : "No passed proof on-chain yet. The first one appears here once the demo estate is seeded."}
          </div>
        )}
      </div>
      <div className="space-y-3">
        {ev ? (
          <ul className="space-y-2">
            {rows.map(([t]) => (
              <li key={t} className="mono flex items-start gap-2 text-sm">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal" aria-hidden /> <span className="sr-only">Passed:</span> {t}
              </li>
            ))}
          </ul>
        ) : (
          <ul className="mono space-y-2 text-sm text-muted">
            {["Taken — m from site", "Taken — before upload", "Never used before (nearest match —/64)", "Shows — · —% confidence", "Signed by QS —"].map((t) => (
              <li key={t}>○ {t}</li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted">
          Checked inside an Intel TDX enclave on OutLayer, with stage recognition by NEAR AI Cloud. The code that checks it is public, and its fingerprint is on-chain.
        </p>
        <LinkButton href={ev ? `/proof/${estateSlug(DEMO_ESTATE)}/${ev.id}` : `/estates/${estateSlug(DEMO_ESTATE)}/milestones`} variant="primary">
          Open the full proof →
        </LinkButton>
      </div>
    </BracketCard>
  );
}

// ---------------- chain chips (from /v0/tokens, filtered) ----------------

export function ChainChips() {
  const q = useQuery({ queryKey: ["oneclick-tokens"], queryFn: oneclick.tokens, retry: 0, staleTime: 600_000 });
  const fromApi = q.data
    ? Array.from(new Set(q.data.filter((t) => STABLE_SYMBOLS.includes(t.symbol.toUpperCase()) && PICKER_CHAINS.includes(t.blockchain)).map((t) => t.blockchain)))
    : [];
  const chains = fromApi.length ? PICKER_CHAINS.filter((c) => fromApi.includes(c) || c === "near") : PICKER_CHAINS;
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Supported chains">
      {chains.map((c) => (
        <li key={c} className="tech corners panel px-3 py-2.5 text-[11px] text-text">
          {chainName(c)}
        </li>
      ))}
    </ul>
  );
}

// ---------------- phone mockup: WhatsApp preview + watch timeline ----------------

export function PhoneMockup() {
  return (
    <div className="mx-auto w-[260px] rounded-[28px] border border-line bg-surface p-3 shadow-2xl" aria-hidden>
      <div className="rounded-[20px] bg-[#0b141a] p-3">
        <div className="ml-auto max-w-[85%] rounded-lg bg-[#005c4b] p-2 text-[11px] text-white/90">
          <div className="overflow-hidden rounded bg-bg">
            <HouseNFT estateName="Harmattan Court" unitLabel="A-4B" unitId="a-4b" approvedCount={2} total={4} status="Allocated" paid="0" price="0" className="aspect-[300/200] w-full object-cover object-top" />
            <div className="p-2">
              <p className="font-semibold text-white">A-4B at Harmattan Court is 50% built</p>
              <p className="text-white/60">plote.app</p>
            </div>
          </div>
          <p className="mt-1">Mum, this is the flat. You can watch every stage here 👆</p>
        </div>
        <div className="mt-3 space-y-2 rounded bg-bg p-2">
          {["Foundation", "Roofing", "Finishing", "Handover"].map((s, i) => (
            <div key={s} className="flex items-center gap-2 text-[11px]">
              <span className={clsx("h-2 w-2 rounded-full", i < 2 ? "bg-teal" : "bg-line")} />
              <span className={i < 2 ? "text-text" : "text-muted"}>{s}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SourceLinks() {
  const s = [
    ["TechEconomy", "https://techeconomy.ng/?p=164669"],
    ["Nigeria Housing Market", "https://www.nigeriahousingmarket.com/news/20-real-estate-scams-nigerian-property-buyers-must-avoid"],
    ["allAfrica", "https://allafrica.com/stories/202601290263.html"],
    ["Guardian Nigeria", "https://guardian.ng/property/diasporan-investors-drive-growth-expose-fault-lines-in-real-estate-sector/"],
    ["Nation (Kenya)", "https://nation.africa/kenya/news/off-plan-scams-from-dream-homes-to-dust--5347430"],
  ];
  return (
    <p className="text-xs text-muted">
      Sources:{" "}
      {s.map(([n, u], i) => (
        <span key={n}>
          <a href={u} target="_blank" rel="noreferrer" className="underline hover:text-text">
            {n}
          </a>
          {i < s.length - 1 ? " · " : ""}
        </span>
      ))}
    </p>
  );
}

export function WatchExampleLink() {
  return (
    <LinkButton href={`/w/${estateSlug(DEMO_ESTATE)}/a-4b`} variant="primary">
      See an example
    </LinkButton>
  );
}

export const LANDING_ESTATE_SLUG = estateSlug(DEMO_ESTATE);

export function FinalCta() {
  return (
    <div className="space-y-4">
      <CheckInput navigate id="final-check" />
      <p className="text-sm text-muted">
        Developer?{" "}
        <Link href="/dev/estates/new" className="font-semibold text-text underline hover:text-teal">
          Put your estate on Plote →
        </Link>
      </p>
    </div>
  );
}
