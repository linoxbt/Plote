# Plote — on-chain interface (source of truth for web, scripts and verifier)

This file pins the exact JSON shapes the contracts accept and return. `docs/SPEC.md` explains *why*;
this file says *what*. If the two disagree, this file wins for field names and types.

Conventions

- `U128` and `U64` are JSON **strings** (`"85000000000"`). Plain `u8/u16/u32/bool` are JSON numbers/booleans.
- All times are **nanoseconds** since the Unix epoch (`env::block_timestamp()`), as `U64` strings.
- USDC amounts are base units, 6 decimals (`"1000000"` = 1 USDC).
- Unit IDs are lowercase `[a-z0-9-]`, 1–16 chars (e.g. `a-4b`, `p-01`). Token ID of the allocation NFT = unit ID.
- Errors are panics whose message **starts with** a stable code, e.g. `E_UNIT_TAKEN: unit a-4b is not available`.
  The web maps the code (text before the first `:`) to plain English.
- Events: NEP-297 `EVENT_JSON:` logs. NFT events use `nep171` 1.0.0. Plote events use
  `{"standard":"plote","version":"1.0.0","event":"<snake_case>","data":[{...}]}`.

---

## 1. `plote-estate` (e.g. `harmattan-court.plote.testnet`)

### 1.1 Init

`new` takes a single argument named `args` (the `NewArgs` object below): the call's JSON is `{"args": { ... }}`.

```jsonc
new({ "args": {
  "developer_id": "dev-harmattan.testnet",
  "payout_id": "dev-harmattan.testnet",
  "surveyor_id": "qs-adaeze.testnet",
  "recovery_id": "plote.testnet",
  "usdc_id": "musdc.plote.testnet",
  "outlayer_id": "outlayer.testnet",
  "verdict_relayer": "relayer.plote.testnet",      // optional; may call submit_verdict (HTTPS fallback, SPEC 6.6)
  "verifier": { "repo": "https://github.com/<you>/plote-verifier", "commit": "<sha>", "build_target": "wasm32-wasip2" },
  // or a deployed OutLayer project: { "repo": "project:plote.testnet/plote-verifier", "commit": "<version_key or empty>", "build_target": "wasm32-wasip2" }
  // GitHub source with a non-empty commit: a verdict whose worker_commit differs (case-insensitive) is stored as
  // EvidenceStatus "Error" (milestone back to Open), like unparsable output. scripts/deploy-estate.ts refuses an
  // empty commit/version_key unless run with --allow-unpinned.
  "unit_code_hash": "<base58 sha256 of plote_unit.wasm>",           // required: NEP-591 global contract hash
  "verify_mode": "outlayer",                                         // or "https" (needs verdict_relayer; SPEC 6.6)
  "name": "Harmattan Court",
  "location": "Lekki, Lagos",
  "geofence": { "lat_e6": 6447000, "lon_e6": 3474000, "radius_m": 300 },   // radius_m 0 = no geofence
  "milestones": [
    { "key": "foundation", "title": "Foundation", "bps": 2000, "deadline": "1801483200000000000" },
    { "key": "roofing",    "title": "Roofing",    "bps": 3000, "deadline": "..." },
    { "key": "finishing",  "title": "Finishing",  "bps": 3000, "deadline": "..." },
    { "key": "handover",   "title": "Handover",   "bps": 2000, "deadline": "..." }
  ],
  "params": {
    "reserve_ttl_ns": "1800000000000", "min_initial_bps": 1000, "mobilisation_bps": 0,
    "grace_ns": "120000000000", "veto_window_ns": "120000000000", "default_grace_ns": "120000000000",
    "penalty_bps": 500, "dust_threshold": "1000000", "late_claim_ns": "600000000000",
    "capture_ttl_ns": "1800000000000", "proposal_period_ns": "600000000000",
    "max_phash_distance": 8, "max_exif_age_h": 72, "min_ai_confidence": 70,
    "demo_mode": true, "playground": false
  },
  "nft_metadata": { "spec": "nft-1.0.0", "name": "Harmattan Court allocations", "symbol": "PLOTE", "icon": null,
                    "base_uri": null, "reference": null, "reference_hash": null },
  "app_url": "https://plote.vercel.app"                // REQUIRED (no default): https://, ≤ 200 chars; NFT `reference`
} })
```

Instalment plans (`add_units`): dates are absolute, but when a unit is allocated (first buyer, or a re-sale after a full
refund), every unmet instalment already due moves to the allocation time, so the new holder gets a full
`default_grace_ns` before `declare_default`. A default sale rebases the same way.

Rules: `sum(milestones.bps) + mobilisation_bps == 10000`, `mobilisation_bps <= 1000`, deadlines strictly increasing,
1–8 milestones (demo estates use exactly 4).

Outside the playground (`params.playground == false`) `new` also refuses (`E_BAD_ARGS`) a geofence radius outside
50..=2000 m, `max_phash_distance` outside 6..=16, `min_ai_confidence` < 60, `max_exif_age_h` outside 1..=168 and an
empty verifier commit, on every network.

Trust anchors (audit round 4, `new` only — live estates were initialised before these rules and nothing re-checks
them on upgrade), all `E_BAD_ARGS`:
- `params.playground: true` is refused unless the estate account ends in `.testnet` (the judge sandbox never exists on
  mainnet; on the playground `assert_safe_checks`/`assert_safe_params` are skipped and capture/evidence/sign-off are open
  to anyone).
- Outside the playground `outlayer_id` must be exactly `outlayer.testnet` on a `.testnet` estate and `outlayer.near` on
  any other account (no mock OutLayer can be pinned).
