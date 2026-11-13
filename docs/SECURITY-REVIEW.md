# Internal security review (pre-audit), 10 November 2026

Three reviewers read the estate and unit contracts, the TEE verifier, and the web server, relayer and database
policies, each looking for ways to lose, lock or redirect buyers' money, or to get a payment released without genuine
evidence. Every finding below was traced in the code; fixes have tests. **This is not an independent audit** — it is
the preparation for one (docs/LAUNCH.md §1).

Status key: **Fixed** (code + test), **Mitigated** (risk reduced, residual noted), **Open** (needs work outside
this codebase or a state migration).

> **Current status (13 Nov):** the sections are in date order and earlier notes describe the state at the time. The
> correction below about the pre-hardening verifier, and the Audit 3 "photo checks cannot pass" item, are superseded:
> see [Audit 4](#audit-4-1213-nov) for what is live now and what is still open.

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

A second, independent review of contracts, verifier, web, server, CI and deploy tooling. Migration `0004_audit2.sql`
was applied and everything below marked Fixed was deployed and re-verified live on 11 Nov (estate code_hash
`4VzfEoLS…`, the reproducible build of `95224ca`).

| # | Sev | Finding | Status |
|---|---|---|---|
| A2-1 | High | The event poller listed transactions signed by or sent to the estate, so it missed relayed meta-transactions (outer receiver = the surveyor), USDC `ft_transfer_call` payments (receiver = USDC) and OutLayer callbacks; refetched event-less transactions every run; no cursor. Milestone emails depended on it | **Fixed (live)** — indexes every receipt the estate executes (NearBlocks receipt listing + RPC outcomes, successful receipts only), records processed receipt ids in `poll_receipts` with or without events, keeps a block cursor in `poll_cursor`, inserts events with `ON CONFLICT DO NOTHING` and emails only rows actually inserted. Verified read-only against testnet (relayed `open_capture`/`submit_evidence`, the OutLayer `verdict` callback and a USDC purchase now indexed; a second run reads nothing) |
| A2-2 | Med | The poller answered 200 when every estate failed, so the scheduled job never failed | **Fixed (live)** — 502 when all estates fail; partial failures, unreadable transactions and cursor gaps go to `ALERT_WEBHOOK_URL` |
| A2-3 | Med | `/api/health` reported NEAR AI "ok" from a key-less `GET /models`; 1Click "configured" on testnet; developer/payout gas unwatched | **Fixed (live)** — `photo_checks` is data-driven (fails when the latest verdicts all show `ai_unavailable`/`challenge_unverified`/`worker_error`; it reports failing on testnet today); 1Click "mainnet only" on testnet; developer and payout accounts (+ `MONITOR_ACCOUNTS`) below 0.5 NEAR flagged; public view stays flags only |
| A2-4 | Med | Default email sender `notify@plote.app` is an unverified domain; unsubscribe/confirm HMAC keyed with `CRON_SECRET` (shared with GitHub Actions) | **Fixed (live)** — `RESEND_FROM` required, `GET /api/notify/status`; `NOTIFY_SECRET` signs links (falls back to `CRON_SECRET` while unset; old unsubscribe links still verify) |
| A2-5 | Med | Gate passes were single-use only per guard device (in-memory nonce); `gate_nonces` unused | **Fixed (live)** — `POST /api/gate/verify` verifies the NEP-413 pass and claims its nonce once in Postgres (`claim_once`, 2 min). the guard page calls it |
| A2-6 | Low | Shared rate limits and single-use nonces fall back to per-instance memory silently | **Fixed** — logged as `plote:rate-limit-fallback` / `plote:once-fallback` (scope and reason only) |
| A2-7 | Med | Playground (anyone is surveyor) had the same caps as real estates on uploads and relayed captures; upload URLs live 2 h, unbound to size; no cleanup | **Fixed (live)** — playground: 5 uploads/hour per account and 50/hour total, 10 relayed captures/hour per account; declared size and a 5-minute deadline recorded and enforced by the poller's storage check (Supabase can't shorten or bind its signed URLs); unreferenced playground files > 14 days deleted when `STORAGE_CLEANUP_DELETE=1` (report-only by default) |
| A2-8 | Med | `/api/verify`: an RPC error escaped as a 500; if `submit_verdict` failed after OutLayer was paid, a retry paid again | **Fixed (live)** — 503 `RPC_UNAVAILABLE`; paid verdicts kept in `verify_results` and resubmitted on retry without a new OutLayer run; 502 `VERDICT_SUBMIT_FAILED` with details |
| A2-9 | Low | `/api/chipin` unthrottled with a 16 s worst-case lookup; 1Click payers' wall name/note never reached `chipins` | **Fixed (live)** — 10/min per IP, 8 s deadline; copied once per deposit address on SUCCESS |
| A2-10 | Low | `/api/meta` read views of any account; no edge caching | **Fixed** — configured estates only; `s-maxage` + `stale-while-revalidate` |
| A2-11 | High | Testnet `/api/oneclick/quote` accepted testnet unit accounts as mainnet 1Click recipients when `MAINNET_UNIT_ACCOUNT` was set (USDC to an address nobody controls); tokens/status/submit proxied on testnet | **Fixed** — testnet quotes only to `MAINNET_UNIT_ACCOUNT`; tokens/submit answer `ONECLICK_MAINNET_ONLY`; status only for deposit addresses Plote quoted |
| A2-12 | High | 1Click plain-transfer deposits credited by anyone's `sync_deposits` | **Fixed (live)** — permissioned, amount-attesting `report_deposit` by the estate's `verdict_relayer`, confirmed by two balance reads and an `expected` snapshot; `/api/oneclick/status` calls it |
| A2-13 | Low | CI didn't lint the verifier (own workspace) or run the Playwright smoke tests | **Fixed** — verifier `fmt --check` + `clippy -D warnings` + tests; an e2e job builds, starts and runs Playwright (Chromium) |
| A2-14 | Med | `upgrade-estate-code.ts` deployed any local WASM, on mainnet too; `deploy-estate.ts` redeployed code and re-funded verification on initialised estates | **Fixed** — `--expected-hash` required, mismatches refused, mainnet needs `--i-know`, deployed `code_hash` printed; deploy skips code, `new` and funding when initialised |
| A2-15 | Med | Docs claimed verifier fixes and a reproducible deployment were live | **Fixed (docs)** — see the correction above and README → Reproducible build |

