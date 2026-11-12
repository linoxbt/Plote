"use client";

// Function-call keys the app holds in this browser (SPEC §4 "Keys on each account", §9.1):
// shows whether the key is stored here AND present on-chain, and offers to add / remove it.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Zap } from "lucide-react";
import { useTx } from "@/components/toast";
import { useWallet } from "@/components/wallet";
import { Button } from "@/components/ui";
import { addLoginKey, appKeyPublic, forgetLoginKey, removeAppKey, viewAccessKey, type AppKeyRole } from "@/lib/near";

export type AppKeyState = "none" | "pending" | "active";

/** Is the stored key for (account, contract, role) present on-chain? Polls briefly after sign-in while it lands. */
export function useAppKey(contractId: string, role: AppKeyRole) {
  const { accountId } = useWallet();
  const q = useQuery({
    queryKey: ["app-key", accountId, contractId, role],
    enabled: !!accountId && typeof window !== "undefined",
    retry: 0,
    refetchInterval: (query) => (query.state.data?.state === "pending" && query.state.dataUpdateCount < 12 ? 5000 : false),
    queryFn: async (): Promise<{ state: AppKeyState; publicKey: string | null; methods: string[] }> => {
      const pk = await appKeyPublic(accountId!, contractId, role);
      if (!pk) return { state: "none", publicKey: null, methods: [] };
      const ak = await viewAccessKey(accountId!, pk).catch(() => null);
      if (!ak || ak.permission === "FullAccess") return { state: "pending", publicKey: pk, methods: [] };
      const fc = ak.permission.FunctionCall;
      return { state: fc.receiver_id === contractId ? "active" : "pending", publicKey: pk, methods: fc.method_names };
    },
  });
  return q;
}

export function AppKeyToggle({
  contractId, role, methods, enableLabel, activeLabel, success,
}: {
  contractId: string; role: AppKeyRole; methods: string[]; enableLabel: string; activeLabel: string; success: string;
}) {
  const { accountId } = useWallet();
  const { run } = useTx();
  const qc = useQueryClient();
  const key = useAppKey(contractId, role);
  if (!accountId) return null;
  const refresh = () => qc.invalidateQueries({ queryKey: ["app-key", accountId, contractId, role] });
  const state = key.data?.state ?? "none";
  const Icon = role === "dev" ? KeyRound : Zap;

  if (state === "active") {
    return (
      <p className="mono flex flex-wrap items-center gap-2 text-xs text-orange">
        <Icon className="h-3.5 w-3.5" aria-hidden /> {activeLabel}
        <Button size="sm" className="min-h-9 text-muted underline" onClick={async () => {
          const r = await run("Remove key", () => removeAppKey(accountId, contractId, role).then(() => true), { success: "Key deleted from your account." });
          if (r) await refresh();
        }}>remove key</Button>
      </p>
    );
  }
  return (
    <div className="space-y-1">
      {state === "pending" ? (
        <p className="mono text-xs text-amber">
          A key was requested but isn&apos;t on your account yet (your wallet may not support adding it at sign-in).{" "}
          <Button size="sm" className="min-h-9 underline" onClick={() => forgetLoginKey(accountId, contractId, role).then(refresh)}>forget it</Button>
        </p>
      ) : null}
      <Button
        size="sm"
        onClick={async () => {
          const r = await run(enableLabel, () => addLoginKey(accountId, contractId, methods, role), { success });
          if (r) refresh();
        }}
      >
        <Icon className="h-4 w-4" aria-hidden /> {enableLabel}
      </Button>
    </div>
  );
}