- Outside the playground `min_initial_bps >= 1000` (a token costs at least 10% of its price, so vote weight and the
  distinct-holder rule can't be farmed with 1-base-unit tokens) and `penalty_bps >= 300`.

Demo timings are refused only on estates whose account does **not** end in `.testnet` (i.e. mainnet), outside the
playground: **`demo_mode: true`, `veto_window_ns` < 24 h, `grace_ns` or `default_grace_ns` < 24 h, `dust_threshold` >
1 USDC (`"1000000"`), `capture_ttl_ns` outside 5 min..=24 h** (`E_BAD_ARGS`). Testnet estates (the demo estates
Harmattan Court and Baobab Heights, with `demo_mode` and 2-minute windows) deploy fresh with them. Only `new` checks
these; no `set_*` method re-checks them, so code upgrades never brick a live estate.

### 1.2 Change methods

| Method | Args | Access / deposit | Returns |
|---|---|---|---|
| `add_units` | `{ units: [{ id, label, price: U128, plan: [{ due_at: U64, cumulative: U128 }] }] }` | developer; attach ≥ 0.035 NEAR × n (unit funding + USDC registration + record; anything above is returned to the developer); ≤ 8 per call, ≤ 500 units per estate, ≤ 24 instalments per plan (`E_TOO_MANY`) | — |
| `retry_unit_setup` | `{ unit_id }` | developer; attach ≥ 0.00125 NEAR; only for a unit that isn't `ready` (else `E_BAD_ARGS`). Re-checks the unit account (`get_info`) and registers it on USDC again; never deletes the unit record (a failed `get_info` keeps it for another retry) | Promise (`bool` ready) |
| `fund_verification` | `{}` | anyone, payable | — |
| `set_verifier` | `{ verifier }` | developer; **attach 1 yocto**; only before the first sale (`E_ALREADY_SOLD`); the playground may repoint it at any time, but only to a non-empty commit / version key. Emits `verifier_changed {old, new, by: "developer"}` | — |
| `repin_verifier` | `{ verifier }` | **only the estate account itself** (`predecessor == current_account_id`, i.e. a transaction signed with the estate's own full-access key, which can already redeploy the code, so no new power) with 1 yocto (`E_NOT_ESTATE` otherwise). Works after the first sale; same checks as `set_verifier` plus a non-empty repo, and never back to the pre-hardening build `31c7225…` (`E_BAD_ARGS`). Emits `verifier_changed {old, new, by: "estate"}`. **It disappears with the estate's full-access key** when that is deleted at launch | — |
| `migrate` | `{}` | `#[private]` (the estate account), after a code upgrade; idempotent. Brings the new storage keys up to `state_version` (see §1.6) | `u32` (version) |
| `set_app_url` | `{ url }` | developer; attach 1 yocto; `https://`, ≤ 200 chars, no quotes/spaces (`E_BAD_ARGS`). Emits `app_url_changed {old, new}` | — |
| `playground_reset` | `{}` | only if `params.playground` (`E_PLAYGROUND_ONLY`). The developer and the surveyor any time; anyone else only while no milestone is `Checking` (`E_CHECK_PENDING`), no other account's capture is unexpired (`E_CAPTURE_ACTIVE`) and at most once per 10 min (`E_RATE_LIMIT`) | — |
| `reserve` | `{ unit_id }` | anyone, attach **at least** 0.05 NEAR (`E_DEPOSIT` below); anything above 0.05 is returned at once | — |
| `cancel_reservation` | `{ unit_id }` | the reserver; attach 1 yocto | Promise (USDC refund; resolves to `bool`), or `true` when nothing was paid |
| `expire_reservation` | `{ unit_id }` | anyone, after `expires_at` | Promise (resolves to `bool`), or `true` when nothing was paid |
| `sync` | `{ unit_id }` | anyone. **Check only**: reads the unit's USDC balance, logs/emits `balance_checked {unit_id, balance, expected}`, credits nothing | Promise (`U128` surplus seen) |
| `report_deposit` | `{ unit_id, amount: U128 }` | only the estate's `verdict_relayer` (its **deposit reporter**, `E_NOT_RELAYER`); no deposit; ~100 Tgas. Books a plain-transfer (1Click) delivery, see §1.2.1 | Promise (`U128` credited) |
| `on_unit_deposit` | `{ unit_id, sender_id, amount: U128, msg }` | only the unit's own account. Books exactly `amount` and returns `"0"` when the unit takes payments (holder, or active reservation, and no transfer out pending); otherwise returns `amount` (USDC refunds it). **Deferred** (§1.2.1): within 5 min of a `report_deposit` that credited this unit, an amount above what that report saw and left unbooked is accepted (`"0"`) but not booked; event `deposit_deferred` | `U128` (unused amount) |
| `refund` | `{ unit_id }` | holder; attach 1 yocto; `E_NFT_PENDING` during an `nft_transfer_call` of the token. A lien-first refund that leaves money on the unit keeps the token alive with less weight (net equity) | Promise |
| `withdraw_excess` | `{ unit_id }` | holder; attach 1 yocto; `E_NFT_PENDING` as above; pays `min(paid − price − excess already out, refundable)` | Promise |
| `sweep_unattributed` | `{ unit_id }` | anyone | Promise |
| `request_surplus_booking` | `{ unit_id }` | developer or `recovery_id` (`E_NOT_DEVELOPER`); no deposit. Reads the unit's USDC balance once and records the surplus over the books (`E_NOTHING_TO_SWEEP` if none; `E_BALANCE_PENDING` if the books changed meanwhile, `E_IN_FLIGHT`). A new request replaces the old one. Event `surplus_requested {unit_id, amount, ready_at}` | Promise (`U128` recorded) |
| `finalize_surplus_booking` | `{ unit_id }` | developer or `recovery_id`; ≥ 7 days after the request (`E_TIMELOCK`; `E_BAD_ARGS` without one). Two chained balance reads like `report_deposit`; books `min(recorded, first − expected, second − expected)` as **`unattributed`** (never `paid`), then `sweep_unattributed` can move it. Event `surplus_booked {unit_id, amount, unattributed}` | Promise (`U128` booked) |
| `list_for_sale` | `{ unit_id, ask: U128 }` | holder, no lien; attach 1 yocto; `E_NFT_PENDING` during an `nft_transfer_call` | — |
| `cancel_listing` | `{ unit_id }` | holder (Voluntary only); attach 1 yocto | — |
| `ft_on_transfer` | NEP-141 (`msg = {"buy":"a-4b"}`) | only from `usdc_id`. A Default listing costs the holder's `paid − refunded_out` **at purchase time** (later payments raise it); the default penalty is `penalty_bps` of that. A lien (set before the default) doesn't block a Default sale: the proceeds after the penalty go to the lender first, up to its `cap` (event `lien_settled {unit_id, lender, amount}`), the rest to the seller, and the buyer gets the token without the lien. A Voluntary listing can't coexist with a lien | `U128` |
| `declare_default` | `{ unit_id }` | anyone | — |
| `handover` | `{ unit_id }` | holder; attach 1 yocto; **every** milestone Approved and the last one's veto window passed (`E_HANDOVER`); `E_NFT_PENDING` during an `nft_transfer_call` | — |
| `set_beneficiary` | `{ unit_id, beneficiary: AccountId \| null }` | holder; attach 1 yocto | — |
| `set_guardians` | `{ unit_id, guardians: [AccountId] }` (≤ 3) | holder; attach 1 yocto | — |
| `guardian_recover` | `{ unit_id, new_owner }` | a guardian; attach 1 yocto; 2 distinct guardians start a 72 h timer (demo: `grace_ns`) | — |
| `finish_recovery` | `{ unit_id }` | anyone, after the timer | — |
| `cancel_recovery` | `{ unit_id }` | holder; attach 1 yocto | — |
| `set_lien` | `{ unit_id, lender, cap: U128 }` | holder; attach 1 yocto. Creates a **pending** lien (replaces any earlier offer; `get_pending_lien`); it has no effect until the lender accepts. Same checks as before (`E_BAD_ARGS` lender = holder, `E_LIEN` lien already active, `E_LISTING` in default). Event `lien_offered {unit_id, lender, cap}`. Liens active before this change stay active | — |
| `accept_lien` | `{ unit_id }` | the lender named in the pending lien (`E_NOT_LENDER`); attach 1 yocto. `E_LIEN` if there is no pending lien or the token changed hands since the offer (the offer is void then); re-checks the `set_lien` rules. Activates the lien (closes a voluntary listing). Event `lien_accepted {unit_id, lender, cap}` | — |
| `clear_lien` | `{ unit_id }` | the lender; attach 1 yocto | — |
| `open_capture` | `{ milestone: u8 }` | surveyor (anyone if playground). **Stage order**: milestone `i > 0` only once milestone `i − 1` is `Approved` (`E_MILESTONE_STATE`; the playground too). On the playground, another account's unexpired capture for that milestone can't be replaced (`E_CAPTURE_ACTIVE`) except by the estate's `surveyor_id` | `String` (6-char code) |
| `submit_evidence` | `{ milestone: u8, url, sha256, captured_at: U64, device_gps: [i32, i32] \| null }` | surveyor (anyone if playground); stage order as `open_capture`. On the playground every account but the surveyor may submit at most 5 per rolling hour (`E_RATE_LIMIT`; a check that fails only for infrastructure reasons gives the slot back) | `U64` evidence id |
| `submit_verdict` | `{ evidence_id: U64, verdict: VerdictArg }` | only `verdict_relayer`, and only when `verify_mode == "https"` (else `E_VERIFY_MODE`). `VerdictArg` = the worker's stdout object as is: `Verdict` fields plus `evidence_id` (number or string), `sha256` and optional `ai_model`; unknown fields are ignored. It must echo this `evidence_id` and the evidence's committed `sha256` (case-insensitive), else `E_VERDICT_MISMATCH` | `bool` (pass) |
| `reopen_stale_check` | `{ milestone: u8 }` | anyone; the milestone must be `Checking` (`E_MILESTONE_STATE`) and its latest evidence submitted ≥ 1 h ago (`E_CHECK_PENDING`). The evidence becomes `Error` (verdict event reason `check_timeout`), the milestone `Open`; a late verdict for it is still applied | — |
| `qs_sign` | `{ milestone: u8 }` | surveyor (anyone if playground); stage order: milestone `i − 1` must be `Approved` (`E_MILESTONE_STATE`) | — |
| `claim_release` | `{ unit_ids: [String] }` (≤ 6, `E_TOO_MANY`; gas) | anyone (funds go to `payout_id` / `payout_redirect`); `E_FROZEN` while frozen, **`E_REFUNDS_OPEN` while refunds are open** (a missed deadline + grace, even if signed late, or a Freeze with refunds) | `u32` transfers started |
| `withdraw_owed` | `{}` | anyone with an owed balance (failed resale payouts, failed reservation refunds); `E_NOTHING_OWED` if none | Promise |
| `propose` | `{ kind: ProposalKind }` | holder (any kind) / developer (`ExtendDeadline`); attach **0.05 NEAR** (`PROPOSAL_DEPOSIT`, kept by the estate; any excess is returned). Every kind but `Veto` needs the quorum (`E_QUORUM`, playground exempt). `ExtendDeadline` is allowed after a miss too (the recovery path, below) | `U64` proposal id |
| `vote` | `{ proposal_id: U64, approve: bool }` | holder with eligible tokens (`E_NOT_ELIGIBLE`: none allocated before the proposal; `E_ALREADY_VOTED`: all of them voted; `E_NFT_PENDING`: the only eligible ones are in a pending `nft_transfer_call`). Votes with ≤ 50 tokens per call | — |
| `expire_proposal` | `{ proposal_id: U64 }` | anyone, after `expires_at` | — |

Plus NEP-171/177/178/181: `nft_transfer`, `nft_transfer_call`, `nft_approve`, `nft_revoke`, `nft_revoke_all`, `nft_is_approved`.
`nft_transfer` panics `E_LIEN` while a lien is set and `E_LISTING` while a Default listing is open; a transfer moves `holder`
and voids a pending lien offer. While an `nft_transfer_call` of a token waits for `nft_resolve_transfer` (at most 10 min),
`refund`, `withdraw_excess`, `handover`, `list_for_sale`, `accept_lien`, `nft_transfer(_call)` and votes with that token
fail `E_NFT_PENDING`.
`nft_approve` attaches ≥ 0.001 NEAR (kept for storage; the rest is returned to the holder); at most 16 approved accounts
per token (`E_TOO_MANY_APPROVALS`; re-approving an approved account is allowed). `nft_revoke` / `nft_revoke_all`: holder,
1 yocto.

Votes (SPEC §8, audit round 2 + final review + audit round 4): each token allocated at or before the proposal opened
votes once. Its weight is its **net equity** `min(paid − refunded_out, price)` in whole USDC (rounded up) — a refund
(lien-first or partial) lowers it at once; an excess withdrawal doesn't (it only took money above the price) — and
**never more than the token weighed when the proposal opened**: `min(weight now, weight at creation)`. (Copy-on-write
snapshot: while any proposal may be open, a change of a unit's weight records `(time, weight before)` for that unit
outside the root state; at most 8 entries per unit, older than one `proposal_period_ns` dropped.) So a top-up after a
proposal opened adds nothing to it (no Veto capture by topping up), and `electorate`, the weight of the eligible tokens
**fixed when the proposal opens**, bounds it.

- `Veto`: executes when `yes × 2 > electorate` (weight only, so it stays fast inside the veto window); rejected when
  `no × 2 ≥ electorate`.
- Every other kind needs **both** `yes × 2 > electorate` **and** a strict majority of distinct holders:
  `holders_yes × 2 > holders_eligible`, where `holders_eligible` counts the distinct current holders of the eligible
  tokens and `holders_yes` / `holders_no` those of them holding a token that voted yes / no. It is rejected when
  `no × 2 ≥ electorate` **or** `holders_no × 2 ≥ holders_eligible`.

Why both: the distinct-holder majority stops one account passing a `StepIn`, `ReplaceSurveyor`, `Freeze`, `Unfreeze` or
`ExtendDeadline` alone while other accounts hold eligible tokens; the weight majority (net equity, capped at creation)
stops sybil accounts holding cheap tokens from out-voting the money (each token costs ≥ 10% of its price on new
estates). No vote lock is applied: a lock could only last until the proposal resolves, and it couldn't stop a refund
after execution. Not implemented (documented): a timelock between a passing `StepIn` / `ReplaceSurveyor` and its
execution. It would need a new proposal status (an enum variant appended at the end would be layout-safe) and an
`execute_proposal` call; the quorum, both majorities and the net-weight snapshot are the safeguards meanwhile.

On weighted proposals `voted` is stored as `"+<unit_id>"` / `"-<unit_id>"`. Views show bare unit ids, plus the
`holders_*` counts computed at view time. A proposal opened before weighted voting (`ProposalView.weighted == false`)
keeps counting one vote per token, with no holder rule, until it expires.

Quorum (all kinds except `Veto`): ≥ 3 allocated tokens and ≥ a quarter of all units allocated (the playground is
exempt). `Unfreeze` is rejected if the estate is no longer frozen.

Not changed (final review, Medium): a holder with ≥ 50% of the weight can still stall a `Veto` by abstaining, because
passing needs `yes × 2 > electorate`. Settling a Veto at its expiry by a simple majority of votes cast would happen at
or after `veto_until`, when `claim_release` can already have moved the stage's money. A safe version needs releases to
wait for open Veto proposals, or a settlement margin before `veto_until` with a keeper to call it, so it is left out.

Recovery after a missed deadline: `ExtendDeadline` may be proposed and executed while refunds are open. With the quorum
and both majorities (weight and distinct holders) it moves the milestone's deadline (`new_deadline` must be in the
future, **later than the milestone's current deadline** — an extension never shortens — and strictly between its
neighbours' deadlines; `E_DEADLINES` at `propose`). The same rules are **re-checked when it passes**: a proposal whose
deadline the clock overtook, or that another executed extension made shorter or out of order, is `Rejected` instead
of executed. It closes refunds for that milestone, so `claim_release` (`E_REFUNDS_OPEN` meanwhile) works again. Holders
who want out vote no and refund before it passes.

#### 1.2.1 Deposits

USDC reaches a unit account two ways, and nothing is ever booked from a raw balance read alone (USDC credits the
receiver before `ft_on_transfer` runs and takes refused money back in `ft_resolve_transfer`, so a read during a
pending `ft_transfer_call` sees money that may leave):

- **`ft_transfer_call`** (wallets) to the unit account: booked by `on_unit_deposit` from its `amount`, exactly once,
  when it accepts (returns `"0"`). Refused deposits (unit not reserved, reservation lapsed, transfer out pending) are
  refunded by USDC and never booked.
- **plain `ft_transfer`** (1Click / NEAR Intents): booked only by `report_deposit({ unit_id, amount })` from the
  estate's deposit reporter (`verdict_relayer`; the app server's relayer account). `amount` is what 1Click's status
  says it delivered (`swapDetails.amountOut`, USDC base units). The estate reads the unit's balance twice in a chained
  promise (read → `on_report_first` → read → `on_report_second`, passing the first reading and the `expected` books
  through callback args) and credits `min(amount, first − expected, second − expected)` to `paid` (holder or active
  reservation) or `unattributed`. If the books changed between the call and either callback (a transfer out started
  or landed, or an `ft_transfer_call` was booked), it credits nothing and fails `E_BALANCE_PENDING`: report again.
  `E_IN_FLIGHT` while a transfer out is pending. A repeated report finds no surplus and credits `"0"` (idempotent).
  **Residual trust:** the reporter can credit at most the surplus really observed on the unit in two consecutive reads,
  and never more than it attests; a dishonest reporter could still book a surplus that isn't a finished plain transfer
  (a pending `ft_transfer_call` spanning both reads that is later refunded), so the role must be a Plote-controlled
  account. It cannot create money that never reached the unit.
- **`sync`** (and `unit.sync_deposits`, which calls it) is a public check only.
- **Report / `ft_transfer_call` overlap** (audit round 4, finding 14): USDC credits the unit before `on_unit_deposit`
  runs, so a report that finishes in between may already have booked that money (e.g. a retried report). Each report
  that credits a unit remembers when and how much surplus its reads saw and left unbooked (`spare`). For 5 minutes
  (`REPORT_SETTLE_NS`) after it, an `on_unit_deposit` of at most `spare` is booked normally (and uses that much up); a
  larger one is accepted (`"0"`, the money stays on the unit) but **not booked**, event
  `deposit_deferred {unit_id, sender_id, amount}`. The app server then books it with `report_deposit({unit_id, amount})`
  (two reads; it can never be booked twice). The unit contract can't signal earlier (its code is a global contract
  fixed by hash), so this is the estate-side guard.
