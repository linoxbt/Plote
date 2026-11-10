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
      (`RELAYER_PRIVATE_KEY`, sensitive). Rotate it on any suspicion; the relayer can't move user funds.
- [ ] Surveyors use phone keys (`/qs/setup`): function-call only, allowance capped. Developers use the claim key from
      `/dev` for day-to-day calls.

## 3. Deploy (the scripts refuse unsafe mainnet configs)

`scripts/deploy-estate.ts` refuses, on mainnet: an unpinned verifier, any USDC other than Circle's
(`17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`), `verify_mode` other than `outlayer`,
`demo_mode`, `playground`, and a veto window under 24 h. Mock USDC can't be deployed on mainnet.

1. Build reproducibly and record the hashes:
   `cargo near build reproducible-wasm --manifest-path contracts/estate/Cargo.toml` (and `unit`). Anyone can repeat
   it; the image is pinned by digest in each `Cargo.toml`.
2. `NEAR_ENV=mainnet` — publish the unit code (global, by hash), then deploy each estate with
   `config/estate.mainnet.example.json` as the starting point (real deadlines, real geofence, real surveyor).
3. Publish the verifier on OutLayer mainnet; pin its version key in the config; store the NEAR AI key with
   `scripts/outlayer-setup.ts`, which uses the condition `Predecessor(Whitelist[estate])` (only runs requested by
   the estate contract can use it).
4. Run one OutLayer check on a throwaway capture to warm the build (yield/resume times out on a cold build).
5. **Lock the code**: `pnpm tsx scripts/delete-estate-keys.ts <estate> --yes`. After this nobody, including Plote,
   can change the estate's code; `/status` shows "Code locked" green. If you'd rather keep an upgrade path, the only
   acceptable alternative is a multisig with a public timelock longer than the shortest veto window, documented here.
6. Set `NEXT_PUBLIC_NETWORK=mainnet`, `NEXT_PUBLIC_ESTATES`, and the server variables in Vercel.

## 4. Operations

- [ ] `supabase/migrations/0001_init.sql` and `0002_rate_limits.sql` applied; Supabase point-in-time recovery on.
- [ ] `ALERT_WEBHOOK_URL` set (Slack or Discord); the poller posts when the relayer drops below 1 NEAR, an estate's
      verification budget drops below 0.3 NEAR, or an estate can't be read.
- [ ] An uptime monitor on `/api/health` (it returns `balances.ok: false` on low balances).
- [ ] The 5-minute poller (`.github/workflows/poll.yml`) has `CRON_SECRET` and `APP_URL` set in the repository.
- [ ] Rate limits are shared across instances (Postgres); the relayer also has per-IP and global caps.

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