### Audit 2: contracts, verifier and web

| # | Sev | Finding | Status |
|---|---|---|---|
| A2-C1 | Critical | A balance read during a pending `ft_transfer_call` was credited permanently (mint an NFT with no money, brick a unit, inflate `paid`) | **Fixed (live)** — `ft_transfer_call` deposits credited only from `on_unit_deposit`'s amount; plain transfers only via `report_deposit` (A2-12); `sync` credits nothing. Verified live: a purchase credited exactly once, a public `sync` credited nothing |
| A2-C2 | High | Stale balance read raced a transfer out | **Fixed (live)** — `expected` snapshot passed through callbacks; mismatch credits nothing |
| A2-C3 | High | Holder methods that move ownership or money took no 1 yoctoNEAR (function-call keys could sell the token) | **Fixed (live)** — 11 methods require exactly 1 yocto; verified live (`list_for_sale` without it refused) |
| A2-C4 | High | Deployed code not reproducible | **Fixed (live)** — see README → Reproducible build. Unit global code: see the note there |
| A2-C5 | High | Live estates ran the pre-hardening verifier while docs said otherwise | **Mitigated** — hardened verifier `47175658…` published and pinned on the playground (live re-pin allowed only there); Harmattan Court and Baobab Heights keep `31c7225…` because a sold estate's verifier is fixed by design; docs say so |
| A2-C6 | Med | Baobab Heights NFT metadata pointed at a third-party site | **Fixed (live)** — `set_app_url`; Baobab now `https://plote-vert.vercel.app`; `app_url` required for new estates |
| A2-C7 | Med | Votes not tied to stake; ExtendDeadline/Unfreeze without quorum | **Fixed (live)** — paid-weighted votes, quorum (≥3 tokens, ≥25% of units) on every kind but Veto; ExtendDeadline is the recovery path after a miss |
| A2-C8 | Med | Releases continued while refunds were open | **Fixed (live)** — `claim_release` → `E_REFUNDS_OPEN` while refunds are open |
| A2-C9 | Med | Reservation stuck when its refund transfer failed; failed callbacks unrecoverable | **Fixed (live)** — failed refund → `owed`; approvals capped; size bounds; `reopen_stale_check` |
| A2-C10 | Med | Playground grief (capture replaced, uploads, budget) | **Fixed (live)** — capture guard, per-account/global caps, cleanup |
| A2-W1 | High | Share images rendered NFT text as empty boxes | **Fixed (live)** — fonts bundled; verified on production |
| A2-W2 | High | Website NFT drawing differed from the on-chain one | **Fixed (live)** — exact port, byte-for-byte fixture tests against the Rust output |
| A2-W3 | High | No UI to cancel/expire reservations or sweep; a unit stuck Reserved | **Fixed (live)** — actions on unit and buy pages; Harmattan `a-2a` expired on-chain |
| A2-W4 | Med | Wallet errors swallowed; menu focus; screen-reader numbers; amber token; /nft hard-coded; proof card missing; app keys in plain localStorage | **Fixed (live)** |

