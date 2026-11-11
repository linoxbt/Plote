# Internal security review (pre-audit), 10 November 2026

Three reviewers read the estate and unit contracts, the TEE verifier, and the web server, relayer and database
policies, each looking for ways to lose, lock or redirect buyers' money, or to get a payment released without genuine
evidence. Every finding below was traced in the code; fixes have tests. **This is not an independent audit** — it is
the preparation for one (docs/LAUNCH.md §1).

Status key: **Fixed** (code + test), **Mitigated** (risk reduced, residual noted), **Open** (needs work outside
this codebase or a state migration).

## Contracts (`contracts/estate`, `contracts/unit`)

| # | Sev | Finding | Status |
|---|---|---|---|
| C1 | High | A seller's guardians/beneficiary survived a sale, letting the seller recover the token after being paid; an `nft_transfer_call` receiver could add a lien/guardians then hand the token back | **Fixed** — cleared on every move; `nft_transfer_call` snapshots the safety state and restores it on revert |
| C2 | High | The buyer of a defaulted unit inherited overdue instalments and could be put back into default in the next block | **Fixed** — overdue instalments are rebased to the sale on a Default sale; the buyer gets a full default grace |
| C3 | High | One early 10 % buyer was the whole electorate: a single-holder `StepIn` redirected releases to any account; same for `Freeze` / `ReplaceSurveyor` | **Fixed** — these need ≥ 3 eligible tokens and ≥ 25 % of units sold; `StepIn` only while frozen or after a missed deadline (re-checked on execution). `Veto` stays fast |
| C4 | High | A late 1Click payment could be credited to whoever reserved the unit next | **Fixed** — other accounts wait `last reservation end + late_claim_ns` (`E_LATE_CLAIM`); `sweep_unattributed` credits an expired current reservation |
| C5 | Med | A defaulter escaped the default listing by setting a lien to a spare account | **Fixed** — `set_lien` only on Allocated/HandedOver with no Default listing |
| C6 | Med | A failed unit-account creation was ignored, leaving a "ready" unit whose money could never move | **Fixed** — `create.and(register)`, both results checked; `retry_unit_setup` finishes a half-created unit |
| C7 | Med | Proposal spam (sybils passing one token around) could push `propose` past the gas limit and disable Veto/Freeze | **Mitigated** — bounded scans; 0.05 NEAR deposit per proposal kept by the estate. A per-token cap needs new state |
| C8 | Low | A balance read could be applied after a payout landed (cross-shard ordering) | **Open** — documented in `on_balance`; logic-only fix noted |
| C9 | Low | An unparsable `nft_on_transfer` result kept the token at the receiver | **Fixed** — returned per NEP-171 |
| C10 | High (ops) | Whoever holds an estate's full-access key can redeploy it | **Open until launch** — `/status` shows "Code locked" per estate; LAUNCH.md §3 locks keys at mainnet deploy |
| V-H2 | High | Real estates could be deployed with no geofence, AI confidence 0, any photo age, or an unpinned verifier | **Fixed** — `new`/`set_verifier` refuse unsafe check settings outside the playground; the deploy script refuses them on mainnet |
| V-L3 | Low | A verdict wasn't bound to the evidence and bytes it judged; mocked AI answers were accepted | **Fixed** — `evidence_id`/`sha256` must match when echoed; `ai_mock` always fails |

Checked and safe: unit `transfer_out` only from the estate; `on_unit_deposit` only from the unit's own account;
`in_flight` saved before every payout promise, failed transfers move no accounting; duplicate claim IDs skipped;
release cap `min(paid, price)`, rounding down, overflow checks on; vote eligibility by `allocated_at <= created_at`;
veto and release windows don't overlap; Freeze blocks claims, reservations, evidence and purchases.

## Verifier (`verifier/`)

> **Correction (11 Nov):** "Fixed" in this table means fixed in the verifier source, with tests. It is **not live**:
> all three testnet estates (`harmattan-court`, `baobab-heights`, `playground`) are still pinned on-chain to the
> pre-hardening OutLayer build `31c7225df81449c11bac1ae31b00fbfcc353a64a2f1aed4b0ce9c90e1dd818f8`, so their photo checks
> run without these fixes until they are re-pinned. `set_verifier` only works before an estate's first sale and all
> three have sales, so re-pinning needs fresh (or reset) estates. Checked with `get_estate` → `verifier.commit`.

