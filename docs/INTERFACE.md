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

```jsonc
new({
  "developer_id": "dev-harmattan.testnet",
  "payout_id": "dev-harmattan.testnet",
  "surveyor_id": "qs-adaeze.testnet",
  "recovery_id": "plote.testnet",
  "usdc_id": "musdc.plote.testnet",
  "outlayer_id": "outlayer.testnet",
  "verdict_relayer": "relayer.plote.testnet",      // optional; may call submit_verdict (HTTPS fallback, SPEC 6.6)
  "verifier": { "repo": "https://github.com/<you>/plote-verifier", "commit": "<sha>", "build_target": "wasm32-wasip2" },
  // or a deployed OutLayer project: { "repo": "project:plote.testnet/plote-verifier", "commit": "<version_key or empty>", "build_target": "wasm32-wasip2" }
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
  "app_url": "https://plote.vercel.app"                // used for NFT `reference`
})
```

Rules: `sum(milestones.bps) + mobilisation_bps == 10000`, `mobilisation_bps <= 1000`, deadlines strictly increasing,
1–8 milestones (demo estates use exactly 4).

### 1.2 Change methods

| Method | Args | Access / deposit | Returns |
|---|---|---|---|
| `add_units` | `{ units: [{ id, label, price: U128, plan: [{ due_at: U64, cumulative: U128 }] }] }` | developer; attach ≥ 0.035 NEAR × n (unit funding + USDC registration + record); ≤ 8 per call | Promise |
| `fund_verification` | `{}` | anyone, payable | — |
| `set_verifier` | `{ verifier }` | developer, only before the first sale | — |
| `playground_reset` | `{}` | anyone, only if `params.playground` | — |
| `reserve` | `{ unit_id }` | anyone, attach exactly 0.05 NEAR | — |
| `cancel_reservation` | `{ unit_id }` | the reserver | Promise (refund USDC) |
| `expire_reservation` | `{ unit_id }` | anyone, after `expires_at` | Promise |
| `sync` | `{ unit_id }` | anyone | Promise |
| `on_unit_deposit` | `{ unit_id, sender_id, amount: U128, msg }` | only the unit's own account | `U128` (unused amount) |
| `refund` | `{ unit_id }` | holder; attach 1 yocto | Promise |
| `withdraw_excess` | `{ unit_id }` | holder; attach 1 yocto | Promise |
| `sweep_unattributed` | `{ unit_id }` | anyone | Promise |
| `list_for_sale` | `{ unit_id, ask: U128 }` | holder, no lien | — |
| `cancel_listing` | `{ unit_id }` | holder (Voluntary only) | — |
| `ft_on_transfer` | NEP-141 (`msg = {"buy":"a-4b"}`) | only from `usdc_id` | `U128` |
| `declare_default` | `{ unit_id }` | anyone | — |
| `handover` | `{ unit_id }` | holder, handover milestone Approved and veto passed | — |
| `set_beneficiary` | `{ unit_id, beneficiary: AccountId \| null }` | holder | — |
| `set_guardians` | `{ unit_id, guardians: [AccountId] }` (≤ 3) | holder | — |
| `guardian_recover` | `{ unit_id, new_owner }` | a guardian; 2 distinct guardians start a 72 h timer (demo: `grace_ns`) | — |
| `finish_recovery` | `{ unit_id }` | anyone, after the timer | — |
| `cancel_recovery` | `{ unit_id }` | holder | — |
| `set_lien` | `{ unit_id, lender, cap: U128 }` | holder | — |
| `clear_lien` | `{ unit_id }` | the lender | — |
| `open_capture` | `{ milestone: u8 }` | surveyor (anyone if playground) | `String` (6-char code) |
| `submit_evidence` | `{ milestone: u8, url, sha256, captured_at: U64, device_gps: [i32, i32] \| null }` | surveyor (anyone if playground) | `U64` evidence id |
| `submit_verdict` | `{ evidence_id: U64, verdict: Verdict }` | only `verdict_relayer` (HTTPS fallback) | — |
| `qs_sign` | `{ milestone: u8 }` | surveyor (anyone if playground) | — |
| `claim_release` | `{ unit_ids: [String] }` (≤ 6; gas) | anyone (funds go to `payout_id`) | Promise |
| `withdraw_owed` | `{}` | anyone with an owed balance | Promise |
| `propose` | `{ kind: ProposalKind }` | holder (any kind) / developer (`ExtendDeadline`) | `U64` proposal id |
| `vote` | `{ proposal_id: U64, approve: bool }` | holder with eligible tokens | — |
| `expire_proposal` | `{ proposal_id: U64 }` | anyone, after `expires_at` | — |

