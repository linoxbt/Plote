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

Note: a live estate's verifier can't change after its first sale (by design), so verifier fixes protect estates
deployed from now on, including mainnet.

## Web server, relayer and database (`web/`, `supabase/`)

See the section appended below by the server fixes.
