# Launching Plote with real money

The testnet deployment is a demo. This is the checklist for holding real buyers' USDC on mainnet. Every gate is a
hard stop: don't take a deposit until all of them are ticked and the evidence is linked here.

## 1. Gates only people can close

- [ ] **Independent security audit** of `contracts/estate`, `contracts/unit` and `verifier/`, by a firm with NEAR
      (near-sdk 5, yield/resume, NEP-141/171) experience. Fix every critical/high finding; publish the report.
      Internal review notes: `docs/SECURITY-REVIEW.md`.
- [ ] **Legal opinion in each launch market.** Holding off-plan deposits can be regulated escrow, collective
      investment or payment activity (in Nigeria: SEC, CBN and state real-estate regulators; in the UK/US/Canada for
      diaspora buyers: money transmission rules). The opinion decides who may list an estate, whether developers must
      be licensed, and what KYC/AML applies.
- [ ] **KYC/KYB policy** that follows from the opinion: verify developers (company registration, directors) before
      an estate is listed; verify buyers if required. Plote's contracts don't need identity, so this sits in the
      listing process and the web app, not on-chain.
- [ ] **Terms and Privacy reviewed by a lawyer** (`/terms`, `/privacy` are plain-language drafts).
- [ ] **A paid pilot** with one real developer and surveyor on one real site, for at least one full milestone
      (capture → check → sign → veto window → release), with the photos reviewed by a person afterwards.

## 2. Accounts and keys

- [ ] A mainnet parent account (e.g. `plote.near`) held in a **hardware wallet or a multisig**, never a key file.
- [ ] Relayer account: a separate account, funded with only a few NEAR at a time, its key only in Vercel
      (`MAINNET_RELAYER_PRIVATE_KEY` on the mainnet build, sensitive). Rotate it on any suspicion; the relayer can't
      move user funds. A mainnet build never falls back to the testnet `RELAYER_*` variables.
- [ ] Reporter account (`REPORTER_ACCOUNT_ID` / `REPORTER_PRIVATE_KEY`): each estate's `verdict_relayer`, which signs
      `submit_verdict` and `report_deposit`. Keep it separate from the relayer (it can book deposits, so it is the more
      sensitive key); required on mainnet. On testnet it falls back to the relayer key when unset.
      **`REPORTER_ACCOUNT_ID` must equal the estate's `verdict_relayer`**, which is set at deploy and can't be changed:
      `report_deposit` (1Click deliveries and `deposit_deferred` wallet deposits) only accepts that account, so
      `scripts/deploy-estate.ts` refuses a mainnet config whose `verdict_relayer` is null or still a placeholder.
- [ ] Surveyors use phone keys (`/qs/setup`): function-call only, allowance capped. Developers use the claim key from
      `/dev` for day-to-day calls.

## 3. Deploy (the scripts refuse unsafe mainnet configs)

`scripts/deploy-estate.ts` refuses, on mainnet: an unpinned verifier, any USDC other than Circle's
(`17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`), `verify_mode` other than `outlayer`,
`demo_mode`, `playground`, and a veto window under 24 h. Mock USDC can't be deployed on mainnet.

1. Build reproducibly and record the hashes:
   `cargo near build reproducible-wasm --manifest-path contracts/estate/Cargo.toml` (and `unit`), or run the
   `reproducible-build` workflow, which publishes `hashes.txt`. Anyone can repeat it; the image is pinned by digest in
   each `Cargo.toml`. Deploy only that artifact: `scripts/upgrade-estate-code.ts --expected-hash <sha256>` refuses any
   other WASM (and refuses mainnet without `--i-know`), calls `migrate` from the estate account after each upgrade and
   prints the deployed `code_hash` and `state_version`; `deploy-estate.ts` doesn't
   redeploy code or re-fund verification on an estate that is already initialised.
