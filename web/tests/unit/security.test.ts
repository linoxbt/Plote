import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { KeyPair, KeyPairSigner, actions, buildDelegateAction, encodeSignedDelegate } from "near-api-js";
import { contentSecurityPolicy, securityHeaders } from "@/lib/csp";
import { houseSvg } from "@/lib/svg-house";
import { usedAmount, wallText } from "@/lib/server/chipin";
import { confirmToken, readToken, unsubscribeToken } from "@/lib/server/notify";
import { decodeSignedDelegate, delegatePublicKey, verifyDelegate, verifyDelegateSignature, type ChainReader, type PlainDelegate } from "@/lib/server/relayer";

const ESTATE = "harmattan-court.plote.testnet";

async function signed(opts: { sender?: string; kp?: KeyPair; nonce?: bigint; maxBlockHeight?: bigint; method?: string } = {}) {
  const kp = opts.kp ?? KeyPair.fromRandom("ed25519");
  const da = buildDelegateAction({
    senderId: opts.sender ?? "qs.testnet",
    receiverId: ESTATE,
    actions: [actions.functionCall(opts.method ?? "qs_sign", { milestone: 0 }, 30_000_000_000_000n, 0n)],
    nonce: opts.nonce ?? 11n,
    maxBlockHeight: opts.maxBlockHeight ?? 1_000n,
    publicKey: kp.getPublicKey(),
  });
  const { signedDelegate } = await new KeyPairSigner(kp).signDelegateAction(da);
  const sd = decodeSignedDelegate(Buffer.from(encodeSignedDelegate(signedDelegate)).toString("base64"));
  return { kp, sd };
}

function chain(over: Partial<{ key: Awaited<ReturnType<ChainReader["accessKey"]>>; height: bigint; surveyor: string; playground: boolean }> = {}): ChainReader {
  return {
    accessKey: async () => ("key" in over ? over.key! : { nonce: 10, permission: "FullAccess" }),
    blockHeight: async () => over.height ?? 900n,
    estate: async () => ({ surveyor_id: over.surveyor ?? "qs.testnet", params: { playground: over.playground ?? false } }),
  };
}

describe("relayer: off-chain delegate verification", () => {
  it("verifies a near-api-js signed delegate and reads its key", async () => {
    const { kp, sd } = await signed();
    expect(verifyDelegateSignature(sd)).toBe(true);
    expect(delegatePublicKey(sd)).toBe(kp.getPublicKey().toString());
    expect(await verifyDelegate(sd, ["qs_sign"], chain())).toEqual({ ok: true, methods: ["qs_sign"] });
  });
  it("rejects a tampered delegate or a foreign signature", async () => {
    const { sd } = await signed();
    const tampered: PlainDelegate = { ...sd, delegateAction: { ...sd.delegateAction, senderId: "mallory.testnet" } };
    expect(verifyDelegateSignature(tampered)).toBe(false);
    const other = await signed();
    expect(verifyDelegateSignature({ ...sd, signature: other.sd.signature })).toBe(false);
    expect((await verifyDelegate(tampered, ["qs_sign"], chain())).ok).toBe(false);
  });
  it("checks key, nonce, expiry and surveyor before paying", async () => {
    const code = async (sd: PlainDelegate, c: ChainReader) => {
      const r = await verifyDelegate(sd, ["qs_sign"], c);
      return r.ok ? "ok" : r.code;
    };
    const { sd } = await signed();
    expect(await code(sd, chain({ key: null }))).toBe("KEY_NOT_ON_ACCOUNT");
    expect(await code(sd, chain({ key: { nonce: 11, permission: "FullAccess" } }))).toBe("NONCE_USED");
    expect(await code(sd, chain({ height: 1_000n }))).toBe("SIGNATURE_EXPIRED");
    expect(await code(sd, chain({ surveyor: "someone-else.testnet" }))).toBe("E_NOT_SURVEYOR");
    expect(await code(sd, chain({ surveyor: "someone-else.testnet", playground: true }))).toBe("ok");
    const fc = (receiver_id: string, method_names: string[]) => ({ nonce: 1, permission: { FunctionCall: { allowance: null, receiver_id, method_names } } });
    expect(await code(sd, chain({ key: fc(ESTATE, ["qs_sign", "open_capture"]) }))).toBe("ok");
    expect(await code(sd, chain({ key: fc(ESTATE, []) }))).toBe("ok");
    expect(await code(sd, chain({ key: fc(ESTATE, ["open_capture"]) }))).toBe("KEY_NOT_ALLOWED");
    expect(await code(sd, chain({ key: fc("musdc.plote.testnet", []) }))).toBe("KEY_NOT_ALLOWED");
  });
});

