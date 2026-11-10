"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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
import { CountUp, usePrefersReducedMotion } from "./motion";
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
    <svg viewBox="0 0 400 420" className="h-auto w-full max-w-md" role="img" aria-label="Isometric drawing of a four-storey apartment block: three floors built, the top floor dashed as not yet built, with unit 4B marked in orange.">
      <path d="M20 44V20h24M356 20h24v24M380 376v24h-24M44 400H20v-24" stroke="#FF9211" strokeWidth="1.5" fill="none" />
      {floors.map((i) => {
        const P: [number, number] = [200, 360 - i * H];
        const up = (q: [number, number]): [number, number] => [q[0], q[1] - H];
        const add = (a: [number, number], b: [number, number]): [number, number] => [a[0] + b[0], a[1] + b[1]];
        const left = pts(P, add(P, L), up(add(P, L)), up(P));
        const right = pts(P, add(P, R), up(add(P, R)), up(P));
        const top = pts(up(P), up(add(P, R)), up(add(add(P, R), L)), up(add(P, L)));
        const dashed = i === 3;
        const stroke = { stroke: "#FF9211", strokeWidth: 1.5, strokeDasharray: dashed ? "5 5" : undefined, fill: dashed ? "none" : "#090909" };
        return (
          <motion.g
            key={i}
            initial={reduce ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: reduce ? 0 : 0.2 + i * 0.35, ease: "easeOut" }}
          >
            <polygon points={left} {...stroke} className={dashed ? "march" : undefined} />
            <polygon points={right} {...stroke} className={dashed ? "march" : undefined} />
            {i === 3 ? <polygon points={top} {...stroke} className="march" /> : null}
            {[0.25, 0.55].map((t) => {
              const a: [number, number] = [P[0] + R[0] * t + 8, P[1] + R[1] * t - 12];
              return <path key={t} d={`M${a[0]} ${a[1]}l18 -10.5v-14l-18 10.5z`} stroke="#FF9211" strokeWidth="1" fill="none" opacity={dashed ? 0.5 : 0.7} strokeDasharray={dashed ? "3 3" : undefined} />;
            })}
            {[0.3, 0.65].map((t) => {
              const a: [number, number] = [P[0] + L[0] * t - 8, P[1] + L[1] * t - 12];
              return <path key={t} d={`M${a[0]} ${a[1]}l-18 -10.5v-14l18 10.5z`} stroke="#FF9211" strokeWidth="1" fill="none" opacity={dashed ? 0.5 : 0.7} strokeDasharray={dashed ? "3 3" : undefined} />;
            })}
            {i === 3 ? (
              <circle className="ping" cx={P[0] + R[0] * 0.55 + 17} cy={P[1] + R[1] * 0.55 - 31} r="5" fill="#FF9211" />
            ) : null}
            {i === 3 ? (
              <motion.circle
                cx={P[0] + R[0] * 0.55 + 17}
                cy={P[1] + R[1] * 0.55 - 31}
                r="5"
                fill="#FD8D37"
                initial={reduce ? false : { scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: reduce ? 0 : 1.8, duration: 0.3 }}
              />
            ) : null}
          </motion.g>
        );
      })}
      <text x="292" y="148" fill="#FD8D37" fontFamily="var(--font-jet), monospace" fontSize="12">
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

/** Live totals across the configured estates; null = not known yet (shows "—", never a made-up number). */
export function useLiveTotals() {
  const estates = useAllEstates();
  const ms = useAllMilestones();
  const okE = estates.filter((x) => x.q.data);
  const okM = ms.filter((x) => x.q.data);
  return {
    loading: estates.some((x) => x.q.isLoading),
    link: okE[0]?.account ?? DEMO_ESTATE,
    units: okE.length ? okE.reduce((n, x) => n + (x.q.data?.unit_count ?? 0), 0) : null,
    escrow: okE.length ? okE.reduce((n, x) => n + toBig(x.q.data?.totals.in_escrow), 0n) : null,
    verified: okM.length ? okM.reduce((n, x) => n + (x.q.data ?? []).filter((m) => m.status === "Verified" || m.status === "Approved").length, 0) : null,
    refunds: okE.length ? okE.reduce((n, x) => n + (x.q.data?.stats.units_refunded ?? 0), 0) : null,
  };
}

function LiveValue({ v, loading }: { v: string | null; loading: boolean }) {
  if (loading && v === null) return <span className="skeleton inline-block h-8 w-20 align-middle" />;
  return v === null ? <span aria-label="not available">—</span> : <CountUp value={v} />;
}