2. `NEAR_ENV=mainnet` — publish the unit code (global, by hash), then deploy each estate with
   `config/estate.mainnet.example.json` as the starting point (real deadlines, real geofence, real surveyor, and
   `verdict_relayer` = the reporter account, i.e. `REPORTER_ACCOUNT_ID`; it can't be changed later).
3. Publish the verifier on OutLayer mainnet; pin its version key in the config; store the NEAR AI key with
   `scripts/outlayer-setup.ts` (mainnet usage: see `scripts/outlayer-setup.ts --help`), which uses the condition
   `Predecessor(Whitelist[estate])` (only runs requested by the estate contract can use it). `NEAR_AI_API_KEY` is an
   OutLayer secret only; the web app never reads it, so it doesn't go in Vercel.
4. Run one OutLayer check on a throwaway capture to warm the build (yield/resume times out on a cold build).
5. **Lock the code**: `pnpm tsx scripts/delete-estate-keys.ts <estate> --yes`. After this nobody, including Plote,
   can change the estate's code; `/status` shows "Code locked" green. If you'd rather keep an upgrade path, the only
   acceptable alternative is a multisig with a public timelock longer than the shortest veto window, documented here.
6. Set `NEXT_PUBLIC_NETWORK=mainnet`, `NEXT_PUBLIC_ESTATES`, `NEXT_PUBLIC_APP_URL` (the https URL of that build) and
   the server variables in Vercel. The reproducible-build workflow compares the estate WASM with
   `config/estate-wasm.sha256`; update that file in the commit that deploys a new artifact.

## 4. Operations

- [ ] Supabase migrations applied, in order: `supabase/migrations/0001_init.sql`, `0002_rate_limits.sql`,
      `0003_security.sql`, `0004_audit2.sql` (poller receipt index, upload size/deadline columns, paid-verdict store,
      1Click → family-wall copy), `0005_poll_schedule.sql` (pg_cron schedule for the poller; needs `POLL_SECRET` in
      Vercel and the same value in Vault as `plote_poll_secret`), `0006_audit4.sql` (event key per receipt/log line,
      `events.notified_at`, listing continuation + never-backwards cursor, the poller run lock, drops `gate_nonces`,
      bucket JPEG/PNG only), `0007_poll_schedule_url.sql` (reschedules the poller with its URL from Vault
      `plote_app_url`, default https://plote-vert.vercel.app). Apply 0006 before deploying the web build that uses it.
      Point-in-time recovery on.
- [ ] Server variables in Vercel (secrets in the dashboard, never in git):

      | Variable | Needed for |
      |---|---|
      | `SUPABASE_SERVICE_ROLE_KEY` | uploads, event cache, rate limits, single-use nonces |
      | `NEXT_PUBLIC_APP_URL` | links in emails, OG images, NFT reference. If unset, Vercel production falls back to `https://$VERCEL_PROJECT_PRODUCTION_URL` (never localhost); set it anyway |
      | `RELAYER_ACCOUNT_ID`, `RELAYER_PRIVATE_KEY` (testnet) / `MAINNET_RELAYER_ACCOUNT_ID`, `MAINNET_RELAYER_PRIVATE_KEY` (mainnet) | gasless surveyor calls; mainnet requires both `MAINNET_*` (no fallback) |
      | `RELAYER_ALLOWED_METHODS` (optional) | relayable methods, intersected with `open_capture,submit_evidence,qs_sign` (the default) |
      | `RELAYER_MAX_GAS_TGAS` (optional) | gas cap per relayed call; whole number clamped to 1..300, default 300 |
      | `REPORTER_ACCOUNT_ID`, `REPORTER_PRIVATE_KEY` | the estate's `verdict_relayer` / deposit reporter (`submit_verdict`, `report_deposit`); required on mainnet, testnet falls back to the relayer |
      | `CRON_SECRET` | manual poller runs and the detailed `/api/health` view (header `x-cron-secret`) |
      | `POLL_SECRET` | the Supabase pg_cron call to the poller (same value as Vault `plote_poll_secret`) |
      | `NOTIFY_SECRET` | signs email confirm/unsubscribe links; **required for emails** (no fallback to `CRON_SECRET` for signing). Unsubscribe links sent before it existed (signed with `CRON_SECRET`) keep working; new ones are valid for a year |
      | `RESEND_API_KEY` + `RESEND_FROM` | milestone emails; both required, `RESEND_FROM` must be on a domain verified in Resend (no default sender). `GET /api/notify/status` says whether emails are on |
      | `ALERT_WEBHOOK_URL` | Slack/Discord alerts from the poller |
      | `NEARBLOCKS_API_KEY` | the poller's receipt listing (the keyless tier rate-limits) |
      | `MONITOR_ACCOUNTS` (optional) | extra accounts to watch for < 0.5 NEAR |
      | `STORAGE_CLEANUP_DELETE` (optional) | the poller deletes flagged evidence files by default in production; `0` = report only |
      | `OUTLAYER_HTTPS_URL`, `OUTLAYER_PAYMENT_KEY` | only for `verify_mode: "https"` estates |
      | `ONECLICK_JWT`, `ONECLICK_BASE_URL` (optional, default `https://1click.chaindefuser.com`), `MAINNET_UNIT_ACCOUNT` | mainnet 1Click build only |
      | `NEXT_PUBLIC_ROOT_ACCOUNT`, `NEXT_PUBLIC_FX_URL` (optional) | parent of estates not in `NEXT_PUBLIC_ESTATES`; the USD→NGN rate endpoint (its origin must be allowed by the CSP) |
- [ ] `ALERT_WEBHOOK_URL` set; the poller posts when the relayer drops below 1 NEAR, an estate's verification
      budget below 0.3 NEAR, a developer/payout/reporter account below 0.5 NEAR, an estate or a transaction can't be
      read, a backlog is being continued over several runs, or emails failed. `/api/oneclick/status` posts when a
      `report_deposit` didn't confirm (`plote:report-deposit-uncertain`; not retried automatically — check the unit's
      paid amount before reporting again). When **every** estate fails the poller answers 502 (visible in
      `net._http_response` and the Vercel logs).
- [ ] An uptime monitor on `/api/health`: `balances.ok`, `accounts.ok`, `photo_checks.ok` (false when the latest
      verdicts all show `ai_unavailable` / `challenge_unverified` / `worker_error`, i.e. NEAR AI or the worker is down)
      and `poller.ok` (false when an estate's cursor wasn't saved in the last 20 minutes).
- [ ] The 5-minute poller runs from Supabase pg_cron only (`plote-poll`, migrations 0005 + 0007). `poll.yml` is
      manual only (`workflow_dispatch`, no schedule). Runs never overlap: a run lock (`poll_lock`, 0006) makes a
      second caller answer `{ skipped: true }`, and each run stops starting new work after 45 s.
- [ ] Rate limits are shared across instances (Postgres); if the database can't answer they fall back to
      per-instance memory and log `plote:rate-limit-fallback` / `plote:once-fallback` (NEP-413 nonces): alert on those
      in the Vercel logs. Relayed delegates and gate passes **fail closed** instead (503 `REPLAY_CHECK_UNAVAILABLE`,
      logged `plote:once-unavailable`). Relayed calls are counted per estate (300/min, 60/min on a playground), so the
      public playground can't use up a real estate's quota. Playground estates also have hourly caps on uploads (5 per
      account, 10 per IP, 20 per /24 or /48 network, 300 per estate) and relayed captures and sign-offs (10 per
      account, 20 per IP, 40 per network, 600 per estate), so throwaway accounts from one network can't lock others out.
- [ ] Gate passes are checked server-side (`POST /api/gate/verify`), single use across guard devices.

## 5. Incidents

There is no admin pause: by design nobody can stop holders from getting refunds. What exists:

- **Holders**: a `Freeze` vote stops releases (optionally opening refunds); `Veto` cancels a sign-off inside the veto
  window; `ReplaceSurveyor` and `StepIn` replace a bad surveyor or developer.
- **Operators**: take the website down or stop the relayer (captures still work by signing directly); post the
  incident on `/status`; never ask users for keys.
- **Verifier bug**: estates are pinned to one verifier build; a new build needs the developer's `set_verifier`,
  which only works before the first sale. Plan verifier upgrades before launch.

## 6. Readiness score (what's left to 100)

| Area | Weight | Status |
|---|---|---|
| Contract correctness (tests, invariants, live E2E, internal review) | 20 | done |
| Verifier integrity (TEE, pinned build, challenge hard-fail, Predecessor-gated secrets) | 15 | done |
| Server hardening (shared rate limits, relayer caps, signed uploads, headers) | 10 | done |
| Operations (health, balance alerts, poller, runbook) | 10 | done |
| Reproducible, locked deployment | 5 | tooling done; lock at mainnet deploy |
| Independent audit | 15 | **open** |
| Legal opinion, KYC/KYB, reviewed terms | 15 | **open** |
| Real USDC on mainnet + pilot on a real site | 10 | **open** |
