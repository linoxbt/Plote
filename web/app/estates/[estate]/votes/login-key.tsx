"use client";

import { AppKeyToggle } from "@/components/app-key";
import { LOGIN_KEY_METHODS } from "@/lib/estate";

/**
 * Fallback for the login function-call key (SPEC §8.4, §9.1). Sign-in already asks for it when the wallet supports
 * `signInWithFunctionCallKey`; wallets that don't (or a key requested for another estate) can add it here.
 */
export function LoginKeyToggle({ contractId }: { contractId: string }) {
  return (
    <AppKeyToggle
      contractId={contractId}
      role="login"
      methods={LOGIN_KEY_METHODS}
      enableLabel="Enable one-tap voting"
      activeLabel="One-tap voting is on for this estate."
      success="A function-call key (0.25 NEAR gas allowance, this estate only) was added. Votes no longer need a popup."
    />
  );
}
