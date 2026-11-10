"use client";

// TxToast: pending → success with tx link → error with plain message (raw code collapsible).

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckCircle2, ChevronDown, Loader2, X, XCircle } from "lucide-react";
import { clsx } from "clsx";
import { explainError } from "@/lib/errors";
import type { TxResult } from "@/lib/near";
import { explorerTxUrl } from "./ui";

type Toast = {
  id: number;
  state: "pending" | "success" | "error";
  title: string;
  message?: string;
  hash?: string;
  code?: string;
  raw?: string;
};

type Ctx = {
  run: <T extends TxResult | TxResult[] | void | unknown>(title: string, fn: () => Promise<T>, opts?: { success?: string }) => Promise<T | undefined>;
  push: (t: Omit<Toast, "id">) => void;
};

const ToastCtx = createContext<Ctx>({ run: async () => undefined, push: () => {} });

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const update = (id: number, patch: Partial<Toast>) => setToasts((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const remove = (id: number) => setToasts((ts) => ts.filter((t) => t.id !== id));

  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = nextId++;
    setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
    if (t.state !== "pending") setTimeout(() => remove(id), t.state === "success" ? 8000 : 20000);
  }, []);

  const run = useCallback(async <T,>(title: string, fn: () => Promise<T>, opts?: { success?: string }) => {
    const id = nextId++;
    setToasts((ts) => [...ts.slice(-3), { id, state: "pending", title, message: "Waiting for the wallet and the network…" }]);
    try {
      const res = await fn();
      const r = (Array.isArray(res) ? res[res.length - 1] : res) as TxResult | undefined;
      update(id, { state: "success", message: opts?.success ?? "Done.", hash: r && typeof r === "object" && "hash" in r ? r.hash : undefined });
      setTimeout(() => remove(id), 8000);
      return res;
    } catch (e) {
      const x = explainError(e);
      const hash = (e as { txHash?: string })?.txHash;
      update(id, { state: "error", message: x.message, code: x.code, raw: x.raw, hash });
      setTimeout(() => remove(id), 30000);
      return undefined;
    }
  }, []);

  return (
    <ToastCtx.Provider value={{ run, push }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end" aria-live="polite">
        {toasts.map((t) => (
          <ToastView key={t.id} t={t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastView({ t, onClose }: { t: Toast; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const Icon = t.state === "pending" ? Loader2 : t.state === "success" ? CheckCircle2 : XCircle;
  return (
    <div
      role={t.state === "error" ? "alert" : "status"}
      className={clsx(
        "corners pointer-events-auto w-full max-w-sm bg-surface-2 p-4 shadow-lg",
        t.state === "success" && "corners-orange",
        t.state === "error" && "corners-red",
        t.state === "pending" && "corners-amber",
      )}
    >
      <div className="flex items-start gap-3">
        <Icon
          className={clsx("mt-0.5 h-5 w-5 shrink-0", t.state === "pending" && "animate-spin text-amber", t.state === "success" && "text-orange", t.state === "error" && "text-red")}
          strokeWidth={1.5}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            <span className="sr-only">{t.state === "pending" ? "Pending: " : t.state === "success" ? "Success: " : "Failed: "}</span>
            {t.title}
          </p>
          {t.message ? <p className="text-sm text-muted">{t.message}</p> : null}
          {t.hash ? (
            <a className="mono mt-1 inline-block text-xs text-orange underline" href={explorerTxUrl(t.hash)} target="_blank" rel="noreferrer">
              View transaction ↗
            </a>
          ) : null}
          {t.code ? (
            <button type="button" className="mono mt-1 flex min-h-8 items-center gap-1 text-xs text-muted" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
              <ChevronDown className={clsx("h-3 w-3", open && "rotate-180")} aria-hidden /> {t.code}
            </button>
          ) : null}
          {open && t.raw ? <pre className="mono mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all text-[11px] text-muted">{t.raw}</pre> : null}
        </div>
        <button type="button" onClick={onClose} className="-m-2 flex h-11 w-11 items-center justify-center text-muted hover:text-text" aria-label="Dismiss">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

export function useTx() {
  return useContext(ToastCtx);
}
