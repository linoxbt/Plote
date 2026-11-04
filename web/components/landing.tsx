"use client";

import Link from "next/link";
import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { CheckCircle2 } from "lucide-react";
import { ESTATES, IS_MAINNET } from "@/lib/config";
import { approvedCount, estate as E } from "@/lib/estate";
import { estateSlug, unitAccount } from "@/lib/estates";
import { formatUsd, formatDuration, nsToMs, toBig } from "@/lib/format";
import { useAllEstates, useAllMilestones } from "@/lib/hooks";
import { chainName, oneclick, PICKER_CHAINS, STABLE_SYMBOLS } from "@/lib/oneclick";
import { CheckChip, CheckInput, type CheckOutcome } from "./check";
import { HouseNFT } from "./house-nft";
import { BracketCard, ChainLink, LinkButton } from "./ui";

const DEMO_ESTATE = ESTATES.find((e) => estateSlug(e) === "harmattan-court") ?? ESTATES[0] ?? "harmattan-court.plote.testnet";

// ---------------- hero: isometric apartment block ----------------

const R: [number, number] = [86, -50];
const L: [number, number] = [-86, -50];
const H = 42;

function pts(...p: [number, number][]) {
  return p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}

export function HeroBlock() {
  const reduce = useReducedMotion();
  const floors = [0, 1, 2, 3];
  return (
    <svg viewBox="0 0 400 420" className="h-auto w-full max-w-md" role="img" aria-label="Isometric drawing of a four-storey apartment block: three floors built, the top floor dashed as not yet built, with unit 4B marked in gold.">
      <path d="M20 44V20h24M356 20h24v24M380 376v24h-24M44 400H20v-24" stroke="#2DD4BF" strokeWidth="1.5" fill="none" />
      {floors.map((i) => {
        const P: [number, number] = [200, 360 - i * H];
        const up = (q: [number, number]): [number, number] => [q[0], q[1] - H];
        const add = (a: [number, number], b: [number, number]): [number, number] => [a[0] + b[0], a[1] + b[1]];
        const left = pts(P, add(P, L), up(add(P, L)), up(P));
        const right = pts(P, add(P, R), up(add(P, R)), up(P));
        const top = pts(up(P), up(add(P, R)), up(add(add(P, R), L)), up(add(P, L)));
        const dashed = i === 3;
        const stroke = { stroke: "#2DD4BF", strokeWidth: 1.5, strokeDasharray: dashed ? "5 5" : undefined, fill: dashed ? "none" : "#0A0B0D" };
        return (
          <motion.g
            key={i}
            initial={reduce ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: reduce ? 0 : 0.2 + i * 0.35, ease: "easeOut" }}
          >
            <polygon points={left} {...stroke} />
            <polygon points={right} {...stroke} />
            {i === 3 ? <polygon points={top} {...stroke} /> : null}
            {[0.25, 0.55].map((t) => {
              const a: [number, number] = [P[0] + R[0] * t + 8, P[1] + R[1] * t - 12];
              return <path key={t} d={`M${a[0]} ${a[1]}l18 -10.5v-14l-18 10.5z`} stroke="#2DD4BF" strokeWidth="1" fill="none" opacity={dashed ? 0.5 : 0.7} strokeDasharray={dashed ? "3 3" : undefined} />;
            })}
            {[0.3, 0.65].map((t) => {
              const a: [number, number] = [P[0] + L[0] * t - 8, P[1] + L[1] * t - 12];
              return <path key={t} d={`M${a[0]} ${a[1]}l-18 -10.5v-14l18 10.5z`} stroke="#2DD4BF" strokeWidth="1" fill="none" opacity={dashed ? 0.5 : 0.7} strokeDasharray={dashed ? "3 3" : undefined} />;
            })}
            {i === 3 ? (
              <motion.circle
                cx={P[0] + R[0] * 0.55 + 17}
                cy={P[1] + R[1] * 0.55 - 31}
                r="5"
                fill="#E8B04B"
                initial={reduce ? false : { scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: reduce ? 0 : 1.8, duration: 0.3 }}
              />
            ) : null}
          </motion.g>
        );
      })}
      <text x="292" y="148" fill="#E8B04B" fontFamily="var(--font-jet), monospace" fontSize="12">
        4B
      </text>
    </svg>
  );
}

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

// ---------------- live strip ----------------

export function LiveStrip() {
  const estates = useAllEstates();
  const ms = useAllMilestones();
  const okE = estates.filter((x) => x.q.data);
  const okM = ms.filter((x) => x.q.data);
  const loading = estates.some((x) => x.q.isLoading);
  const units = okE.length ? okE.reduce((n, x) => n + (x.q.data?.unit_count ?? 0), 0) : null;
  const escrow = okE.length ? okE.reduce((n, x) => n + toBig(x.q.data?.totals.in_escrow), 0n) : null;
  const verified = okM.length ? okM.reduce((n, x) => n + (x.q.data ?? []).filter((m) => m.status === "Verified" || m.status === "Approved").length, 0) : null;
  const refunds = okE.length ? okE.reduce((n, x) => n + (x.q.data?.stats.units_refunded ?? 0), 0) : null;
  const link = okE[0]?.account ?? DEMO_ESTATE;
  const items: [string, string | null][] = [
    ["UNITS ON PLOTE", units === null ? null : String(units)],
    ["USDC IN ESCROW", escrow === null ? null : formatUsd(escrow)],
    ["MILESTONES VERIFIED", verified === null ? null : String(verified)],
    ["REFUNDS PAID", refunds === null ? null : String(refunds)],
  ];
  return (
    <div>
      <dl className="grid grid-cols-2 gap-px bg-line md:grid-cols-4">
        {items.map(([k, v]) => (
          <div key={k} className="bg-bg p-4 sm:p-5">
            <dt className="mono text-[11px] tracking-[0.12em] text-muted">{k}</dt>
            <dd className="mono mt-1 flex items-baseline gap-1 text-2xl tabular-nums sm:text-3xl" aria-busy={loading}>
              {loading && v === null ? <span className="skeleton inline-block h-7 w-16" /> : (v ?? <span aria-label="not available">—</span>)}
              <ChainLink account={link} />
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-sm text-muted">Live from NEAR {IS_MAINNET ? "mainnet" : "testnet"}. Every number links to the chain.</p>
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
        <li key={c} className="mono corners bg-surface px-3 py-2 text-sm">
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