Plus NEP-171/177/178/181: `nft_transfer`, `nft_transfer_call`, `nft_approve`, `nft_revoke`, `nft_revoke_all`, `nft_is_approved`.
`nft_transfer` panics `E_LIEN` while a lien is set and `E_LISTING` while a Default listing is open; a transfer moves `holder`.

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
| `votes_available` | `{ proposal_id: U64, account_id }` | `u32` |
| `nft_token`, `nft_tokens`, `nft_tokens_for_owner`, `nft_supply_for_owner`, `nft_total_supply`, `nft_metadata` | standard | standard; `metadata.media` = live SVG data URI |

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
  now: string;                          // block timestamp at view time
};

type UnitStatus = "Available" | "Reserved" | "Allocated" | "InDefault" | "HandedOver";

type UnitView = {
  id: string; account: string; label: string; price: string; status: UnitStatus;
  holder: string | null; allocated_at: string | null;
  reservation: { by: string; expires_at: string } | null;
  last_reservation: { by: string; expires_at: string } | null;
  plan: { due_at: string; cumulative: string }[];
  paid: string; unattributed: string; released: string; refunded_out: string; in_flight: string;
  listing: { ask: string; kind: "Voluntary" | "Default"; since: string } | null;
  beneficiary: string | null; guardians: string[];
  recovery: { new_owner: string; approvals: string[]; ready_at: string | null } | null;
  lien: { lender: string; cap: string } | null;
  // computed
  refundable_now: string;    // what refund() would pay right now ("0" if refunds aren't open)
  releasable_now: string;    // what claim_release would move right now
  excess_now: string;        // what withdraw_excess would pay
  refunds_open: boolean;
  next_due: { due_at: string; cumulative: string; shortfall: string } | null;
  progress_bps: number;      // approved (veto passed) bps incl. mobilisation
  approved_bps: number;      // same as progress_bps (kept for clarity)
};

type TakenView = {
  exists: boolean; status: UnitStatus | null; holder: string | null;
  paid: string; released: string; price: string; label: string | null;
  account: string | null; reserved_until: string | null; allocated_at: string | null;
};

type MilestoneStatus = "Open" | "Checking" | "Verified" | "Approved" | "Vetoed" | "Missed";
type MilestoneView = {
  index: number; key: string; title: string; bps: number; deadline: string;
  status: MilestoneStatus;              // Missed is computed at view time
  evidence_ids: string[]; verified_at: string | null; signed_at: string | null;
  veto_until: string | null; veto_passed: boolean;   // Approved and veto window over
  refunds_open_at: string;             // deadline + grace
};

type CaptureView = { milestone: number; code: string; by: string; opened_at: string; expires_at: string };

type Verdict = {
  pass: boolean; reasons: string[]; warnings: string[];
  phash: string; nearest_distance: number;
  exif_time: string | null; gps: [number, number] | null; gps_source: "exif" | "device" | null;
  distance_m: number | null; ai_stage: string | null; ai_confidence: number | null;
  challenge_read: string | null; ai_chat_id: string | null;
  worker_commit: string; attestation: string | null;
  source: "outlayer" | "https";
};

type EvidenceView = {
  id: string; milestone: number; url: string; sha256: string; captured_at: string;
  device_gps: [number, number] | null; challenge: string; challenge_opened_at: string;
  submitted_by: string; submitted_at: string;
  status: "Pending" | "Pass" | "Fail" | "Error";
  verdict: Verdict | null; raw_response_hash: string | null; error: string | null;
};

type ProposalView = {
  id: string; kind: unknown /* ProposalKind */; proposer: string;
  created_at: string; expires_at: string; electorate: number; yes: number; no: number;
  voted: string[]; status: "Open" | "Executed" | "Rejected" | "Expired";
};

