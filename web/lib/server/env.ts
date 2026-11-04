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
    (v("RELAYER_ALLOWED_METHODS") ?? "open_capture,submit_evidence,qs_sign,sync,sync_deposits,sweep_unattributed")
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
  resendFrom: () => v("RESEND_FROM") ?? "Plote <notify@plote.app>",
  cronSecret: () => v("CRON_SECRET"),
};
