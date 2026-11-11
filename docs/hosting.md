# Hosting

| Service | What | Where |
|---|---|---|
| Vercel | Next.js app (`web/`), team "Linoxbt" (Hobby), project `plote` | https://plote-vert.vercel.app (production; the poller and README use this URL) |
| Supabase | `plote` project, London (eu-west-2): photo bucket `evidence`, event cache, 1Click quotes | https://oshxsrhnynauyxcraymy.supabase.co |

Vercel builds from GitHub `linoxbt/Plote` with root directory `web`, Node 22, `pnpm build`.

## Database

Apply `supabase/migrations/0001_init.sql`, `0002_rate_limits.sql`, `0003_security.sql` and `0004_audit2.sql` in order
(SQL editor or `supabase db push`). All four are idempotent; 0004 adds `poll_receipts`, `verify_results`, two columns
on `evidence_files`, `oneclick_quotes.chipin_recorded`, a unique index on `chipins.deposit_address` and `poll_prune()`.
Every private table has RLS on and no policies (service role only).

## Environment variables in Vercel (secrets — set them in the dashboard, never in git)

| Variable | Where to get it |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → project `plote` → Project Settings → API Keys → `service_role` (or a secret key) |
| `RELAYER_ACCOUNT_ID` / `RELAYER_PRIVATE_KEY` | `relayer.plote.testnet`, created by `just accounts` (key in `~/.near-credentials/testnet/`) |
| `CRON_SECRET` | any long random string; also a GitHub Actions secret for `.github/workflows/poll.yml` |
| `NOTIFY_SECRET` | any long random string, different from `CRON_SECRET`; signs email confirm/unsubscribe links (falls back to `CRON_SECRET` while unset) |
| `RESEND_API_KEY` + `RESEND_FROM` (optional, both or neither) | resend.com — milestone emails. `RESEND_FROM` must use a domain verified in Resend (there is no default sender); check `GET /api/notify/status` |
| `ALERT_WEBHOOK_URL` (optional) | a Slack or Discord incoming webhook; test it with `/api/cron/poll?test_alert=1` |
| `NEARBLOCKS_API_KEY` (recommended) | nearblocks.io/apis — the poller lists estate receipts there; the keyless tier rate-limits |
| `MONITOR_ACCOUNTS`, `STORAGE_CLEANUP_DELETE` (optional) | extra accounts to watch for < 0.5 NEAR; `1` to let the poller delete flagged evidence files |
| `OUTLAYER_HTTPS_URL` / `OUTLAYER_PAYMENT_KEY` | OutLayer dashboard, only if an estate uses `verify_mode: "https"` |
| `ONECLICK_JWT` (optional, mainnet build) | partners.near-intents.org — removes the 0.2% 1Click fee |

Already set: `NEXT_PUBLIC_*` network, RPC, estates, USDC, explorer, root account, GitHub URL, Supabase URL + anon key.

The poller workflow needs only the `CRON_SECRET` repository secret: it calls https://plote-vert.vercel.app unless a
repository variable `APP_URL` overrides it. It fails (HTTP 502) only when every estate failed; partial problems go to
`ALERT_WEBHOOK_URL`. Try a run without writing anything: `curl -H "x-cron-secret: …" "$APP/api/cron/poll?dry_run=1"`.