| # | Sev | Finding | Status |
|---|---|---|---|
| V-H1 | High | Location and time are whatever the submitter says (device GPS is an argument; EXIF can be rewritten) | **Mitigated** — `gps_mismatch` when EXIF and device GPS disagree > 100 m; `gps_device_only` warning. Full fix needs device-attested capture (C2PA / platform attestation). The surveyor's signature and replaceability remain the backstop |
| V-H2 | High | `radius_m == 0` skipped location on any estate | **Fixed** — `bad_geofence` unless playground; radius > 5 km refused |
| V-M1 | Med | Text in the photo could steer the model; the claimed milestone biased it; loose JSON extraction | **Fixed** — milestone removed from the prompt, image text untrusted, `has_other_instructions` → `ai_instruction_text`, JSON mode + strict single-object parsing |
| V-M2 | Med | Reuse check dodged by mirror/rotate/EXIF orientation | **Fixed** for all 8 orientations. Crops: **Open** (needs a crop-tolerant hash); cross-estate registry: **Open** |
| V-M3 | Med | Empty verifier pin ran the project's active version | **Fixed** in the contract (see V-H2 row above) |
| V-L1 | Low | Missing screen/render flags counted as "real photo" | **Fixed** — missing → `ai_unavailable` |
| V-L2 | Low | No HTTP timeouts; huge images could crash the worker; photo URL host unrestricted | **Fixed** timeouts and `image_too_large`; URL host allowlist **Open** (belongs in `submit_evidence`) |
| V-L3 | Low | Verdict not bound to bytes | **Fixed** — worker echoes `sha256`; contract checks it |

Note: a live estate's verifier can't change after its first sale (by design), so verifier fixes protect only estates
deployed (or pinned) after the fixed build is published, including mainnet. None of the live testnet estates has them.

## Web server, relayer and database (`web/`, `supabase/`)

| # | Sev | Finding | Status |
|---|---|---|---|
| W-H1 | High | The relayer paid gas for anyone: no signature, key, nonce or expiry check before submitting; public `sync*` methods allowlisted; limits counted before auth (surveyor lock-out) | **Fixed** — signature, access key, nonce and `maxBlockHeight` verified off-chain first; only the estate's surveyor (any account on the playground); only `open_capture`/`submit_evidence`/`qs_sign`; single-use delegate hash; limits per sender, per IP and global, counted after verification, shared across instances |
| W-M1 | Med | No CSP / frame protection while app keys live in localStorage (one-click vote clickjacking) | **Mitigated** — CSP with `frame-ancestors 'none'`, connect-src allowlist, X-Frame-Options, HSTS, Permissions-Policy, violation reports. `script-src` keeps `'unsafe-inline'`/`'unsafe-eval'` because wallet code from near-connect needs them, so the CSP stops framing, not injected script. Moving app keys to non-extractable WebCrypto (as the surveyor key already is) remains **Open** |
| W-M2 | Med | Upload rate limit counted before auth (surveyor lock-out) | **Fixed** — per-IP before auth, per-account after signature and surveyor checks; EXIF capped at 4 KB |
| W-M3 | Med | `/api/verify` could be replayed to burn OutLayer credit | **Fixed** — Postgres lease per evidence id, max 3 runs |
| W-M4 | Med | Family-wall totals could be inflated with failed or repeated transactions | **Fixed** — successful transactions only, amount from the final outcome, unique per tx hash, name/note from the signed transfer |
| W-L1–L6 | Low | 1Click status re-sync, unthrottled 1Click proxies, detailed public health, unconfirmed email sign-ups, unescaped SVG badge, replayable NEP-413 nonces | **Fixed** — claim-once sync, rate limits, details behind the cron secret, double opt-in with POST confirmation, escaped, single-use nonces |
| W-ops | — | Per-instance rate limits | **Fixed** — shared Postgres limiter (`0002`), security tables (`0003`), both applied |

Checked and safe: NEP-413 payload encoding and binding; upload paths are server-generated and can't overwrite; RLS on
every private table; constant-time cron secret; HMAC unsubscribe tokens; no secrets in `NEXT_PUBLIC_*`; no
user-controlled outbound URLs; NFT images can't run script.

## Live verification after the fixes

All three testnet estates were upgraded in place to the fixed **contract** (state checked identical before and after);
their **verifier** pin was not changed (still `31c7225`, see the correction above), and the deployed estate code is a
local build, not the reproducible artifact (README → Reproducible build).
Contract 60 tests, 5/5 integration flows on real WASM, verifier 78, web 77 unit + 14 end-to-end, clippy and fmt clean.

## Audit 2 (11 Nov)

A second review of the server, CI and deploy tooling. Status key as above; "Fixed (pending deploy)" means the code and
tests are in the repository but need migration `0004_audit2.sql` and a Vercel deploy to be live.

