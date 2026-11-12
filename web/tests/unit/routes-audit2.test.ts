import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- mocks (hoisted) -----------------------------------------------------------------------------------------
const h = vi.hoisted(() => ({
  views: {} as Record<string, unknown>,
  viewFail: false,
  relayer: vi.fn(),
  poll: vi.fn(),
  results: new Map<string, Record<string, unknown>>(),
  rpcs: [] as string[],
  lockHeld: false,
}));

vi.mock("@/lib/near", async (orig) => {
  const real = await orig<typeof import("@/lib/near")>();
  return {
    ...real,
    viewUncached: vi.fn(async (_c: string, method: string) => {
      if (h.viewFail) throw new real.RpcError("connect ECONNREFUSED");
      return h.views[method];
    }),
  };
});
vi.mock("@/lib/server/relayer", async (orig) => ({ ...(await orig<typeof import("@/lib/server/relayer")>()), callAsReporter: h.relayer }));
vi.mock("@/lib/server/poller", async (orig) => ({ ...(await orig<typeof import("@/lib/server/poller")>()), pollEstate: h.poll }));
vi.mock("@/lib/server/balances", () => ({ balances: async () => ({ ok: true, detail: "", low: [] }) }));
vi.mock("@/lib/server/health", async (orig) => ({ ...(await orig<typeof import("@/lib/server/health")>()), accountBalances: async () => ({ ok: true, detail: "", low: [] }) }));
vi.mock("@/lib/server/storage-cleanup", async (orig) => ({ ...(await orig<typeof import("@/lib/server/storage-cleanup")>()), cleanupEstateStorage: async () => ({ checked: 0, flagged: 0, deleted: 0, dryRun: true, reasons: {} }) }));

/** Just enough of the Supabase client: verify_results rows in memory, every rpc unavailable (routes fall back). */
function fakeSb() {
  const k = (f: Record<string, unknown>) => `${f.estate}|${f.evidence_id}`;
  const table = (name: string) => {
    const filters: Record<string, unknown> = {};
    let op: "select" | "update" = "select";
    let patch: Record<string, unknown> = {};
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => ((filters[c] = v), q),
      is: () => q,
      in: () => Promise.resolve({ data: [], error: null }),
      limit: () => Promise.resolve({ data: [], error: null }),
      maybeSingle: () => Promise.resolve({ data: name === "verify_results" ? (h.results.get(k(filters)) && !h.results.get(k(filters))!.submitted_at ? h.results.get(k(filters)) : null) : null, error: null }),
      upsert: (row: Record<string, unknown>) => {
        if (name === "verify_results") h.results.set(k(row), row);
        return Promise.resolve({ error: null });
      },
      update: (p: Record<string, unknown>) => ((op = "update"), (patch = p), q),
      then: (res: (x: unknown) => unknown) => {
        if (op === "update" && name === "verify_results") {
          const cur = h.results.get(k(filters));
          if (cur) h.results.set(k(filters), { ...cur, ...patch });
        }
        return Promise.resolve({ data: [], error: null }).then(res);
      },
    };
    return q;
  };
  // The poller's run lock is free; every other rpc is unavailable (routes fall back or fail closed).
  return {
    from: table,
    rpc: (fn: string) => {
      h.rpcs.push(fn);
      return Promise.resolve(fn === "poll_lock_acquire" ? { data: !h.lockHeld, error: null } : fn === "poll_lock_release" ? { data: null, error: null } : { data: null, error: { message: "not in tests" } });
    },
  };
}
const sb = fakeSb();
vi.mock("@/lib/server/supabase-admin", () => ({ supabaseAdmin: () => sb }));

import { GET as pollGET } from "@/app/api/cron/poll/route";
import { POST as verifyPOST } from "@/app/api/verify/route";
import { POST as quotePOST } from "@/app/api/oneclick/quote/route";
import { GET as tokensGET } from "@/app/api/oneclick/tokens/route";
import { POST as submitPOST } from "@/app/api/oneclick/submit/route";
import { GET as metaGET } from "@/app/api/meta/[estate]/[unit]/route";
import { GET as notifyStatusGET } from "@/app/api/notify/status/route";

