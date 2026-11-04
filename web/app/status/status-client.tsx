"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle, XCircle, Loader2 } from "lucide-react";
import { clsx } from "clsx";
import { BracketCard, Button } from "@/components/ui";
import { ESTATES, RPC_URLS } from "@/lib/config";
import { estate as E } from "@/lib/estate";
import { explainError } from "@/lib/errors";
import { timeAgo } from "@/lib/format";
import { nodeStatus } from "@/lib/near";

type Level = "green" | "amber" | "red" | "loading";
type Row = { name: string; level: Level; detail: string };

const ICON = { green: CheckCircle2, amber: AlertTriangle, red: XCircle, loading: Loader2 };
const WORD = { green: "Operational", amber: "Degraded", red: "Down", loading: "Checking" };
const COLOR = { green: "text-teal", amber: "text-amber", red: "text-red", loading: "text-muted" };

function RowView({ r }: { r: Row }) {
  const I = ICON[r.level];
  return (
    <li className="flex items-start justify-between gap-4 border-b border-line/60 py-3 last:border-0">
      <div className="min-w-0">
        <p className="font-medium">{r.name}</p>
        <p className="mono break-all text-xs text-muted">{r.detail}</p>
      </div>
      <span className={clsx("mono flex shrink-0 items-center gap-1.5 text-xs font-semibold uppercase", COLOR[r.level])}>
        <I className={clsx("h-4 w-4", r.level === "loading" && "animate-spin")} aria-hidden /> {WORD[r.level]}
      </span>
    </li>
  );
}

export function StatusClient() {
  const rpc = useQuery({ queryKey: ["status-rpc"], queryFn: () => Promise.all(RPC_URLS.map((u) => nodeStatus(u))), refetchInterval: 30_000 });
  const estates = useQuery({
    queryKey: ["status-estates"],
    refetchInterval: 30_000,
    queryFn: () =>
      Promise.all(
        ESTATES.map(async (e) => {
          try {
            const est = await E.getEstate(e);
            let last: string | null = null;
            try {
              const evs = await E.listEvidence(e, { limit: 10 });
              last = evs.find((x) => x.verdict)?.submitted_at ?? null;
            } catch {
              /* optional */
            }
            return { e, ok: true as const, name: est.name, last };
          } catch (err) {
            return { e, ok: false as const, error: explainError(err) };
          }
        }),
      ),
  });
  const health = useQuery({
    queryKey: ["status-health"],
    refetchInterval: 60_000,
    queryFn: async () => (await fetch("/api/health")).json() as Promise<Record<string, { ok: boolean; detail: string; configured?: boolean }>>,
  });

  const rows: Row[] = [];
  if (!rpc.data) rows.push({ name: "NEAR RPC", level: "loading", detail: RPC_URLS.join(" · ") });
  else
    rpc.data.forEach((r, i) =>
      rows.push({ name: i === 0 ? "NEAR RPC (primary)" : "NEAR RPC (fallback)", level: r.ok ? "green" : i === 0 && rpc.data.some((x) => x.ok) ? "amber" : "red", detail: `${RPC_URLS[i]} · ${r.ok ? `block ${r.height} · ${r.ms} ms` : r.error}` }),
    );
  if (!estates.data) rows.push({ name: "Estate contracts", level: "loading", detail: ESTATES.join(", ") });
  else
    estates.data.forEach((x) =>
      rows.push(x.ok ? { name: `Estate view · ${x.name}`, level: "green", detail: x.e } : { name: `Estate view · ${x.e}`, level: "red", detail: `${x.error.code}: ${x.error.message}` }),
    );
  const lastVerdict = estates.data?.map((x) => (x.ok ? x.last : null)).filter(Boolean).sort().pop() ?? null;
  rows.push({ name: "OutLayer (last verdict)", level: estates.data ? (lastVerdict ? "green" : "amber") : "loading", detail: lastVerdict ? `last verdict on evidence submitted ${timeAgo(lastVerdict)}` : "no verdict seen yet" });
  const h = health.data;
  for (const [k, name] of [["nearai", "NEAR AI Cloud (/v1/models)"], ["oneclick", "1Click (/v0/tokens)"], ["supabase", "Supabase"], ["relayer", "Relayer"]] as const) {
    const v = h?.[k];
    rows.push({ name, level: !h ? (health.error ? "red" : "loading") : v?.ok ? "green" : v?.configured === false ? "amber" : "red", detail: v?.detail ?? (health.error ? "health endpoint unreachable" : "…") });
  }
  return (
    <BracketCard>
      <ul>{rows.map((r) => <RowView key={r.name} r={r} />)}</ul>
      <div className="mt-4"><Button size="sm" onClick={() => { rpc.refetch(); estates.refetch(); health.refetch(); }}>Re-check</Button></div>
    </BracketCard>
  );
}
