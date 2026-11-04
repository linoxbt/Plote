# Hosting

| Service | What | Where |
|---|---|---|
| Vercel | Next.js app (`web/`), team "Linoxbt" (Hobby), project `plote` | https://plote-linoxbt1.vercel.app (production alias) |
| Supabase | `plote` project, London (eu-west-2): photo bucket `evidence`, event cache, 1Click quotes | https://oshxsrhnynauyxcraymy.supabase.co |

Vercel builds from GitHub `linoxbt/Plote` with root directory `web`, Node 22, `pnpm build`.

## Environment variables still to add in Vercel (secrets — set them in the dashboard, never in git)

| Variable | Where to get it |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → project `plote` → Project Settings → API Keys → `service_role` (or a secret key) |
| `RELAYER_ACCOUNT_ID` / `RELAYER_PRIVATE_KEY` | `relayer.plote.testnet`, created by `just accounts` (key in `~/.near-credentials/testnet/`) |
| `OUTLAYER_HTTPS_URL` / `OUTLAYER_PAYMENT_KEY` | OutLayer dashboard, only if an estate uses `verify_mode: "https"` |
| `ONECLICK_JWT` (optional) | partners.near-intents.org — removes the 0.2% 1Click fee |
| `RESEND_API_KEY` (optional) | resend.com — milestone emails |

Already set: `NEXT_PUBLIC_*` network, RPC, estates, USDC, explorer, root account, GitHub URL, Supabase URL + anon key,
and `CRON_SECRET` (also add it as a GitHub Actions secret for `.github/workflows/poll.yml`, with repo variable
`APP_URL`).
