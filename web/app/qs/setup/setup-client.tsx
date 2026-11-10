"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Circle, KeyRound, Laptop, Smartphone } from "lucide-react";
import { clsx } from "clsx";
import { QrImage } from "@/components/oneclick-pay";
import { useTx } from "@/components/toast";
import { useWallet } from "@/components/wallet";
import { BracketCard, Button, Field } from "@/components/ui";
import { APP_URL, ESTATES } from "@/lib/config";
import { SURVEYOR_KEY_METHODS } from "@/lib/estate";
import { estateAccount, isValidAccountId } from "@/lib/estates";
import { getWallet, LOGIN_KEY_ALLOWANCE, viewAccessKey, type AccessKeyView } from "@/lib/near";
import { randomNonce, verifyNep413 } from "@/lib/nep413";
import { createPhoneKey, deletePhoneKey, loadPhoneKey, phoneSignNep413, webCryptoEd25519Supported } from "@/lib/phone-key";

function Step({ n, done, title, children, icon }: { n: number; done: boolean; title: string; children: React.ReactNode; icon: React.ReactNode }) {
  return (
    <BracketCard tone={done ? "orange" : "default"} className="space-y-3">
      <div className="flex items-center gap-3">
        {done ? <CheckCircle2 className="h-5 w-5 text-orange" aria-hidden /> : <Circle className="h-5 w-5 text-muted" aria-hidden />}
        <h2 className="text-lg font-normal">{n}. {title}</h2>
        <span className="ml-auto text-muted" aria-hidden>{icon}</span>
      </div>
      {children}
    </BracketCard>
  );
}

export function SetupClient({ account: qAccount, pk: qPk, estate: qEstate }: { account: string; pk: string; estate: string }) {
  const { accountId, connect } = useWallet();
  const { run } = useTx();
  const [account, setAccount] = useState(qAccount);
  const [estate, setEstate] = useState(qEstate || ESTATES[0] || "");
  const [pin, setPin] = useState("");
  const [needsPin, setNeedsPin] = useState(false);
  const [pub, setPub] = useState<string | null>(null);
  const [onChain, setOnChain] = useState<AccessKeyView | null>(null);
  const [test, setTest] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { webCryptoEd25519Supported().then((ok) => setNeedsPin(!ok)); }, []);
  useEffect(() => {
    if (!account) return;
    loadPhoneKey(account).then((k) => setPub(k?.publicKey ?? null));
  }, [account]);

  const laptopPk = qPk || null;
  const estateAcc = estate ? estateAccount(estate) : "";
  const link = pub ? `${APP_URL}/qs/setup?account=${encodeURIComponent(account)}&pk=${encodeURIComponent(pub)}&estate=${encodeURIComponent(estateAcc)}` : "";

  const check = async () => {
    const k = pub ?? laptopPk;
    if (!k) return;
    setOnChain(await viewAccessKey(account, k).catch(() => null));
  };

  return (
    <div className="space-y-4">
      <Step n={1} done={!!pub || !!laptopPk} title="Create a key on this phone" icon={<Smartphone className="h-5 w-5" />}>
        <Field label="Your surveyor account" htmlFor="qs-acc"><input id="qs-acc" className="input" value={account} onChange={(e) => setAccount(e.target.value.trim())} placeholder="qs-adaeze.testnet" /></Field>
        <Field label="Estate" htmlFor="qs-est">
          <select id="qs-est" className="input" value={estateAcc} onChange={(e) => setEstate(e.target.value)}>
            {ESTATES.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </Field>
        {needsPin ? <Field label="PIN (this browser can't keep a non-exportable key)" htmlFor="qs-pin"><input id="qs-pin" type="password" inputMode="numeric" className="input" value={pin} onChange={(e) => setPin(e.target.value)} /></Field> : <p className="text-xs text-muted">This browser supports non-exportable Ed25519 keys: the private key never leaves secure storage.</p>}
        {pub ? (
          <div className="space-y-2">
            <p className="mono break-all text-xs">Public key: {pub}</p>
            <p className="text-sm text-muted">Open this link on the laptop where your wallet is signed in (or scan the QR):</p>
            <QrImage text={link} label="QR link for the laptop" size={200} />
            <p className="mono break-all text-xs">{link}</p>
            <Button size="sm" variant="danger" onClick={async () => { await deletePhoneKey(account); setPub(null); }}>Delete this phone key</Button>
          </div>
        ) : (
          <Button variant="primary" disabled={!isValidAccountId(account)} onClick={async () => {
            setErr(null);
            try { setPub(await createPhoneKey(account, needsPin ? pin : undefined)); } catch (e) { setErr((e as Error).message); }
          }}><KeyRound className="h-4 w-4" aria-hidden /> Create phone key</Button>
        )}
      </Step>

      <Step n={2} done={!!onChain} title="Authorise it from your wallet (laptop)" icon={<Laptop className="h-5 w-5" />}>
        <p className="text-sm text-muted">Signs one <span className="mono">AddKey</span> on <span className="mono">{account || "your account"}</span>: function-call permission, receiver <span className="mono">{estateAcc}</span>, methods {SURVEYOR_KEY_METHODS.join(", ")}, allowance 0.25 NEAR. (An allowance of 0 would mean unlimited, so one is always set.)</p>
        {!accountId ? <Button onClick={connect}>Connect wallet</Button> : accountId !== account ? <p className="text-sm text-amber">Your wallet is {accountId}; switch to {account || "the surveyor account"}.</p> : (
          <Button variant="primary" disabled={!(laptopPk ?? pub)} onClick={async () => {
            const publicKey = laptopPk ?? pub!;
            const r = await run("Add surveyor phone key", async () => {
              const w = await getWallet();
              await w.signAndSendTransaction({ receiverId: account, actions: [{ type: "AddKey", params: { publicKey, accessKey: { permission: { receiverId: estateAcc, allowance: LOGIN_KEY_ALLOWANCE, methodNames: SURVEYOR_KEY_METHODS } } } }] });
              return true;
            }, { success: "Key added. The phone can now sign milestones for this estate only." });
            if (r) check();
          }}>Authorise key</Button>
        )}
        <Button size="sm" onClick={check}>Check on-chain</Button>
        {onChain ? <p className="mono text-xs text-orange">On-chain: {onChain.permission === "FullAccess" ? "full access (!)" : `function call → ${onChain.permission.FunctionCall.receiver_id} [${onChain.permission.FunctionCall.method_names.join(", ")}]`}</p> : null}
      </Step>

      <Step n={3} done={test === true} title="Test signature" icon={<CheckCircle2 className="h-5 w-5" />}>
        <p className="text-sm text-muted">Signs a throwaway message with the phone key and verifies it locally. Nothing is sent on-chain.</p>
        <Button disabled={!pub} onClick={async () => {
          try {
            const nonce = randomNonce();
            const payload = { message: `plote-test:${Date.now()}`, nonce, recipient: estateAcc };
            const s = await phoneSignNep413(account, payload);
            setTest(verifyNep413(payload, s));
          } catch (e) { setErr((e as Error).message); setTest(false); }
        }}>Sign a test message</Button>
        {test !== null ? <p className={clsx("mono text-sm", test ? "text-orange" : "text-red")}>{test ? "✓ signature verifies" : "✕ signature failed"}</p> : null}
      </Step>
      {err ? <p className="text-sm text-red" role="alert">{err}</p> : null}
      <p className="text-xs text-muted">Lost the phone? Delete the key from any wallet. The worst an attacker could do is submit evidence that still has to pass the secure-hardware check.</p>
    </div>
  );
}
