"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Sun } from "lucide-react";
import { CountdownChip } from "@/components/chain";
import { QrImage } from "@/components/oneclick-pay";
import { RequireWallet, useWallet } from "@/components/wallet";
import { BracketCard, Button, ErrorState, LoadingCard, Page } from "@/components/ui";
import { explainError } from "@/lib/errors";
import { estateAccount, estateSlug } from "@/lib/estates";
import { msToNs, unitDisplay } from "@/lib/format";
import { useEstate, useUnit } from "@/lib/hooks";
import { bytesToBase64, getWallet } from "@/lib/near";
import { encodeGatePass, gateMessage, randomNonce } from "@/lib/nep413";

const ROTATE_MS = 50_000;

export function PassClient({ slug, unitId }: { slug: string; unitId: string }) {
  const account = estateAccount(slug);
  const est = useEstate(account);
  const unit = useUnit(account, unitId);
  const { accountId } = useWallet();
  const [pass, setPass] = useState<{ text: string; at: number } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sign = useCallback(async () => {
    if (!accountId) return;
    setBusy(true);
    setErr(null);
    try {
      const nonce = randomNonce();
      const message = gateMessage(estateSlug(account), unitId);
      const w = await getWallet();
      const signed = await w.signMessage({ message, recipient: account, nonce });
      setPass({ text: encodeGatePass({ accountId: signed.accountId || accountId, publicKey: signed.publicKey, signature: signed.signature, nonce: bytesToBase64(nonce), message }), at: Date.now() });
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }, [accountId, account, unitId]);

  // Rotate every ROTATE_MS while the page is visible. When it's hidden at the due time, keep re-arming (cheap) instead
  // of stopping, and refresh as soon as the page becomes visible again with an expired pass.
  useEffect(() => {
    if (!pass) return;
    const due = pass.at + ROTATE_MS;
    const tick = () => {
      if (document.visibilityState === "visible") void sign();
      else timer.current = setTimeout(tick, 5000);
    };
    timer.current = setTimeout(tick, Math.max(0, due - Date.now()));
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() >= due) {
        if (timer.current) clearTimeout(timer.current);
        void sign();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pass, sign]);

  if (est.isLoading || unit.isLoading) return <Page narrow><LoadingCard /></Page>;
  if (!unit.data) return <Page narrow><ErrorState error={unit.error ?? { message: "E_UNIT_NOT_FOUND" }} /></Page>;
  const u = unit.data;
  return (
    <Page narrow>
      <h1 className="text-3xl font-normal">Gate pass · <span className="mono">{unitDisplay(u.id)}</span></h1>
      <p className="mb-6 text-muted">{est.data?.name}. Show this to the guard. It&apos;s a message signed by your wallet and expires after 60 seconds.</p>
      <RequireWallet what="your gate pass">
        {u.status !== "HandedOver" ? (
          <BracketCard tone="amber">The gate pass works after handover. {unitDisplay(u.id)} is {u.status}.</BracketCard>
        ) : u.holder !== accountId ? (
          <BracketCard tone="red">This wallet doesn&apos;t hold {unitDisplay(u.id)}.</BracketCard>
        ) : (
          <BracketCard tone="accent" className="flex flex-col items-center gap-4 text-center">
            {pass ? (
              <>
                <QrImage text={pass.text} size={300} label={`Gate pass QR for ${unitDisplay(u.id)}`} />
                <CountdownChip until={msToNs(pass.at + ROTATE_MS)} label="refreshes" tone="orange" />
              </>
            ) : <p className="text-muted">Sign once to show your pass.</p>}
            <Button variant="accent" loading={busy} onClick={sign}><RefreshCw className="h-4 w-4" aria-hidden /> {pass ? "Refresh now" : "Show my pass"}</Button>
            <p className="flex items-center gap-2 text-xs text-muted"><Sun className="h-4 w-4" aria-hidden /> Turn your screen brightness up so the guard&apos;s camera can read it.</p>
            {err ? <p className="text-sm text-red">{explainError(err).message}</p> : null}
          </BracketCard>
        )}
      </RequireWallet>
    </Page>
  );
}
