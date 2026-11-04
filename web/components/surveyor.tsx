"use client";

// Who signs surveyor calls: the phone key through the relayer (gasless, SPEC §9.3–9.4) when this device has one,
// otherwise the connected wallet (always the case in the Playground, where any wallet can be the surveyor).

import { useEffect, useState } from "react";
import { getWallet, sendTx, type TxResult, type TxSpec } from "@/lib/near";
import { listPhoneKeys, needsUnlock, phoneSignNep413, relayWithPhoneKey, unlockPhoneKey } from "@/lib/phone-key";
import type { Nep413Payload } from "@/lib/nep413";
import { bytesToBase64 } from "@/lib/near";
import { useWallet } from "./wallet";
import { Button, Field } from "./ui";

export type SurveyorSigner = {
  accountId: string | null;
  mode: "phone" | "wallet" | null;
  locked: boolean;
  unlock: (pin: string) => Promise<void>;
  call: (spec: TxSpec) => Promise<TxResult>;
  signNep413: (p: Nep413Payload) => Promise<{ accountId: string; publicKey: string; signature: string }>;
};

export function useSurveyorSigner(): SurveyorSigner {
  const { accountId: walletAccount } = useWallet();
  const [phone, setPhone] = useState<{ accountId: string; locked: boolean } | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    listPhoneKeys().then((keys) => {
      if (!alive) return;
      const k = keys.find((x) => !walletAccount || x.accountId === walletAccount) ?? keys[0];
      setPhone(k ? { accountId: k.accountId, locked: needsUnlock(k) } : null);
    });
    return () => {
      alive = false;
    };
  }, [walletAccount, tick]);

  const phoneMode = !!phone && (!walletAccount || phone.accountId === walletAccount);
  const accountId = phoneMode ? phone!.accountId : walletAccount;
  return {
    accountId,
    mode: phoneMode ? "phone" : walletAccount ? "wallet" : null,
    locked: phoneMode ? phone!.locked : false,
    unlock: async (pin: string) => {
      if (phone) await unlockPhoneKey(phone.accountId, pin);
      setTick((t) => t + 1);
    },
    call: (spec) => (phoneMode ? relayWithPhoneKey(phone!.accountId, spec) : sendTx(spec)),
    signNep413: async (p) => {
      if (phoneMode) return phoneSignNep413(phone!.accountId, p);
      const w = await getWallet();
      const s = await w.signMessage({ message: p.message, recipient: p.recipient, nonce: p.nonce });
      return { accountId: s.accountId || walletAccount!, publicKey: s.publicKey, signature: s.signature };
    },
  };
}

export function SignerBadge({ s }: { s: SurveyorSigner }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  if (!s.mode) return null;
  return (
    <div className="mono space-y-2 text-xs text-muted">
      <p>
        Signing as <span className="text-text">{s.accountId}</span> with {s.mode === "phone" ? "this phone's surveyor key (gas paid by the relayer)" : "your wallet"}.
      </p>
      {s.locked ? (
        <div className="flex items-end gap-2">
          <Field label="PIN" htmlFor="pk-pin" error={err ?? undefined}><input id="pk-pin" type="password" inputMode="numeric" className="input w-32" value={pin} onChange={(e) => setPin(e.target.value)} /></Field>
          <Button size="sm" onClick={() => s.unlock(pin).then(() => setErr(null)).catch((e) => setErr((e as Error).message))}>Unlock key</Button>
        </div>
      ) : null}
    </div>
  );
}

export { bytesToBase64 };