### Audit 3: final independent review (11 Nov)

| # | Sev | Finding | Status |
|---|---|---|---|
| A3-1 | High | Flash-weight vote capture: one holder topped up to full price before voting, passed StepIn/ReplaceSurveyor/Freeze alone, then refunded the top-up (PoC) | **Fixed (live)** — every kind but Veto needs a paid-weighted majority **and** a strict majority of distinct eligible holders; electorate fixed at creation; PoC kept as a regression test. Estates upgraded to the reproducible build of `affdf57` (code_hash `J31YPbxD…`) |
| A3-2 | High (mainnet) | Estate accounts still hold a full-access key | **Open by decision on testnet** (keeps the demo upgradable during judging; `/status` shows "not locked"); lock at mainnet launch (LAUNCH.md §3) |
| A3-3 | Med | Plan dates not rebased for a later buyer of a refunded unit | **Fixed (live)** — rebased at every allocation |
| A3-4 | Med | Deposit report retried after an uncertain timeout | **Fixed (live)** — retried only after a definite contract refusal; uncertain outcomes logged for an operator |
| A3-5 | Low | Default ask ignored refunded money; `withdraw_excess` uncapped | **Fixed (live)** |
| A3-6 | Med | A holder with ≥50% weight can stall a Veto by abstaining | **Open (documented)** — a safe fix needs releases to wait for open vetoes |
| A3-7 | Med | CSP allows inline/eval script (wallet SDKs need it); `vote` is no-popup | **Open (documented)** — app keys are now non-extractable WebCrypto keys where supported |

### Still open after Audit 3

- **Photo checks cannot pass** until the NEAR AI API key has credits (owner action); health reports this honestly.
- **Reporter trust (A2-12):** the relayer can credit at most the real observed surplus; a malicious relayer racing a
  pending `ft_transfer_call` across both reads could still book refunded money. Full fix needs a per-unit pending counter (state migration).
- **Event schedule:** done — Supabase pg_cron calls the poller every 5 minutes (`0005_poll_schedule.sql`, `POLL_SECRET`), verified live.
- **Independent audit, legal opinion, mainnet funds and a real-site pilot** (LAUNCH.md §1).

## Audit 4 (12–13 Nov)

A fourth review of contracts, verifier, web, server, CI and deploy tooling, followed by a live redeploy. **Still not an
independent audit.**

What was deployed and checked live on NEAR testnet (12–13 Nov):

