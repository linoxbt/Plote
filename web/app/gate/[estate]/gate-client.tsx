"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, RotateCcw, XCircle } from "lucide-react";
import { clsx } from "clsx";
import { Button, Page } from "@/components/ui";
import { estateAccount } from "@/lib/estates";
import { explainError } from "@/lib/errors";
import { useEstate } from "@/lib/hooks";

/** POST /api/gate/verify's answer, plus "retry": the check couldn't run (rate limit, NEAR unreachable), which is not a denial. */
type GateResult =
  | { ok: true; unit: string; label: string; accountId: string }
  | { ok: false; reason: string; code?: string; unit?: string }
  | { retry: true; reason: string };

/** Server-side check (signature, key, holder, handover) with a single-use nonce claim shared by every guard device. */
async function verifyOnServer(estate: string, pass: string): Promise<GateResult> {
  let res: Response;
  try {
    res = await fetch("/api/gate/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ estate, pass }) });
  } catch {
    return { retry: true, reason: "No connection. Check the phone's signal and scan again." };
  }
  const j = (await res.json().catch(() => null)) as (Record<string, unknown> & { ok?: boolean }) | null;
  if (res.status === 429 || res.status === 503 || res.status >= 500 || !j) {
    return { retry: true, reason: typeof j?.message === "string" ? j.message : "Can't check passes right now. Try again in a moment." };
  }
  if (!res.ok) return { ok: false, reason: typeof j.message === "string" ? j.message : "This isn't a valid gate pass.", code: typeof j.code === "string" ? j.code : undefined };
  if (j.ok === true) return { ok: true, unit: String(j.unit), label: String(j.label ?? ""), accountId: String(j.accountId ?? "") };
  return { ok: false, reason: String(j.reason ?? "Pass rejected."), code: typeof j.code === "string" ? j.code : undefined, unit: typeof j.unit === "string" ? j.unit : undefined };
}

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
      setResult(await verifyOnServer(account, text.trim()));
    } catch (e) {
      setResult({ retry: true, reason: explainError(e).message });
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
      <h1 className="text-3xl font-normal">Gate · {est.data?.name ?? slug}</h1>
      <p className="mb-4 text-muted">Scan the holder&apos;s gate pass. Verification is public: the signature, the key and the token are checked against the chain, and each pass opens the gate once, on any guard&apos;s phone.</p>
      {result && "retry" in result ? (
        <div className="corners corners-amber flex flex-col items-center gap-4 p-10 text-center" role="alert">
          <RotateCcw className="h-24 w-24 text-amber" strokeWidth={1.25} aria-hidden />
          <p className="font-display text-4xl font-medium text-amber">TRY AGAIN</p>
          <p className="text-lg">{result.reason}</p>
          <p className="text-sm text-muted">The pass wasn&apos;t checked, so this is not a denial.</p>
          <Button variant="primary" onClick={start}><Camera className="h-4 w-4" aria-hidden /> Scan again</Button>
        </div>
      ) : result ? (
        <div className={clsx("corners flex flex-col items-center gap-4 p-10 text-center", result.ok ? "corners-orange bg-orange-dim/30" : "corners-red bg-red/10")} role="alert">
          {result.ok ? <CheckCircle2 className="h-32 w-32 text-orange-ink" strokeWidth={1.25} aria-hidden /> : <XCircle className="h-32 w-32 text-red" strokeWidth={1.25} aria-hidden />}
          <p className={clsx("font-display text-5xl font-medium", result.ok ? "text-orange-ink" : "text-red")}>{result.ok ? "OPEN" : "DENIED"}</p>
          {result.unit ? <p className="mono text-3xl">{result.unit.toUpperCase()}</p> : null}
          <p className="text-lg">{result.ok ? `${result.label} · ${result.accountId}` : result.reason}</p>
          <Button variant="primary" onClick={start}><Camera className="h-4 w-4" aria-hidden /> Scan next</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="corners corners-orange relative aspect-square overflow-hidden bg-surface-2">
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
