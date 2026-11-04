"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, XCircle } from "lucide-react";
import { clsx } from "clsx";
import { Button, Page } from "@/components/ui";
import { estateAccount } from "@/lib/estates";
import { verifyGatePass, type GateResult } from "@/lib/gate";
import { explainError } from "@/lib/errors";
import { useEstate } from "@/lib/hooks";

export function GateClient({ slug }: { slug: string }) {
  const account = estateAccount(slug);
  const est = useEstate(account);
  const video = useRef<HTMLVideoElement>(null);
  const controls = useRef<{ stop: () => void } | null>(null);
  const busy = useRef(false);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<GateResult | null>(null);
  const [camErr, setCamErr] = useState<string | null>(null);
  const [paste, setPaste] = useState("");

  const check = useCallback(async (text: string) => {
    if (busy.current) return;
    busy.current = true;
    try {
      setResult(await verifyGatePass(text, account));
    } catch (e) {
      setResult({ ok: false, reason: explainError(e).message });
    } finally {
      busy.current = false;
    }
  }, [account]);

  const stop = () => {
    controls.current?.stop();
    controls.current = null;
    setScanning(false);
  };

  const start = async () => {
    setCamErr(null);
    setResult(null);
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      const reader = new BrowserQRCodeReader();
      setScanning(true);
      controls.current = await reader.decodeFromConstraints({ video: { facingMode: "environment" } }, video.current!, (res) => {
        if (res) {
          stop();
          check(res.getText());
        }
      });
    } catch (e) {
      setScanning(false);
      setCamErr(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => () => controls.current?.stop(), []);

  return (
    <Page narrow>
      <h1 className="text-3xl font-semibold">Gate · {est.data?.name ?? slug}</h1>
      <p className="mb-4 text-muted">Scan the holder&apos;s gate pass. Verification is public: the signature, the key and the token are checked against the chain.</p>
      {result ? (
        <div className={clsx("corners flex flex-col items-center gap-4 p-10 text-center", result.ok ? "corners-teal bg-teal-dim/30" : "corners-red bg-red/10")} role="alert">
          {result.ok ? <CheckCircle2 className="h-32 w-32 text-teal" strokeWidth={1.25} aria-hidden /> : <XCircle className="h-32 w-32 text-red" strokeWidth={1.25} aria-hidden />}
          <p className={clsx("font-display text-5xl font-bold", result.ok ? "text-teal" : "text-red")}>{result.ok ? "OPEN" : "DENIED"}</p>
          {result.unit ? <p className="mono text-3xl">{result.unit.toUpperCase()}</p> : null}
          <p className="text-lg">{result.ok ? `${result.label} · ${result.accountId}` : result.reason}</p>
          <Button variant="primary" onClick={start}><Camera className="h-4 w-4" aria-hidden /> Scan next</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="corners corners-teal relative aspect-square overflow-hidden bg-surface-2">
            <video ref={video} className="h-full w-full object-cover" muted playsInline aria-label="Camera preview" />
            {!scanning ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <Button variant="primary" onClick={start}><Camera className="h-4 w-4" aria-hidden /> Start camera</Button>
              </div>
            ) : null}
          </div>
          {scanning ? <Button onClick={stop}>Stop camera</Button> : null}
          {camErr ? <p className="text-sm text-red">Camera unavailable: {camErr}</p> : null}
          <details className="text-sm">
            <summary className="min-h-11 cursor-pointer text-muted">No camera? Paste the pass</summary>
            <textarea className="input mt-2" value={paste} onChange={(e) => setPaste(e.target.value)} aria-label="Gate pass JSON" />
            <Button className="mt-2" onClick={() => check(paste)}>Verify</Button>
          </details>
        </div>
      )}
    </Page>
  );
}