/** "Plote in numbers": four live counters, each linking to the chain. */
export function LiveStrip() {
  const t = useLiveTotals();
  const items: [string, string | null][] = [
    ["Units on Plote", t.units === null ? null : String(t.units)],
    ["USDC in escrow", t.escrow === null ? null : formatUsd(t.escrow)],
    ["Milestones verified", t.verified === null ? null : String(t.verified)],
    ["Refunds paid", t.refunds === null ? null : String(t.refunds)],
  ];
  return (
    <div>
      <dl className="grid grid-cols-2 lg:grid-cols-4">
        {items.map(([k, v], i) => (
          <div key={k} data-reveal className={clsx("border-white/10 px-1 py-6 sm:px-6", i % 2 === 1 && "border-l", i >= 2 && "border-t lg:border-t-0", i > 0 && "lg:border-l")}>
            <dd className="mono flex items-baseline gap-2 text-[30px] tabular-nums sm:text-[40px]" aria-busy={t.loading}>
              <LiveValue v={v} loading={t.loading} />
              <ChainLink account={t.link} />
            </dd>
            <dt className="mt-1 text-sm uppercase tracking-[0.08em] text-muted">{k}</dt>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-sm text-muted">Live from NEAR {IS_MAINNET ? "mainnet" : "testnet"}. Every number links to the chain.</p>
    </div>
  );
}

/** Hero glass card: the live escrow figure. */
export function LiveEscrowCard() {
  const t = useLiveTotals();
  return (
    <div data-reveal className="glass flex h-full flex-col justify-between gap-4 rounded-2xl p-6">
      <p className="text-sm text-muted">USDC held in unit escrow · live</p>
      <p className="mono text-[40px] leading-none tabular-nums sm:text-[48px]">
        <LiveValue v={t.escrow === null ? null : formatUsd(t.escrow)} loading={t.loading} />
      </p>
      <p className="flex items-center gap-2 text-xs text-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-orange" aria-hidden /> across {t.units === null ? "—" : t.units} units on NEAR {IS_MAINNET ? "mainnet" : "testnet"}
        <ChainLink account={t.link} />
      </p>
    </div>
  );
}

/** Live estate cards (Core's news-card row). */
export function EstateCards() {
  const estates = useAllEstates();
  return (
    <div className="grid gap-5 md:grid-cols-3">
      {estates.map(({ account, q }) => {
        const e = q.data;
        const slug = estateSlug(account);
        const name = e?.name ?? slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        return (
          <Link key={account} href={`/estates/${slug}`} data-reveal className="group flex flex-col overflow-hidden rounded-2xl bg-surface ring-1 ring-white/[0.08] transition-[box-shadow,translate] duration-300 hover:-translate-y-1 hover:ring-orange/40">
            <div className="glow-sky relative h-40">
              <span className="absolute left-5 top-5 rounded-full bg-black/30 px-3 py-1 text-xs text-text/90 ring-1 ring-white/15">{slug === "playground" ? "Judge sandbox" : "Demo estate"}</span>
              <svg viewBox="0 0 120 80" className="absolute bottom-0 right-4 h-32 w-auto opacity-70" aria-hidden>
                {[0, 1, 2, 3].map((f) => (
                  <path key={f} d={`M30 ${70 - f * 14}l30 -12l30 12l-30 12z M30 ${70 - f * 14}v-12 M90 ${70 - f * 14}v-12`} fill="none" stroke={f === 3 ? "#FD8D37" : "#FF9211"} strokeWidth="1" opacity={f === 3 ? 0.9 : 0.6} />
                ))}
              </svg>
            </div>
            <div className="flex flex-1 flex-col gap-2 p-6">
              <p className="text-lg">{name}</p>
              <p className="text-sm text-muted">{e?.location || (q.isLoading ? "Loading…" : q.error ? "Awaiting deployment" : "")}</p>
              <p className="mono mt-auto pt-3 text-sm text-muted">
                {e ? `${e.unit_count} units · ${formatUsd(toBig(e.totals.in_escrow))} in escrow` : "—"}
              </p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

// ---------------- the token that does something: live NFT with stage toggle ----------------

const STAGES = ["Foundation", "Roofing", "Finishing", "Handover"];

const STAGE_MS = 2200;

/**
 * The token drawn at each stage. It plays through the stages on its own (before → Foundation → Roofing → Finishing →
 * Handover, then again); tap a stage to hold it, tap it again to resume. Paused off-screen and under reduced motion.
 */
export function NftShowcase() {
  const unitQ = useQuery({ queryKey: ["unit", DEMO_ESTATE, "a-4b"], queryFn: () => E.getUnit(DEMO_ESTATE, "a-4b"), retry: 0 });
  const msQ = useQuery({ queryKey: ["milestones", DEMO_ESTATE], queryFn: () => E.getMilestones(DEMO_ESTATE), retry: 0 });
  const estQ = useQuery({ queryKey: ["estate", DEMO_ESTATE], queryFn: () => E.getEstate(DEMO_ESTATE), retry: 0 });
  const live = approvedCount(msQ.data);
  const reduce = usePrefersReducedMotion();
  const [held, setHeld] = useState<number | null>(null); // a stage the visitor picked (0..3)
  const [step, setStep] = useState(0); // autoplay position: 0 = nothing proven yet, 1..4 = stages proven
  const [visible, setVisible] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const playing = !reduce && held === null && visible;

  useEffect(() => {
    if (!box.current || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.25 });
    io.observe(box.current);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => setStep((s) => (s + 1) % 5), step === 4 ? STAGE_MS * 1.6 : STAGE_MS);
    return () => clearTimeout(t);
  }, [playing, step]);

  const shown = held !== null ? held + 1 : reduce ? live : step;
  const active = held !== null ? held : reduce ? null : step - 1; // chip to highlight
  const u = unitQ.data;
  return (
    <BracketCard className="space-y-4">
      <div ref={box}>
        <HouseNFT
          animated
          estateName={estQ.data?.name ?? "Harmattan Court"}
          unitLabel="A-4B"
          unitId="a-4b"
          approvedCount={shown}
          total={msQ.data?.length || 4}
          status={shown >= 4 ? "HandedOver" : shown > 0 && !reduce ? "Allocated" : (u?.status ?? "—")}
          paid={u?.paid ?? "0"}
          price={u?.price ?? "0"}
        />
      </div>
      <div>
        <p className="label">{held !== null ? "Holding at" : reduce ? "Show at" : "Playing through each stage"}</p>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Show the token at a stage">
          {STAGES.map((s, i) => (
            <button
              key={s}
              type="button"
              aria-pressed={held === i}
              onClick={() => setHeld(held === i ? null : i)}
              className={clsx("btn btn-sm relative overflow-hidden", active === i ? "border-orange/60 bg-orange/10 text-orange" : "btn-ghost")}
            >
              {s}
              {playing && active === i ? (
                <span key={step} aria-hidden className="chip-progress absolute inset-x-0 bottom-0 h-[2px] bg-orange" style={{ animationDuration: `${step === 4 ? STAGE_MS * 1.6 : STAGE_MS}ms` }} />
              ) : null}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">
          {held !== null
            ? "Holding this stage. Tap it again to keep playing."
            : reduce
              ? u ? `Live: ${live} of ${msQ.data?.length ?? 4} milestones approved.` : "Live state unavailable — showing the drawing."
              : `A preview of how the token changes. Live: ${live} of ${msQ.data?.length ?? 4} approved.`}
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
      <div className="corners corners-orange relative aspect-[4/3] overflow-hidden bg-surface-2">
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
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-orange" aria-hidden /> <span className="sr-only">Passed:</span> {t}
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
        <li key={c} className="rounded-full bg-white/[0.05] px-4 py-2 text-sm ring-1 ring-white/10">
          {chainName(c)}
        </li>
      ))}
    </ul>
  );
}

// ---------------- phone mockup: WhatsApp preview + watch timeline ----------------

export function PhoneMockup() {
  return (
    <div className="mx-auto w-[260px] rounded-[24px] border border-line bg-surface p-3 shadow-2xl" aria-hidden>
      <div className="rounded-[20px] bg-[#0b141a] p-3">
        <div className="ml-auto max-w-[85%] rounded-lg bg-[#005c4b] p-2 text-[11px] text-white/90">
          <div className="overflow-hidden rounded bg-bg">
            <HouseNFT estateName="Harmattan Court" unitLabel="A-4B" unitId="a-4b" approvedCount={2} total={4} status="Allocated" paid="0" price="0" className="aspect-[300/200] w-full object-cover object-top" />
            <div className="p-2">
              <p className="font-normal text-white">A-4B at Harmattan Court is 50% built</p>
              <p className="text-white/60">plote.app</p>
            </div>
          </div>
          <p className="mt-1">Mum, this is the flat. You can watch every stage here 👆</p>
        </div>
        <div className="mt-3 space-y-2 rounded bg-bg p-2">
          {["Foundation", "Roofing", "Finishing", "Handover"].map((s, i) => (
            <div key={s} className="flex items-center gap-2 text-[11px]">
              <span className={clsx("h-2 w-2 rounded-full", i < 2 ? "bg-orange" : "bg-line")} />
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
        <Link href="/dev/estates/new" className="font-normal text-text underline hover:text-orange">
          Put your estate on Plote →
        </Link>
      </p>
    </div>
  );
}