| # | Sev | Finding | Status |
|---|---|---|---|
| A2-1 | High | The event poller listed transactions signed by or sent to the estate, so it missed relayed meta-transactions (outer receiver = the surveyor), USDC `ft_transfer_call` payments (receiver = USDC) and OutLayer callbacks; refetched event-less transactions every run; no cursor. Milestone emails depended on it | **Fixed (pending deploy)** — indexes every receipt the estate executes (NearBlocks receipt listing + RPC outcomes, successful receipts only), records processed receipt ids in `poll_receipts` with or without events, keeps a block cursor in `poll_cursor`, inserts events with `ON CONFLICT DO NOTHING` and emails only rows actually inserted. Verified read-only against testnet (relayed `open_capture`/`submit_evidence`, the OutLayer `verdict` callback and a USDC purchase now indexed; a second run reads nothing) |
| A2-2 | Med | The poller answered 200 when every estate failed, so the scheduled job never failed | **Fixed (pending deploy)** — 502 when all estates fail; partial failures, unreadable transactions and cursor gaps go to `ALERT_WEBHOOK_URL` |
| A2-3 | Med | `/api/health` reported NEAR AI "ok" from a key-less `GET /models`; 1Click "configured" on testnet; developer/payout gas unwatched | **Fixed (pending deploy)** — `photo_checks` is data-driven (fails when the latest verdicts all show `ai_unavailable`/`challenge_unverified`/`worker_error`; it reports failing on testnet today); 1Click "mainnet only" on testnet; developer and payout accounts (+ `MONITOR_ACCOUNTS`) below 0.5 NEAR flagged; public view stays flags only |
| A2-4 | Med | Default email sender `notify@plote.app` is an unverified domain; unsubscribe/confirm HMAC keyed with `CRON_SECRET` (shared with GitHub Actions) | **Fixed (pending deploy)** — `RESEND_FROM` required, `GET /api/notify/status`; `NOTIFY_SECRET` signs links (falls back to `CRON_SECRET` while unset; old unsubscribe links still verify) |
| A2-5 | Med | Gate passes were single-use only per guard device (in-memory nonce); `gate_nonces` unused | **Fixed server-side (pending deploy + client change)** — `POST /api/gate/verify` verifies the NEP-413 pass and claims its nonce once in Postgres (`claim_once`, 2 min). The guard page must call it (frontend) |
| A2-6 | Low | Shared rate limits and single-use nonces fall back to per-instance memory silently | **Fixed** — logged as `plote:rate-limit-fallback` / `plote:once-fallback` (scope and reason only) |
| A2-7 | Med | Playground (anyone is surveyor) had the same caps as real estates on uploads and relayed captures; upload URLs live 2 h, unbound to size; no cleanup | **Fixed (pending deploy)** — playground: 5 uploads/hour per account and 50/hour total, 10 relayed captures/hour per account; declared size and a 5-minute deadline recorded and enforced by the poller's storage check (Supabase can't shorten or bind its signed URLs); unreferenced playground files > 14 days deleted when `STORAGE_CLEANUP_DELETE=1` (report-only by default) |
| A2-8 | Med | `/api/verify`: an RPC error escaped as a 500; if `submit_verdict` failed after OutLayer was paid, a retry paid again | **Fixed (pending deploy)** — 503 `RPC_UNAVAILABLE`; paid verdicts kept in `verify_results` and resubmitted on retry without a new OutLayer run; 502 `VERDICT_SUBMIT_FAILED` with details |
| A2-9 | Low | `/api/chipin` unthrottled with a 16 s worst-case lookup; 1Click payers' wall name/note never reached `chipins` | **Fixed (pending deploy)** — 10/min per IP, 8 s deadline; copied once per deposit address on SUCCESS |
| A2-10 | Low | `/api/meta` read views of any account; no edge caching | **Fixed** — configured estates only; `s-maxage` + `stale-while-revalidate` |
| A2-11 | High | Testnet `/api/oneclick/quote` accepted testnet unit accounts as mainnet 1Click recipients when `MAINNET_UNIT_ACCOUNT` was set (USDC to an address nobody controls); tokens/status/submit proxied on testnet | **Fixed** — testnet quotes only to `MAINNET_UNIT_ACCOUNT`; tokens/submit answer `ONECLICK_MAINNET_ONLY`; status only for deposit addresses Plote quoted |
| A2-12 | High | 1Click plain-transfer deposits credited by anyone's `sync_deposits` | **In progress (contracts)** — a permissioned, amount-attesting `report_deposit` by the estate's `verdict_relayer`; `/api/oneclick/status` already calls it, live once the new estate code is deployed |
| A2-13 | Low | CI didn't lint the verifier (own workspace) or run the Playwright smoke tests | **Fixed** — verifier `fmt --check` + `clippy -D warnings` + tests; an e2e job builds, starts and runs Playwright (Chromium) |
| A2-14 | Med | `upgrade-estate-code.ts` deployed any local WASM, on mainnet too; `deploy-estate.ts` redeployed code and re-funded verification on initialised estates | **Fixed** — `--expected-hash` required, mismatches refused, mainnet needs `--i-know`, deployed `code_hash` printed; deploy skips code, `new` and funding when initialised |
| A2-15 | Med | Docs claimed verifier fixes and a reproducible deployment were live | **Fixed (docs)** — see the correction above and README → Reproducible build |