type DevStats = {
  milestones_due: number; milestones_on_time: number; units_sold: number; units_refunded: number;
  evidence_submitted: number; evidence_passed: number; signoffs: number; vetoes: number;
  units_handed_over: number;
};
```

### 1.4 Events (`standard: "plote"`, `version: "1.0.0"`)

`unit_added {unit_id, account, price}` · `reserved {unit_id, by, expires_at}` · `reservation_ended {unit_id, by, refunded}` ·
`deposit_synced {unit_id, new_money, paid, unattributed}` · `allocated {unit_id, holder}` ·
`capture_opened {milestone, by, expires_at}` · `evidence_submitted {evidence_id, milestone, sha256}` ·
`verdict {evidence_id, pass, reasons}` · `qs_signed {milestone, by, veto_until}` · `released {unit_id, amount, to}` ·
`refunded {unit_id, amount, to}` · `excess_withdrawn {unit_id, amount, to}` · `unattributed_swept {unit_id, amount, to}` ·
`defaulted {unit_id, ask}` · `listed {unit_id, ask, kind}` · `sold {unit_id, from, to, price}` ·
`frozen {reason, refunds_open}` · `unfrozen {}` · `surveyor_changed {old, new}` · `handed_over {unit_id}` ·
`proposal_created {proposal_id, kind, proposer, expires_at}` · `voted {proposal_id, voter, approve, tokens}` ·
`proposal_executed {proposal_id}` · `proposal_rejected {proposal_id}` · `playground_reset {}`.

### 1.5 Error codes

`E_NOT_DEVELOPER E_NOT_SURVEYOR E_NOT_HOLDER E_NOT_RESERVER E_NOT_RELAYER E_NOT_LENDER E_NOT_GUARDIAN E_UNIT_TAKEN
E_UNIT_NOT_FOUND E_UNIT_EXISTS E_BAD_UNIT_ID E_BALANCE_PENDING E_RESERVATION_ACTIVE E_NO_RESERVATION E_DEPOSIT
E_MILESTONE_STATE E_NOT_VERIFIED E_VETO_WINDOW E_FROZEN E_NO_REFUND_YET E_NOTHING_TO_REFUND E_LIEN E_LISTING
E_UNDERPAID E_IN_FLIGHT E_BUDGET E_BAD_TOKEN E_BPS_SUM E_DEADLINES E_NO_CHALLENGE E_CHALLENGE_EXPIRED
E_NOTHING_TO_SWEEP E_NO_EXCESS E_NOT_ELIGIBLE E_ALREADY_VOTED E_PROPOSAL_STATE E_PROPOSAL_OPEN E_PLAYGROUND_ONLY
E_NOT_DUE E_HANDOVER E_RECOVERY E_TOO_MANY E_BAD_ARGS E_NOT_UNIT E_ALREADY_SOLD`

---

## 2. `plote-unit` (e.g. `a-4b.harmattan-court.plote.testnet`)

```
new({ estate_id, usdc_id, unit_id })
ft_on_transfer({ sender_id, amount, msg }) -> U128     // non-USDC → "amount" (bounce); USDC → estate.on_unit_deposit
transfer_out({ receiver_id, amount, memo })            // predecessor must be estate_id
sync_deposits()                                        // anyone → estate.sync(unit_id)
get_info() -> [estate_id, usdc_id, unit_id]
```

## 3. `plote-musdc` (`musdc.plote.testnet`)

Standard NEP-141 + NEP-145 + NEP-148 (`ft_transfer`, `ft_transfer_call`, `ft_balance_of`, `ft_total_supply`,
`ft_metadata`, `storage_deposit`, `storage_balance_of`, `storage_balance_bounds`, `storage_withdraw`, `storage_unregister`)
plus `mint({ amount: U128, account_id?: AccountId })` — anyone, ≤ 10,000 USDC (`10000000000`) per call; registers the
receiver if needed when ≥ 0.00125 NEAR is attached. Name "Plote test USDC", symbol "USDC", decimals 6.

## 4. Verifier worker stdin / stdout

See SPEC §6.3. stdin adds `"playground": bool`, `"challenge": "K7RQ4M"`, `"challenge_opened_at": U64-as-number`.
stdout (one line JSON): `Verdict` fields above **minus** `source`, plus `evidence_id`. Numbers for `exif_time` may be
numbers or strings; the estate accepts both.