- **Contracts:** all three estates (`harmattan-court`, `baobab-heights`, `playground` `.plote.testnet`) run the
  reproducible build of commit `99f6a77` (`99f6a77db831a8f5658d8d1d13b3cfa5415f60c8`): wasm sha256
  `4a572e3e11df139fdf7b12742149c1add0792f56b04cbd73690e25fbee9ece6a`, `code_hash`
  `61CGp8J2MpTr2DYpCVSCotWEQeuGdbVhDWAv2iuA2VxD`, built in the pinned `sourcescan/cargo-near:0.22.0-rust-1.97.0` image.
  Upgraded in place with state intact, then `migrate` → `state_version` 2. `config/estate-wasm.sha256` pins the sha256
  and revision; `.github/workflows/reproducible.yml` rebuilds the pinned revision and fails if the hash differs or the
  contract sources changed since it.
- **Verifier:** hardened build, version key `07cf962632350d40bcdc4318d382af8f31aa49aab264b7b725add86dd415df6b`,
  reproducible with `cd verifier && ./build-wasm.sh` (`verifier/README.md`, `.github/workflows/verifier-build.yml`),
  published on OutLayer as `plote.testnet/plote-verifier`. All three estates are pinned to it; the two sold estates
  through the new `repin_verifier`, which only the estate account itself can call while its keys exist. The NEAR AI key
  is stored as an OutLayer secret per estate with `Predecessor(Whitelist[estate])`.
- **First live end-to-end pass** (playground, 12 Nov): `open_capture` code `2NJF8S` → photo uploaded via
  `/api/evidence/upload-url` → `submit_evidence` id 6 → OutLayer TEE worker `plote-verifier@0.1.0` with NEAR AI model
  `Qwen/Qwen3-VL-30B-A3B-Instruct` → verdict Pass (no reasons, no warnings) → milestone Verified → `qs_sign` →
  Approved → 2-minute veto window → `claim_release` on `p-55` and `p-56` (100 USDC paid each) → 20 USDC released from
  each (40 in total) to `dev-harmattan.plote.testnet`. Proof page: https://plote-vert.vercel.app/proof/playground/6.
  **About that photo:** it is a public-domain 1943 photograph of a foundation, with the one-time code on paper
  composited in digitally and EXIF stamped onto the file. The model accepted it. This shows the documented limit
  (V-H1, A4-H3): finding the code in the frame cannot by itself prove the paper was physically on site. The playground
  has no geofence; non-demo estates require the phone's GPS.
- **Web:** the production build includes the Audit 4 web and server changes. Supabase migrations `0006_audit4.sql`
  and `0007_poll_schedule_url.sql` were applied on 13 Nov before the production deploy of `bdf7176`; a poller run on
  the new code returned 200 with no errors and advanced every estate's cursor.

Tests after the fixes: estate 108, unit 5, musdc 3 (`cargo test --workspace`); 11 integration flows on the real WASMs
(`tests/integration`); verifier 89 + 5; web 192 (Vitest). Clippy `-D warnings` clean.

Status key for this section: **Fixed (live)** — deployed and running on testnet; **Fixed (code)** —
merged and tested, waiting on a testnet configuration change;
**Open (documented)** — not fixed, written down in INTERFACE.md, README or LAUNCH.md.

### Critical

| # | Finding | Status |
|---|---|---|
| A4-C1 | **Fake-estate payments.** The web app treated any account under the root (or typed into a URL) as a Plote estate, so a look-alike contract could be shown with Plote's pages and take buyers' payments | **Fixed (live)** — only genuine estates are treated as Plote: those in `NEXT_PUBLIC_ESTATES`, or subaccounts of the root account whose `code_hash` is in `NEXT_PUBLIC_ESTATE_CODE_HASHES` (default `61CGp8J2…`, `J31YPbxD…`); the app refuses to build a payment to anything else (`assertPayable`), including nested look-alike accounts |

### High

