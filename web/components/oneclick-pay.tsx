"use client";

// Path B: pay from another chain through 1Click (mainnet build only, SPEC §7.3).

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";
import { Copy } from "lucide-react";
import { chainName, oneclick, PICKER_CHAINS, STABLE_SYMBOLS, type QuoteResponse } from "@/lib/oneclick";
import { explainError } from "@/lib/errors";
import { formatUsd } from "@/lib/format";
import { BracketCard, Button, ErrorState, Field, LoadingCard } from "./ui";
import { CountdownChip } from "./chain";

export function QrImage({ text, size = 220, label }: { text: string; size?: number; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(text, { margin: 1, width: size, color: { dark: "#0A0B0D", light: "#E9ECEF" } })
      .then((u) => alive && setSrc(u))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [text, size]);
  return src ? <img src={src} width={size} height={size} alt={label} className="bg-text p-1" /> : <div className="skeleton" style={{ width: size, height: size }} aria-hidden />;
}

export function OneClickPay({ estate, unit, recipient, amount }: { estate: string; unit: string; recipient: string; amount: string }) {
  const tokens = useQuery({ queryKey: ["oneclick-tokens"], queryFn: oneclick.tokens, staleTime: 600_000, retry: 1 });
  const options = useMemo(
    () => (tokens.data ?? []).filter((t) => STABLE_SYMBOLS.includes(t.symbol.toUpperCase()) && PICKER_CHAINS.includes(t.blockchain) && t.blockchain !== "near"),
    [tokens.data],
  );
  const [asset, setAsset] = useState("");
  const [refundTo, setRefundTo] = useState("");
  const [chipName, setChipName] = useState("");
  const [wet, setWet] = useState<QuoteResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const chosen = options.find((o) => o.assetId === asset) ?? options[0];
  const dry = useQuery({
    queryKey: ["oneclick-dry", chosen?.assetId, amount, recipient],
    queryFn: () => oneclick.quote({ dry: true, originAsset: chosen!.assetId, amount, refundTo: refundTo || "0x0000000000000000000000000000000000000000", recipient, estate, unit }),
    enabled: !!chosen && BigInt(amount || "0") > 0n,
    retry: 0,
    refetchInterval: 30_000,
  });

  if (tokens.isLoading) return <LoadingCard lines={3} label="Loading chains" />;
  if (tokens.error) return <ErrorState error={tokens.error} title="Couldn't load the chains 1Click supports" onRetry={() => tokens.refetch()} />;

  if (wet?.quote.depositAddress) {
    const addr = wet.quote.depositAddress;
    return (
      <BracketCard tone="teal" className="space-y-4">
        <p className="font-display text-xl font-semibold">Send exactly {wet.quote.amountInFormatted} {chosen?.symbol} on {chainName(chosen?.blockchain ?? "")}</p>
        <div className="flex flex-col items-start gap-4 sm:flex-row">
          <QrImage text={addr} label="QR code of the deposit address" />
          <div className="min-w-0 space-y-2">
            <p className="label">Deposit address</p>
            <p className="mono break-all text-sm">{addr}</p>
            <Button size="sm" onClick={() => navigator.clipboard?.writeText(addr).catch(() => {})}><Copy className="h-4 w-4" aria-hidden /> Copy</Button>
            {wet.quote.deadline ? <div><CountdownChip until={String(Date.parse(wet.quote.deadline) * 1e6)} label="quote valid" /></div> : null}
            <p className="text-sm text-muted">The unit receives {wet.quote.amountOutFormatted} USDC. Cross-chain payments can take up to 15 minutes.</p>
          </div>
        </div>
        <Link href={`/pay/status/${encodeURIComponent(addr)}`} className="btn btn-primary">Track this payment →</Link>
      </BracketCard>
    );
  }

  return (
    <div className="space-y-4">
      <Field label="Pay with" htmlFor="oc-asset">
        <select id="oc-asset" className="input" value={chosen?.assetId ?? ""} onChange={(e) => setAsset(e.target.value)}>
          {options.map((o) => <option key={o.assetId} value={o.assetId}>{o.symbol} on {chainName(o.blockchain)}</option>)}
        </select>
      </Field>
      <Field label={`Your ${chosen ? chainName(chosen.blockchain) : ""} address (for refunds)`} htmlFor="oc-refund" hint="If the swap can't complete, 1Click refunds here.">
        <input id="oc-refund" className="input" value={refundTo} onChange={(e) => setRefundTo(e.target.value.trim())} placeholder="0x… or your Solana address" />
      </Field>
      <Field label="Name for the family wall (optional)" htmlFor="oc-name"><input id="oc-name" className="input" maxLength={40} value={chipName} onChange={(e) => setChipName(e.target.value)} /></Field>
      <BracketCard className="mono text-sm">
        {dry.isLoading ? "Getting a quote…" : dry.data ? (
          <p>You send ≈ {dry.data.quote.amountInFormatted} {chosen?.symbol} · unit receives {dry.data.quote.amountOutFormatted} USDC{dry.data.quote.timeEstimate ? ` · ~${Math.ceil(dry.data.quote.timeEstimate / 60)} min` : ""}</p>
        ) : dry.error ? <span className="text-red">{explainError(dry.error).message}</span> : `Unit receives ${formatUsd(amount)} USDC`}
      </BracketCard>
      {err ? <ErrorState error={err} title="Couldn't create the deposit address" /> : null}
      <Button
        variant="primary"
        loading={busy}
        disabled={!chosen || refundTo.length < 20}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            setWet(await oneclick.quote({ dry: false, originAsset: chosen!.assetId, amount, refundTo, recipient, estate, unit, chipName: chipName || undefined }));
          } catch (e) {
            setErr(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        Get deposit address
      </Button>
    </div>
  );
}
