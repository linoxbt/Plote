"use client";

import { useState } from "react";
import { Zap } from "lucide-react";
import { LOGIN_KEY_METHODS } from "@/lib/estate";
import { addLoginKey, forgetLoginKey, getLoginKey } from "@/lib/near";
import { useTx } from "@/components/toast";
import { useWallet } from "@/components/wallet";
import { Button } from "@/components/ui";

/** Adds the login function-call key so votes are signed without a wallet popup (SPEC §8.4, §9.1). */
export function LoginKeyToggle({ contractId }: { contractId: string }) {
  const { accountId } = useWallet();
  const { run } = useTx();
  const [has, setHas] = useState(() => (typeof window !== "undefined" && accountId ? !!getLoginKey(accountId, contractId) : false));
  if (!accountId) return null;
  if (has || getLoginKey(accountId, contractId)) {
    return (
      <p className="mono flex flex-wrap items-center gap-2 text-xs text-teal">
        <Zap className="h-3.5 w-3.5" aria-hidden /> One-tap voting is on for this estate.
        <button type="button" className="min-h-9 underline text-muted" onClick={() => { forgetLoginKey(accountId, contractId); setHas(false); }}>
          forget key
        </button>
      </p>
    );
  }
  return (
    <Button
      size="sm"
      onClick={async () => {
        const r = await run("Enable one-tap voting", () => addLoginKey(accountId, contractId, LOGIN_KEY_METHODS), {
          success: "A function-call key (0.25 NEAR gas allowance, this estate only) was added. Votes no longer need a popup.",
        });
        if (r) setHas(true);
      }}
    >
      <Zap className="h-4 w-4" aria-hidden /> Enable one-tap voting
    </Button>
  );
}
