// Server-only environment. Never import this from a client component.

function v(name: string): string | undefined {
  const x = process.env[name]?.trim();
  return x ? x : undefined;
}

export const serverEnv = {
  supabaseUrl: () => v("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseServiceKey: () => v("SUPABASE_SERVICE_ROLE_KEY"),
  relayerAccountId: () => v("RELAYER_ACCOUNT_ID"),
  relayerPrivateKey: () => v("RELAYER_PRIVATE_KEY"),
  relayerAllowedMethods: () =>
    (v("RELAYER_ALLOWED_METHODS") ?? "open_capture,submit_evidence,qs_sign") // intersected with RELAYABLE_METHODS in relayer.ts
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  relayerMaxGasTgas: () => Number(v("RELAYER_MAX_GAS_TGAS") ?? "300"),
  oneclickBaseUrl: () => (v("ONECLICK_BASE_URL") ?? "https://1click.chaindefuser.com").replace(/\/$/, ""),
  oneclickJwt: () => v("ONECLICK_JWT"),
  mainnetUnitAccount: () => v("MAINNET_UNIT_ACCOUNT"),
  mainnetRelayerAccountId: () => v("MAINNET_RELAYER_ACCOUNT_ID") ?? v("RELAYER_ACCOUNT_ID"),
  mainnetRelayerPrivateKey: () => v("MAINNET_RELAYER_PRIVATE_KEY"),
  nearblocksApiKey: () => v("NEARBLOCKS_API_KEY"),
  resendApiKey: () => v("RESEND_API_KEY"),
  /** Required with RESEND_API_KEY: a sender on a domain verified in Resend. No default (an unverified sender fails). */
  resendFrom: () => v("RESEND_FROM"),
  cronSecret: () => v("CRON_SECRET"),
  /** Second poll secret for the Supabase pg_cron scheduler (supabase/migrations/0005_poll_schedule.sql). */
  pollSecret: () => v("POLL_SECRET"),
  /** HMAC key for confirm/unsubscribe links. Falls back to CRON_SECRET (so links sent before it existed keep working). */
  notifySecret: () => v("NOTIFY_SECRET"),
  /** Extra accounts the health check and poller watch for low NEAR (comma-separated), besides each estate's developer/payout. */
  monitorAccounts: () =>
    (v("MONITOR_ACCOUNTS") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  /** The poller only reports which storage files it would delete unless this is "1". */
  storageCleanupDelete: () => v("STORAGE_CLEANUP_DELETE") === "1",
  /** Optional Slack/Discord-compatible webhook for operational alerts (low balances, poller errors). */
  alertWebhookUrl: () => v("ALERT_WEBHOOK_URL"),
};