describe("security headers", () => {
  it("denies framing and plugins, allows the app's and wallets' hosts", () => {
    const csp = contentSecurityPolicy({ rpcUrls: ["https://rpc.example.org/path"], supabaseUrl: "https://abc.supabase.co/", fxUrl: "https://fx.example.com/v6/latest/USD" });
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    const connect = csp.split("; ").find((d) => d.startsWith("connect-src "))!;
    for (const h of ["https://rpc.example.org", "https://abc.supabase.co", "wss://abc.supabase.co", "https://fx.example.com", "https://test.rpc.fastnear.com", "https://raw.githubusercontent.com", "wss://*.walletconnect.org"]) {
      expect(connect.split(" ")).toContain(h);
    }
    expect(connect).not.toContain("ws://localhost");
    expect(contentSecurityPolicy({ rpcUrls: [], dev: true })).toContain("ws://localhost:*");
    const keys = securityHeaders({ rpcUrls: [] }).map((h) => h.key);
    expect(keys).toEqual(expect.arrayContaining(["Content-Security-Policy", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy"]));
  });
});

describe("family wall reads the chain, not the poster", () => {
  const b64 = (s: string) => Buffer.from(s).toString("base64");
  it("takes the kept amount from ft_resolve_transfer's return value", () => {
    expect(usedAmount({ SuccessValue: b64('"50000000"') })).toBe(50_000_000n);
    expect(usedAmount({ SuccessValue: b64('"0"') })).toBe(0n);
    expect(usedAmount({ Failure: {} })).toBeNull();
    expect(usedAmount({ SuccessValue: "" })).toBeNull();
    expect(usedAmount({ SuccessValue: b64("true") })).toBeNull();
    expect(usedAmount(undefined)).toBeNull();
  });
  it("takes name and note from the signed msg", () => {
    expect(wallText(JSON.stringify({ from: " Aunty Bisi ", note: "For the roof!" }))).toEqual({ name: "Aunty Bisi", note: "For the roof!" });
    expect(wallText(JSON.stringify({ from: "x".repeat(99) })).name).toHaveLength(40);
    expect(wallText("not json")).toEqual({ name: null, note: null });
    expect(wallText(undefined)).toEqual({ name: null, note: null });
  });
});

describe("notify tokens", () => {
  it("round-trips signed tokens and rejects tampering", () => {
    process.env.CRON_SECRET = "test-secret";
    const c = confirmToken("alice.testnet", ESTATE, "a-4b", "a@example.com", 123);
    expect(readToken(c)).toEqual(["confirm", "alice.testnet", ESTATE, "a-4b", "a@example.com", 123]);
    const [body, sig] = c.split(".");
    expect(readToken(`${body}x.${sig}`)).toBeNull();
    expect(readToken("garbage")).toBeNull();
    expect(readToken(unsubscribeToken("alice.testnet", ESTATE, "a-4b"))).toHaveLength(3);
  });
});

describe("NFT SVG escaping", () => {
  it("escapes an unknown status from the chain", () => {
    const svg = houseSvg({ estateName: "E", unitLabel: "A", unitId: "a", approvedCount: 0, total: 4, status: '<img src=x onerror="&#97;lert(1)">', paid: "0", price: "0" });
    expect(svg).not.toContain("<IMG");
    expect(svg).toContain("&lt;IMG SRC=X ON");
  });
});
