// Server-only environment. Never import this from a client component.

function v(name: string): string | undefined {
  const x = process.env[name]?.trim();
  return x ? x : undefined;
}

export const MAX_GAS_TGAS = 300; // a NEAR transaction's gas limit

/**
 * RELAYER_MAX_GAS_TGAS as a whole number of Tgas, clamped to 1..300. Unset or not a number: 300 (logged once, so a
 * typo doesn't silently lift or zero the cap).
 */
export function parseMaxGasTgas(raw: string | undefined): number {
  if (raw === undefined) return MAX_GAS_TGAS;
  const n = Number(raw);
  if (!/^\s*\d+(\.\d+)?\s*$/.test(raw) || !Number.isFinite(n)) {
    warnOnce("plote:bad-env", "RELAYER_MAX_GAS_TGAS is not a number; using 300");
    return MAX_GAS_TGAS;
  }
  return Math.min(MAX_GAS_TGAS, Math.max(1, Math.floor(n)));
}

/**
 * STORAGE_CLEANUP_DELETE: "1" deletes, "0" only reports. Unset: delete on a production deployment (NODE_ENV=production
 * and not a Vercel preview/development deployment), report everywhere else.
 */
export function cleanupDeletes(env: { STORAGE_CLEANUP_DELETE?: string; NODE_ENV?: string; VERCEL_ENV?: string }): boolean {
  const s = env.STORAGE_CLEANUP_DELETE?.trim();
  if (s === "1") return true;
  if (s === "0") return false;
  return env.NODE_ENV === "production" && env.VERCEL_ENV !== "preview" && env.VERCEL_ENV !== "development";
}

const warned = new Set<string>();
function warnOnce(tag: string, msg: string) {
  if (warned.has(msg)) return;
  warned.add(msg);
  console.warn(tag, msg);
}

export const serverEnv = {
  supabaseUrl: () => v("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseServiceKey: () => v("SUPABASE_SERVICE_ROLE_KEY"),
  /** Testnet relayer (pays gas for relayed surveyor meta-transactions). */
  relayerAccountId: () => v("RELAYER_ACCOUNT_ID"),
  relayerPrivateKey: () => v("RELAYER_PRIVATE_KEY"),
  relayerAllowedMethods: () =>
    (v("RELAYER_ALLOWED_METHODS") ?? "open_capture,submit_evidence,qs_sign") // intersected with RELAYABLE_METHODS in relayer.ts
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  relayerMaxGasTgas: () => parseMaxGasTgas(v("RELAYER_MAX_GAS_TGAS")),
  /**
   * The estate's verdict_relayer / deposit reporter: signs submit_verdict (/api/verify) and report_deposit
   * (/api/oneclick/status). Falls back to the relayer key on testnet only (relayer.ts reporterCredentials).
   */
  reporterAccountId: () => v("REPORTER_ACCOUNT_ID"),
  reporterPrivateKey: () => v("REPORTER_PRIVATE_KEY"),
  oneclickBaseUrl: () => (v("ONECLICK_BASE_URL") ?? "https://1click.chaindefuser.com").replace(/\/$/, ""),
  oneclickJwt: () => v("ONECLICK_JWT"),
  mainnetUnitAccount: () => v("MAINNET_UNIT_ACCOUNT"),
  /** Mainnet relayer: both required on a mainnet build; there is no fallback to the testnet RELAYER_* variables. */
  mainnetRelayerAccountId: () => v("MAINNET_RELAYER_ACCOUNT_ID"),
  mainnetRelayerPrivateKey: () => v("MAINNET_RELAYER_PRIVATE_KEY"),
  nearblocksApiKey: () => v("NEARBLOCKS_API_KEY"),
  resendApiKey: () => v("RESEND_API_KEY"),
  /** Required with RESEND_API_KEY: a sender on a domain verified in Resend. No default (an unverified sender fails). */
  resendFrom: () => v("RESEND_FROM"),
  cronSecret: () => v("CRON_SECRET"),
  /** Second poll secret for the Supabase pg_cron scheduler (supabase/migrations/0005 + 0007). */
  pollSecret: () => v("POLL_SECRET"),
  /** HMAC key for confirm/unsubscribe links. Required to send emails; CRON_SECRET only verifies old unsubscribe links. */
  notifySecret: () => v("NOTIFY_SECRET"),
  /** Extra accounts the health check and poller watch for low NEAR (comma-separated), besides each estate's developer/payout. */
  monitorAccounts: () =>
    (v("MONITOR_ACCOUNTS") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  /** Whether the poller deletes flagged evidence files (default on in production; STORAGE_CLEANUP_DELETE=0 opts out). */
  storageCleanupDelete: () => cleanupDeletes({ STORAGE_CLEANUP_DELETE: process.env.STORAGE_CLEANUP_DELETE, NODE_ENV: process.env.NODE_ENV, VERCEL_ENV: process.env.VERCEL_ENV }),
  /** Optional Slack/Discord-compatible webhook for operational alerts (low balances, poller errors, uncertain deposits). */
  alertWebhookUrl: () => v("ALERT_WEBHOOK_URL"),
};
