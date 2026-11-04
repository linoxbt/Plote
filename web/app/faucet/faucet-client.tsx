"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Coins } from "lucide-react";
import { MonoAmount } from "@/components/chain";
import { useTx } from "@/components/toast";
import { RequireWallet, useWallet } from "@/components/wallet";
import { BracketCard, Button, LinkButton } from "@/components/ui";
import { USDC_ID } from "@/lib/config";
import { useUsdcBalance, useUsdcRegistered } from "@/lib/hooks";
import { sendTx, sendTxs } from "@/lib/near";
import { FAUCET_AMOUNT, usdc } from "@/lib/usdc";

export function FaucetClient() {
  const { accountId } = useWallet();
  const bal = useUsdcBalance(accountId);
  const reg = useUsdcRegistered(accountId);
  const { run } = useTx();
  const qc = useQueryClient();
  return (
    <RequireWallet what="the faucet">
      <BracketCard className="space-y-4">
        <p className="text-sm">Token: <span className="mono">{USDC_ID}</span></p>
        <p>Your balance: <MonoAmount value={bal.data ?? null} account={accountId} naira={false} /></p>
        <p className="text-sm text-muted">{reg.data === false ? "You're not registered on the token yet; the first mint registers you (0.00125 NEAR storage)." : reg.data ? "Registered on the token." : "Checking registration…"}</p>
        <Button variant="primary" onClick={async () => {
          const r = await run("Mint 5,000 test USDC", (): Promise<unknown> => (reg.data === false ? sendTxs([usdc.storageDeposit(accountId!), usdc.mint(FAUCET_AMOUNT, accountId!)]) : sendTx(usdc.mint(FAUCET_AMOUNT, accountId!))), { success: "5,000 test USDC is in your wallet." });
          if (r) qc.invalidateQueries();
        }}><Coins className="h-4 w-4" aria-hidden /> Get 5,000 test USDC</Button>
        <LinkButton href="/estates/playground">Buy a Playground unit →</LinkButton>
      </BracketCard>
    </RequireWallet>
  );
}