| # | Finding | Status |
|---|---|---|
| A4-H1 | **Stage order not enforced.** A later milestone could be captured, signed and released before an earlier one; `approved_bps` summed approved stages regardless of order; `handover` didn't need every stage | **Fixed (live)** — `open_capture` / `submit_evidence` / `qs_sign` for milestone *i* need *i − 1* Approved (`E_MILESTONE_STATE`, playground too); `approved_bps` counts approved stages in order only; `handover` needs all milestones Approved (`E_HANDOVER`). Integration flow `audit4_stage_order_and_repin_on_chain` |
| A4-H2 | **Vote capture**: splitting one stake across sybil accounts (several 10 % tokens out-voting fully paid holders), or pledging a unit to one's own second account and taking a lien-first refund while keeping the full vote weight | **Fixed (live)** — weight = net equity `min(paid − refunded_out, price)`, never above the token's weight when the proposal opened (copy-on-write snapshot); every kind but Veto also needs a strict majority of distinct holders; new estates need `min_initial_bps ≥ 1000` |
| A4-H3 | **Spoofable location.** The phone's GPS was optional and EXIF GPS can be written by anyone, so a real estate's geofence could be satisfied from anywhere | **Fixed (live)** for the check: `gps_device_missing` outside the playground and demo estates; EXIF and phone GPS must agree within 100 m. **Residual, Open (documented):** both positions still come from the submitter's device, and the challenge code can't prove physical presence (see the live proof photo above). Device-attested capture is not built |
| A4-H4 | **Unvalidated trust anchors:** any `outlayer_id` (a mock could be pinned), the `playground` flag on any account, `mock*` warnings accepted, and HTTPS-mode `submit_verdict` not bound to the evidence | **Fixed (live)** — `outlayer_id` allowlisted per network (`outlayer.testnet` / `outlayer.near`) outside the playground; `playground: true` only on `.testnet` accounts; every `mock*` / `ai_mock*` warning becomes a failing reason; verdicts must echo `evidence_id` and the committed `sha256` (`verdict_unbound` otherwise); HTTPS-mode `submit_verdict` enforces both (`E_VERDICT_MISMATCH`). These are `new`-time checks; the live estates were checked by hand (all three use `outlayer.testnet`, only the playground has the flag) |
| A4-H5 | **Sold estates ran the pre-hardening verifier** (`31c7225…`), because `set_verifier` stops at the first sale | **Fixed (live)** — `repin_verifier` (estate account only, 1 yocto, never back to `31c7225…`); all three estates pinned to `07cf9626…`. The method disappears when the estate keys are deleted |
| A4-H6 | **UI showed success for payments the contract refused or refunded** (an `ft_transfer_call` whose `on_unit_deposit` returned the amount) | **Fixed (live)** — the outcome's refunded amount is read; refused or refunded payments are shown as failures with the reason |
| A4-H7 | **Estate wizard and deploy script disagreed** on the config schema, so a wizard-made config couldn't be deployed as shown | **Fixed (live)** — the wizard emits the deploy-script schema; tests check its fields against what the deploy scripts read and the checked-in testnet config |
| A4-H8 | **False public claims** in the README, site copy and proof page (verifier fixes "live", passing proofs, reproducibility) | **Fixed (live)** — site copy and proof page corrected (the proof page states what was checked and what wasn't); README, demo script and this review updated 13 Nov |
| A4-H9 | **Estate keys.** Each estate account holds a full-access key, so its holder can replace the code | **Open (documented)** — kept on testnet so the demo stays upgradable; deleted at mainnet launch (LAUNCH.md §3); `/status` shows "not locked". Same as C10 / A3-2 |

### Medium

| # | Finding | Status |
|---|---|---|
| A4-M1 | Partial-refund accounting: after a lien-first refund, the release cap (`min(paid, price) × bps − released`) could ask for more than the unit held, so `claim_release` failed for that unit forever | **Fixed (live)** — releases are capped by the unit's books net of refunds; the token stays alive with net-equity weight (`r4_release_capped_by_books_after_partial_refund`) |
| A4-M2 | A lien set before a default blocked the default sale, and liens needed no lender consent | **Fixed (live)** — liens need lender consent (`set_lien` → `accept_lien`; an offer is void after a transfer); a Default sale pays the lender first from the proceeds, up to its cap (`lien_settled`), the seller gets the rest and the buyer takes the token free of the lien |
| A4-M3 | Veto top-up: topping up after a Veto opened added weight to it | **Fixed (live)** — weight capped at its value when the proposal opened |
| A4-M4 | Unbooked surplus: USDC on a unit that nobody reported had no path out | **Fixed (live)** — `request_surplus_booking` → 7 days (`E_TIMELOCK`) → `finalize_surplus_booking`, booked as `unattributed` only, then `sweep_unattributed` |
| A4-M5 | Poller skipped the rest of a backlog when NearBlocks paged it (gap skipping) | **Fixed (live)** — resumes from the NearBlocks continuation; never-backwards cursor (`poll_cursor_save`, 0006) |
| A4-M6 | Event dedupe keyed by transaction, so several events in one transaction collapsed | **Fixed (live)** — events keyed by receipt, log line and data index (0006) |
| A4-M7 | Lost emails: emails tied to the insert, so a failed send was never retried | **Fixed (live)** — emails driven by `events.notified_at` (0006) |
| A4-M8 | Double schedulers: GitHub Actions and pg_cron both ran the poller, overlapping | **Fixed (live)** for `poll.yml` (manual only); run lock `poll_lock` and the 45 s work budget **Fixed (live)** (0006) |
| A4-M9 | Playground DoS: unbounded submissions burned the verification budget; anyone could reset during others' captures | **Fixed (live)** — on-chain caps (5 submissions per account per hour, `E_RATE_LIMIT`; a slot is returned on infrastructure failure); guarded `playground_reset` (no check running, no foreign open capture, once per 10 min); per-estate relay caps on the server |
| A4-M10 | 1Click note attribution: the estate and unit for a deposit could be taken from the request body instead of the quote's recipient, so a payment or family-wall note could be attributed to another unit | **Fixed (live)** — estate and unit derived from the recipient `<unit>.<estate>` only; a body naming another unit is refused |
| A4-M11 | 1Click quote insert unchecked: a failed database insert still returned a deposit address the status route would not know | **Fixed (live)** — insert checked; no address is returned without a stored quote |
| A4-M12 | Verdict lost when the 60 s request ended between the OutLayer answer and `submit_verdict` | **Fixed (live)** — verdict saved before submitting; a retry resubmits it without a new paid run |
| A4-M13 | Hot key: one relayer key both paid gas and booked deposits | **Fixed (code)** — separate `REPORTER_*` key, required on mainnet. **Testnet:** the estates' `verdict_relayer` is still `relayer.plote.testnet`, so relayer and reporter are one account there until it is changed on-chain |
| A4-M14 | `APP_URL` could fall back to localhost in production links (emails, NFT reference) | **Fixed (live)** — production falls back to `https://$VERCEL_PROJECT_PRODUCTION_URL`, never localhost |
| A4-M15 | SSRF / hash oracle: the worker fetched any URL, followed redirects, and echoed the digest of whatever it fetched | **Fixed (live)** — URL allowlist (`url_not_allowed`), no redirects, the committed hash echoed (not the served bytes' digest) |
| A4-M16 | An AI outage burned the verification budget and counted as a failed photo | **Fixed (live)** — infrastructure-only failures (`ai_unavailable`, `worker_error`) are stored as Error, refund the 0.05 NEAR and reopen the milestone; the worker retries NEAR AI once on a transient error |
| A4-M17 | Unreproducible verifier, and a proof page claiming the build could be checked against source | **Fixed (live)** — `build-wasm.sh` reproducible build + `verifier-build.yml`; model pinned and recorded (`ai_model`); the proof page no longer compares a git SHA with a WASM hash or claims a source match it can't show |
| A4-M18 | Types drift between the web app and INTERFACE.md | **Fixed (live)** — types aligned; new fields and error codes in `web/lib/errors.ts` |
| A4-M19 | Double submit on payment and capture buttons | **Fixed (live)** — double-submit guards on payment and capture actions |
| A4-M20 | Stale data after transactions | **Fixed (live)** — targeted cache invalidation per estate and unit |
| A4-M21 | Capture dead ends (stuck after an upload or a failed check) | **Fixed (live)** — ready/retry states; only the next milestone in order is offered; another account's open capture is explained |
| A4-M22 | Gas: `propose` and `vote` were sent with too little gas for the quorum scan and distinct-holder count | **Fixed (live)** — 100 Tgas each in the app |
| A4-M23 | No `migrate` or state version for in-place upgrades | **Fixed (live)** — `migrate` + `state_version` (2 on all three estates); layout test `layout::r4_stored_layout_unchanged` |
| A4-M24 | CI gaps: broad token permissions, actions pinned by tag, no secret scan, reproducible check not tied to the deployed revision | **Fixed (live)** — least-privilege permissions, SHA-pinned actions, gitleaks, reproducible check rebuilds the pinned revision |

### Low

| # | Finding | Status |
|---|---|---|
| A4-L1 | `ExtendDeadline` checked only at `propose`; could shorten a deadline | **Fixed (live)** — re-checked when it passes, never shortens (rejected otherwise) |
| A4-L2 | Money/vote/transfer methods usable while an `nft_transfer_call` of the token was unresolved | **Fixed (live)** — pending flag, `E_NFT_PENDING` |
| A4-L3 | `add_units` kept any excess deposit | **Fixed (live)** — excess returned to the developer |
| A4-L4 | A report and an `ft_transfer_call` overlapping could book the same money twice | **Fixed (live)** in the contract — amounts above the report's spare are accepted but not booked (`deposit_deferred`). The server books them with `report_deposit` from the poller's follow-ups: **Fixed (live)** (0006) |
| A4-L5 | `set_verifier` took no 1 yocto | **Fixed (live)** — 1 yocto required |
| A4-L6 | `withdraw_owed` with nothing owed succeeded silently | **Fixed (live)** — `E_NOTHING_OWED` |
| A4-L7 | Replay checks fell back to per-instance memory when Postgres was down | **Fixed (live)** — relayed delegates and gate passes fail closed (503 `REPLAY_CHECK_UNAVAILABLE`) |
| A4-L8 | API errors and logs could carry internal details or keys | **Fixed (live)** — sanitized error bodies; keys and bearer tokens redacted from logs |
| A4-L9 | No signal when the poller stopped | **Fixed (live)** — `poller.ok` in `/api/health` (false after 20 min without a saved cursor) |
| A4-L10 | Flagged evidence files were only reported, never deleted | **Fixed (live)** — deleted by default in production (`STORAGE_CLEANUP_DELETE=0` for report-only); runs inside the poller |

New error codes: `E_VERDICT_MISMATCH`, `E_TIMELOCK`, `E_RATE_LIMIT`, `E_NFT_PENDING`, `E_NOTHING_OWED` (INTERFACE §1.5,
`web/lib/errors.ts`). New verifier reasons: `gps_device_missing`, `url_not_allowed`; new contract reason
`verdict_unbound`.

### Still open after Audit 4

1. **Estate full-access keys on testnet** (A4-H9). Until they are deleted at mainnet launch (LAUNCH.md §3), the key
   holder can upgrade the code and call `repin_verifier`.
2. **No timelock on `StepIn` / `ReplaceSurveyor`** (INTERFACE §1.2). Quorum, both majorities and the net-equity snapshot
   are the safeguards.
3. **Veto stall** (A3-6): a holder with ≥ 50 % of the weight can stop a Veto passing by abstaining.
4. **Deposit reporter trust** (A2-12): the reporter is trusted to report plain-transfer deposits honestly. It can credit
   at most the surplus seen in two balance reads, but could book money from a pending `ft_transfer_call` that is later
   refunded. On testnet it is the same account as the relayer (A4-M13).
5. **Code-in-frame is not proof of presence** (V-H1, A4-H3): the live proof photo shows a composited code passes.
   Non-demo estates add the phone's GPS; device-attested capture is not built.
6. **CSP** (W-M1, A3-7): `script-src` still allows `'unsafe-inline'` and `'unsafe-eval'` for the wallet SDKs.
7. **External gates:** independent audit, legal opinion, mainnet pilot on a real site (LAUNCH.md §1).