- **Unbooked surplus** (finding 7): USDC on a unit that nobody reported is booked as `unattributed` by
  `request_surplus_booking` → (7 days) → `finalize_surplus_booking`, then swept (`sweep_unattributed`).

Server call after a 1Click `SUCCESS`: the relayer signs `report_deposit` on the **estate** account (not the unit):
`{ "unit_id": "<first label of the recipient>", "amount": "<swapDetails.amountOut>" }`, 0 deposit, 100 Tgas; on a failed
transaction retry later.

A reservation refund the reserver can't receive (e.g. not registered on USDC) moves to the estate's own USDC account and
is credited to `owed_of(reserver)` (`withdraw_owed`); the reservation still ends (`reservation_ended` with `"owed": true`).

`ProposalKind` (serde externally tagged):

```jsonc
{ "ReplaceSurveyor": { "account": "qs-new.testnet" } }
{ "Veto": { "milestone": 1 } }
{ "Freeze": { "reason": "No work for 6 weeks", "refunds_open": true } }
"Unfreeze"
{ "ExtendDeadline": { "milestone": 2, "new_deadline": "1801483200000000000" } }
{ "StepIn": { "new_payout_id": "contractor.testnet" } }
```

### 1.3 Views

| View | Args | Returns |
|---|---|---|
| `get_estate` | — | `EstateView` |
| `get_unit` | `{ unit_id }` | `UnitView \| null` |
| `list_units` | `{ from_index?: u32, limit?: u32 }` | `UnitView[]` (default limit 100) |
| `is_taken` | `{ unit_id }` | `TakenView` |
| `get_milestones` | — | `MilestoneView[]` |
| `get_capture` | `{ milestone: u8 }` | `CaptureView \| null` |
| `get_evidence` | `{ id: U64 }` | `EvidenceView \| null` |
| `list_evidence` | `{ milestone?: u8, from_index?: u32, limit?: u32 }` | `EvidenceView[]` (newest first) |
| `get_proposal` | `{ id: U64 }` | `ProposalView \| null` |
| `list_proposals` | `{ from_index?: u32, limit?: u32 }` | `ProposalView[]` (newest first) |
| `dev_stats` | — | `DevStats` |
| `verification_budget` | — | `U128` (yoctoNEAR) |
| `owed_of` | `{ account_id }` | `U128` |
| `check_input` | `{ evidence_id: U64 }` | `String \| null` — the exact worker stdin (HTTPS fallback) |
| `votes_available` | `{ proposal_id: U64, account_id }` | `u32` (tokens that can still vote) |
| `vote_weight_available` | `{ proposal_id: U64, account_id }` | `u32` (the weight `vote` would cast now, ≤ 50 tokens; `min(now, at creation)` per token; tokens in a pending `nft_transfer_call` excluded) |
| `get_pending_lien` | `{ unit_id }` | `{ lender: string, cap: U128 } \| null` — a lien offered by the current holder, not accepted yet |
| `get_surplus_request` | `{ unit_id }` | `{ at: U64, amount: U128, ready_at: U64 } \| null` |
| `state_version` | — | `u32` (1 = deployed before the marker and not migrated; current 2) |
| `nft_token`, `nft_tokens`, `nft_tokens_for_owner`, `nft_supply_for_owner`, `nft_total_supply`, `nft_metadata` | standard | standard; `metadata.media` = live SVG data URI. The SVG's "paid" and `metadata.extra.paid` are **net** (`paid − refunded_out`) |