const ESTATE = "harmattan-court.plote.testnet";
const json = (body: unknown, headers: Record<string, string> = {}) => ({ method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

describe("/api/cron/poll status", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret";
    h.poll.mockReset();
  });
  const call = (q = "") => pollGET(new Request(`http://x/api/cron/poll${q}`, { headers: { "x-cron-secret": "s3cret" } }));
  it("returns 502 when every estate failed, so the scheduled job fails", async () => {
    h.poll.mockRejectedValue(new Error("NearBlocks HTTP 429"));
    const r = await call();
    expect(r.status).toBe(502);
    const j = await r.json();
    expect(j.code).toBe("POLL_FAILED");
    expect(j.report[ESTATE].error).toContain("429");
  });
  it("returns 200 on a partial failure (the alert webhook reports it)", async () => {
    let n = 0;
    h.poll.mockImplementation(async () => {
      if (n++ === 0) throw new Error("boom");
      return { report: { listed: 0, fresh: 0, processed: 0, events: 0, inserted: 0, cursor: { from: 1, to: 1 }, gap: false, deferred: 0, errors: [] }, inserted: [] };
    });
    const r = await call("?dry_run=1");
    expect(r.status).toBe(200);
    expect((await r.json()).dryRun).toBe(true);
  });
  it("exits early while another run holds the lock, and releases its own lock", async () => {
    h.lockHeld = true;
    const r = await call();
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ skipped: true });
    expect(h.poll).not.toHaveBeenCalled();
    h.lockHeld = false;
    h.rpcs.length = 0;
    h.poll.mockRejectedValue(new Error("x"));
    await call();
    expect(h.rpcs).toContain("poll_lock_acquire");
    expect(h.rpcs).toContain("poll_lock_release");
  });
  it("rejects a wrong secret", async () => {
    const r = await pollGET(new Request("http://x/api/cron/poll", { headers: { "x-cron-secret": "nope!!" } }));
    expect(r.status).toBe(401);
  });
});

describe("/api/verify", () => {
  beforeEach(() => {
    Object.assign(process.env, { OUTLAYER_HTTPS_URL: "https://outlayer.example/call", OUTLAYER_PAYMENT_KEY: "pk", RELAYER_ACCOUNT_ID: "relayer.plote.testnet", RELAYER_PRIVATE_KEY: "ed25519:x" });
    h.viewFail = false;
    h.results.clear();
    h.relayer.mockReset();
    h.views = {
      get_estate: { verify_mode: "https", verdict_relayer: "relayer.plote.testnet" },
      get_evidence: { status: "Pending" },
      check_input: "{\"input\":1}",
    };
  });
  const post = (id: number) => verifyPOST(new Request("http://x/api/verify", { ...json({ estate: ESTATE, evidenceId: id }), headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${id}` } }));

  it("answers 503 RPC_UNAVAILABLE when NEAR can't be read", async () => {
    h.viewFail = true;
    const r = await post(1);
    expect(r.status).toBe(503);
    expect((await r.json()).code).toBe("RPC_UNAVAILABLE");
  });

  it("keeps a paid verdict when submit_verdict fails, and a retry submits it without paying OutLayer again", async () => {
    const outlayer = vi.fn(async () => new Response(JSON.stringify({ output: { pass: true, reasons: [], worker_commit: "abc" } }), { status: 200 }));
    vi.stubGlobal("fetch", outlayer);
    h.relayer.mockRejectedValueOnce(new Error("relayer: RPC timeout"));
    const r = await post(2);
    expect(r.status).toBe(502);
    const j = await r.json();
    expect(j.code).toBe("VERDICT_SUBMIT_FAILED");
    expect(j.details).toMatchObject({ saved: true, pass: true });
    expect(outlayer).toHaveBeenCalledTimes(1);

    h.relayer.mockResolvedValueOnce({ hash: "TX1", logs: [], events: [], returnValue: null });
    const again = await post(2);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ pass: true, reused: true });
    expect(outlayer).toHaveBeenCalledTimes(1); // not paid twice
    expect(h.results.get(`${ESTATE}|2`)).toMatchObject({ submitted_tx: "TX1" });
    vi.unstubAllGlobals();
  });
});

describe("1Click on a testnet build", () => {
  it("tokens and submit answer ONECLICK_MAINNET_ONLY instead of proxying", async () => {
    const t = await tokensGET();
    expect(t.status).toBe(503);
    expect((await t.json()).code).toBe("ONECLICK_MAINNET_ONLY");
    const s = await submitPOST(new Request("http://x", json({ depositAddress: "0x0000000000", txHash: "0x00000000000" })));
    expect((await s.json()).code).toBe("ONECLICK_MAINNET_ONLY");
  });
  it("quote accepts only MAINNET_UNIT_ACCOUNT as the recipient", async () => {
    process.env.MAINNET_UNIT_ACCOUNT = "a-4b.harmattan-court.plote.someone.near";
    const body = { dry: true, originAsset: "nep141:usdc.base", amount: "1000000", refundTo: "0x00000000000000000000000000000000000000ff", recipient: `a-4b.${ESTATE}` };
    const r = await quotePOST(new Request("http://x", { ...json(body), headers: { "content-type": "application/json", "x-forwarded-for": "10.9.9.9" } }));
    expect(r.status).toBe(400);
    expect((await r.json()).code).toBe("ONECLICK_MAINNET_ONLY");
    delete process.env.MAINNET_UNIT_ACCOUNT;
  });
});

describe("/api/meta and /api/notify/status", () => {
  it("meta serves only configured estates, with cache headers", async () => {
    const r = await metaGET(new Request("http://x"), { params: Promise.resolve({ estate: "evil.testnet", unit: "a-1" }) });
    expect(r.status).toBe(404);
    expect(r.headers.get("cache-control")).toContain("max-age");
  });
  it("notify status is false without RESEND_FROM", async () => {
    process.env.RESEND_API_KEY = "re_x";
    delete process.env.RESEND_FROM;
    expect(await (await notifyStatusGET()).json()).toEqual({ configured: false });
  });
});
