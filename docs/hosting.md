# Hosting

| Service | What | Where |
|---|---|---|
| Vercel | Next.js app (`web/`), team "Linoxbt" (Hobby), project `plote` | https://plote-vert.vercel.app (production; the poller and README use this URL) |
| Supabase | `plote` project, London (eu-west-2): photo bucket `evidence`, event cache, 1Click quotes | https://oshxsrhnynauyxcraymy.supabase.co |

Vercel builds from GitHub `linoxbt/Plote` with root directory `web`, Node 22, `pnpm build`.

## Database

Apply, in order (SQL editor or `supabase db push`); each file is idempotent:

| Migration | What it does |
|---|---|
| `0001_init.sql` | evidence_files, events, oneclick_quotes, chipins, notify_subscriptions, poll_cursor, the `evidence` bucket |
| `0002_rate_limits.sql` | shared rate limits (`rate_limit_hit`, `rate_limits_prune`) |
| `0003_security.sql` | single-use claims (`claim_once`), HTTPS verify leases, one family-wall note per transaction |
| `0004_audit2.sql` | `poll_receipts`, `verify_results`, upload size/deadline columns, `oneclick_quotes.chipin_recorded`, `poll_prune()` |
| `0005_poll_schedule.sql` | pg_cron job `plote-poll` (needs Vault secret `plote_poll_secret` = `POLL_SECRET`) |
| `0006_audit4.sql` | events keyed by (tx, receipt, log line, data item) + `notified_at` (existing rows stamped); `poll_cursor` continuation columns and `poll_cursor_save()` (never moves backwards); run lock `poll_lock` + `poll_lock_acquire/release()`; drops the unused `gate_nonces`; bucket JPEG/PNG only. **Apply before deploying the web build that uses it.** |
| `0007_poll_schedule_url.sql` | reschedules `plote-poll` with the URL from Vault secret `plote_app_url` (default https://plote-vert.vercel.app) |

Every private table has RLS on and no policies (service role only).

## Environment variables in Vercel (secrets — set them in the dashboard, never in git)

| Variable | Where to get it |
|---|---|
| `NEXT_PUBLIC_APP_URL` | `https://plote-vert.vercel.app` on production. If unset, a Vercel production build falls back to `https://$VERCEL_PROJECT_PRODUCTION_URL` (previews: `$VERCEL_URL`); localhost is only used in local dev |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → project `plote` → Project Settings → API Keys → `service_role` (or a secret key) |
| `RELAYER_ACCOUNT_ID` / `RELAYER_PRIVATE_KEY` | `relayer.plote.testnet`, created by `just accounts` (key in `~/.near-credentials/testnet/`). A mainnet build uses `MAINNET_RELAYER_ACCOUNT_ID` / `MAINNET_RELAYER_PRIVATE_KEY` instead (both required, no fallback) |
| `RELAYER_ALLOWED_METHODS` (optional) | comma list, intersected with `open_capture,submit_evidence,qs_sign` (default) |
| `RELAYER_MAX_GAS_TGAS` (optional) | gas cap per relayed call; whole number, clamped to 1..300 (default 300) |
| `REPORTER_ACCOUNT_ID` / `REPORTER_PRIVATE_KEY` | the estates' `verdict_relayer` (signs `submit_verdict` and `report_deposit`). Optional on testnet (falls back to the relayer key), required on mainnet. Changing it also needs the estates' `verdict_relayer` changed on-chain |
| `CRON_SECRET` | any long random string; manual poller runs (GitHub secret for `poll.yml`) and the detailed `/api/health` view |
| `POLL_SECRET` | any long random string; the Supabase pg_cron call to the poller (same value in Vault as `plote_poll_secret`) |
| `NOTIFY_SECRET` | any long random string, different from `CRON_SECRET`; signs email confirm/unsubscribe links. **Required for emails** (no signing fallback); old unsubscribe links signed with `CRON_SECRET` still verify |
| `RESEND_API_KEY` + `RESEND_FROM` (optional, both or neither) | resend.com — milestone emails. `RESEND_FROM` must use a domain verified in Resend (there is no default sender); check `GET /api/notify/status` |
| `ALERT_WEBHOOK_URL` (optional) | a Slack or Discord incoming webhook; test it with `/api/cron/poll?test_alert=1` |
| `NEARBLOCKS_API_KEY` (recommended) | nearblocks.io/apis — the poller lists estate receipts there; the keyless tier rate-limits |
| `MONITOR_ACCOUNTS` (optional) | extra accounts to watch for < 0.5 NEAR |
| `STORAGE_CLEANUP_DELETE` (optional) | the poller deletes flagged evidence files by default on production; `0` = report only, `1` = delete on any deployment |
| `OUTLAYER_HTTPS_URL` / `OUTLAYER_PAYMENT_KEY` | OutLayer dashboard, only if an estate uses `verify_mode: "https"` |
| `ONECLICK_JWT` (optional, mainnet build) | partners.near-intents.org — removes the 0.2% 1Click fee |
| `ONECLICK_BASE_URL` (optional) | 1Click API base, default `https://1click.chaindefuser.com` |

Already set: `NEXT_PUBLIC_*` network, RPC, estates, USDC, explorer, root account (`NEXT_PUBLIC_ROOT_ACCOUNT`, parent of
estates not listed), GitHub URL, Supabase URL + anon key. Optional `NEXT_PUBLIC_FX_URL`: the USD→NGN rate endpoint
(default open.er-api.com). `NEAR_AI_API_KEY` is **not** a Vercel variable: it is an OutLayer secret stored with
`scripts/outlayer-setup.ts`.

The 5-minute poller runs from Supabase pg_cron (0005 + 0007). `.github/workflows/poll.yml` is manual only
(workflow_dispatch) and needs the `CRON_SECRET` repository secret; it calls https://plote-vert.vercel.app unless a
repository variable `APP_URL` overrides it. Only one run at a time (an overlapping call answers `skipped: true`).
It fails (HTTP 502) only when every estate failed; partial problems go to `ALERT_WEBHOOK_URL`. Try a run without
writing anything: `curl -H "x-cron-secret: …" "$APP/api/cron/poll?dry_run=1"`. `/api/health` reports
`poller.ok: false` when an estate wasn't polled for 20 minutes.

`scripts/deploy-outlayer-mock.ts` is test-only (testnet demos; refuses other networks).