```ts
type EstateView = {
  name: string; location: string; account: string; app_url: string;
  developer_id: string; payout_id: string; surveyor_id: string; recovery_id: string;
  usdc_id: string; outlayer_id: string; verdict_relayer: string | null; verify_mode: "outlayer" | "https";
  verifier: { repo: string; commit: string; build_target: string };
  unit_code_hash: string | null;
  geofence: { lat_e6: number; lon_e6: number; radius_m: number };
  params: Params;                       // same keys as init; u64/u128 as strings
  frozen: { reason: string; since: string; refunds_open: boolean } | null;
  payout_redirect: string | null;       // set by an executed StepIn
  unit_count: number; allocated_count: number; available_count: number;
  totals: { paid: string; released: string; refunded: string; in_escrow: string };
  stats: DevStats;
  verification_budget: string;
  refunds_open: boolean;                // a missed deadline + grace, or a Freeze with refunds
  now: string;                          // block timestamp at view time
};

type UnitStatus = "Available" | "Reserved" | "Allocated" | "InDefault" | "HandedOver";

type UnitView = {
  id: string; account: string; label: string; price: string; status: UnitStatus;
  ready: boolean;            // account created and registered on USDC (else reserve/pay are refused; see retry_unit_setup)
  holder: string | null; allocated_at: string | null;
  reservation: { by: string; expires_at: string } | null;
  last_reservation: { by: string; expires_at: string } | null;
  plan: { due_at: string; cumulative: string }[];
  paid: string; unattributed: string; released: string; refunded_out: string; in_flight: string;
  listing: { ask: string; kind: "Voluntary" | "Default"; since: string } | null;  // Default: ask = paid − refunded_out now
  beneficiary: string | null; guardians: string[];
  recovery: { new_owner: string; approvals: string[]; ready_at: string | null } | null;
  lien: { lender: string; cap: string } | null;
  // computed
  refundable_now: string;    // what refund() would pay right now ("0" if refunds aren't open)
  releasable_now: string;    // what claim_release would move right now ("0" while frozen or refunds are open):
                             // min(min(paid − refunded_out, price) × approved_bps / 10000 − released, paid − released − refunded_out)
  excess_now: string;        // what withdraw_excess would pay (capped at what is still refundable)
  refunds_open: boolean;
  next_due: { due_at: string; cumulative: string; shortfall: string } | null;
  progress_bps: number;      // approved (veto passed) bps incl. mobilisation, counted in stage order: stops at the
                             // first milestone that isn't Approved with its veto window over
  approved_bps: number;      // same as progress_bps (kept for clarity)
};

type TakenView = {
  exists: boolean; status: UnitStatus | null; holder: string | null;
  paid: string;              // net: paid − refunded_out
  released: string; price: string; label: string | null;
  account: string | null; reserved_until: string | null; allocated_at: string | null;
};

type MilestoneStatus = "Open" | "Checking" | "Verified" | "Approved" | "Vetoed" | "Missed";
type MilestoneView = {
  index: number; key: string; title: string; bps: number; deadline: string;
  status: MilestoneStatus;              // Missed is computed at view time
  late: boolean;                        // deadline + grace passed without a timely sign-off (refunds open)
  evidence_ids: string[];               // the newest 32 (older evidence stays in list_evidence)
  verified_at: string | null; signed_at: string | null;
  veto_until: string | null; veto_passed: boolean;   // Approved and veto window over
  refunds_open_at: string;             // deadline + grace
};

type CaptureView = { milestone: number; code: string; by: string; opened_at: string; expires_at: string };

type Verdict = {
  pass: boolean; reasons: string[]; warnings: string[];
  phash: string; nearest_distance: number;
  exif_time: string | null; gps: [number, number] | null; gps_source: "exif" | "device" | null;
  distance_m: number | null; ai_stage: string | null; ai_confidence: number | null;
  challenge_read: string | null;
  ai_observations: string[];            // the model's short notes (SPEC 6.4 "observations"), ≤ 4 × ≤ 160 chars; [] if none
  ai_chat_id: string | null;
  worker_commit: string; attestation: string | null;
  source: "outlayer" | "https";
};

type EvidenceView = {
  id: string; milestone: number; url: string; sha256: string; captured_at: string;
  device_gps: [number, number] | null; challenge: string; challenge_opened_at: string;
  submitted_by: string; submitted_at: string;
  status: "Pending" | "Pass" | "Fail" | "Error";
  verdict: Verdict | null;              // also kept on an infrastructure Error (see §1.4 `verdict`)
  raw_response_hash: string | null; error: string | null;
  ai_model: string | null;              // the worker's `ai_model`, ≤ 64 chars (stored outside the evidence record)
};

type ProposalView = {
  id: string; kind: unknown /* ProposalKind */; proposer: string;
  created_at: string; expires_at: string;
  electorate: number; yes: number; no: number;   // weighted: whole USDC of min(paid − refunded_out, price); else token counts
  voted: string[];                               // unit ids that voted
  weighted: boolean;
  holders_eligible: number; holders_yes: number; holders_no: number;   // distinct holders (non-Veto majority rule)
  status: "Open" | "Executed" | "Rejected" | "Expired";
};

type DevStats = {
  milestones_due: number; milestones_on_time: number; units_sold: number; units_refunded: number;
  evidence_submitted: number; evidence_passed: number; signoffs: number; vetoes: number;
  units_handed_over: number;
};
```

