"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { LogOut, Wallet as WalletIcon } from "lucide-react";
import { LOGIN_KEY_METHODS } from "@/lib/estate";
import { loginKeyContract } from "@/lib/estates";
import { getConnector, signInWithLoginKey } from "@/lib/near";
import { truncateAccount } from "@/lib/format";
import { Button } from "./ui";

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

  useEffect(() => {
    let alive = true;
    getConnector()
      .then(async (c) => {
        c.on("wallet:signIn", (t) => {
          if (!alive) return;
          setAccountId(t.accounts[0]?.accountId ?? null);
          setWalletName(t.wallet?.manifest?.name ?? null);
        });
        c.on("wallet:signOut", () => {
          if (!alive) return;
          setAccountId(null);
          setWalletName(null);
        });
        try {
          const { wallet, accounts } = await c.getConnectedWallet();
          if (alive) {
            setAccountId(accounts[0]?.accountId ?? null);
            setWalletName(wallet.manifest?.name ?? null);
          }
        } catch {
          /* not signed in */
        }
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      // SPEC §9.1: sign-in also asks for the login function-call key for the estate in view (when the wallet supports it).
      const { wallet, accountId } = await signInWithLoginKey(loginKeyContract(window.location.pathname), LOGIN_KEY_METHODS);
      setAccountId(accountId);
      setWalletName(wallet.manifest?.name ?? null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/reject|cancel|closed/i.test(msg)) setError(msg);
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      const c = await getConnector();
      await c.disconnect();
    } catch {
      /* already disconnected */
    }
    setAccountId(null);
    setWalletName(null);
  }, []);

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
        <a href="/me" className="btn btn-ghost corners btn-sm mono max-w-[11rem]" title={accountId}>
          <span className="h-1.5 w-1.5 rounded-full bg-teal" aria-hidden />
          <span className="truncate">{truncateAccount(accountId, compact ? 14 : 20)}</span>
        </a>
        <button type="button" className="btn btn-ghost btn-sm min-w-11 px-2" onClick={disconnect} aria-label="Disconnect wallet" title="Disconnect">
          <LogOut className="h-4 w-4" strokeWidth={1.5} aria-hidden />
        </button>
      </div>
    );
  }
  return (
    <Button size="sm" onClick={connect} loading={connecting}>
      <WalletIcon className="h-4 w-4" strokeWidth={1.5} aria-hidden />[Connect wallet]
    </Button>
  );
}

/** Renders children only when a wallet is connected; otherwise a connect prompt. */
export function RequireWallet({ children, what = "this" }: { children: ReactNode; what?: string }) {
  const { accountId, ready, connect, connecting } = useWallet();
  if (accountId) return <>{children}</>;
  return (
    <div className="corners bg-surface flex flex-col items-center gap-3 p-8 text-center">
      <WalletIcon className="h-7 w-7 text-muted" strokeWidth={1.5} aria-hidden />
      <p className="font-display text-lg">Connect a NEAR wallet to use {what}.</p>
      <p className="max-w-md text-sm text-muted">Your NEAR account is your identity on Plote. No passwords, no sign-up.</p>
      <Button variant="primary" onClick={connect} loading={connecting || !ready}>
        Connect wallet
      </Button>
    </div>
  );
}
