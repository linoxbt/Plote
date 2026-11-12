"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { LogOut, Wallet as WalletIcon } from "lucide-react";
import { NETWORK } from "@/lib/config";
import { explainError } from "@/lib/errors";
import { LOGIN_KEY_METHODS } from "@/lib/estate";
import { accountNetworkMismatch, loginKeyContract } from "@/lib/estates";
import { forgetAllAppKeys, getConnector, signInWithLoginKey } from "@/lib/near";
import { truncateAccount } from "@/lib/format";
import { useTx } from "./toast";
import { Button } from "./ui";

/** The visitor closed the wallet picker or declined in the wallet: not an error worth a toast. */
export function isUserCancel(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e ?? "");
  return /reject|cancel|closed|denied|dismiss|abort/i.test(msg);
}

type WalletCtx = {
  accountId: string | null;
  walletName: string | null;
  ready: boolean;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
};

const Ctx = createContext<WalletCtx>({
  accountId: null, walletName: null, ready: false, connecting: false, error: null,
  connect: async () => {}, disconnect: async () => {},
});

export function WalletProvider({ children }: { children: ReactNode }) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { push } = useTx();

  /** Accept an account only when it belongs to this build's network; otherwise sign the wallet out again. */
  const adopt = useCallback((id: string | null, name: string | null): boolean => {
    const mismatch = id ? accountNetworkMismatch(id, NETWORK) : null;
    if (mismatch) {
      setAccountId(null);
      setWalletName(null);
      setError(mismatch);
      void getConnector().then((c) => c.disconnect()).catch(() => undefined);
      return false;
    }
    setAccountId(id);
    setWalletName(name);
    return true;
  }, []);

  useEffect(() => {
    let alive = true;
    getConnector()
      .then(async (c) => {
        c.on("wallet:signIn", (t) => {
          if (!alive) return;
          adopt(t.accounts[0]?.accountId ?? null, t.wallet?.manifest?.name ?? null);
        });
        c.on("wallet:signOut", () => {
          if (!alive) return;
          setAccountId(null);
          setWalletName(null);
        });
        try {
          const { wallet, accounts } = await c.getConnectedWallet();
          if (alive) adopt(accounts[0]?.accountId ?? null, wallet.manifest?.name ?? null);
        } catch {
          /* no wallet connected yet: the normal signed-out state */
        }
      })
      // The wallet selector itself failed to load (blocked script, offline). Kept for RequireWallet; Connect retries and toasts.
      .catch((e) => alive && setError(explainError(e).message))
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, [adopt]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      // SPEC §9.1: sign-in also asks for the login function-call key for the estate in view (when the wallet supports it).
      const { wallet, accountId } = await signInWithLoginKey(loginKeyContract(window.location.pathname), LOGIN_KEY_METHODS);
      if (!adopt(accountId, wallet.manifest?.name ?? null)) {
        if (accountId) await forgetAllAppKeys(accountId);
        push({ state: "error", title: "Wrong network", message: accountNetworkMismatch(accountId ?? "", NETWORK) ?? undefined });
      }
    } catch (e) {
      if (!isUserCancel(e)) {
        const x = explainError(e);
        setError(x.message);
        push({ state: "error", title: "Couldn't connect your wallet", message: x.message, code: x.code, raw: x.raw });
      }
    } finally {
      setConnecting(false);
    }
  }, [push, adopt]);

  const disconnect = useCallback(async () => {
    const was = accountId;
    try {
      const c = await getConnector();
      await c.disconnect();
    } catch {
      /* already disconnected */
    }
    // Signing out of the site also forgets the app keys this browser holds for the account, so whoever uses the
    // browser next can't sign with them. (They stay on the account, scoped and capped, until removed with the wallet.)
    if (was) await forgetAllAppKeys(was).catch(() => 0);
    setAccountId(null);
    setWalletName(null);
  }, [accountId]);

  const value = useMemo(
    () => ({ accountId, walletName, ready, connecting, error, connect, disconnect }),
    [accountId, walletName, ready, connecting, error, connect, disconnect],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet() {
  return useContext(Ctx);
}

export function ConnectButton({ compact = false }: { compact?: boolean }) {
  const { accountId, connect, disconnect, connecting } = useWallet();
  if (accountId) {
    return (
      <div className="flex items-center gap-1">
        <Link href="/me" prefetch={false} className="btn btn-ghost btn-sm mono max-w-[11rem]" title={accountId}>
          <span className="h-1.5 w-1.5 rounded-full bg-orange" aria-hidden />
          <span className="truncate">{truncateAccount(accountId, compact ? 14 : 20)}</span>
        </Link>
        <button type="button" className="btn btn-ghost btn-sm min-w-11 px-2" onClick={disconnect} aria-label="Disconnect wallet" title="Disconnect">
          <LogOut className="h-4 w-4" strokeWidth={1.5} aria-hidden />
        </button>
      </div>
    );
  }
  return (
    <Button size="sm" onClick={connect} loading={connecting}>
      <WalletIcon className="h-4 w-4" strokeWidth={1.5} aria-hidden />Connect wallet
    </Button>
  );
}

/** Renders children only when a wallet is connected; otherwise a connect prompt. */
export function RequireWallet({ children, what = "this" }: { children: ReactNode; what?: string }) {
  const { accountId, ready, connect, connecting, error } = useWallet();
  if (accountId) return <>{children}</>;
  return (
    <div className="corners bg-surface flex flex-col items-center gap-3 p-8 text-center">
      <WalletIcon className="h-7 w-7 text-muted" strokeWidth={1.5} aria-hidden />
      <p className="font-display text-lg">Connect a NEAR wallet to use {what}.</p>
      <p className="max-w-md text-sm text-muted">Your NEAR account is your identity on Plote. No passwords, no sign-up.</p>
      <Button variant="primary" onClick={connect} loading={connecting || !ready}>
        Connect wallet
      </Button>
      {error ? (
        <p role="alert" className="max-w-md text-sm text-red">
          Couldn&apos;t connect: {error} Try again, or pick a different wallet.
        </p>
      ) : null}
    </div>
  );
}