### 1.4 Events (`standard: "plote"`, `version: "1.0.0"`)

`unit_added {unit_id, account, price}` · `reserved {unit_id, by, expires_at}` · `reservation_ended {unit_id, by, refunded, owed?}` ·
`deposit_synced {unit_id, new_money, paid, unattributed, source: "ft_transfer_call" | "report"}` ·
`balance_checked {unit_id, balance, expected}` (`sync`, books nothing) · `allocated {unit_id, holder}` ·
`capture_opened {milestone, by, expires_at}` · `evidence_submitted {evidence_id, milestone, sha256}` ·
`verdict {evidence_id, pass, reasons}` · `qs_signed {milestone, by, veto_until}` · `released {unit_id, amount, to}` ·
`refunded {unit_id, amount, to}` · `excess_withdrawn {unit_id, amount, to}` · `unattributed_swept {unit_id, amount, to}` ·
`defaulted {unit_id, ask}` · `listed {unit_id, ask, kind}` · `sold {unit_id, from, to, price}` ·
`frozen {reason, refunds_open}` · `unfrozen {}` · `surveyor_changed {old, new}` · `handed_over {unit_id}` ·
`proposal_created {proposal_id, kind, proposer, expires_at}` · `voted {proposal_id, voter, approve, tokens, weight}` ·
`proposal_executed {proposal_id}` · `proposal_rejected {proposal_id}` · `payout_redirected {old, new}` (executed `StepIn`) ·
`playground_reset {}` · `app_url_changed {old, new}` · `verifier_changed {old, new, by: "developer" | "estate"}` ·
`lien_offered {unit_id, lender, cap}` · `lien_accepted {unit_id, lender, cap}` · `lien_settled {unit_id, lender, amount}`
(default sale) · `deposit_deferred {unit_id, sender_id, amount}` · `surplus_requested {unit_id, amount, ready_at}` ·
`surplus_booked {unit_id, amount, unattributed}` · `migrated {from, to}`.

