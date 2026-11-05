"use client";

// "The NFT is the unit": a live token inspector, the token's on-chain art, and what the token does —
// each ability tied to the contract call that checks it (contracts/estate/src: nft.rs, payments.rs,
// resale.rs, votes.rs; gate pass = NEP-413).

import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ESTATES, IS_MAINNET } from "@/lib/config";
import { estate as E } from "@/lib/estate";
import { estateSlug, unitAccount } from "@/lib/estates";
import { explainError } from "@/lib/errors";
import { formatUsd, toBig } from "@/lib/format";
import { HudTag } from "./hud";
import { NftShowcase } from "./landing";
import { ChainLink } from "./ui";

const DEMO = ESTATES.find((e) => estateSlug(e) === "harmattan-court") ?? ESTATES[0] ?? "harmattan-court.plote.testnet";
const TOKEN = "a-4b";

const ABILITIES: { title: string; call: string; body: string }[] = [
  { title: "Holds the money", call: "a-4b.harmattan-court", body: "Payments sit in the unit's own NEAR account, not the developer's. The token is the key to that account." },
  { title: "Pulls a refund", call: "refund(\"a-4b\")", body: "Only the token's holder can call it, once a stage deadline is missed. Everything not yet released comes back." },
  { title: "Sells in one step", call: "list_for_sale → ft_transfer_call", body: "The buyer's USDC and the token swap in a single transaction. Nobody holds either side in between." },
  { title: "Protects you if you fall behind", call: "declare_default", body: "Miss instalments and the token is resold for what you paid, minus a fixed 5%. Not forfeited." },
  { title: "Gives you a vote", call: "vote(id, approve)", body: "One vote per token: replace the surveyor, veto a sign-off or freeze payments. Tokens bought mid-vote can't swing it." },
  { title: "Opens the gate", call: "NEP-413 signature", body: "After handover the holder signs a gate pass on their phone. The guard's phone checks it against the chain." },
];

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] items-baseline gap-4 border-t border-[var(--line-soft)] py-2.5">
      <dt className="tech text-[8.5px] text-faint">{k}</dt>
      <dd className="mono min-w-0 truncate text-[12.5px] text-text">{children}</dd>
    </div>
  );
}

/** What a block explorer would show for the token, read live from the estate contract. */
function TokenInspector() {
  const unitQ = useQuery({ queryKey: ["unit", DEMO, TOKEN], queryFn: () => E.getUnit(DEMO, TOKEN), retry: 0 });
  const tokQ = useQuery({ queryKey: ["nft-token", DEMO, TOKEN], queryFn: () => E.nftToken(DEMO, TOKEN), retry: 0 });
  const pending = [unitQ.error, tokQ.error].some((e) => e && explainError(e).code === "CONTRACT_NOT_DEPLOYED");
  const u = unitQ.data;
  const held = u ? toBig(u.paid) - toBig(u.released) - toBig(u.refunded_out) : null;
  const owner = tokQ.data?.owner_id ?? u?.holder ?? null;
  const unitAcc = unitAccount(DEMO, TOKEN);
  return (
    <div className="corners panel relative p-5 sm:p-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <HudTag className="text-[7.5px]">Token inspector</HudTag>
        <span className="tech text-[8px] text-faint">{pending ? "Awaiting deployment" : `Live · NEAR ${IS_MAINNET ? "mainnet" : "testnet"}`}</span>
      </div>
      <dl>
        <Row k="Token ID">{TOKEN}</Row>
        <Row k="Contract">
          {DEMO} <ChainLink account={DEMO} />
        </Row>
        <Row k="Standards">NEP-171 · 177 · 178 · 181</Row>
        <Row k="Owner">{owner ?? (pending ? "— not deployed yet" : "— unminted · reserve to mint")}</Row>
        <Row k="Holds">
          {held === null ? "—" : `${formatUsd(held)} in escrow`} <span className="text-faint">in</span> {unitAcc} <ChainLink account={unitAcc} />
        </Row>
        <Row k="Status">{u?.status ?? "—"}</Row>
        <Row k="Image">drawn on-chain from the unit&apos;s state, every view</Row>
      </dl>
    </div>
  );
}

export function NftSection() {
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] lg:gap-14">
      <div className="space-y-5">
        <NftShowcase />
        <p className="text-[12.5px] text-muted">
          The token&apos;s picture isn&apos;t a file someone uploaded. The contract draws it from the unit&apos;s state each time it&apos;s viewed: each
          proven stage fills in teal, and the windows turn gold at handover. Tap a stage to preview.
        </p>
      </div>
      <div className="space-y-8">
        <TokenInspector />
        <ol className="grid gap-px bg-[var(--line-soft)] sm:grid-cols-2">
          {ABILITIES.map((a, i) => (
            <li key={a.title} className="space-y-2 bg-[rgba(2,3,20,0.72)] p-5">
              <div className="flex items-center gap-3">
                <span className="tech text-[8.5px] text-teal tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                <span className="tech text-[10.5px] text-text">{a.title}</span>
              </div>
              <code className="mono inline-block bg-surface-2/70 px-1.5 py-0.5 text-[11px] text-teal">{a.call}</code>
              <p className="text-[12.5px] text-muted">{a.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