`verdict.reasons` in the `verdict` event is `["worker_error"]` when OutLayer failed or the output was unparsable,
`["worker_commit_mismatch"]` when the verdict came from another build than the pinned commit, and `["check_timeout"]`
when `reopen_stale_check` reopened the milestone.

Audit round 4 verdict rules (any verify mode):
- Every warning starting with `mock` or `ai_mock` (e.g. the outlayer-mock's `mock_verifier`) is added to `reasons`, so
  the verdict fails.
- OutLayer mode: a verdict that doesn't echo **both** `evidence_id` and `sha256` gets the reason `verdict_unbound` and
  can't pass (a mismatching echo is an `Error`, reason `verdict_mismatch`, as before). The pre-hardening build
  `31c7225…` echoes neither, so estates pinned to it must `repin_verifier` before a check can pass. HTTPS mode:
  `submit_verdict` refuses a missing/mismatching echo with `E_VERDICT_MISMATCH`.
- **Infrastructure failures** (finding 10): a verdict whose failing reasons are all in {`ai_unavailable`,
  `worker_error`, and `challenge_unverified` when `ai_unavailable` is in its reasons or warnings} is stored as
  `Error` (milestone back to `Open`, the verdict kept), the `verdict` event's reason is the first of them, and in
  outlayer mode the check's 0.05 NEAR goes back to `verification_budget` (also when the OutLayer call itself failed)
  and the submitter's playground rate-limit slot is returned. Any other reason makes it a normal `Fail`.
- Other reasons (`gps_device_missing`, `url_not_allowed`, …) fail as any reason does; warnings such as
  `gps_exif_only`, `captured_at_mismatch`, `ai_model_mismatch` don't.

### 1.5 Error codes

`E_NOT_DEVELOPER E_NOT_SURVEYOR E_NOT_HOLDER E_NOT_RESERVER E_NOT_RELAYER E_NOT_LENDER E_NOT_GUARDIAN E_UNIT_TAKEN
E_UNIT_NOT_FOUND E_UNIT_EXISTS E_BAD_UNIT_ID E_BALANCE_PENDING E_RESERVATION_ACTIVE E_NO_RESERVATION E_DEPOSIT
E_MILESTONE_STATE E_NOT_VERIFIED E_VETO_WINDOW E_FROZEN E_NO_REFUND_YET E_NOTHING_TO_REFUND E_LIEN E_LISTING
E_UNDERPAID E_IN_FLIGHT E_BUDGET E_BAD_TOKEN E_BPS_SUM E_DEADLINES E_NO_CHALLENGE E_CHALLENGE_EXPIRED
E_NOTHING_TO_SWEEP E_NO_EXCESS E_NOT_ELIGIBLE E_ALREADY_VOTED E_PROPOSAL_STATE E_PROPOSAL_OPEN E_PLAYGROUND_ONLY
E_NOT_DUE E_HANDOVER E_RECOVERY E_TOO_MANY E_BAD_ARGS E_NOT_UNIT E_ALREADY_SOLD E_VERIFY_MODE E_NOT_ESTATE E_STORAGE
E_QUORUM E_STEP_IN E_LATE_CLAIM E_REFUNDS_OPEN E_TOO_MANY_APPROVALS E_CAPTURE_ACTIVE E_CHECK_PENDING
E_VERDICT_MISMATCH E_TIMELOCK E_RATE_LIMIT E_NFT_PENDING E_NOTHING_OWED`

`E_VERIFY_MODE`: `submit_verdict` on an estate whose `verify_mode` isn't `"https"`. `E_NOT_ESTATE` (plote-unit): a
caller other than the estate tried to initialise the unit or move its funds. `E_STORAGE` (plote-musdc): the receiver
isn't registered on the token and no storage deposit was attached.

`E_QUORUM`: a proposal of any kind but `Veto` (`StepIn`, `ReplaceSurveyor`, `Freeze`, `Unfreeze`, `ExtendDeadline`)
while fewer than 3 tokens, or fewer than a quarter of all units, are allocated (not on the playground). `E_STEP_IN`: `StepIn` proposed (or passing) while the estate isn't frozen and no milestone
deadline + grace has been missed. `E_LATE_CLAIM`: `reserve` by another account within `late_claim_ns` of the last
reservation ending (a late payment may still land for that reserver).

`E_REFUNDS_OPEN`: `claim_release` while refunds are open (until an executed `ExtendDeadline` or the end of the freeze
closes them). `E_TOO_MANY_APPROVALS`: `nft_approve` for a 17th account. `E_CAPTURE_ACTIVE`: on the playground,
`open_capture` while another account's capture for that milestone is unexpired. `E_CHECK_PENDING`: `reopen_stale_check`
less than 1 h after the latest evidence was submitted. `E_ALREADY_VOTED`: every eligible token of the caller already
voted (`E_NOT_ELIGIBLE` means none of the caller's tokens was allocated before the proposal opened). `E_BALANCE_PENDING` also means a
`report_deposit` saw the unit's books change between its balance reads (nothing credited; report again).
`E_NOT_RELAYER` also covers `report_deposit` from anyone but the deposit reporter.

Audit round 4: `E_VERDICT_MISMATCH`: `submit_verdict` whose verdict doesn't echo the evidence id and its committed
sha256. `E_TIMELOCK`: `finalize_surplus_booking` before its 7-day delay. `E_RATE_LIMIT`: on the playground, a 6th
`submit_evidence` by one account within an hour, or a `playground_reset` by a non-developer/surveyor within 10 min of the
last one. `E_NFT_PENDING`: a money, vote or transfer method on a token whose `nft_transfer_call` hasn't resolved.
`E_NOTHING_OWED`: `withdraw_owed` with nothing owed. Reused codes: `E_MILESTONE_STATE` also means the previous milestone
isn't Approved yet (stage order); `E_NOT_ESTATE` also covers `repin_verifier` from any account but the estate itself;
`E_NOT_DEVELOPER` also covers the surplus-booking methods (developer or `recovery_id`); `E_LIEN` / `E_NOT_LENDER` cover
`accept_lien`; `E_CHECK_PENDING` / `E_CAPTURE_ACTIVE` also cover `playground_reset`.

### 1.6 Upgrades and state layout (audit round 4, finding 11)

Live estates are upgraded in place, so the borsh layout of the root `Estate` and of everything stored in it (`Unit`,
`Milestone`, `Proposal`, `Evidence`, `Verdict`, `Params`, …) never changes; an enum may only gain variants at the end
(a unit test, `layout::r4_stored_layout_unchanged`, reads current bytes with verbatim copies of the deployed types).
New state lives under raw storage keys starting with `z` (the original collections use one-byte prefixes `0x00..0x07`):
`zv` state version, `zx` latest proposal expiry, `zs` per-unit weight history, `zl` pending liens, `zu` surplus
requests, `zr` playground submissions, `zt` last playground reset, `zn` pending `nft_transfer_call`s, `zw` last
crediting report per unit, `zm` `ai_model` per evidence. Upgrade procedure: deploy the new code, then call `migrate`
from the estate account (it can be the second action of the same transaction); `state_version` then reads 2. A future
change that does need a new root layout would add a `#[private] #[init(ignore_state)]` migration that reads the old
struct; `migrate` is where the stored version is dispatched on.

Storage (finding 13): holder setters (`set_guardians` ≤ 3, `set_beneficiary` 1, `set_lien` one pending offer per unit,
`list_for_sale` one listing, `vote` entries inside a proposal paid for by `PROPOSAL_DEPOSIT`) take no storage deposit;
each is bounded per unit and paid by the estate's balance. New per-unit/per-account keys are bounded too (weight history
≤ 8 entries, playground submissions ≤ 5 timestamps).

---

## 2. `plote-unit` (e.g. `a-4b.harmattan-court.plote.testnet`)

```
new({ estate_id, usdc_id, unit_id })
ft_on_transfer({ sender_id, amount, msg }) -> U128     // non-USDC → "amount" (bounce); USDC → estate.on_unit_deposit (books `amount` if accepted)
transfer_out({ receiver_id, amount, memo })            // predecessor must be estate_id
sync_deposits()                                        // anyone → estate.sync(unit_id): a check only, credits nothing
get_info() -> [estate_id, usdc_id, unit_id]
```

## 3. `plote-musdc` (`musdc.plote.testnet`)

Standard NEP-141 + NEP-145 + NEP-148 (`ft_transfer`, `ft_transfer_call`, `ft_balance_of`, `ft_total_supply`,
`ft_metadata`, `storage_deposit`, `storage_balance_of`, `storage_balance_bounds`, `storage_withdraw`, `storage_unregister`)
plus `mint({ amount: U128, account_id?: AccountId })` — anyone, ≤ 10,000 USDC (`10000000000`) per call; registers the
receiver if needed when ≥ 0.00125 NEAR is attached. Name "Plote test USDC", symbol "USDC", decimals 6.

## 4. Verifier worker stdin / stdout

See SPEC §6.3. stdin adds `"playground": bool`, `"challenge": "K7RQ4M"`, `"challenge_opened_at": U64-as-number`.
stdout (one line JSON): `Verdict` fields above **minus** `source`, plus `evidence_id`, `sha256` (the committed hash,
lowercase, whenever bytes were fetched; `null` otherwise) and `ai_model` (`string | null`). The estate requires the
`evidence_id`/`sha256` echo for a pass (§1.4) and ignores fields it doesn't know. Numbers for `exif_time` may be
numbers or strings; the estate accepts both. `ai_observations` is the model's `observations` list (strings only, ≤ 4).

Run modes (SPEC 6.1): `demo_mode` turns `ai_unavailable` into a warning; `playground` turns `ai_stage_mismatch`,
`ai_low_confidence` and `outside_geofence` into warnings. Nothing else is ever softened: when the model can't be asked,
the challenge can't be read, so the verdict fails with `challenge_unverified` in every mode.
