# Plote — Build Spec (NEAR HACKATHON)

Nov 3, 2026 · @Lino

## 1. Product overview

**Brand:** Plote. **Concept:** Plotline — every off-plan home gets its own on-chain account. **Track:** NFTs That Do Something (NEAR HACKATHON, Nov 1–14 2026).

### One-line pitch

Plote turns each off-plan housing unit into a NEAR account that holds the buyer's money in escrow, releases it to the developer only when a construction milestone is proven, and refunds it if the build stalls. The allocation NFT *is* the key to that account.

### The problem, in three facts

- **Double allocation.** Developers sell the same unit to more than one buyer, and buyers find out at handover. Reported cases include a developer reselling units already paid for by another subscriber ([TechEconomy](https://techeconomy.ng/?p=164669)), and double sales appear on lists of the most common Nigerian property scams ([Nigeria Housing Market](https://www.nigeriahousingmarket.com/news/20-real-estate-scams-nigerian-property-buyers-must-avoid)).
- **Money goes out before the building goes up.** Buyers pay over 12–24 months and the developer gets the cash on day one. When the project stalls, the money is gone. Diaspora investors in the Revolutionplus case are one recent example ([allAfrica, Jan 2026](https://allafrica.com/stories/202601290263.html)); allocation delays are widespread ([Nairametrics](https://nairametrics.com/?p=520082)).
- **Diaspora buyers can't see the site.** They drive a large share of off-plan sales ([Guardian](https://guardian.ng/property/diasporan-investors-drive-growth-expose-fault-lines-in-real-estate-sector/)) but rely on WhatsApp photos that can be reused or staged. The same pattern exists in Kenya ([Nation](https://nation.africa/kenya/news/off-plan-scams-from-dream-homes-to-dust--5347430)).

### What Plote does

| Job | How Plote does it | NEAR primitive |
| --- | --- | --- |
| One unit, one buyer | Each unit is a named account (`a-4b.harmattan-court.plote.testnet`) and has exactly one allocation NFT. Minting a second one is impossible. | Named sub-accounts, NEP-171 |
| Public "is it taken?" check | Anyone can type a unit name and see its owner, amount paid and status. No login. | View calls via RPC |
| Escrow per unit | USDC sits on the unit's own account, not the developer's wallet. | NEP-141 on unit account |
| Pay from any chain | Diaspora buyers pay in USDC/USDT from Base, Solana, Ethereum etc. The unit's account receives native NEAR USDC. | NEAR Intents (1Click API) |
| Release only on proof | A milestone (foundation 20%, roofing 30%, finishing 30%, handover 20%) unlocks only after a site photo passes a TEE check and a quantity surveyor signs off. | OutLayer (TEE), NEAR AI Cloud, function-call keys |
| Refund if it stalls | After deadline + grace, the holder can pull their unreleased money back. | Contract logic |
| Fair exit | Holder can sell the NFT; price, transfer and payout happen in one transaction. A defaulting buyer's unit is auto-listed with a fixed penalty instead of being forfeited. | NEP-171 + NEP-178 approvals |
| Holders have a voice | Holders vote, one vote per unit, to replace the surveyor, veto a sign-off, freeze releases or extend a deadline. | Votes in the estate contract, gated by the NFT |
| After handover | The NFT becomes the gate pass and service-charge account. | Same unit account |

### Who it's for

- **Primary user:** a diaspora buyer (UK, US, Canada) paying for a flat in Lagos or Abuja in instalments. They hold USDC or can get it, and they're the ones least able to check the site.
- **Second user:** a mid-sized developer who wants to prove they're honest. Plote is a sales tool for them: "our escrow is public."
- **Third role:** a quantity surveyor (QS) who already does stage inspections. Plote gives them a key that can only sign milestones.

### Why NFTs That Do Something

The NFT is not a picture of a house. It is the right to a specific unit's account: the money in it, the refund out of it, the resale price of it, its vote in the estate, and the gate pass at the end. The image updates itself at every milestone, so the token also shows what it's worth.

### Honest limits (say these in the pitch)

- Plote is not the land title (C of O / governor's consent). It proves allocation and payment, not legal ownership of land.
- A fraudulent developer simply won't opt in. Plote is for honest developers who want to stand out.
- The surveyor is a trusted role. Plote limits the damage (TEE photo checks, holders can vote them out), it doesn't remove trust.
- The TEE proves the checks ran on the photo that was submitted. It doesn't prove the photo is honest: EXIF time and GPS can be forged with free tools. Plote adds a one-time challenge code that must appear on paper in the photo, and the surveyor still signs.
- Holders, not the developer, appoint and replace the surveyor. In production the QS fee should be paid from escrow so the developer doesn't pay the person checking them.
- Local buyers pay in naira. The first market is the diaspora; naira on-ramps are pitch-only.
- Developers need cash to start building. An estate can set an optional mobilisation tranche (up to 10%) released when a unit is allocated; everything else waits for proof.

### Success criteria for the hackathon

1. A judge can follow the README and, on testnet, buy a unit, see "taken" on the public check page, then in the Plote Playground estate (open to every wallet) photograph a challenge code, watch the TEE verdict land on-chain, sign as surveyor, see 20% released, and trigger a refund on a Baobab Heights unit.
2. One unit on mainnet receives a real any-chain USDC payment through 1Click (≈$2), visible on explorer.near-intents.org and NearBlocks.
3. A 3-minute demo video and an X post tagging @NEARProtocol with #NEARHackathon.

## 2. Scope

Twelve days remain (Nov 3 → Nov 14, 23:59 UTC). Scope is cut so the **Must** list is finished by Nov 10, leaving four days for **Should**, polish, video and submission. Anything not in Must or Should is pitch material only.

### Must (MVP — the demo fails without these)

| # | Feature | Done when… |
| --- | --- | --- |
| M1 | Estate + unit accounts | Script creates `harmattan-court.plote.testnet` with 6 units, baobab-heights.plote.testnet (refund demo, 3+ units) and playground.plote.testnet (60 units), every unit running the unit contract. |
| M2 | Allocation NFT (NEP-171/177/178/181) | One token per unit; a second mint on the same unit panics with `E_UNIT_TAKEN`. Shows in a NEAR wallet's NFT tab. |
| M3 | Public "Is unit X taken?" page | `/check` returns owner, paid, released, status for any unit name, no login. |
| M4 | Reserve → pay → mint | Buyer reserves a unit, pays mock USDC with `ft_transfer_call`, NFT mints to them when the initial deposit is met. |
| M5 | Milestone schedule | 4 milestones (20/30/30/20) with deadlines stored per estate, plus an optional mobilisation tranche (mobilisation\_bps, 0–1,000) released at allocation; milestone bps then sum to 10,000 − mobilisation\_bps. |
| M6 | Evidence upload + TEE check | Surveyor uploads a photo; OutLayer worker checks hash, EXIF time, GPS geofence, perceptual-hash reuse and the one-time challenge code written on paper in the photo; verdict stored on-chain. |
| M7 | QS sign-off + release | Surveyor signs with a function-call key; developer claims the released share per unit. |
| M8 | Refund | After deadline + grace with no approval, the holder gets back paid − released. NFT burns, unit reopens. |
| M9 | Frontend core | Landing, check, estate, unit, buy, my units, developer console, surveyor capture, proof page. |
| M10 | README + video + submission | Judges can reproduce the testnet flow in under 10 minutes. |
| M11 | Judge playground estate | playground.plote.testnet lets any wallet act as surveyor, has no geofence, treats an AI stage mismatch as a warning and holds 60 cheap units. A judge photographs the challenge code anywhere and sees a pass, a sign-off and a release in under 10 minutes. |

### Should (the features that win)

| # | Feature | Why it matters to judges |
| --- | --- | --- |
| S1 | NEAR AI Cloud stage check inside the verifier | "Does this photo show a roof?" answered by an attested model, not by us. |
| S2 | Any-chain payment on mainnet via 1Click | Real USDC from Base/Solana lands on a unit account. One unit, ≈$2. |
| S3 | Dynamic NFT image | The token's SVG is drawn by the contract from milestone state. Shows progress in any wallet that renders it. |
| S4 | Atomic resale | Buyer pays, seller gets paid, NFT moves, escrow stays with the unit, in one transaction. |
| S5 | Default → auto-resale with fixed penalty | Missed instalments list the unit for resale instead of forfeiting the buyer's money. |
| S6 | Holder votes, one per unit | Holders vote to replace the surveyor, veto a sign-off or freeze releases. Built into the estate contract, so the NFT itself is the vote. |
| S7 | Developer track-record score | Public page computed from on-chain history. |
| S8 | "Watch my house" share page | Public timeline with a WhatsApp/X preview card. |
| S9 | Gasless surveyor via relayer | The surveyor's phone app never needs NEAR for gas. |

### Could (only if ahead of plan on Nov 11)

- C1 Family chip-in wall: anyone can pay into a unit with a name and message.
- C2 Next-of-kin beneficiary + 2-of-3 guardian recovery.
- C3 Lender lien flag that blocks transfer until cleared.
- C4 Step-in rights: a holder vote freezes releases estate-wide and redirects them to a replacement contractor.
- C5 Gate-pass QR after handover (NEP-413 signed message checked by a guard page).
- C6 Handover timelapse built from milestone photos.
- C7 Milestone celebration screen + email notification.
- C8 Vanity unit names (`the-adeyemis.harmattan-court…`).
- C9 Post-handover service-charge balance on the same unit account.

### Pitch-only (mention, don't build)

- Idle escrow earning yield on Rhea (risky with buyers' money; mention as opt-in for the future).
- QR on the paper allocation letter linking to the on-chain unit.
- Naira on-ramp partners.
- Co-buying a unit with siblings (multi-owner NFT).
- Registry integration with state land bureaus.

### Non-goals (explicitly out)

- Agents of any kind. Smart locks. Fractional investor shares. Gamified payment streaks.
- Land title or legal ownership. KYC. Fiat custody.
- A real marketplace for developers (we seed one demo estate).

### Scope rule

If a Should item isn't working by its roadmap day, it is cut to a slide and the time goes to polish. A smooth demo of M1–M10 plus S1–S3 beats a broken demo of everything.

## 3. System architecture

Four layers. The chain holds every rule that touches money. The web app only reads state and asks wallets to sign. Off-chain services do the work a contract can't (image analysis, cross-chain swaps, file storage), and each one returns something the contract can check.

### Components

| Layer | Component | Runs on | Responsibility |
| --- | --- | --- | --- |
| Chain | `estate` contract | `harmattan-court.plote.testnet` | Unit registry, allocation NFT, milestone schedule, verdicts, sign-offs, resale, defaults, holder votes. |
| Chain | `unit` contract (global) | `a-4b.harmattan-court.plote.testnet` (one per unit) | Holds the unit's USDC. Only obeys the estate contract. `sync_deposits`, `release`, `refund_to`. |
| Chain | Mock USDC (NEP-141) | `musdc.plote.testnet` | Testnet stablecoin with a public mint for demo buyers. Mainnet uses Circle USDC. |
| Chain | OutLayer | `outlayer.testnet` | Receives `request_execution` from the estate contract and resumes it with the TEE verdict. |
| TEE | `plote-verifier` worker | OutLayer (Intel TDX), WASI | Downloads photo, checks SHA-256, EXIF, GPS, pHash, calls NEAR AI vision, returns JSON verdict. |
| AI | NEAR AI Cloud | `cloud-api.near.ai/v1` | Vision model answers "which construction stage is shown?" with a signed response. |
| Payments | 1Click API | `1click.chaindefuser.com` | Quotes and deposit addresses so any-chain funds land as USDC on a unit account (mainnet). |
| Web | Plote app | Vercel (Next.js) | Landing, public pages, buyer/dev/QS/voting apps, OG images. |
| Web | API routes | Vercel functions | Upload signer, 1Click proxy (keeps JWT secret), relayer for gasless meta-transactions, deposit poller. |
| Data | Supabase | Free tier | Photo storage (public bucket), off-chain cache of events and pHashes, chip-in messages, notification emails. |
| Read | NEAR RPC + NearBlocks API | FastNEAR RPC | View calls; transaction history for activity feeds. |

### Trust boundaries

- **Funds** only move by contract rules. Plote's servers hold no buyer money and no key that can move it.
- **Photos** are trusted by hash. The SHA-256 of each photo is written on-chain before the TEE check, so swapping the file later is detectable.
- **Verdicts** are trusted because OutLayer attests the worker's code hash, input hash and output. The contract stores the attestation reference alongside the verdict.
- **The TEE proves the code, not the scene.** It attests that the published checks ran on the committed photo. A forged EXIF or a staged site still needs a corrupt surveyor, and the one-time challenge code rules out photos made before the capture was opened.
- **Surveyor** is a named, replaceable role. Holders can vote them out.
- **Relayer** can only pay gas for whitelisted methods on the estate contract. Losing its key costs gas, not escrow.

### Data flow: a milestone, end to end

1. Surveyor opens `/qs` on a phone and calls open\_capture(milestone); the contract issues a 6-character challenge code valid for 30 minutes. The surveyor writes it on paper and takes the photo with the paper in frame. The app reads EXIF, uploads to Supabase, computes SHA-256.
2. App sends `submit_evidence(milestone, photo_url, sha256)` through the relayer (signed by the surveyor's function-call key).
3. Estate contract stores the evidence as `Pending`, then calls `outlayer.testnet.request_execution` with the worker's GitHub source and the evidence JSON. The transaction yields.
4. Worker runs in the TEE: fetch → hash match → EXIF time ≤ 72h → GPS inside the estate's geofence → pHash not within distance 8 of any prior photo → NEAR AI vision says the stage matches and reads the challenge code → returns `{pass, reasons, phash, ai_stage, ai_confidence}`.
5. OutLayer resumes; the estate callback writes the verdict. If `pass`, the milestone becomes `Verified`.
6. Surveyor calls `qs_sign(milestone)`. Milestone becomes `Approved`. Holder veto window starts (24h on mainnet, 2 minutes in demo mode).
7. After the window, developer calls `claim_release(unit_ids)`. Each unit contract sends its share of USDC to the developer's payout account.
8. Every step emits a NEP-297 event; the app updates the unit page and the dynamic NFT image.

The diagram below shows the same thing as boxes.

&#91;embedded content: Plote architecture · users, web app, NEAR contracts, off-chain services\]

The two highlighted contracts are the only places money moves. Everything on the right either stores a file, swaps a token into USDC, or returns a verdict the estate contract checks.

## 4. NEAR account model and contract design

### Account tree

```
plote.testnet                         # root: owns the brand, deploys the global unit code
├─ musdc.plote.testnet                # mock USDC (NEP-141, 6 decimals) — testnet only
├─ relayer.plote.testnet              # pays gas for meta-transactions
└─ harmattan-court.plote.testnet        # estate contract (NFT + registry + milestones)
   ├─ a-1a.harmattan-court.plote.testnet  # unit account, block A unit 1A (unit contract)
   ├─ a-4b.harmattan-court.plote.testnet
   └─ …

baobab-heights.plote.testnet          # refund-demo estate (a deadline already missed)
playground.plote.testnet              # judge playground estate (open surveyor role, 60 units)
outlayer.testnet                      # OutLayer (third party)
```

**Why units are flat under the estate.** NEAR only lets an account create its own direct sub-accounts. A `block-a` level would need its own contract just to create units. Flattening to `a-4b` keeps one creator (the estate contract) and keeps names short. NEAR account IDs max out at 64 characters; `a-4b.harmattan-court.plote.testnet` is 34. Use lowercase letters, digits and `-` only.

**Mainnet names.** Use a sub-account of an account you already own, e.g. `plote.<you>.near` → `harmattan-court.plote.<you>.near` → `a-4b.harmattan-court.plote.<you>.near`. Creating a new top-level `.near` name is not needed.

### Why a unit is an account and not a row in a map

| Problem | Row-in-a-map | Account-per-unit |
| --- | --- | --- |
| Who owns money that arrives without a message (1Click uses plain `ft_transfer`)? | Can't tell which unit it was for. | Any USDC on the unit account is that unit's. `sync_deposits` reads the balance. |
| Can the public verify escrow? | Must trust the contract's internal ledger. | Open NearBlocks, look at the unit account's USDC balance. |
| Where does a diaspora relative send money? | A memo they'll get wrong. | A human-readable address: `a-4b.harmattan-court…`. |
| Post-handover service charge | New system. | Same account keeps working. |

### Global contract for units (testnet)

All unit accounts run identical code. NEP-591 global contracts let us upload the code once and point each unit at it.

- **Testnet:** deploy the unit WASM as a global contract by hash (immutable: holders know the code can't change under them). Each new unit uses it for under 0.001 NEAR of storage instead of paying for a full copy.
- **Mainnet:** global deploys cost about 10× normal storage and those tokens are burned, which is over budget. Mainnet gets a plain `deploy` on one unit only (≈1 NEAR per 100 KB, locked and returned when the account is deleted).

```bash
# once: publish unit code globally by hash
near contract deploy-as-global use-file target/near/plote_unit.wasm \
  as-global-hash plote.testnet network-config testnet sign-with-keychain send

# per unit (the estate contract does this in code; CLI shown for clarity)
near contract deploy a-4b.harmattan-court.plote.testnet use-global-hash <HASH> \
  without-init-call network-config testnet sign-with-keychain send
```

In Rust, the estate contract creates a unit with one batched promise: `create_account` → `transfer` (storage) → `use_global_contract` (by hash) → `function_call("new", …)`. **Verify on Day 1** the exact near-sdk method name for the global-contract action (`Promise::use_global_contract` in recent near-sdk 5.x — check docs.rs for the version you pin). Fallback: the estate contract embeds the unit WASM with `include_bytes!` and calls `deploy_contract`. That works everywhere but costs ≈1.5 NEAR per unit on testnet (free testnet NEAR, so acceptable).

### Keys on each account

| Account | Keys | Why |
| --- | --- | --- |
| `plote.testnet` | Your full-access key | Admin; never used by the app. |
| `harmattan-court…` | **None after init** (keys deleted) | The estate contract can't be changed by anyone, including us. Say this in the pitch. For the hackathon, keep a full-access key until Nov 12, then delete it on video. |
| `a-4b.harmattan-court…` | None | Created by the estate contract with no keys. Only the contract's code can move funds. |
| Surveyor's own account | A function-call key restricted to `harmattan-court…` methods `submit_evidence`, `qs_sign`, open\_capture | Lives on the surveyor's phone. Can't move NEAR. Allowance set (e.g. 0.25 NEAR) — an allowance of 0 means unlimited, so always set one. |
| Developer's account | Function-call key for `claim_release`, `propose (deadline extensions` only) | Day-to-day console use. |
| `relayer.plote.testnet` | Full-access key in Vercel env | Pays gas for delegate actions to whitelisted methods. |

### Storage accounting

- **Reservation deposit:** `reserve()` requires 0.05 NEAR attached (covers NFT token storage + unit metadata). Refunded on refund/burn. Mark as "storage, not price" in UI.
- **Unit creation:** paid by the developer when they add units (`add_units` needs ≈0.01 NEAR per unit with a global contract, plus 0.00125 NEAR to register the unit on the USDC contract via `storage_deposit`).
- **USDC registration:** every unit account must be registered on the USDC contract before it can receive tokens (NEP-145). The estate contract calls `usdc.storage_deposit({account_id: unit, registration_only: true})` during unit creation. The developer payout account must also be registered.

### Contract crates

| Crate | Account | Size target | Notes |
| --- | --- | --- | --- |
| `plote-estate` | estate | < 400 KB | near-sdk 5.x, near-contract-standards (NFT core, metadata, approvals, enumeration). |
| `plote-unit` | each unit | < 150 KB | No standards; tiny. |
| `plote-musdc` | musdc | < 200 KB | near-contract-standards FT with an open `mint(amount)` capped at 10,000 per call. |

Pin `near-sdk` to the latest 5.x release on crates.io when you start (v6 is in preparation; don't adopt a pre-release mid-hackathon). Build with `cargo near build non-reproducible-wasm` during development and `cargo near build reproducible-wasm` for the final deploy so judges can verify the code hash.

## 5. Smart contract spec

Three contracts. All amounts are USDC base units (6 decimals) as `U128` in JSON. All times are nanoseconds (`env::block_timestamp()`). The token ID of the allocation NFT **is** the unit ID (`"a-4b"`), so the NEP-171 core itself refuses a second mint for the same unit.

### 5.1 Core rule: the unit account's balance is the truth

Money can reach a unit three ways: `ft_transfer_call` from a NEAR wallet, plain `ft_transfer` from 1Click, or a relative chipping in. The estate contract never trusts a message about an amount. It asks the USDC contract for the unit account's balance and works out what changed:

```
expected(unit) = paid + unattributed - released - refunded_out   // in_flight must be 0: sync is blocked while a transfer out is pending
balance        = ft_balance_of(unit_account)
new_money      = balance - expected
  unit has a holder or an active reservation -> paid += new_money
  unit is Available with no reservation      -> unattributed += new_money (credited to nobody)
```

`sync(unit_id)` is public and idempotent. The `estate runs it after accepting a wallet deposit (5.4)`; the app calls it after a 1Click payment shows SUCCESS; anyone can call it.

**Unattributed money.** USDC that reaches an Available unit with no reservation is credited to nobody: `sync` adds it to `unit.unattributed`. Up to `dust_threshold` (1 USDC) it is credited to the next reserver, so dust can't block a unit. Above it, `reserve` fails `E_BALANCE_PENDING` until anyone calls `sweep_unattributed`, which sends it to the unit's last reserver if their reservation ended less than `late_claim_ns` ago (a late 1Click delivery), otherwise to the estate's `recovery_id`. A wallet payment (`ft_transfer_call`) to such a unit never gets this far: the unit asks the estate first and the token bounces back to the sender (5.4).

### 5.2 `plote-estate` state

```rust
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Estate {
    // roles
    developer_id: AccountId,
    payout_id: AccountId,          // where releases go (must be USDC-registered)
    surveyor_id: AccountId,        // replaced only by a holder vote (section 8); ignored when params.playground
    recovery_id: AccountId,        // receives swept unattributed USDC (Plote-run; returned on request)
    // integrations
    usdc_id: AccountId,
    outlayer_id: AccountId,        // outlayer.testnet / outlayer.near
    verifier: VerifierSource,      // { repo, commit, build_target: "wasm32-wasip2" }
    unit_code_hash: Option<Base58CryptoHash>, // global contract hash (testnet)
    // site
    name: String,                  // "Harmattan Court"
    geofence: Geofence,            // { lat_e6: i32, lon_e6: i32, radius_m: u32 }; radius 0 = no geofence
    // data
    milestones: Vec<Milestone>,    // exactly 4 in MVP, bps sum = 10_000 - params.mobilisation_bps
    units: IterableMap<UnitId, Unit>,
    evidence: IterableMap<u64, Evidence>,
    next_evidence_id: u64,
    captures: LookupMap<u8, Capture>, // open challenge per milestone
    accepted_phashes: Vector<u64>, // 64-bit pHashes of every passed photo
    owed: LookupMap<AccountId, u128>, // payouts that failed (unregistered receiver)
    // governance (section 8)
    proposals: IterableMap<u64, Proposal>,
    next_proposal_id: u64,
    // NFT
    tokens: NonFungibleToken,
    metadata: LazyOption<NFTContractMetadata>,
    // switches
    frozen: Option<Freeze>,        // { reason, since, refunds_open: bool }
    params: Params,
    stats: DevStats,               // feeds the track-record score
}

pub struct Params {
    reserve_ttl_ns: u64,      // 30 min testnet, 24 h mainnet (1Click can take ~15 min)
    min_initial_bps: u16,     // 1_000 = first payment must reach 10% of price to mint
    mobilisation_bps: u16,    // 0..=1_000, released at allocation (0 in the demo estates)
    grace_ns: u64,            // after a milestone deadline before refunds open (demo: 2 min; real: 30 days)
    veto_window_ns: u64,      // after QS sign-off before release (demo: 2 min; real: 24 h)
    default_grace_ns: u64,    // after a missed instalment before default (demo: 2 min; real: 14 days)
    penalty_bps: u16,         // 500 = 5% of paid goes to developer on a default sale
    dust_threshold: u128,     // 1_000_000 = 1 USDC; unattributed money at or below this goes to the next reserver
    late_claim_ns: u64,       // a lapsed reserver can sweep late deposits for this long (demo: 10 min; real: 7 days)
    capture_ttl_ns: u64,      // challenge code lifetime (30 min)
    proposal_period_ns: u64,  // holder vote length (demo: 10 min; real: 7 days)
    max_phash_distance: u8,   // 8 (Hamming) = treat as reused photo
    max_exif_age_h: u32,      // 72
    min_ai_confidence: u8,    // 70
    demo_mode: bool,          // short timers; ai_unavailable is a warning
    playground: bool,         // judge sandbox: anyone can capture/submit/sign, no geofence,
                              // ai_stage_mismatch is a warning, playground_reset allowed
}

pub struct Unit {
    id: UnitId,               // "a-4b"
    account: AccountId,       // a-4b.harmattan-court.plote.testnet
    label: String,            // "Block A · Unit 4B · 3-bed"
    price: u128,
    status: UnitStatus,
    holder: Option<AccountId>,
    allocated_at: Option<u64>,        // vote eligibility (section 8)
    reservation: Option<Reservation>, // { by, expires_at }
    last_reservation: Option<Reservation>, // kept after expiry/cancel for late claims
    plan: Vec<Instalment>,    // [{ due_at, cumulative }]
    paid: u128,               // credited to the holder/reserver
    unattributed: u128,       // arrived while nobody held or reserved the unit
    released: u128,
    refunded_out: u128,       // refunds + withdraw_excess
    in_flight: u128,          // locked while a transfer out is pending
    listing: Option<Listing>, // { ask, kind: Voluntary | Default, since }
    beneficiary: Option<AccountId>,   // C2
    guardians: Vec<AccountId>,        // C2 (2-of-3)
    lien: Option<AccountId>,          // C3
}

pub enum UnitStatus { Available, Reserved, Allocated, InDefault, HandedOver }

pub struct Milestone {
    key: String,              // "foundation" | "roofing" | "finishing" | "handover"
    title: String,
    bps: u16,                 // 2000, 3000, 3000, 2000
    deadline: u64,
    status: MilestoneStatus,  // Missed is computed: deadline + grace passed and not Approved
    evidence_ids: Vec<u64>,
    verified_at: Option<u64>,
    signed_at: Option<u64>,
    veto_until: Option<u64>,
}

pub enum MilestoneStatus { Open, Checking, Verified, Approved, Vetoed, Missed }

pub struct Capture {
    code: String,             // 6 chars from env::random_seed, alphabet without 0/O/1/I/L
    by: AccountId,
    opened_at: u64,
    expires_at: u64,          // opened_at + capture_ttl_ns
}

pub struct Evidence {
    id: u64,
    milestone: u8,
    url: String,              // public Supabase URL
    sha256: String,           // hex, committed before the check
    captured_at: u64,         // claimed by the app; checked against EXIF in the TEE
    device_gps: Option<(i32, i32)>,
    challenge: String,        // the capture code the photo must show
    challenge_opened_at: u64, // EXIF time must not be earlier than this (minus 5 min clock skew)
    submitted_by: AccountId,
    status: EvidenceStatus,   // Pending | Pass | Fail | Error
    verdict: Option<Verdict>,
}

pub struct Verdict {
    pass: bool,
    reasons: Vec<String>,     // ["exif_stale", "outside_geofence", "phash_reuse:12", "ai_stage_mismatch", "challenge_missing"]
    warnings: Vec<String>,    // checks downgraded by demo_mode / playground
    phash: String,            // hex u64
    nearest_distance: u8,
    exif_time: Option<u64>,
    gps: Option<(i32, i32)>,  // lat_e6, lon_e6
    gps_source: Option<String>, // "exif" | "device"
    distance_m: Option<u32>,
    ai_stage: Option<String>,
    ai_confidence: Option<u8>,
    challenge_read: Option<String>, // code the model read on the paper
    ai_chat_id: Option<String>, // NEAR AI Cloud chat id → /v1/signature/{id}
    worker_commit: String,
    attestation: Option<String>, // OutLayer execution / attestation reference
}

pub struct Proposal {
    id: u64,
    kind: ProposalKind,
    proposer: AccountId,
    created_at: u64,
    expires_at: u64,          // created_at + proposal_period_ns (Veto: min(that, veto_until))
    electorate: u32,          // allocated tokens when the proposal was created
    yes: u32,
    no: u32,
    voted: Vec<UnitId>,       // each token votes once per proposal, whoever holds it later
    status: ProposalStatus,   // Open | Executed | Rejected | Expired
}

pub enum ProposalKind {
    ReplaceSurveyor { account: AccountId },
    Veto { milestone: u8 },
    Freeze { reason: String, refunds_open: bool },
    Unfreeze,
    ExtendDeadline { milestone: u8, new_deadline: u64 },
    StepIn { new_payout_id: AccountId }, // C4
}
```

### 5.3 Methods

**Init and setup** (developer)

| Method | Args | Access | Effect |
| --- | --- | --- | --- |
| `new` | `NewArgs { developer_id, payout_id, surveyor_id, usdc_id, outlayer_id, verifier, unit_code_hash, name, geofence, milestones, params, nft_metadata }` | `#[init]` | Validates milestone bps + mobilisation\_bps = 10,000 and deadlines increasing. |
| `add_units` | `units: Vec<UnitInput { id, label, price, plan }>` | developer, payable ≥ 0.02 NEAR × n | Creates each unit sub-account, deploys unit code, calls unit `new`, registers it on USDC. Emits `unit_added`. |
| `fund_verification` | — | anyone, payable | Tops up the NEAR budget used to pay OutLayer. |
| `playground_reset` | — | anyone, only when `params.playground` | Resets every milestone to `Open` with deadlines re-based on now and clears captures. Units, payments and releases stay. Emits `playground_reset`. |

**Buyer**

| Method | Args | Access | Effect |
| --- | --- | --- | --- |
| `reserve` | `unit_id` | anyone, payable 0.05 NEAR | `Available → Reserved` for `reserve_ttl`. Fails `E_UNIT_TAKEN` if not Available, `E_BALANCE_PENDING` if the unit holds unattributed USDC above dust\_threshold (anyone can clear it with sweep\_unattributed). Unattributed USDC at or below the threshold is credited to the reserver. |
| `cancel_reservation` | `unit_id` | reserver | Refunds any USDC on the unit to the reserver, returns 0.05 NEAR, unit back to Available. |
| `expire_reservation` | `unit_id` | anyone, after TTL | Same as cancel; protects the unit from being blocked. |
| `sync` | `unit_id` | anyone | Reads balance → updates `paid`. If `Reserved` and `paid ≥ price × min_initial_bps` → mints NFT to reserver (`Allocated`). Emits `deposit_synced`, `allocated`, `nft_mint`. |
| `refund` | `unit_id` | holder | Allowed if any milestone is `Missed` (deadline + grace passed without approval) or `frozen.refunds_open`. Sends `paid − released` − refunded\_out to holder, burns NFT, resets unit to Available. A missed milestone keeps refunds open until holders pass an ExtendDeadline vote. Emits `refunded`, `nft_burn`. |
| `list_for_sale` | `unit_id, ask` | holder, no lien | Creates a voluntary listing. |
| `cancel_listing` | `unit_id` | holder | Removes voluntary listing (not a Default listing). |
| `ft_on_transfer` | `sender_id, amount, msg` | only from `usdc_id` | `msg = {"buy":"a-4b"}` → atomic resale (5.5). Any other msg → rejects (returns full amount). |
| `handover` | `unit_id` | holder, after handover milestone approved | `Allocated → HandedOver`; NFT becomes the gate pass. |
| `set_beneficiary` / `set_guardians` / `guardian_recover` | … | holder / 2-of-3 guardians | C2. |
| `set_lien` / `clear_lien` | `unit_id, lender` | holder / lender | C3. Blocks `nft_transfer`, listing and refund destination change. |
| `on_unit_deposit` | `unit_id, sender_id, amount, msg` | only the unit's own account | Called from the unit's `ft_on_transfer`. Unit Available with no reservation → returns the full amount (NEP-141 refunds the sender). Otherwise returns 0 and schedules `sync`. |
| `withdraw_excess` | `unit_id` | holder | Sends `paid − price` (minus earlier excess withdrawals) to the holder. Excess over the price is never releasable. Emits `excess_withdrawn`. |
| `sweep_unattributed` | `unit_id` | anyone | Sends `unattributed` to the last reserver if their reservation ended less than `late_claim_ns` ago, else to `recovery_id`. Fails `E_NOTHING_TO_SWEEP` at or below `dust_threshold`. Emits `unattributed_swept`. |

**Surveyor** (signed with the function-call key, usually via the relayer; any account when params.playground)

| Method | Args | Effect |
| --- | --- | --- |
| `open_capture` | `milestone: u8` | Issues a 6-character challenge code from `env::random_seed` (alphabet without 0/O/1/I/L), valid for `capture_ttl_ns`. One open capture per milestone; a new call replaces it. Returns the code. Emits `capture_opened`. |
| `submit_evidence` | `milestone: u8, url, sha256, captured_at`, device\_gps | Stores `Evidence::Pending`, sets milestone `Checking`, calls OutLayer (5.6). Requires an open, unexpired capture for that milestone (E\_NO\_CHALLENGE / E\_CHALLENGE\_EXPIRED); copies its code into the evidence and closes it. Rejects if frozen, milestone not Open/Checking, or verification budget < 0.05 NEAR. |
| `qs_sign` | `milestone: u8` | Requires `Verified`. Sets `Approved`, `signed_at`, `veto_until = now + veto_window`. Emits `qs_signed`. |

**Developer**

| Method | Args | Effect |
| --- | --- | --- |
| `claim_release` | `unit_ids: Vec<UnitId>` (≤ 20 per call) | For each: `due = min(paid, price) × approved_bps / 10_000 − released`, where `approved_bps` counts only milestones whose veto window has passed. Locks `in_flight`, calls unit `transfer_out(payout_id, due)`. Callback moves `in_flight → released`. Blocked while frozen. |
| `declare_default` | `unit_id` | Anyone may call (not only the developer). Allowed if `now > due_at + default_grace` for an instalment and `paid < cumulative`. `Allocated → InDefault`, creates `Listing { ask: paid, kind: Default }`. |
| `withdraw_owed` | — | Anyone with an `owed` balance pulls it (after registering on USDC). |

**Holder votes** (section 8; one vote per allocation token)

| Method | Access | Effect |
| --- | --- | --- |
| `propose(kind)` | a holder (any kind) or the developer (`ExtendDeadline` only) | Opens a proposal with `electorate` = tokens allocated now. One open proposal per account. `Veto` only during that milestone's veto window. Emits `proposal_created`. |
| `vote(proposal_id, approve)` | a holder | Casts one vote for every token the caller holds that was allocated before the proposal opened and hasn't voted on it. More than half of `electorate` yes → executes at once; more than half no → `Rejected`. Emits `voted`, then `proposal_executed` / `proposal_rejected`. |
| `expire_proposal(proposal_id)` | anyone, after `expires_at` | Marks it `Expired`. |

Effects of an executed proposal: `ReplaceSurveyor` replaces the QS; `Veto` sets the milestone `Vetoed` (evidence must be resubmitted); `Freeze` stops all releases and optionally opens refunds; `Unfreeze` lifts it; `ExtendDeadline` moves the deadline and turns `Missed` back to `Open`; `StepIn` (C4) sends future releases to a replacement contractor.

**Views**

`get_estate()`, `get_unit(unit_id) → UnitView` (adds `refundable_now`, `releasable_now`, `next_due`, `progress_bps`), `list_units(from_index, limit)`, `is_taken(unit_id) → { exists, status, holder, paid, released, account }`, `get_milestones()`, `get_`capture(milestone), get\_evidence(id), list\_evidence(milestone), get\_proposal(id), list\_proposals(from\_index, limit`)`, `dev_stats()`, `verification_budget()`, plus NEP-171/177/178/181 views (`nft_token`, `nft_tokens`, `nft_tokens_for_owner`, `nft_metadata`, `nft_supply_for_owner`, …).

### 5.4 `plote-unit` (one per unit account)

```rust
#[near(contract_state)]
pub struct Unit { estate_id: AccountId, usdc_id: AccountId, unit_id: String }

#[near]
impl Unit {
    #[init] pub fn new(estate_id: AccountId, usdc_id: AccountId, unit_id: String) -> Self;
    // NEP-141 receiver: any token but usdc_id → returns the full amount (bounced).
    // USDC → returns estate.on_unit_deposit(unit_id, sender_id, amount, msg): 0 (keep, then sync) or amount (bounce)
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128>;
    // only the estate can move funds out
    pub fn transfer_out(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) -> Promise; // asserts predecessor == estate_id, attaches 1 yocto, 15 Tgas
    pub fn sync_deposits(&self) -> Promise;  // anyone: calls estate.sync(unit_id)
    pub fn get_info(&self) -> (AccountId, AccountId, String);
}
```

The unit account needs a little NEAR for its own storage (≈0.01 NEAR with a global contract) and for the 1 yoctoNEAR attached to each `ft_transfer`; `add_units` funds it with 0.02 NEAR.

### 5.5 Atomic resale

1. Buyer calls `usdc.ft_transfer_call({receiver_id: estate, amount: ask, msg: '{"buy":"a-4b"}'})`.
2. Estate `ft_on_transfer` checks: listing exists, `amount ≥ ask`, no lien, not frozen, buyer ≠ seller.
3. Payout: Voluntary → `ask` to seller. Default → `ask − penalty` to seller, `penalty = paid × penalty_bps / 10_000` to `payout_id`.
4. `nft_transfer` internally to the buyer; `holder = buyer`; status back to `Allocated` (Default listings) and the remaining instalment plan carries over.
5. Returns `amount − ask` (refunded to buyer by the FT standard).
6. If a payout `ft_transfer` fails (receiver not registered), the amount goes to `owed` and the seller can `withdraw_owed` later. The escrow on the unit account never moves during resale.

### 5.6 OutLayer call from the estate contract

OutLayer's documented parameters for `request_execution`: `source` (GitHub `{repo, commit, build_target}`, `WasmUrl` or `Project`), `resource_limits {max_instructions, max_memory_mb, max_execution_seconds}`, `input_data` (string), `secrets_ref`, `response_format: "Json"`, and an attached NEAR deposit (unused deposit is refunded). The result comes back to the caller through yield/resume.

```rust
#[ext_contract(ext_outlayer)]
trait OutLayer {
    fn request_execution(&mut self, source: serde_json::Value, resource_limits: serde_json::Value,
        input_data: String, secrets_ref: Option<serde_json::Value>, response_format: String);
}

fn start_check(&mut self, ev: &Evidence) -> Promise {
    let input = json!({
        "evidence_id": ev.id, "url": ev.url, "sha256": ev.sha256,
        "captured_at": ev.captured_at, "now": env::block_timestamp(),
        "milestone": self.milestones[ev.milestone as usize].key,
        "geofence": self.geofence, "known_phashes": self.recent_phashes(500),
        "limits": { "max_exif_age_h": self.params.max_exif_age_h,
                    "max_phash_distance": self.params.max_phash_distance }
    }).to_string();
    ext_outlayer::ext(self.outlayer_id.clone())
        .with_attached_deposit(NearToken::from_millinear(50))   // estimate first (5.7)
        .with_static_gas(Gas::from_tgas(100))
        .request_execution(
            json!({"GitHub": {"repo": self.verifier.repo, "commit": self.verifier.commit,
                              "build_target": self.verifier.build_target}}),
            json!({"max_instructions": 50_000_000_000u64, "max_memory_mb": 256, "max_execution_seconds": 60}),
            input,
            Some(json!({"profile": "plote", "account_id": env::current_account_id()})), // NEAR AI key
            "Json".into())
        .then(Self::ext(env::current_account_id())
            .with_static_gas(Gas::from_tgas(30))
            .on_verdict(ev.id))
}

#[private]
pub fn on_verdict(&mut self, evidence_id: u64,
    #[callback_result] res: Result<serde_json::Value, PromiseError>) { /* parse Verdict, store, update milestone */ }
```

**Verify on Day 2:** the exact JSON shape OutLayer returns to the callback (it may wrap the worker's stdout in an execution-response object with status and attestation fields), the deposit the `estimate_execution_cost` view returns for these limits, and the `secrets_ref` format. Write `on_verdict` to accept either a bare verdict or a wrapper with the verdict inside, and to store the raw response hash. On `Err` or unparsable output: `EvidenceStatus::Error`, milestone back to `Open`, so the surveyor can resubmit.

On `pass`: push the pHash to `accepted_phashes`, set milestone `Verified`. On fail: milestone back to `Open`; reasons shown on the proof page.

**Yield timeout.** A yielded receipt that isn't resumed within about 200 blocks (a few minutes) resumes with an error, and the evidence lands as `Error`. OutLayer's first build of a new worker commit can take longer than that. Warm the build cache with a CLI run after every commit change, pin the commit in the estate config, and don't change it in the 48 hours before recording.

### 5.7 Gas and deposits (starting values, tune in tests)

| Call | Prepaid gas | Deposit |
| --- | --- | --- |
| `add_units` (per unit) | 30 Tgas each, ≤ 8 per tx | 0.02 NEAR + 0.00125 NEAR USDC storage |
| `reserve` | 15 Tgas | 0.05 NEAR |
| `sync` | 50 Tgas | — |
| `submit_evidence` | 300 Tgas | paid from verification budget |
| `claim_release` | 300 Tgas for 20 units | — |
| `refund` | 100 Tgas | 1 yocto |
| `usdc.ft_transfer_call` → resale | 150 Tgas | 1 yocto |

### 5.8 Events (NEP-297)

NFT events use the standard `nep171` (`nft_mint`, `nft_transfer`, `nft_burn`). Plote's own events use standard `plote`, version `1.0.0`:

```rust
#[near(event_json(standard = "plote"))]
pub enum PloteEvent {
    #[event_version("1.0.0")] UnitAdded { unit_id: String, account: AccountId, price: U128 },
    #[event_version("1.0.0")] Reserved { unit_id: String, by: AccountId, expires_at: U64 },
    #[event_version("1.0.0")] DepositSynced { unit_id: String, new_money: U128, paid: U128 },
    #[event_version("1.0.0")] Allocated { unit_id: String, holder: AccountId },
    #[event_version("1.0.0")] EvidenceSubmitted { evidence_id: U64, milestone: u8, sha256: String },
    #[event_version("1.0.0")] Verdict { evidence_id: U64, pass: bool, reasons: Vec<String> },
    #[event_version("1.0.0")] QsSigned { milestone: u8, by: AccountId, veto_until: U64 },
    #[event_version("1.0.0")] Released { unit_id: String, amount: U128, to: AccountId },
    #[event_version("1.0.0")] Refunded { unit_id: String, amount: U128, to: AccountId },
    #[event_version("1.0.0")] Defaulted { unit_id: String, ask: U128 },
    #[event_version("1.0.0")] Listed { unit_id: String, ask: U128, kind: String },
    #[event_version("1.0.0")] Sold { unit_id: String, from: AccountId, to: AccountId, price: U128 },
    #[event_version("1.0.0")] Frozen { reason: String, refunds_open: bool },
    #[event_version("1.0.0")] Unfrozen {},
    #[event_version("1.0.0")] SurveyorChanged { old: AccountId, new: AccountId },
    #[event_version("1.0.0")] HandedOver { unit_id: String },
    #[event_version("1.0.0")] CaptureOpened { milestone: u8, by: AccountId, expires_at: U64 },
    #[event_version("1.0.0")] UnattributedSwept { unit_id: String, amount: U128, to: AccountId },
    #[event_version("1.0.0")] ExcessWithdrawn { unit_id: String, amount: U128, to: AccountId },
    #[event_version("1.0.0")] ProposalCreated { proposal_id: U64, kind: String, proposer: AccountId, expires_at: U64 },
    #[event_version("1.0.0")] Voted { proposal_id: U64, voter: AccountId, approve: bool, tokens: u32 },
    #[event_version("1.0.0")] ProposalExecuted { proposal_id: U64 },
    #[event_version("1.0.0")] ProposalRejected { proposal_id: U64 },
    #[event_version("1.0.0")] PlaygroundReset {},
}
```

### 5.9 Errors

Panic with stable codes so the frontend can map them to plain-English messages: `E_NOT_DEVELOPER`, `E_NOT_SURVEYOR`, `E_NOT_HOLDER`, `E_UNIT_TAKEN`, `E_UNIT_NOT_FOUND`, `E_BALANCE_PENDING`, `E_RESERVATION_ACTIVE`, `E_MILESTONE_STATE`, `E_NOT_VERIFIED`, `E_VETO_WINDOW`, `E_FROZEN`, `E_NO_REFUND_YET`, `E_LIEN`, `E_LISTING`, `E_UNDERPAID`, `E_IN_FLIGHT`, `E_BUDGET`, `E_BAD_TOKEN`, `E_BPS_SUM`, E\_NO\_CHALLENGE, E\_CHALLENGE\_EXPIRED, E\_NOTHING\_TO\_SWEEP, E\_NO\_EXCESS, E\_NOT\_ELIGIBLE, E\_ALREADY\_VOTED, E\_PROPOSAL\_STATE, E\_PROPOSAL\_OPEN, E\_PLAYGROUND\_ONLY.

### 5.10 Invariants (each gets a test)

1. **One unit, one token:** token ID = unit ID; minting an existing ID panics.
2. **Conservation:** after any `sync`, `paid + unattributed = balance + released + refunded_out + in_flight` for every unit.
3. **Release cap:** `released ≤ min(paid, price) × approved_bps / 10_000` at all times.
4. **Exits only to three places:** a unit's USDC leaves only to `payout_id` (release), the holder (refund, excess), the reserver (expired/cancelled reservation, late claim), or recovery\_id (swept unattributed money).
5. **Frozen means no releases:** `claim_release` panics while frozen; refunds still work if opened.
6. **No double count:** `in_flight > 0` blocks `sync` for that unit until the callback lands.
7. **Schedule integrity:** milestone bps sum to 10,000; deadlines strictly increase; only a holder vote can extend them after the first sale.
8. **Evidence is committed first:** a verdict can only attach to an evidence ID whose SHA-256 was stored before the OutLayer call.
9. **One token, one vote:** a token's vote on a proposal is recorded by unit ID, so selling the token mid-vote never adds a vote.
10. **Fresh photos only:** a verdict can only attach to evidence submitted under an open, unexpired capture for the same milestone.

### 5.11 Dynamic NFT metadata

`nft_token` returns `metadata.media` computed at view time: an SVG data URI (`data:image/svg+xml;base64,…`) drawn from the unit's state — estate name, unit label, a 4-segment progress bar (filled for each approved milestone), paid / price, and status badge. `media_hash` is omitted because the image changes. near-contract-standards' NFT views return stored metadata, so the estate overrides nft\_token, nft\_tokens and nft\_tokens\_for\_owner to fill media at view time. `reference` points to `https://plote.app/api/meta/{estate}/{unit}` (JSON with the latest milestone photo). Keep the SVG template under 2 KB to keep the WASM small. **Check on Day 4** which wallets render data-URI media (test MyNearWallet, Meteor, HOT); fall back to an HTTPS image URL from the app if none do.

## 6. Milestone verification (OutLayer + NEAR AI Cloud)

This is the feature judges will remember: a construction photo is checked inside a TEE, the check is attested, and only then can money move. The quantity surveyor still signs, but they can no longer push through a recycled or off-site photo, or one taken before the capture was opened.

### 6.1 Checks, in order (fail fast)

| # | Check | Rule | Reason code on fail |
| --- | --- | --- | --- |
| 1 | Fetch | Download `url` (≤ 12 MB). | `fetch_failed` |
| 2 | Integrity | `sha256(bytes) == evidence.sha256` committed on-chain. | `hash_mismatch` |
| 3 | Decodes | JPEG/HEIC-converted-to-JPEG/PNG decodes; ≥ 800 px short side. | `bad_image` |
| 4 | Freshness | EXIF `DateTimeOriginal` (+ `OffsetTimeOriginal`, default +01:00) within `max_exif_age_h` (72 h) of `now`, and not in the future (> 10 min). | `exif_missing`, `exif_stale`, `exif_future` |
| 5 | Location | EXIF GPS inside the estate geofence (haversine ≤ `radius_m`, e.g. 300 m). If EXIF has no GPS, use the device location the app recorded, and mark `gps_source: "device"` (lower trust, shown on the proof page). Skipped when radius\_m = 0 (playground). | `outside_geofence`, `gps_missing` |
| 6 | Not reused | 64-bit perceptual hash; Hamming distance to every `known_phashes` entry > `max_phash_distance` (8). | `phash_reuse:<distance>` |
| 7 | Right stage | NEAR AI vision returns a stage that matches the milestone with confidence ≥ 70, and `is_photo_of_screen_or_print == false`. | `ai_stage_mismatch`, `ai_low_confidence`, `ai_screen_photo`, `ai_unavailable` |
| 8 | Challenge | The model reads the code on the paper in the photo; it must match `evidence.challenge` (case-insensitive, at most one character wrong). EXIF time, when present, must not be earlier than `challenge_opened_at` − 5 min. | `challenge_missing`, `challenge_mismatch`, `exif_before_capture` |

`pass = true` only if every check passes. `ai_unavailable` is a fail in production; in `demo_mode` it is a warning so a NEAR AI outage doesn't kill the live demo. In playground mode ai\_stage\_mismatch, ai\_low\_confidence and outside\_geofence are warnings too, so a judge can photograph the code anywhere; the hash, reuse, screen-photo and challenge checks still fail hard. Downgraded checks go into verdict.warnings and show in amber on the proof page.

### 6.2 Worker: `plote-verifier`

Public GitHub repo (OutLayer builds from source, so the commit hash *is* the code identity).

```
plote-verifier/
├─ Cargo.toml
├─ src/
│  ├─ main.rs        # read stdin JSON → run checks → print verdict JSON to stdout
│  ├─ fetch.rs       # HTTPS GET (wasi:http)
│  ├─ exif.rs        # time + GPS
│  ├─ geo.rs         # haversine
│  ├─ phash.rs       # perceptual hash + hamming
│  └─ ai.rs          # NEAR AI Cloud vision call
├─ fixtures/          # 12 test photos: 4 real stages, 2 reused, 2 stale, 2 off-site, 2 screen photos
└─ README.md          # how to run locally with wasmtime
```

```toml
[package]
name = "plote-verifier"
edition = "2021"

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
sha2 = "0.10"
hex = "0.4"
kamadak-exif = "0.6"          # pure Rust EXIF reader
image = { version = "0.25", default-features = false, features = ["jpeg", "png"] }
image_hasher = "3"            # pHash family (fork of img_hash); 3.x needs Rust ≥ 1.87
base64 = "0.22"
wstd = "*"                    # wasi:http client for wasm32-wasip2 — pin a version on Day 2
```

Build target: `wasm32-wasip2` (HTTP needs WASI P2). Pure-logic checks (2–6) also build for `wasm32-wasip1`, so if HTTP from the worker turns out to be awkward you can split: fetch in the worker via OutLayer's documented HTTP support, or fall back to 6.6.

**Verify on Day 2 (first thing):** `image`, `image_hasher` and `kamadak-exif` compile for `wasm32-wasip2` with default features off, and the binary runs under OutLayer's instruction limit for a 4000×3000 JPEG. If decoding a full-size photo is too heavy, downscale with `image::imageops::thumbnail` to 512 px before hashing (pHash only needs \~32×32).

### 6.3 Input and output contract

```json
// stdin (input_data)
{
  "evidence_id": 17,
  "url": "https://<project>.supabase.co/storage/v1/object/public/evidence/harmattan-court/17.jpg",
  "sha256": "9f2c…e1",
  "captured_at": 1793740000000000000,
  "device_gps": [6447123, 3474190],
  "now": 1793743600000000000,
  "milestone": "roofing",
  "geofence": { "lat_e6": 6447000, "lon_e6": 3474000, "radius_m": 300 },
  "known_phashes": ["c3a1f0e29b7d4410", "…"],
  "limits": { "max_exif_age_h": 72, "max_phash_distance": 8, "min_ai_confidence": 70 },
  "demo_mode": true,
  "playground": false,
  "challenge": "K7RQ4M",
  "challenge_opened_at": 1793739000000000000
}

// stdout (verdict)
{
  "evidence_id": 17,
  "pass": true,
  "reasons": [],
  "phash": "8e71c0d2a4b39f05",
  "nearest_distance": 27,
  "exif_time": 1793739420000000000,
  "gps": [6447118, 3474201], "gps_source": "exif", "distance_m": 23,
  "ai_stage": "roofing", "ai_confidence": 88, "ai_chat_id": "chatcmpl-…",
  "challenge_read": "K7RQ4M", "warnings": [],
  "worker_commit": "<git sha baked in at build>"
}
```

Keep stdout to this one JSON line. Bake the git commit into the binary with a `build.rs` (`GIT_SHA` env) so the proof page can show it next to OutLayer's attested code hash.

### 6.4 NEAR AI Cloud stage check

- Endpoint: `POST https://cloud-api.near.ai/v1/chat/completions` (OpenAI-compatible).
- Model: `Qwen/Qwen3-VL-30B-A3B-Instruct` (vision). Confirm it's still listed with `GET /v1/models` on Day 1.
- Auth: `Authorization: Bearer $NEAR_AI_API_KEY`, stored as an **OutLayer encrypted secret** so the key never appears on-chain or in the repo.
- Image: pass the public `url` as an `image_url` content part (or a base64 data URL of the downscaled image if the model can't fetch external URLs).
- `temperature: 0`, `max_tokens: 300`, ask for JSON only.

**System prompt**

```
You are a construction-stage inspector for residential buildings in West Africa.
You look at ONE photo and classify the visible construction stage.
Stages, in order:
- "site_clearing": bare or cleared land, no structure
- "foundation": excavation, footings, blinding, foundation walls or ground-floor slab; no walls above knee height
- "walls": block or concrete walls rising, columns, lintels; no roof structure
- "roofing": roof trusses, roof sheets or tiles being installed or complete; windows/finishes absent
- "finishing": plastering, screeding, windows, doors, tiling, painting, electrical/plumbing fixtures
- "complete": finished building, landscaping, ready to occupy
- "not_construction": not a construction site
Also decide whether the image is a photo of a screen, a printout, or a render/CGI.
The photo should show a sheet of paper with a short handwritten or printed code. Copy it exactly, or null if there is none.
Answer with JSON only, no prose:
{"stage": <one of the stages>, "confidence": <0-100 integer>,
 "is_photo_of_screen_or_print": <true|false>, "is_render": <true|false>,
 "challenge_read": <string or null>,
 "observations": [<up to 4 short strings>]}
```

**User message:** `Milestone being claimed: "<milestone>". Classify this photo.` + the image part.

**Stage match table**

| Milestone | Accepted AI stages |
| --- | --- |
| foundation | `foundation`, `walls` |
| roofing | `roofing` |
| finishing | `finishing`, `complete` |
| handover | `complete` |

The worker records `ai_chat_id`. The proof page links to `GET /v1/signature/{chat_id}` so anyone can confirm the answer came from NEAR AI's private inference, and to `/v1/attestation/report` for the model's TEE report. **Verify** the exact query parameters (`model`, `signing_algo`) on Day 3.

### 6.5 Client side (surveyor app) before upload

1. Call `open_capture(milestone)` and show the code in large type: "Write K7RQ4M on paper and keep it in the photo." Count down its 30-minute lifetime.
2. `<input type="file" accept="image/*" capture="environment">` opens the rear camera.
3. Read EXIF in the browser with `exifr` to show the surveyor warnings *before* submitting ("No GPS in photo — turn on location for Camera").
4. Record `navigator.geolocation.getCurrentPosition` (high accuracy) as `device_gps`.
5. Compute SHA-256 with `crypto.subtle.digest` over the **original bytes**. Never re-encode before hashing; the worker must see the same file.
6. Upload original bytes to Supabase Storage via a signed upload URL from `/api/evidence/upload-url` (bucket `evidence`, public read, path `{estate}/{uuid}.jpg`).
7. Call `submit_evidence` with url + sha256 + captured\_at + device\_gps.

**Known gap:** iOS Safari can strip GPS from photos picked through a file input, and some Android camera apps omit EXIF time. The fallback to device GPS keeps the flow working; the proof page shows which source was used. Say this in the pitch — judges respect named limits.

### 6.6 Fallback if yield/resume integration slips

If the on-chain `request_execution` path isn't working by end of Nov 5 (decide early; the end-to-end gate depends on it):

1. The app calls OutLayer's HTTPS API (`POST https://api.outlayer.io/call/<owner>/<project>` with an `X-Payment-Key`) from a Vercel function.
2. It submits the verdict plus OutLayer's attestation to a new method `submit_verdict(evidence_id, verdict, attestation)` callable only by the relayer.
3. The contract stores it as `verdict_source: "https"` and the proof page says so.

This is weaker (the relayer is trusted to pass the result through) but still shows TEE-attested checks. Prefer the yield/resume path; it's the stronger story.

### 6.7 What the proof page shows (`/proof/{estate}/{evidence_id}`)

- The photo, its SHA-256, and "hash matches on-chain commitment ✓".
- Map pin vs geofence circle, distance in metres, GPS source.
- EXIF capture time vs submission time.
- The challenge code issued on-chain next to the code the model read, and when the capture was opened.
- Nearest previous photo and its Hamming distance (thumbnail side by side when < 16).
- AI stage, confidence, observations; links to the NEAR AI signature and attestation.
- Any warnings (demo or playground mode) in amber, and a "Playground" banner on playground proofs.
- Worker repo + commit, OutLayer execution reference, transaction hashes for submit / verdict / QS sign.
- Plain-English verdict: "This photo was taken 23 m from the site, 1 hour before it was submitted, has not been used before, and shows roofing work."

## 7. Payments (USDC, NEAR Intents / 1Click)

### 7.1 Tokens

| Network | Token | Contract | Decimals |
| --- | --- | --- | --- |
| Testnet | Plote mock USDC (ours, open faucet) | `musdc.plote.testnet` | 6 |
| Testnet (optional) | Circle testnet USDC | `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af` | 6 |
| Mainnet | Circle native USDC (NEP-141) | `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` | 6 |

Use native USDC on mainnet, not bridged USDC.e (`a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near`). The estate stores `usdc_id` and rejects any other token in `ft_on_transfer` (`E_BAD_TOKEN`).

Why our own mock on testnet: judges need to buy a unit in two clicks. `musdc.mint({amount})` gives anyone up to 10,000 test USDC per call; the buy page has a "Get test USDC" button.

### 7.2 Path A — NEAR wallet (testnet and mainnet)

1. `estate.reserve({unit_id})` with 0.05 NEAR.
2. If needed, `usdc.storage_deposit` for the buyer (they need to be registered to hold USDC; the app checks `storage_balance_of` first).
3. `usdc.ft_transfer_call({receiver_id: "a-4b.harmattan-court.plote.testnet", amount, msg: ""})` with 1 yoctoNEAR.
4. Unit `ft_on_transfer` `asks estate.on_unit_deposit: the estate keeps the tokens and syncs because the unit is reserved, or bounces them back if nobody reserved it`. NFT mints when the first payment reaches 10% of price.

Steps 1 and 3 are one wallet approval if the wallet supports multi-transaction signing (`signAndSendTransactions`); otherwise two.

### 7.3 Path B — any chain via 1Click (mainnet only)

NEAR Intents has no testnet, so this path runs on mainnet with ≈$2. The buyer never needs a NEAR wallet to pay; they need one only to own the NFT (or the reservation can be made by a relative or by Plote's demo account on their behalf).

**Flow**

```
Buyer picks "Pay from Base / Solana / Ethereum / Arbitrum …"
  → app: GET  /api/oneclick/tokens              (proxy of GET /v0/tokens, cached 10 min)
  → app: POST /api/oneclick/quote  dry:true     (shows "you send X, unit receives Y USDC")
  → buyer confirms
  → app: POST /api/oneclick/quote  dry:false    → returns depositAddress + deadline
  → buyer sends from their own wallet (or scans a QR of depositAddress)
  → app: POST /api/oneclick/submit             (optional: POST /v0/deposit/submit with txHash — speeds detection)
  → app polls GET /api/oneclick/status?depositAddress=… every 5 s
       PENDING_DEPOSIT → KNOWN_DEPOSIT_TX → PROCESSING → SUCCESS | REFUNDED | FAILED
  → on SUCCESS: app calls unit.sync_deposits() (any account; relayer pays gas)
  → estate records the new money; NFT mints if reserved and threshold met
```

**Quote request (wet)**

```json
POST https://1click.chaindefuser.com/v0/quote
Authorization: Bearer <ONECLICK_JWT>      // optional; without it a 0.2% fee applies
{
  "dry": false,
  "swapType": "EXACT_OUTPUT",
  "slippageTolerance": 100,
  "originAsset": "<assetId from /v0/tokens, e.g. USDC on Base>",
  "depositType": "ORIGIN_CHAIN",
  "destinationAsset": "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  "amount": "2000000",
  "refundTo": "<buyer's address on the origin chain>",
  "refundType": "ORIGIN_CHAIN",
  "recipient": "a-4b.harmattan-court.plote.<you>.near",
  "recipientType": "DESTINATION_CHAIN",
  "deadline": "<now + 30 min, ISO 8601>",
  "referral": "plote",
  "quoteWaitingTimeMs": 3000
}
```

**Rules**

- Never hard-code origin asset IDs. Read them from `GET /v0/tokens` (fields include `assetId`, `blockchain`, `symbol`, `decimals`, `price`) and show only stablecoins in the picker (USDC/USDT on Base, Arbitrum, Ethereum, Solana, BNB, Polygon).
- Check the exact field names (`swapType` values, `slippageTolerance` in basis points, status strings) against the OpenAPI spec at `https://1click.chaindefuser.com/docs/v0/openapi.yaml` on Day 8, or use the typed SDK `@defuse-protocol/one-click-sdk-typescript`.
- `EXACT_OUTPUT` so the unit receives a round amount; show the buyer the input including fees.
- The unit account must already be registered on the USDC contract, or delivery fails. `add_units` does this; the payment page double-checks `storage_balance_of(unit)` before quoting.
- Keep the JWT server-side only (Vercel env), never in the browser bundle.
- Cross-chain settlement can take up to \~15 minutes; the reservation TTL on mainnet is 24 h for that reason.
- Show the 1Click explorer link (`https://explorer.near-intents.org/?depositAddress=…`) on the status screen. **Verify** the explorer's URL format on Day 8.
- A delivery that lands after the reservation expired is recorded as unattributed. The status page then offers "Claim my late payment", which calls `sweep_unattributed` and returns the USDC to the buyer's NEAR account within `late_claim_ns` (7 days).

**Payment status page** (`/pay/status/[depositAddress]`): a 4-step tracker (Waiting for deposit → Deposit seen → Swapping → Delivered to unit), the amount, the origin tx, the NEAR tx, and a "Sync now" button.

### 7.4 Path C — chip-in (family wall, C1)

A public link `/w/a-4b?chip=1` lets a relative send USDC to the unit account by either path. With Path A they add a `msg` (`{"from":"Aunty Bisi","note":"For the roof!"}`); with Path B the note is stored in Supabase keyed by depositAddress. Either way the money is credited to the unit (the holder's position) by `sync`. The wall shows notes and amounts; the amounts are read from chain, the names from Supabase.

### 7.5 Outgoing money

- **Release:** unit → developer `payout_id` (USDC on NEAR). Developer can later swap or withdraw via 1Click themselves; that's outside Plote.
- **Refund:** unit → holder's NEAR account. Pitch-only: refund straight to an origin chain using a 1Click `INTENTS`-type quote.
- **Resale:** buyer → estate → seller (+ penalty to developer on default sales).

## 8. Governance (holder votes in the estate contract)

Holders govern their estate inside the estate contract: one vote per allocation token, cast by whoever holds it. A passed vote is the only way to replace the surveyor, veto a sign-off, freeze or unfreeze releases, extend a deadline or (C4) redirect releases to a replacement contractor. Sputnik DAO was dropped: a separate DAO needs its member list synced to NFT ownership, so a sold token kept voting until the next sync. Here the NFT itself is the vote.

### 8.1 Who can do what

| Role | Who | Can do |
| --- | --- | --- |
| holder | any account holding at least one allocation token | Propose any kind; vote once per token it holds |
| developer | `developer_id` | Propose `ExtendDeadline` only; votes only with tokens it holds |
| anyone | — | `expire_proposal` after expiry |

One vote per unit, not per account. Splitting units across accounts can't add votes, and merging them can't lose any. A token allocated after a proposal opened can't vote on it, so buying units mid-vote doesn't swing the result.

### 8.2 Passing rule

- `electorate` = tokens in `Allocated`, `InDefault` or `HandedOver` when the proposal opens.
- Executes the moment `yes × 2 > electorate`. Rejected the moment it can no longer pass (`no × 2 ≥ electorate`).
- Expires after `proposal_period_ns` (demo 10 minutes, real 7 days). A `Veto` proposal also expires at that milestone's `veto_until`.
- One open proposal per account. No bond: only holders and the developer can propose.

### 8.3 Proposals the app offers

| Button in `/estates/[estate]/votes` | `ProposalKind` | Effect when executed |
| --- | --- | --- |
| Replace surveyor | `ReplaceSurveyor { account }` | `surveyor_id` changes; emits `surveyor_changed` |
| Veto this sign-off | `Veto { milestone }` | Milestone → `Vetoed`; evidence must be resubmitted (only during the veto window) |
| Freeze releases | `Freeze { reason, refunds_open }` | `claim_release` panics `E_FROZEN`; refunds open if asked |
| Unfreeze | `Unfreeze` | Lifts the freeze |
| Extend deadline | `ExtendDeadline { milestone, new_deadline }` | Deadline moves; `Missed` → `Open` |
| Step in (C4) | `StepIn { new_payout_id }` | Future releases go to the new account |

```bash
near call harmattan-court.plote.testnet propose \
  '{"kind":{"Freeze":{"reason":"No work on site for 6 weeks","refunds_open":true}}}' --accountId buyer-1.testnet
near call harmattan-court.plote.testnet vote '{"proposal_id":"3","approve":true}' --accountId buyer-2.testnet
```

### 8.4 Guard rails

- The veto window means a bad sign-off can be stopped before money moves; refunds don't need a vote at all (they only need a missed deadline).
- A captured vote (the developer buys many units) can only freeze, extend or swap the surveyor; it can't release money without a verified and signed milestone. Releases still need the TEE check.
- `vote` and `propose` are non-payable, so the login function-call key signs them without a wallet popup.
- Mainnet demo: no votes (Mainnet Lite has no estate contract). The pitch shows testnet votes.

## 9. Identity and access

Plote has no passwords and no user table for auth. Your NEAR account is your identity; your role comes from the estate contract (`developer_id`, `surveyor_id`, NFT holder, which also makes you a voter).

### 9.1 Wallet login

- Library: `@hot-labs/near-connect` (manifest-based wallet connector, wallets run sandboxed) with `near-api-js` for RPC. React hooks via `near-connect-hooks` (`useNearWallet`, `callFunction`, `getBalance`).
- Supported wallets: whatever the near-connect manifest lists (HOT, Meteor, MyNearWallet, Intear, Sender, …). Test at least two on Day 3.
- Networks: `testnet` default; `NEXT_PUBLIC_NETWORK=mainnet` builds the mainnet demo variant.
- Login asks for a **function-call key** for the estate contract (near-connect's function-call-key plugin) so frequent non-payable calls (`sync`, `qs_sign`, `submit_evidence`) don't open the wallet every time. Payable calls (`reserve`, `ft_transfer_call`, `refund`) always go through the wallet.
- Fallback if near-connect gives trouble: `@near-wallet-selector/*` v9 (+ `@near-wallet-selector/modal-ui`).

```ts
// lib/near.ts (sketch)
import { NearConnector } from "@hot-labs/near-connect";
export const connector = new NearConnector({ network: process.env.NEXT_PUBLIC_NETWORK as "testnet" | "mainnet" });
export async function signIn() { const w = await connector.connect(); return w; }
```

Check the exact constructor options and the function-call-key plugin name against the package README on Day 3 — this sketch shows intent, not a pinned API.

### 9.2 Roles in the app

| Role | How the app knows | Unlocks |
| --- | --- | --- |
| Visitor | Not signed in | Landing, check, estates, units, proof, watch, developer score. |
| Buyer / holder | Signed in; `nft_tokens_for_owner` returns tokens | `/me`, unit management, resale, refund, gate pass, votes. |
| Surveyor | `get_estate().surveyor_id == account` | `/qs` capture app. |
| Developer | `get_estate().developer_id == account` | `/dev` console. |
| Voter | Holds a token allocated before the proposal opened (`nft_tokens_for_owner` + `get_unit`) | Proposal and vote buttons. |
| Guard | Anyone with the `/gate/[estate]` link | Scanner page; verification is public, so no login needed. |

The contract enforces every rule; the app only hides buttons that would fail.

### 9.3 Surveyor's scoped key

The surveyor's phone should never hold a key that can move NEAR.

1. Surveyor signs in on a laptop with their full wallet once.
2. `/qs/setup` generates an ed25519 key pair in the phone browser (stored in IndexedDB, non-exportable via WebCrypto where supported, else encrypted with a PIN).
3. The laptop wallet signs `AddKey` on the surveyor's account: function-call permission, `receiver_id: harmattan-court.plote.testnet`, `method_names: ["open_capture", "submit_evidence", "qs_sign"]`, `allowance: 0.25 NEAR`. (Allowance 0 would mean unlimited, so always set one.)
4. The phone now signs **delegate actions** with that key; the relayer submits them and pays gas.

If the phone is lost, the surveyor deletes the key from any wallet; worst case an attacker could submit evidence that still has to pass the TEE check.

### 9.4 Relayer (gasless meta-transactions, NEP-366)

- `POST /api/relay` on Vercel. Body: a borsh-serialised, base64 `SignedDelegate`.
- Server checks: receiver is the estate contract (or a unit account for `sync_deposits`), every action is a `FunctionCall`, method in the allowlist `[open_capture, submit_evidence, qs_sign, sync, sweep_unattributed]`, deposit = 0, gas ≤ 300 Tgas, sender not rate-limited (10 per minute per account, Upstash or in-memory).
- Then wraps it in a transaction from `relayer.plote.testnet` (`actionCreators.signedDelegate`) and sends it with near-api-js.
- Options to save time: the `@near-relay/server` + `@near-relay/client` example packages, or Pagoda's Rust relayer (`/relay`, `/send_meta_tx`, whitelisted-contracts config) on Railway. The plain near-api-js route is ≈ 80 lines and has the fewest moving parts — recommended.
- Wallet connectors don't support "sign a delegate without sending", so meta-transactions are only for keys the app holds (surveyor phone key, the app's own function-call key). Buyers use their wallet normally.

### 9.5 Gate pass (C5)

After handover the NFT opens the estate gate.

1. Holder opens `/me/units/a-4b/pass`. The app asks the wallet to sign a NEP-413 message: `{ message: "plote-gate:harmattan-court:a-4b", recipient: "harmattan-court.plote.testnet", nonce: <32 random bytes> }`. Messages expire after 60 s (timestamp inside the message).
2. The page shows a QR of `{accountId, publicKey, signature, nonce, message}`.
3. Guard's `/gate/harmattan-court` page scans it, verifies the ed25519 signature, checks via RPC that `publicKey` is a full-access key of `accountId` (`view_access_key`) and that `accountId` owns token `a-4b` with status `HandedOver`, and shows a big green ✓ with the unit label. Replayed nonces are rejected (kept in memory/Supabase for 2 minutes).

### 9.6 Privacy

- On-chain: account names, amounts, statuses. No real names, emails or phone numbers.
- Supabase: photos (public by design — they're the proof), chip-in display names the sender typed, optional email for milestone notifications (opt-in, deletable).
- Tell buyers in the FAQ that their account name and amount paid are public, and suggest a new account if they don't want it linked to their other activity.

## 10. Feature specs

Each feature: what it is, the story, how it works, and how you know it's done. IDs match the scope table in section 2.

### Core NFT functions

**M2 · Allocation NFT — one unit, one owner**

- *Story:* As a buyer, I want proof nobody else was sold my flat.
- *How:* token ID = unit ID. `nft_mint` is internal and only runs from `sync` when a reserved unit's first payment clears. Metadata: `title: "Harmattan Court · A-4B"`, `description`, `media` (dynamic SVG), `extra` = JSON `{estate, unit_account, price}`. Standard transfers work, but `nft_transfer` is blocked while a lien exists or a Default listing is open.
- *Done:* a test mints A-4B, a second mint attempt panics `E_UNIT_TAKEN`; the token appears under the buyer in a NEAR wallet.

**M3 · Public "Is unit X taken?"**

- *Story:* As a buyer being offered "the last unit in Block A" on WhatsApp, I want to check in 5 seconds without signing up.
- *How:* `/check` with one input. Accepts `a-4b`, `A-4B`, full account `a-4b.harmattan-court.plote.testnet`, or a pasted Plote URL. View call `is_taken`. Big answer card: **TAKEN** (holder account, paid %, since date) / **RESERVED** (until time) / **AVAILABLE** (price, "Reserve" button) / **NOT A PLOTE UNIT** (warning: "This estate doesn't use Plote escrow. Ask the developer why.").
- *Done:* works on a phone, logged out, under 1 s on testnet RPC.

**M4 · Reserve → pay → mint** — see 7.2. *Done:* new wallet goes from zero to holding the NFT in under 2 minutes using the in-app test USDC faucet.

**M5–M7 · Milestones, evidence, sign-off, release** — see 5.3 and section 6.

- *Done:* on the demo estate, uploading a valid roofing photo leads to `Verified` within \~1 minute; QS signs; after the 2-minute demo veto window the developer's claim moves exactly 30% of each unit's paid amount (capped at price) to the payout account. Balances on NearBlocks match the unit page.

**M8 · Refund**

- *Story:* As a buyer, if the roof isn't up by the promised date, I want my unreleased money back without asking anyone.
- *How:* the unit page shows a countdown to "refunds open" (deadline + grace). When `refundable_now > 0`, a red "Get my money back" button calls `refund`. Confirmation shows exact amount and that the NFT will be burned.
- *Done:* demo estate unit B-2A has a missed finishing deadline; refund returns paid − released to the holder and the unit shows AVAILABLE again.

**S4 · Atomic resale** — see 5.5. Listing card on `/market` and on the unit page: ask, paid so far, what the buyer inherits ("remaining balance ₦/$, next instalment due"). *Done:* one transaction moves USDC buyer → seller and the NFT seller → buyer; escrow balance unchanged.

**S5 · Default → auto-resale with a fixed penalty**

- *Story:* As a buyer who lost my job, I don't want to lose everything I've paid.
- *How:* missed instalment + `default_grace` → anyone can call `declare_default`. Unit goes `InDefault` and gets a Default listing at `ask = paid`. The next buyer takes over the position. The defaulter receives `paid − 5%`; the 5% goes to the developer for the hassle. The unit page explains this in one sentence before the buyer ever signs.
- *Done:* test shows defaulter receives 95% of paid, developer 5%, new holder has `paid` credit and the old plan's remaining instalments.

**S6 · Holder votes** — see section 8. *Done:* in the demo, two holders vote to replace the surveyor; the next `qs_sign` from the old surveyor panics `E_NOT_SURVEYOR`.

**C9 · Post-handover account** — after `HandedOver`, the unit account keeps receiving USDC for service charge; the estate pays the facility manager via a holder-approved `Transfer`-style function call. Pitch + one screen only.

### Winning features

**M6/S1 · TEE-checked milestone photos** — section 6. The proof page is the demo moment.

**S2 · Any-wallet deposit route per unit** — section 7.3. Every unit page has "Pay from another chain" showing supported chains as chips.

**S7 · Developer track-record score**

- *Story:* As a buyer choosing between two developers, I want a number I can trust more than a brochure.
- *How:* computed in the app from on-chain `dev_stats` (per estate) summed across all Plote estates where `developer_id` matches. The list of estates comes from `plote.testnet` registry view `list_estates()` (estates call `register` at init) or, if the registry slips, from `config/estates.json`.

| Component | Weight | Formula |
| --- | --- | --- |
| On-time delivery | 40 | milestones approved by deadline ÷ milestones due |
| Refund-free | 25 | 1 − units refunded ÷ units sold |
| Clean evidence | 15 | evidence passed ÷ evidence submitted |
| No vetoes | 10 | 1 − vetoed sign-offs ÷ sign-offs |
| Track length | 10 | min(1, units handed over ÷ 20) |

Shown as a 0–100 score with each component's bar and the raw counts. Fewer than 4 milestones due → badge "New on Plote" instead of a score. *Done:* `/developers/[account]` renders the breakdown and links every number to its source.

### Fun features

**S3 · Dynamic NFT image** — 5.11. Visual: a minimal isometric house outline whose parts fill in teal as milestones are approved (foundation slab → walls → roof → windows lit in gold at handover). Status badge top-right, `A-4B` in monospace, progress `2/4`.

**S8 · "Watch my house" page** — `/w/[estate]/[unit]`, public, no login. Vertical timeline of milestones with photos, verdict chips ("23 m from site · not reused · roofing 88%"), paid/released bars, and a share button. OG image (1200×630) via `next/og` so WhatsApp and X show the house drawing, progress and estate name. *Done:* pasting the link into WhatsApp shows the card.

**C1 · Family chip-in wall** — 7.4. Cards with name, amount, note, date; total contributed by family vs holder.

**C6 · Handover timelapse** — at handover, `/w/…/timelapse` plays all milestone photos in order with dates (CSS crossfade; optional MP4 via ffmpeg.wasm for download).

**C7 · Milestone celebration** — when a milestone the holder paid into is approved, their next visit shows a full-screen moment: the NFT image animating the new part, "Your roof is on. 50% built.", confetti in brand colours, share button. Optional email via Resend.

**C8 · Vanity unit names** — at reservation, a holder may pick a display alias (`the-adeyemis`). Stored in metadata `extra.alias`; the account name stays `a-4b` (renaming accounts isn't possible). Shown on the watch page.

**C5 · Gate pass QR** — 9.5.

### Stretch safety features

**C2 · Next-of-kin and guardian recovery** — holder sets a `beneficiary` and up to 3 `guardians`. If the holder loses access, 2 of 3 guardians call `guardian_recover(unit_id, new_owner)`; a 72 h delay lets the holder cancel. *Done:* test recovers a token after two guardian calls and the delay.

**C3 · Lender lien flag** — a mortgage lender can be set as `lien`. While set: no transfer, no listing, and refunds go to the lender up to an amount they set. Only the lender clears it.

**C4 · Step-in rights** — holders pass a `Freeze`, then `StepIn { new_payout_id }`; future releases go to the replacement contractor's account. Milestones resume with a new surveyor.

### Small details that make it feel finished

- `submit_evidence` also takes `device_gps: Option<(i32, i32)>` (from 6.5).
- Every amount shows USDC and, greyed, an approximate naira value (rate from a public FX API, cached 1 h, labelled "approx.").
- Every on-chain number has a tiny "↗" linking to NearBlocks (testnet or mainnet).
- Error codes map to plain sentences (`E_UNIT_TAKEN` → "Someone already holds this unit.").

## 11. Brand and logo

### 11.1 Brand core

- **Name:** Plote (rhymes with "note"). From *plot* — the piece of land, and the storyline of a build. Always written "Plote", never all-caps in sentences.
- **Concept line:** Plotline — every off-plan home gets its own on-chain account.
- **Tagline (primary):** *Pay for the house you can see.*
- **Alternates:** "Your deposit, in its own account." · "Escrow you can check from London." · "One unit. One owner. Proof at every floor."
- **Voice:** calm, exact, on the buyer's side. Short sentences. Numbers over adjectives. Never "revolutionary", "web3", "trustless" in customer copy; say what happens to the money instead.
- **Audience feeling:** relief. "Finally, I can check."

### 11.2 Visual system

Dark, precise, terminal-inspired, warm enough for a family's biggest purchase. The signature device is the **survey beacon**: Nigerian survey plans mark plot corners with numbered beacons. Plote draws every card, photo frame and the logo with four corner brackets instead of full borders — a plot boundary.

| Token | Hex | Use |
| --- | --- | --- |
| `--bg` | `#0A0B0D` | Page background (near-black) |
| `--surface` | `#111317` | Cards |
| `--surface-2` | `#171A1F` | Inputs, hover |
| `--line` | `#252A31` | Hairlines, brackets (idle) |
| `--text` | `#E9ECEF` | Primary text |
| `--muted` | `#8B939D` | Secondary text |
| `--teal` | `#2DD4BF` | Primary action, verified, progress |
| `--teal-dim` | `#134E48` | Teal fills at low emphasis |
| `--gold` | `#E8B04B` | Value, handover, celebrations (use sparingly) |
| `--red` | `#F06A6A` | Refund open, fail reasons, danger |
| `--amber` | `#F2A93B` | Pending, reserved, veto window |

Contrast: `--text` on `--bg` ≈ 17:1; `--muted` on `--bg` ≈ 6.6:1; teal on bg ≈ 10:1 — all pass WCAG AA. Light mode is not required for the hackathon; ship dark only and say so.

**Type**

- Display / headings: **Space Grotesk** 500–700 (Google Fonts).
- Body: **Inter** 400/500.
- Data, account names, amounts, labels, buttons: **JetBrains Mono** 400/600. Amounts always mono with tabular figures.
- Scale: 56 / 40 / 28 / 20 / 16 / 14 / 12. Line height 1.2 headings, 1.6 body.

**Shape and motion**

- Radius 2 px (nearly square — surveyed land, not bubbles). Corner brackets 12 px long, 1.5 px stroke; turn teal on hover/focus.
- Grid background on hero only: 24 px dotted grid at 6% opacity, like survey paper.
- Motion: 150 ms ease-out for UI; the milestone celebration is the only big animation. Respect `prefers-reduced-motion`.
- Icons: Lucide, 1.5 px stroke.

### 11.3 The mark

**Idea:** a plot seen from above. Four survey-beacon corner brackets frame a square; inside, the negative space between a vertical stroke and a small filled square in the upper-right reads as a geometric **P**. The filled square is the unit — "your unit, inside a surveyed boundary". It works at 16 px (favicon) because it's just brackets and one block.

**Wordmark:** "plote" in lowercase Space Grotesk Medium, tracking −2%, with the "o" replaced by a small square outline with corner gaps (a mini plot). Lockups: mark + wordmark horizontal; mark alone for app icon, favicon, NFT corner stamp.

**Hand-built fallback (SVG, 64×64)** — so you don't depend on an image generator:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <!-- survey-beacon corners -->
  <path d="M6 18V6h12M46 6h12v12M58 46v12H46M18 58H6V46" stroke="#2DD4BF" stroke-width="4" stroke-linecap="square"/>
  <!-- P: stem + bowl block -->
  <rect x="20" y="18" width="6" height="28" fill="#E9ECEF"/>
  <rect x="26" y="18" width="18" height="16" fill="#E9ECEF"/>
  <rect x="32" y="24" width="6" height="4" fill="#0A0B0D"/>
  <!-- the unit: one gold beacon point -->
  <rect x="40" y="40" width="6" height="6" fill="#E8B04B"/>
</svg>
```

### 11.4 World-class logo prompt

Use with a vector-capable generator (Recraft V3 in "Vector art / Logo" style is best for clean SVG output; Ideogram 3 for wordmarks with correct letters; Midjourney v7 for exploration). You can also run the exploration prompt through NEAR AI Cloud's image model (`black-forest-labs/FLUX.2-klein-4B` on `/v1/images/generations`) — a nice "made with NEAR" touch for the README, but finalise in vector.

**Primary prompt**

```
A minimalist, geometric logo mark for "Plote", a fintech product that holds home buyers' deposits in escrow for off-plan apartments in Lagos.
Concept: a land plot seen from directly above, defined only by four sharp corner brackets like survey beacons on a land survey plan.
Inside the boundary, negative space and one solid square form an abstract, architectural capital letter "P".
A single small square accent in warm gold sits at one inner corner, representing one housing unit.
Style: Swiss modernism meets surveyor's blueprint. Flat vector, perfectly even stroke weight, square line caps, strict 8-unit grid, generous negative space, no gradients, no shadows, no 3D.
Colours: teal #2DD4BF brackets, off-white #E9ECEF letterform, gold #E8B04B accent, on a near-black #0A0B0D background.
Must read clearly at 16 pixels. Centered, icon only, no text, crisp edges, logo design sheet quality, award-winning brand identity, by a top-tier identity studio.
```

**Wordmark prompt**

```
Wordmark logo reading exactly "plote" in lowercase, geometric grotesk sans-serif similar to Space Grotesk Medium, slightly tight letter spacing.
The letter "o" is replaced by a small square drawn with four corner brackets only (gaps at the middle of each side), like a surveyed land plot.
Off-white #E9ECEF letters, teal #2DD4BF on the bracket-square, near-black #0A0B0D background. Flat vector, no effects, perfect kerning, horizontal lockup with generous clear space.
```

**Variation prompts** (run 2–3 seeds each)

1. *Beacon pillar:* "…replace the gold square with a tiny survey beacon pillar seen from above (a square with a dot), keep everything else…"
2. *Key notch:* "…the bowl of the P has a subtle key-tooth notch on its right edge, hinting that the token is a key…"
3. *Floor stack:* "…the P's stem is made of four stacked horizontal bars of equal height with 1-unit gaps, representing four construction milestones…"

**Negative prompt** (where supported)

```
house silhouette, roof chevron, chimney, keyhole cliche, blockchain cubes, chain links, coins, hexagons, gradients, glow, bevel, 3D, photorealism, mockup, extra letters, misspelled text, thin hairlines, busy details, clip art
```

**Selection checklist:** reads at 16 px · still recognisable in one colour · no house cliché · the P is findable in under 2 seconds · brackets align to the grid · works on white too (invert to `#0A0B0D` on `#FFFFFF`). Trace the winner in Figma (or let Recraft export SVG), snap to a 64-unit grid, export `logo.svg`, `mark.svg`, `favicon.ico` (16/32/48), `apple-touch-icon.png` (180), `og-default.png` (1200×630).

### 11.5 Other generated assets

- **Hero visual:** an isometric line drawing of a 4-storey apartment block on a dotted survey grid, drawn in 1.5 px teal lines, three floors solid and the top floor dashed ("not yet built"), with corner beacons at the plot boundary. Prompt: *"Isometric technical line drawing of a four-storey residential apartment block on a dotted blueprint grid, thin teal (#2DD4BF) lines on near-black (#0A0B0D), lower three floors drawn solid, top floor drawn as dashed outline under construction, four survey-beacon corner brackets marking the plot, minimal, architectural, no people, no text."* Better: build it as an SVG component so floors can animate in as you scroll.
- **NFT art:** the dynamic SVG from 5.11 (isometric house that fills in per milestone). No generator needed.
- **Estate cover photos:** use your own or royalty-free construction photos (Unsplash/Pexels licence); label them "illustrative" on the demo estate.

## 12. Landing page (`/`)

One long page, dark, built from the design system in 11.2. Every number on it is read live from the chain — no invented stats. Copy below is final; layout notes are in *italics*.

### Meta

- `<title>`: Plote — Pay for the house you can see
- Description: Plote holds your off-plan deposit in its own on-chain account and releases it to the developer only when each construction stage is proven. Check any unit in seconds.
- OG image: mark + "Pay for the house you can see." + the isometric block, 1200×630.

### 1 · Nav

*Sticky, 64 px, blurred `--bg` at 80%.* Logo · How it works · Check a unit · Estates · For developers · FAQ · **\[Connect wallet\]** (mono, bracket button). Network pill on the right: `● TESTNET`.

### 2 · Hero

*Left: copy. Right: the isometric apartment block, floors drawing in one by one on load, gold dot on unit 4B. Dotted survey grid behind.*

- Eyebrow (mono, teal): `OFF-PLAN ESCROW · BUILT ON NEAR`
- H1: **Pay for the house you can see.**
- Sub: Plote gives every off-plan unit its own account. Your money waits there and moves to the developer only when a photo of the next stage passes an independent check. If the build stalls, you take it back.
- Primary CTA: **\[Check a unit →\]** · Secondary: **\[See a live estate\]**
- Inline check (under CTAs): input `a-4b.harmattan-court` + button `Check` → result chip appears in place.
- Trust line (muted, mono): `Escrow per unit · One owner per unit · Refunds you trigger yourself`

### 3 · Live strip

*Four mono counters with tiny ↗ links to NearBlocks. Values from `list_units` and `dev_stats` across demo estates.*

`UNITS ON PLOTE  24` · `USDC IN ESCROW  $41,200` · `MILESTONES VERIFIED  7` · `REFUNDS PAID  1`

Caption: "Live from NEAR testnet. Every number links to the chain."

### 4 · The problem

- H2: **Off-plan is a promise. Plote makes it a receipt.**
- Three cards (corner brackets, red icon):
  1. **Sold twice.** Some developers sell the same unit to more than one buyer. You find out at handover.
  2. **Paid upfront, built never.** Instalments go straight to the developer. When a project stalls, the money's already spent.
  3. **Photos from far away.** If you live abroad, you judge progress from WhatsApp pictures that could be from anywhere, or from last year.
- Source line (muted): links to TechEconomy, Nigeria Housing Market, allAfrica, Guardian Nigeria, Nation (Kenya).

### 5 · How it works

*Four steps on a horizontal track; on mobile, vertical. Each step has a small animated illustration.*

- H2: **Four steps. No middleman holding your money.**

1. **Reserve your unit.** Each unit has its own address, like `a-4b.harmattan-court`. Reserve it and it's locked for you.
2. **Pay into the unit, not the developer.** Pay from a NEAR wallet, or send USDC from Base, Solana, Ethereum and more. The money sits in the unit's own account. You get the allocation token — the only one that unit will ever have.
3. **Every stage is proven.** The surveyor uploads a site photo. It's checked inside secure hardware: taken on site, taken this week, never used before, and showing the right stage. Then the surveyor signs.
4. **Money moves only on proof.** Each verified stage releases its share — 20%, 30%, 30%, 20%. Miss a deadline and you can take back everything not yet released. One tap.

### 6 · The token that does something

- H2: **Your token isn't a picture. It's the unit.**
- Sub: Hold it and you hold the money, the vote and the keys.
- Grid of 6 cards:
  - **Holds the money** — your payments sit in the unit's account until a stage is proven.
  - **Gets you refunds** — if a deadline passes, the token is what lets you pull your money back.
  - **Sells in one step** — list it; a buyer pays, you're paid and the token moves in a single transaction.
  - **Protects you if you fall behind** — miss instalments and it's resold for what you paid, minus a fixed 5%. Not forfeited.
  - **Gives you a vote** — one per unit: replace the surveyor, veto a sign-off or freeze payments.
  - **Opens the gate** — after handover, it's your gate pass and service-charge account.
- *Right side: the live NFT image of A-4B, with a toggle "Show at: Foundation / Roofing / Finishing / Handover" that redraws it.*

### 7 · Proof, not promises

*Show one real proof card from the demo estate.*

- H2: **See exactly why money moved.**
- Proof card: photo · `✓ Taken 23 m from site` · `✓ Taken 1 h before upload` · `✓ Never used before (nearest match 27/64)` · `✓ Shows roofing — 88% confidence` · `✓ Signed by QS Adaeze O.` · `Released $1,200 from 4 units`.
- Small print: "Checked inside an Intel TDX enclave on OutLayer, with stage recognition by NEAR AI Cloud. The code that checks it is public, and its fingerprint is on-chain."
- CTA: **\[Open the full proof →\]**

### 8 · Pay from wherever you are

- H2: **In London, Houston or Toronto? Pay the way you already do.**
- Body: Send USDC or USDT from the chain you use. Plote swaps it and delivers USDC straight into your unit's account. No exchange account in Nigeria, no wire to a stranger.
- Chain chips (from `/v0/tokens`, filtered): Base · Arbitrum · Ethereum · Solana · BNB · Polygon · NEAR
- Footnote: "Cross-chain payments use NEAR Intents. They can take up to 15 minutes."

### 9 · Watch your house

- H2: **Share the build with the whole family.**
- Body: Every unit has a public page with each stage's photo and proof. Send it to your mum on WhatsApp. Let your siblings chip in toward the roof.
- *Phone mockup showing the WhatsApp preview card and the watch page timeline.*
- CTA: **\[See an example\]**

### 10 · For developers

- H2: **Honest developers finally have a way to prove it.**
- Bullets: Public escrow is a sales tool — buyers can check you in seconds. · Get paid per stage, automatically, the moment it's proven. · Your on-time record becomes a public score. · Diaspora buyers can pay you from any chain.
- CTA: **\[Open the developer console\]** · Link: "Read the contract →"

### 11 · For surveyors

- H2: **Your sign-off, on the record.**
- Body: Snap the site photo on your phone. Plote checks it and you sign. Your key can only sign milestones — it can't move money.

### 12 · Built on NEAR

*Mono logo row + one line each.*

- **Accounts per unit** — each home is a named NEAR account.
- **NEAR Intents** — pay from other chains.
- **OutLayer** — photo checks run in secure hardware, attested on-chain.
- **NEAR AI Cloud** — private, verifiable stage recognition.
- **Holder votes** — one vote per unit, cast with the NFT.
- Link: "Read the build spec and code on GitHub →"

### 13 · What Plote is not

*Plain, bordered box. This section builds trust.*

- H2: **What Plote doesn't do.**
- Plote is not your land title. Always check the C of O or governor's consent with a lawyer.
- Plote can't stop a developer who refuses to use it. Ask your developer why they don't.
- The surveyor is a real person. Plote checks their photos and lets holders replace them, but it doesn't remove the need for one.
- Today Plote works in USDC. Naira payments are on the roadmap.

### 14 · FAQ

- **Where is my money, exactly?** In your unit's own NEAR account, e.g. `a-4b.harmattan-court.plote.near`. Anyone can look it up.
- **Can Plote take my money?** No. Plote's servers don't hold any key that can move it. Only the estate contract's rules can, and those rules are public.
- **What if the developer disappears?** When a deadline passes without a verified stage, you can refund everything not yet released.
- **Doesn't the developer need money to start building?** An estate can release a fixed mobilisation share (up to 10%) when a unit is allocated. Everything else waits for a proven stage.
- **What if I can't keep paying?** Your unit is listed for what you've paid. When it sells, you get that back minus a fixed 5%.
- **What does it cost me?** Nothing on top of the price during the pilot. You pay a small network fee for each transaction (fractions of a cent).
- **Is my name public?** Your account name and amounts are public. Your real name isn't stored on-chain.
- **Why one vote per unit and not per account?** Each unit is one stake. Splitting units across accounts can't add votes, and units bought after a vote opens can't swing it.
- **Is this live?** The hackathon build runs on NEAR testnet, with a real cross-chain payment demonstrated on mainnet.

### 15 · Final CTA

- H2: **Check a unit before you pay for it.**
- Input + **\[Check\]** (same as hero). Under it: "Developer? **Put your estate on Plote →**"

### 16 · Footer

Mark + "Plote — every off-plan home, its own account." · Links: How it works, Estates, Developers, Proofs, GitHub, Build spec, Status (`/status`) · "Built for NEAR HACKATHON 2026 · MIT licence" · Network switch (testnet / mainnet demo) · "Not financial or legal advice."

## 13. App frontend — every page

### 13.1 Stack

| Concern | Choice |
| --- | --- |
| Framework | Next.js (App Router, current stable) + TypeScript, React Server Components for public pages |
| Styling | Tailwind CSS v4 + CSS variables from 11.2; shadcn/ui primitives restyled (radius 2 px, bracket borders) |
| Wallet | `@hot-labs/near-connect` + `near-connect-hooks`; `near-api-js` v7 for RPC/views |
| Data | TanStack Query (5 s refetch on pages with pending state); a typed `lib/estate.ts` client per contract method |
| Forms | react-hook-form + zod |
| Images | `exifr` (client EXIF), `next/og` (OG + NFT fallback PNG) |
| QR | `qrcode` (render), `@zxing/browser` (scan) |
| Charts | none heavy; progress bars are plain SVG |
| Motion | Framer Motion for the hero and celebration only |
| Hosting | Vercel (Hobby); Supabase (Storage + Postgres cache) |

**Shared components:** `BracketCard`, `MonoAmount` (USDC + approx ₦), `AccountChip` (truncate middle, copy, NearBlocks ↗), `StatusBadge` (Available/Reserved/Taken/In default/Handed over), `MilestoneTrack` (4 segments), `ProofChecklist`, `TxToast` (pending → success with tx link → error with plain message), `NetworkPill`, `EmptyState`, `CountdownChip`, `HouseNFT` (renders the same SVG the contract produces, client-side, for instant preview).

**Every page has:** loading skeleton in brackets, an error state with the raw error code collapsible, mobile layout (most diaspora users are on phones), and a NearBlocks link for every on-chain number.

### 13.2 Sitemap

```
PUBLIC (no login)
/                                   Landing
/check                              Is unit X taken?
/estates                            Estate directory
/estates/[estate]                   Estate overview
/estates/[estate]/units/[unit]      Unit detail (buy, pay, status)
/estates/[estate]/milestones        Milestone timeline for the estate
/proof/[estate]/[evidenceId]        Proof page for one photo
/w/[estate]/[unit]                  Watch my house (shareable)
/w/[estate]/[unit]/timelapse        Handover timelapse (C6)
/market                             Resale and default listings
/developers/[account]               Developer track record
/how-it-works                       Long-form explainer
/faq                                FAQ
/status                             System status (RPC, OutLayer, NEAR AI, 1Click)
/gate/[estate]                      Guard scanner (C5)

BUYER (wallet)
/buy/[estate]/[unit]                Reserve → pay wizard
/pay/status/[depositAddress]        1Click payment tracker
/me                                 My units
/me/units/[estate]/[unit]           Manage a unit (pay, refund, sell, beneficiary, lien)
/me/units/[estate]/[unit]/pass      Gate pass QR (C5)
/faucet                             Get test USDC (testnet only)

VOTES (holder)
/estates/[estate]/votes             Proposals + vote
/estates/[estate]/votes/new         New proposal

DEVELOPER
/dev                                Developer console home
/dev/estates/new                    Create estate wizard
/dev/estates/[estate]               Manage units, schedule, budget
/dev/estates/[estate]/releases      Claim releases

SURVEYOR
/qs                                 Surveyor home (my estates, pending milestones)
/qs/setup                           Install phone key
/qs/[estate]/capture                Capture + submit evidence
/qs/[estate]/sign                   Review verdict + sign

API (Vercel functions)
/api/relay  /api/evidence/upload-url  /api/oneclick/{tokens,quote,submit,status}
/api/og/unit  /api/meta/[estate]/[unit]  /api/cron/poll
```

### 13.3 Public pages

**`/check`** — one input, auto-focus. Accepts unit ID, account, or URL. Result card states: TAKEN (holder, paid %, since, "View unit"), RESERVED (until, countdown), AVAILABLE (price, "Reserve"), HANDED OVER, NOT A PLOTE UNIT (red warning card with "What to ask your developer" list). Recent checks kept in localStorage (wrapped in try/catch). Share result button.

**`/estates`** — grid of `BracketCard`s: cover image, name, location, developer score chip, units sold/total, current milestone, escrow total. Filter: city, stage. MVP has 1–2 estates.

**`/estates/[estate]`** — header (name, location map pin, developer, surveyor, votes link, contract ↗); `MilestoneTrack` with dates and status; unit grid (floor-plan style: blocks as columns, units as cells coloured by status, click → unit); escrow summary (total paid, released, refundable now); recent activity (events); "Freeze active" red banner if frozen.

**`/estates/[estate]/units/[unit]`** — left: dynamic NFT image, label, status, price. Right: if Available → **Reserve**; if Reserved by you → pay options (NEAR wallet / other chain); if Taken → holder, paid bar, released bar, refundable now, next instalment, listing if any (Buy button). Tabs: Timeline · Payments (from events) · Proofs · Contract (account, code hash, balances).

**`/estates/[estate]/milestones`** — vertical list; each milestone: share %, deadline, status, evidence thumbnails with pass/fail chips, QS sign-off, veto window countdown, release totals.

**`/proof/[estate]/[evidenceId]`** — section 6.7. Layout: large photo with bracket frame; checklist; map (static OpenStreetMap tile + circle; no API key) ; side-by-side nearest previous photo; AI panel; "How to verify this yourself" collapsible with links (OutLayer execution, worker commit, NEAR AI signature, tx hashes).

**`/w/[estate]/[unit]`** — public, minimal chrome, large type. House image, "A-4B at Harmattan Court is 50% built", timeline with photos, paid vs released, family wall (C1), share buttons (WhatsApp deep link `https://wa.me/?text=`, X intent, copy). `generateMetadata` uses `/api/og/unit` for the card.

**`/market`** — table/cards of listings: unit, estate, ask, paid so far, what you inherit, kind (Voluntary / Default with explainer chip), Buy button → wallet `ft_transfer_call`.

**`/developers/[account]`** — score dial, five component bars with raw counts, list of estates with outcome per milestone, "How this score works" link.

**`/how-it-works`** — long-form explainer with the architecture diagram, money-flow table, and "What Plote is not".

**`/status`** — green/amber/red for: NEAR RPC, estate contract view, OutLayer (last verdict time), NEAR AI (`/v1/models` reachable), 1Click (`/v0/tokens` reachable), Supabase. Handy during judging.

**`/gate/[estate]`** — full-screen camera scanner; result screen huge ✓ or ✕ with unit label and reason.

### 13.4 Buyer pages

**`/buy/[estate]/[unit]`** — 3-step wizard:

1. **Reserve** — explains 0.05 NEAR storage deposit (refundable) and the reservation timer. Button → `reserve`.
2. **Pay** — choose amount (min 10% of price; presets: 10%, 25%, full) and method:
   - *NEAR wallet:* checks USDC registration, then `ft_transfer_call` to the unit account. Testnet shows "Need test USDC? \[Get 5,000\]".
   - *Another chain:* chain/token picker (from `/api/oneclick/tokens`), dry quote shown live, then wet quote → deposit address + QR + copy + countdown → redirect to `/pay/status/...`.
3. **Done** — NFT reveal animation, "Share your house" (watch link), "Set a beneficiary" nudge.

**`/pay/status/[depositAddress]`** — 4-step tracker, auto-sync on SUCCESS, refund explanation on REFUNDED/FAILED, 1Click explorer link.

**`/me`** — cards for each held unit: NFT image, estate, % built, paid/price, next instalment due (amber if < 7 days, red if overdue), refundable now (red badge), quick actions: Pay, Watch page, Sell, Refund. Empty state: "No units yet. \[Check a unit\]".

**`/me/units/[estate]/[unit]`** — sections: Overview · Pay instalment · Refund (shows rule and countdown, or the button) · Sell (set ask, see fees: none for voluntary) · Beneficiary & guardians (C2) · Lien (C3) · Notifications (email opt-in) · Danger zone (cancel listing). Celebration overlay (C7) on first visit after a new approval.

**`/me/units/.../pass`** — signs NEP-413, shows rotating QR (refresh every 50 s), brightness hint.

**`/faucet`** — register on `musdc` if needed, then `mint(5_000_000_000)`; testnet only (hidden on mainnet build).

### 13.5 Vote pages

**`/estates/[estate]/votes`** — open and past proposals (kind, status, yes/no against the electorate, time left), your eligible tokens for each, and Vote yes / Vote no buttons calling `vote` (signed by the login function-call key, no popup).

**`/estates/[estate]/votes/new`** — templates from 8.3 (Replace surveyor, Veto sign-off, Freeze, Unfreeze, Extend deadline, Step in). Each template is a small form with a preview of the exact `propose` arguments. Only holders, and the developer for Extend deadline, see the button.

### 13.6 Developer console

**`/dev`** — your estates, totals (escrow, releasable now, refunds risk = units whose next milestone is within 14 days of deadline), verification budget, quick links.

**`/dev/estates/new`** — wizard: details (name, slug → account preview, location pin + geofence radius), milestones (4 rows, % must sum to 100, deadlines), roles (payout account, surveyor account), params (demo mode toggle), review → instructions to run `scripts/deploy-estate.ts` (MVP; one-click factory is pitch-only). Show estimated NEAR needed.

**`/dev/estates/[estate]`** — units table with inline add (ID, label, price, instalment plan builder), `add_units` in batches of 8; verification budget top-up; activity.

**`/dev/estates/[estate]/releases`** — table per unit: paid, approved %, released, releasable now; select all → `claim_release` in chunks of 20; history.

### 13.7 Surveyor app (mobile-first, installable PWA)

**`/qs`** — estates where you're the surveyor; for each, next milestone, status, deadline. Big "Capture" button.

**`/qs/setup`** — section 9.3 flow with a 3-step checklist and a test signature.

**`/qs/[estate]/capture`** — milestone picker → challenge code from open\_capture in large type → camera → preview with live pre-checks (EXIF time present, GPS present and inside geofence — shown as a mini map) → upload progress → "Checking in secure hardware…" with a live log ("hash ✓ → EXIF ✓ → location ✓ → not reused ✓ → AI: roofing 88% ✓") as events arrive → verdict.

**`/qs/[estate]/sign`** — verified milestones awaiting signature; proof summary; "I inspected this site in person on \[date\]" checkbox; **Sign** → `qs_sign` via relayer.

### 13.8 Mobile and accessibility

- Breakpoints 375 / 768 / 1280. Unit grid becomes a list on mobile.
- Tap targets ≥ 44 px. Focus rings teal 2 px. All status uses text + icon, never colour alone.
- Amounts: `aria-label` with full words ("1,200 US dollars").
- Lighthouse targets: Performance ≥ 90 on landing, Accessibility ≥ 95 everywhere.

### 13.9 Demo data

Seed the demo estate so every page has something real to show: 6 units (2 available, 1 reserved, 2 taken with payments, 1 in a missed-deadline state for the refund demo), milestones 1–2 approved with real photos, one failed evidence (reused photo) to show a red proof page. Landing counters read these live; until seeding is done they show `—` rather than made-up numbers. Seed the playground with 60 available units, one passed proof and one failed proof. The surveyor name in the landing proof card is the demo surveyor account's display name.

## 14. Off-chain services

The off-chain side is deliberately thin: Vercel functions plus one Supabase project. If every one of them went down, money would still be safe and every rule would still hold; only convenience would be lost.

### 14.1 API routes

| Route | Method | Purpose | Auth / limits |
| --- | --- | --- | --- |
| `/api/relay` | POST | Submit a `SignedDelegate` as a meta-transaction (9.4). | Method allowlist, 0 deposit, 10/min/account. |
| `/api/evidence/upload-url` | POST `{estate, contentType, size}` | Returns a Supabase signed upload URL + final public URL. | Caller must sign a NEP-413 message proving they're the estate's surveyor (checked against `get_estate`). Max 12 MB, \`image/jpeg |
| `/api/oneclick/tokens` | GET | Proxy + 10-min cache of `GET /v0/tokens`, filtered to stablecoins. | Public. |
| `/api/oneclick/quote` | POST | Proxy of `POST /v0/quote`; adds JWT; forces `destinationAsset` = USDC and `recipient` = a real unit account (checked with `is_taken`). Stores wet quotes in `oneclick_quotes`. | Public, 20/min/IP. |
| `/api/oneclick/submit` | POST `{depositAddress, txHash}` | Proxy of `POST /v0/deposit/submit`. | Public. |
| `/api/oneclick/status` | GET `?depositAddress=` | Proxy of `GET /v0/status`; on `SUCCESS` triggers `unit.sync_deposits()` via the relayer key once. | Public. |
| `/api/og/unit` | GET `?estate=&unit=` | 1200×630 PNG for WhatsApp/X cards (`next/og` `ImageResponse`). | Public, edge-cached 60 s. |
| `/api/meta/[estate]/[unit]` | GET | NEP-177 `reference` JSON (latest photo, stage, links). | Public. |
| `/api/notify` | POST | Opt-in email on milestone events (Resend free tier). | Signed NEP-413 from the subscriber. |
| `/api/cron/poll` | GET | Pulls recent estate transactions, parses `EVENT_JSON` logs into `events`, sends notifications. | Secret header; called by a GitHub Actions schedule every 5 minutes (Vercel Hobby cron is too infrequent). |

All routes: zod-validated bodies, JSON errors `{code, message}`, no secrets in responses.

### 14.2 Supabase schema

```sql
-- photos (bucket "evidence", public read; writes only via signed upload URLs)
create table evidence_files (
  id uuid primary key default gen_random_uuid(),
  estate text not null,
  evidence_id bigint,              -- filled after submit_evidence lands
  path text not null unique,
  sha256 text not null,
  uploaded_by text not null,       -- NEAR account
  exif jsonb,                      -- client-side EXIF snapshot (display only)
  created_at timestamptz default now()
);

-- event cache for fast feeds (chain is still the source of truth)
create table events (
  id bigserial primary key,
  network text not null,           -- testnet | mainnet
  estate text not null,
  unit text,
  standard text not null,          -- plote | nep171
  event text not null,
  data jsonb not null,
  tx_hash text not null,
  block_height bigint not null,
  block_time timestamptz not null,
  unique (tx_hash, event, unit)
);
create index on events (estate, block_height desc);

create table oneclick_quotes (
  deposit_address text primary key,
  network text not null default 'mainnet',
  estate text not null, unit text not null,
  quote jsonb not null, status text not null default 'PENDING_DEPOSIT',
  synced boolean default false,
  chip_name text, chip_note text,  -- C1 for Path B
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table chipins (
  id bigserial primary key,
  estate text not null, unit text not null,
  tx_hash text, deposit_address text,
  display_name text check (char_length(display_name) <= 40),
  note text check (char_length(note) <= 140),
  amount numeric, created_at timestamptz default now()
);

create table notify_subscriptions (
  account text not null, estate text not null, unit text not null,
  email text not null, created_at timestamptz default now(),
  primary key (account, estate, unit)
);

create table gate_nonces (nonce text primary key, used_at timestamptz default now());
```

Row-level security: enable on all tables; public `select` on `events`, `chipins`, `evidence_files`; all writes through the service-role key in Vercel functions only. Never ship the service key to the browser.

### 14.3 Reading chain data

- **Views:** near-api-js `JsonRpcProvider` against a FastNEAR RPC (`https://test.rpc.fastnear.com` testnet; `https://rpc.mainnet.fastnear.com` mainnet — confirm URLs) with a `FailoverRpcProvider` fallback to `https://rpc.testnet.near.org` / `https://rpc.mainnet.near.org`.
- **History / events:** NearBlocks API (`https://api-testnet.nearblocks.io/v1/account/{id}/txns` and the receipt/log endpoints — check the free-tier rate limit and exact paths on Day 5). The poller fetches new transactions to the estate account, then fetches each transaction's receipts via RPC `tx` (`EXPERIMENTAL_tx_status`) and extracts `EVENT_JSON:` logs. Unit pages fall back to contract views if the cache is empty.
- **Why not a full indexer:** for 11 days and one estate, polling + cache is enough. Mention NEAR Lake / an indexer as production work.

### 14.4 Notifications (C7)

Resend free tier, one template: "Your roof is on — A-4B at Harmattan Court is 50% built." + proof link + watch link. Triggered by the poller on `QsSigned` and `Released` for units whose holder subscribed. Unsubscribe link deletes the row.

### 14.5 Scripts (run locally / in CI)

| Script | Does |
| --- | --- |
| `scripts/deploy-global-unit.ts` | Builds unit WASM, deploys as global by hash, prints hash. |
| `scripts/deploy-musdc.ts` | Creates `musdc.plote.testnet`, deploys mock USDC, inits metadata. |
| `scripts/deploy-estate.ts` | Creates estate sub-account, deploys estate WASM, calls `new` with `config/harmattan-court.json`. |
| `scripts/add-units.ts` | Calls `add_units` in batches. |
| `scripts/reset-playground.ts` | Calls `playground_reset` and adds units to the playground when fewer than 10 are available. |
| `scripts/seed-demo.ts` | Creates demo buyer accounts, mints test USDC, reserves/pays units, uploads fixture photos, runs milestones 1–2, sets up the refund case. |
| `scripts/add-surveyor-key.ts` | Adds the scoped function-call key to the surveyor's account. |
| `scripts/delete-estate-keys.ts` | Deletes the estate account's full-access key (do last, on video). |
| `scripts/mainnet-lite.ts` | Mainnet: create one unit account, register on USDC, print the address for the 1Click demo. |

## 15. Toolchain inventory — everything to install, sign up for, and connect

Versions marked *latest* should be pinned to whatever is current on the day you install, then frozen in lockfiles. Don't upgrade mid-hackathon.

### 15.1 Machine and runtimes

| Tool | Version | Install |
| --- | --- | --- |
| OS | macOS, Linux, or GitHub Codespaces (4-core recommended for Rust builds) | — |
| Rust | stable ≥ 1.87 (needed by `image_hasher` 3.x) | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| Rust targets | `wasm32-unknown-unknown` (contracts), `wasm32-wasip2` + `wasm32-wasip1` (worker) | `rustup target add wasm32-unknown-unknown wasm32-wasip2 wasm32-wasip1` |
| cargo-near | latest (maintenance mode, ≈ v0.20.x) | `curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/cargo-near/releases/latest/download/cargo-near-installer.sh \| sh` |
| near CLI (Rust) | latest `near-cli-rs` | `curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/near-cli-rs/releases/latest/download/near-cli-rs-installer.sh \| sh` |
| Docker | latest | Needed by `cargo near build reproducible-wasm`. |
| wasmtime | latest | Run the verifier locally: `curl https://wasmtime.dev/install.sh -sSf \| bash` |
| Node.js | 20 LTS or 22 LTS | via `nvm` |
| pnpm | 9+ | `corepack enable` |
| Supabase CLI | latest | `npm i -g supabase` (optional; local dev) |
| GitHub CLI | latest | For repo + Actions secrets. |

### 15.2 Rust crates

| Crate | Where | Notes |
| --- | --- | --- |
| `near-sdk` | estate, unit, musdc | Latest **5.x** (v6 is being prepared; don't adopt a pre-release). Features: `["unit-testing"]` in dev. |
| `near-contract-standards` | estate, musdc | Same version as near-sdk. NFT core/metadata/approval/enumeration; FT core + storage. |
| `near-sdk` `#[near(event_json)]` | estate | NEP-297 events. |
| `serde_json` | all | Already re-exported by near-sdk. |
| `near-workspaces` *or* `near-api` + `near-sandbox` | `tests/` | near-workspaces-rs is being deprecated in favour of near-api-rs + near-sandbox-rs. Use near-workspaces if you know it (works today); otherwise the new pair. |
| `tokio`, `anyhow` | tests | Async test runtime. |
| `kamadak-exif`, `image`, `image_hasher`, `sha2`, `hex`, `base64`, `wstd` | verifier | Section 6.2. |

### 15.3 npm packages (web)

```bash
pnpm add next react react-dom
pnpm add @hot-labs/near-connect near-connect-hooks near-api-js
pnpm add @defuse-protocol/one-click-sdk-typescript
pnpm add @supabase/supabase-js
pnpm add @tanstack/react-query zod react-hook-form @hookform/resolvers
pnpm add exifr qrcode @zxing/browser framer-motion lucide-react clsx
pnpm add resend
pnpm add -D typescript @types/node @types/react tailwindcss @tailwindcss/postcss
pnpm add -D vitest @testing-library/react playwright @playwright/test eslint prettier
npx shadcn@latest init
# optional alternative wallet stack
# pnpm add @near-wallet-selector/core @near-wallet-selector/modal-ui @near-wallet-selector/meteor-wallet @near-wallet-selector/my-near-wallet
```

Scaffolding shortcut: `npx create-near-app@latest` produces a working Next.js + wallet example; copy its wallet setup into your app if near-connect wiring takes more than an hour.

### 15.4 External APIs

| API | Base URL | Key? | Used for |
| --- | --- | --- | --- |
| NEAR RPC (FastNEAR / near.org) | `https://test.rpc.fastnear.com`, `https://rpc.testnet.near.org` | No | Views, transactions |
| NearBlocks | `https://api-testnet.nearblocks.io/v1` / `https://api.nearblocks.io/v1` | Free tier (key optional) | Tx history |
| 1Click (NEAR Intents) | `https://1click.chaindefuser.com/v0` | JWT optional (removes 0.2% fee) — from partners.near-intents.org | Any-chain payments (mainnet) |
| 1Click explorer | `https://explorer.near-intents.org` | No | Status links |
| OutLayer | `outlayer.testnet` / `outlayer.near`; HTTPS `https://api.outlayer.io` | Payment key for HTTPS path only | TEE verification |
| OutLayer docs | `https://outlayer.fastnear.com/docs` (redirects to app.outlayer.ai) | — | Reference |
| NEAR AI Cloud | `https://cloud-api.near.ai/v1` | API key (claim $10 credits via NEAR Builders, per hackathon FAQ) | Vision stage check; optional image gen |
| Supabase | project URL | anon + service keys | Storage, cache |
| Resend | `https://api.resend.com` | API key (free) | Emails |
| FX rate | any free USD→NGN endpoint | Usually no | "≈ ₦" display only |

### 15.5 Accounts to create

| Account | Network | How | Funding |
| --- | --- | --- | --- |
| `plote.testnet` | testnet | MyNearWallet / Meteor testnet, or `near account create-account sponsor-by-faucet-service plote.testnet …` | Faucet (testnet NEAR is free) |
| `harmattan-court.plote.testnet`, `musdc.plote.testnet`, `relayer.plote.testnet`, baobab-heights.plote.testnet, playground.plote.testnet | testnet | `near account create-account fund-myself <name> '10 NEAR' …` from `plote.testnet` | 10 / 5 / 5 NEAR |
| `dev-lekki.testnet`, `qs-adaeze.testnet`, `buyer-1..4.testnet` | testnet | Faucet | Demo roles |
| `plote.<you>.near` + one unit | mainnet | Sub-account of your existing mainnet account | ≈ 0.1–5 NEAR depending on Mainnet Lite vs Full (17.4) |
| GitHub org/user repo `plote` (public, MIT) | — | `gh repo create plote --public --license mit` | — |
| GitHub repo `plote-verifier` (public) | — | Separate repo so OutLayer builds only the worker | — |
| Vercel project | — | Import the repo | Hobby (free) |
| Supabase project | — | Free tier | — |
| NEAR AI Cloud | — | Sign up, claim credits | $10 credit |
| OutLayer | — | Sign in at app.outlayer.ai, register the worker as a project, upload the NEAR AI key as an encrypted secret | Testnet NEAR for executions |
| 1Click partner JWT | — | partners.near-intents.org (optional) | — |
| X account | — | For the demo post | — |

### 15.6 Agent skills (for Claude Code or another coding agent)

```bash
npx skills add near/agent-skills          # includes near-intents and near-ai-cloud skills
npx skills add supabase/agent-skills      # Supabase dev + security guidance
```

Give the coding agent these context files at the start of each session: this spec (export as Markdown into `docs/SPEC.md`), `https://docs.near.org/llms.txt`, the 1Click OpenAPI file (`https://1click.chaindefuser.com/docs/v0/openapi.yaml`, saved into `docs/`), and the OutLayer NEAR-integration page saved as Markdown.

### 15.7 MCP servers

| Server | Command / URL | Why |
| --- | --- | --- |
| NEAR MCP (local) | `claude mcp add near-mcp npx @nearai/near-mcp@latest run` | 20+ tools: view accounts, call contracts, create accounts, keys — lets the agent inspect testnet state while debugging. Run locally only; it can hold keys. |
| NEAR Docs MCP | `https://docs.near.org/mcp` (`claude mcp add --transport http near-docs https://docs.near.org/mcp`) | Search current NEAR docs instead of guessing APIs. |
| Supabase MCP | Supabase's hosted MCP (connect in Claude) | Create tables, run SQL, check advisors. |
| Vercel MCP | Vercel's hosted MCP | Deploy logs, env vars, runtime errors. |
| GitHub | `gh` CLI | Repo, Actions secrets, releases. |
| Figma MCP (optional) | Hosted | If you design screens in Figma first. |

### 15.8 Claude Code project setup (suggested)

`CLAUDE.md` at repo root:

```md
# Plote
Spec: docs/SPEC.md (source of truth). Contracts in /contracts, web in /web, worker in ../plote-verifier.
Rules:
- Testnet by default. Never put a private key in code; read from env or ~/.near-credentials.
- Every contract method change needs a test in contracts/*/tests.
- Amounts are USDC base units (6 dp) as strings in JSON.
- Before using any NEAR/OutLayer/1Click API, check docs via the near-docs MCP or docs/ files. Do not invent method names.
- Run `pnpm -C web typecheck && cargo test -p plote-estate` before saying a task is done.
```

## 16. Repo, environment and scripts

### 16.1 Repositories

- `plote` — monorepo: contracts, web app, scripts, docs. Public, MIT.
- `plote-verifier` — the OutLayer worker only. Public, MIT. Separate so its commit hash identifies exactly the checking code.

### 16.2 `plote` layout

```
plote/
├─ LICENSE                      # MIT
├─ README.md                    # judge-facing (section 19)
├─ CLAUDE.md
├─ justfile                     # one-word commands (16.5)
├─ Cargo.toml                   # workspace
├─ contracts/
│  ├─ estate/
│  │  ├─ Cargo.toml
│  │  ├─ src/{lib.rs, state.rs, units.rs, payments.rs, milestones.rs, verify.rs,
│  │  │       resale.rs, votes.rs, capture.rs, nft.rs, svg.rs, events.rs, errors.rs, views.rs}
│  │  └─ tests/{flow.rs, refund.rs, resale.rs, default.rs, votes.rs, sweep.rs, playground.rs, invariants.rs}
│  ├─ unit/{Cargo.toml, src/lib.rs, tests/}
│  ├─ musdc/{Cargo.toml, src/lib.rs}
│  └─ mocks/outlayer-mock/       # test double: echoes a canned verdict via callback
├─ web/
│  ├─ app/                       # routes from 13.2
│  ├─ components/
│  ├─ lib/{near.ts, estate.ts, unit.ts, usdc.ts, votes.ts, oneclick.ts, supabase.ts, nep413.ts, errors.ts, svg-house.ts}
│  ├─ public/{logo.svg, mark.svg, favicon.ico, og-default.png, fixtures/}
│  ├─ styles/tokens.css
│  └─ tests/{unit/, e2e/}
├─ scripts/                     # 14.5, TypeScript, run with tsx
├─ config/
│  ├─ playground.testnet.json
│  ├─ baobab-heights.testnet.json
│  ├─ harmattan-court.testnet.json
│  ├─ harmattan-court.mainnet.json
│  └─ estates.json
├─ supabase/migrations/0001_init.sql
├─ docs/{SPEC.md, oneclick-openapi.yaml, outlayer-near-integration.md, demo-script.md}
└─ .github/workflows/{ci.yml, poll.yml}
```

### 16.3 Estate config (`config/harmattan-court.testnet.json`)

```json
{
  "account": "harmattan-court.plote.testnet",
  "name": "Harmattan Court",
  "developer_id": "dev-lekki.testnet",
  "payout_id": "dev-lekki.testnet",
  "surveyor_id": "qs-adaeze.testnet",
  "usdc_id": "musdc.plote.testnet",
  "outlayer_id": "outlayer.testnet",
  "verifier": { "repo": "https://github.com/<you>/plote-verifier", "commit": "<sha>", "build_target": "wasm32-wasip2" },
  "geofence": { "lat_e6": 6447000, "lon_e6": 3474000, "radius_m": 300 },
  "milestones": [
    { "key": "foundation", "title": "Foundation", "bps": 2000, "deadline": "2027-02-01T12:00:00Z" },
    { "key": "roofing",    "title": "Roofing",    "bps": 3000, "deadline": "2027-05-03T12:00:00Z" },
    { "key": "finishing",  "title": "Finishing",  "bps": 3000, "deadline": "2027-08-02T12:00:00Z" },
    { "key": "handover",   "title": "Handover",   "bps": 2000, "deadline": "2027-11-01T12:00:00Z" }
  ],
  "params": { "reserve_ttl_ns": "1800000000000", "min_initial_bps": 1000, "grace_ns": "120000000000",
              "veto_window_ns": "120000000000", "default_grace_ns": "120000000000", "penalty_bps": 500,
              "max_phash_distance": 8, "max_exif_age_h": 72, "min_ai_confidence": 70, "demo_mode": true, "playground": false,
              "mobilisation_bps": 0, "dust_threshold": "1000000", "late_claim_ns": "600000000000",
              "capture_ttl_ns": "1800000000000", "proposal_period_ns": "600000000000" },
  "units": [
    { "id": "a-1a", "label": "Block A · 1A · 2-bed", "price": "60000000000" },
    { "id": "a-4b", "label": "Block A · 4B · 3-bed", "price": "85000000000" },
    { "id": "b-2a", "label": "Block B · 2A · 2-bed", "price": "60000000000" }
  ]
}
```

The geofence above is a placeholder in Lekki; set it to wherever your demo photos are actually taken (a real construction site near you: Harmattan Court's photos must also pass the AI stage check, so foundation or roofing work must be in frame; the playground has no geofence), or the location check will fail. Prices are USDC base units ($60,000 / $85,000).

For the refund demo, a second estate `baobab-heights.plote.testnet` can be created with a finishing deadline already in the past, so its refund button is live during judging. This is simpler than manipulating time.

**Playground** (`config/playground.testnet.json`, account `playground.plote.testnet`): `playground: true`, geofence radius 0, deadlines a year out, 60 units `p-01`…`p-60` at $1,000 (`"1000000000"`), so one faucet mint pays a unit in full. `scripts/reset-playground.ts` reopens milestones and adds units when fewer than 10 are available. Harmattan Court's deadlines sit in 2027 so judges never meet a missed milestone there; only Baobab Heights shows the refund.

### 16.4 Environment variables

**`web/.env.local` (and Vercel)**

| Variable | Example | Public? |
| --- | --- | --- |
| `NEXT_PUBLIC_NETWORK` | `testnet` | yes |
| `NEXT_PUBLIC_RPC_URL` | `https://test.rpc.fastnear.com` | yes |
| `NEXT_PUBLIC_RPC_FALLBACK` | `https://rpc.testnet.near.org` | yes |
| `NEXT_PUBLIC_ESTATES` | `harmattan-court.plote.testnet,baobab-heights.plote.testnet`,playground.plote.testnet | yes |
| `NEXT_PUBLIC_USDC_ID` | `musdc.plote.testnet` | yes |
| `NEXT_PUBLIC_EXPLORER` | `https://testnet.nearblocks.io` | yes |
| `NEXT_PUBLIC_APP_URL` | `https://plote.vercel.app` | yes |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxxx.supabase.co` | yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ…` | yes |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ…` | **no** |
| `RELAYER_ACCOUNT_ID` | `relayer.plote.testnet` | no |
| `RELAYER_PRIVATE_KEY` | `ed25519:…` | **no** |
| `RELAYER_ALLOWED_METHODS` | `open_capture,submit_evidence,qs_sign,sync,sync_deposits,sweep_unattributed` | no |
| `ONECLICK_BASE_URL` | `https://1click.chaindefuser.com` | no |
| `ONECLICK_JWT` | `eyJ…` (optional) | **no** |
| `MAINNET_UNIT_ACCOUNT` | `a-4b.harmattan-court.plote.<you>.near` | no |
| `MAINNET_RELAYER_PRIVATE_KEY` | `ed25519:…` (tiny balance) | **no** |
| `NEARBLOCKS_API_KEY` | optional | no |
| `RESEND_API_KEY` | `re_…` | **no** |
| `CRON_SECRET` | random 32 bytes | **no** |

**Worker secrets (OutLayer encrypted secrets, never in git):** `NEAR_AI_API_KEY`, `NEAR_AI_MODEL=Qwen/Qwen3-VL-30B-A3B-Instruct`.

**Scripts (`.env` at repo root, git-ignored):** `NEAR_ENV=testnet`, `ROOT_ACCOUNT=plote.testnet`, credentials read from `~/.near-credentials` by near-api-js `UnencryptedFileSystemKeyStore` (or the CLI keychain).

### 16.5 `justfile`

```make
build:            cargo near build non-reproducible-wasm --manifest-path contracts/estate/Cargo.toml && \
                  cargo near build non-reproducible-wasm --manifest-path contracts/unit/Cargo.toml && \
                  cargo near build non-reproducible-wasm --manifest-path contracts/musdc/Cargo.toml
build-release:    cargo near build reproducible-wasm --manifest-path contracts/estate/Cargo.toml   # etc.
test:             cargo test --workspace && pnpm -C web test
deploy-testnet:   pnpm tsx scripts/deploy-musdc.ts && pnpm tsx scripts/deploy-global-unit.ts && \
                  pnpm tsx scripts/deploy-estate.ts config/harmattan-court.testnet.json && \
                  pnpm tsx scripts/add-units.ts config/harmattan-court.testnet.json && \
                  pnpm tsx scripts/deploy-estate.ts config/playground.testnet.json && \
                  pnpm tsx scripts/add-units.ts config/playground.testnet.json
seed:             pnpm tsx scripts/seed-demo.ts
reset-playground: pnpm tsx scripts/reset-playground.ts
web:              pnpm -C web dev
verifier-local:   cd ../plote-verifier && cargo build --release --target wasm32-wasip2 && \
                  wasmtime run --wasi http target/wasm32-wasip2/release/plote-verifier.wasm < fixtures/roofing-good.json
mainnet-lite:     NEAR_ENV=mainnet pnpm tsx scripts/mainnet-lite.ts
```

### 16.6 CI (`.github/workflows/ci.yml`)

On push: `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test --workspace` (sandbox tests), `pnpm -C web lint typecheck test`, Playwright smoke against the Vercel preview URL (landing loads, `/check?u=a-4b` shows TAKEN). `poll.yml`: `schedule: cron: '*/5 * * * *'` → `curl -H "x-cron-secret: $CRON_SECRET" $APP_URL/api/cron/poll`. Disable it after judging.

## 17. Testing, security, deployment and budget

### 17.1 Test plan

**Contract unit tests** (`cargo test`, near-sdk `testing_env!`): bps sum, deadline order, release math (rounding down, cap at price), default penalty math, error codes for every access check, SVG output contains the right number of filled segments.

**Sandbox integration tests** (near-workspaces or near-api + near-sandbox), each a named file:

| Test | Asserts |
| --- | --- |
| `flow::happy_path` | Deploy musdc, unit (global or embedded), estate with `outlayer-mock`; add 3 units; reserve → pay 10% → NFT minted; submit evidence → mock verdict pass → QS sign → wait veto → claim → payout receives 20% of paid. |
| `flow::double_mint` | Second reserve on a taken unit → `E_UNIT_TAKEN`; direct mint impossible. |
| `flow::plain_transfer_sync` | `ft_transfer` (no call) to unit account, then `sync` → `paid` updates (simulates 1Click). |
| `refund::missed_deadline` | Advance time past deadline + grace (sandbox `fast_forward`) → refund pays `paid − released`, NFT burned, unit Available. |
| `refund::not_yet` | Before deadline → `E_NO_REFUND_YET`. |
| `resale::voluntary` | List → buyer `ft_transfer_call` → seller paid, NFT moved, unit balance unchanged. |
| `resale::underpaid` | Amount < ask → full refund to buyer, nothing moves. |
| `default::penalty` | Missed instalment → `declare_default` → sale → seller 95%, payout 5%. |
| `verify::fail_reasons` | Mock verdict fail → milestone back to Open; no release possible. |
| `verify::callback_error` | Mock returns error → evidence Error, milestone Open. |
| `vote::freeze_blocks_release` | Holders pass a `Freeze` vote → `claim_release` → `E_FROZEN`; refunds still work if opened. |
| `vote::replace_surveyor` | After a passed `ReplaceSurveyor` vote, old QS `qs_sign` → `E_NOT_SURVEYOR`; a token sold mid-vote can't vote twice. |
| `deposit::bounce_unreserved` | `ft_transfer_call` to an Available unit with no reservation → full amount back to the sender; balance unchanged. |
| `sweep::dust_and_late_claim` | ≤ 1 USDC plain transfer → next reserver credited; $5 after a lapsed reservation → `sweep_unattributed` pays the lapsed reserver; after `late_claim_ns` → `recovery_id`. |
| `excess::withdraw` | Pay 110% of price → `withdraw_excess` returns 10%; releases never exceed price. |
| `verify::challenge_required` | `submit_evidence` without an open capture → `E_NO_CHALLENGE`; expired → `E_CHALLENGE_EXPIRED`; mock verdict `challenge_mismatch` → milestone `Open`. |
| `playground::open_roles` | With `playground: true` any account can capture, submit and sign; `playground_reset` reopens milestones; on a normal estate it panics `E_PLAYGROUND_ONLY`. |
| `invariants::conservation` | Randomised sequence of 200 actions; after each, `paid == balance + released + refunded + in_flight` for all units. |
| `access::unit_only_estate` | Anyone but estate calling `unit.transfer_out` → panic. |

**Worker tests:** `cargo test` on native target for check logic with the 12 fixture photos; `wasmtime run` smoke test on the WASI build; one real OutLayer testnet run recorded in `docs/` with its execution reference.

**Web tests:** Vitest for `lib/` (amount formatting, error mapping, NEP-413 encode/verify, SVG house); Playwright e2e on the preview URL: landing → check (taken/available/not-plote), estate page renders milestones, proof page renders checklist, watch page has OG tags. Wallet flows are tested manually (wallet popups are hard to automate) with the checklist in 17.5.

### 17.2 Security checklist

- [ ] Every state-changing method checks `predecessor_account_id` against the right role; tests cover each.
- [ ] `ft_on_transfer` checks `predecessor == usdc_id`; returns the full amount on any failure path.
- [ ] Callbacks are `#[private]`; they handle `PromiseError` and never leave `in_flight` stuck (restore on failure).
- [ ] Payable methods assert exact or minimum deposits; methods that move FTs require 1 yocto (forces full-access key/wallet confirmation).
- [ ] No `unwrap()` on user input; amounts use checked arithmetic (`checked_mul`, `checked_sub`) — panics with codes.
- [ ] Storage: `reserve` deposit covers token storage; measure with `env::storage_usage()` before/after in a test.
- [ ] Unit accounts have no access keys; estate full-access key deleted on Nov 12 (on video).
- [ ] Global contract deployed **by hash** (immutable).
- [ ] Reproducible build for final WASMs; publish code hashes in README.
- [ ] Relayer: method allowlist, zero deposit, gas cap, rate limit, separate low-balance account; key only in Vercel env.
- [ ] Supabase: RLS on; service key server-only; signed upload URLs expire in 5 min; file size/type checked.
- [ ] 1Click JWT server-only; quote proxy forces destination asset and a real unit recipient (prevents using Plote as a free swap proxy).
- [ ] NEP-413 messages include recipient, nonce, expiry; nonces single-use.
- [ ] No secrets in git (`gitleaks` in CI); `.env*` ignored.
- [ ] Clear demo-mode banner when `demo_mode = true` (short timers).
- [ ] Known trust assumptions listed in README: surveyor, OutLayer TEE, NEAR AI model accuracy, Supabase availability for photos.

### 17.3 Deployment order (testnet)

1. Create accounts (15.5). Fund from faucet.
2. `just build`.
3. `scripts/deploy-musdc.ts` → `musdc.plote.testnet`.
4. `scripts/deploy-global-unit.ts` → note the hash into the estate config (or use the embedded fallback).
5. Push `plote-verifier`, register it as an OutLayer project, upload NEAR AI key as a secret, run one execution from CLI to warm the build cache: `near call outlayer.testnet request_execution '{"source":{"GitHub":{"repo":"https://github.com/<you>/plote-verifier","commit":"<sha>","build_target":"wasm32-wasip2"}},"input_data":"<fixture json>","resource_limits":{"max_instructions":50000000000,"max_memory_mb":256,"max_execution_seconds":60},"response_format":"Json"}' --accountId plote.testnet --deposit 0.1 --gas 300000000000000`
6. `scripts/deploy-estate.ts config/harmattan-court.testnet.json` → `fund_verification` with 5 NEAR.
7. `scripts/add-units.ts`.
8. `scripts/deploy-estate.ts config/playground.testnet.json` → `add-units.ts (60 playground units)`.
9. `scripts/add-surveyor-key.ts`.
10. Supabase: `supabase db push` (migrations), create `evidence` bucket.
11. Vercel: import repo, root `web/`, set env (16.4), deploy.
12. `scripts/seed-demo.ts`.
13. Repeat 6–7 + 12 for `baobab-heights` (refund demo estate).
14. Smoke test with 17.5.
15. Nov 12: `just build-release`, redeploy if code changed (fresh accounts if needed), delete estate keys on video.

### 17.4 Mainnet demo (S2)

Two options — pick on Day 8 based on NEAR price and time.

|  | Mainnet Lite (recommended) | Mainnet Full |
| --- | --- | --- |
| What | One unit account (no estate contract), registered on USDC; receives a real 1Click payment; app shows balance and the 1Click trail. | Estate + one unit with real contracts; payment syncs and mints an NFT on mainnet. |
| Accounts | `plote.<you>.near` → `harmattan-court.plote.<you>.near` → `a-4b…` | Same |
| NEAR needed | ≈ 0.2 NEAR (account storage + USDC registration + gas) | ≈ 5–6 NEAR locked for contract storage (≈1 NEAR per 100 KB; estate ≈ 350 KB + unit ≈ 150 KB), recoverable later by deleting the accounts |
| USDC | ≈ $2 sent from Base or Solana | Same |
| Story | "Real money from another chain lands in the unit's own account." | Same + "and it minted the allocation NFT on mainnet." |

In Lite, the unit account is created with a full-access key you hold (no contract), so say clearly in the video that mainnet shows the payment rail only and the escrow logic runs on testnet. Judges were told testnet is fine in every track; the mainnet piece is a bonus.

### 17.5 Manual smoke checklist (run before recording and before submitting)

1. Fresh browser, phone size: landing loads < 2 s, check `a-4b` → TAKEN.
2. New testnet wallet → faucet → reserve `a-1a` → pay 10% → NFT shows in `/me` and in the wallet.
3. Phone: `/qs` capture a fresh photo at the geofence → verdict pass within 2 min → sign → wait 2 min → `/dev` claim → payout balance up.
4. Upload a reused photo → verdict fail `phash_reuse` → proof page red.
5. `baobab-heights` unit → refund → balance returned, unit Available.
6. List a unit → second wallet buys → both balances correct.
7. Votes: propose replace surveyor → 2 holders vote yes → executed → old QS can't sign.
8. Watch page link pasted in WhatsApp → card renders.
9. Mainnet: 1Click quote → pay $2 → SUCCESS → balance on unit account.
10. `/status` all green.
11. Playground: Capture → photograph the code on paper anywhere → pass with amber warnings → Sign → wait 2 min → Claim → payout up.

### 17.6 Budget (≤ $50)

NEAR price changes daily; amounts in NEAR are firm, USD is an estimate — check the price when you buy.

| Item | Cost | Notes |
| --- | --- | --- |
| Testnet everything (contracts, OutLayer runs, relayer gas) | $0 | Testnet NEAR from faucet. |
| NEAR AI Cloud inference | $0 | Covered by the $10 builder credits; each vision call is a fraction of a cent to a few cents. |
| Mainnet Lite: ≈ 0.2 NEAR + ≈ $2 USDC + 1Click/bridge fees | ≈ $3–5 | The $2 ends up in the unit account (yours). |
| Mainnet Full (optional): ≈ 5–6 NEAR locked | Locked, not spent | Recoverable by deleting accounts after judging. Only if you already hold the NEAR. |
| Vercel Hobby, Supabase free, Resend free, GitHub, Codespaces free hours | $0 | Codespaces free tier hours are limited; build Rust locally if you can. |
| Logo generation (Recraft / Ideogram) | $0–10 | Free tiers usually enough; the hand-built SVG in 11.3 is the fallback. |
| Domain (optional, e.g. `.xyz`) | $0–15 | `plote.vercel.app` is fine for judging. |
| Buffer | ≈ $15 | Retries on mainnet, an extra wallet top-up. |
| **Total** | **≈ $5–45** | Comfortably inside $50 with Mainnet Lite and no domain. |

## 18. Roadmap — Nov 3 to Nov 14

Twelve working days including today. The submission target is **Nov 14, 18:00 UTC**, not 23:59: the form can't be edited after submitting, and the last hours are when sites slow down.

&#91;embedded content: Plote roadmap · 4 phases, 3 gates, submit Nov 14\]

Each gate is a hard check: if it fails, the next phase starts with the fix, and the cut order below kicks in.

### Day by day

| Day | Date | Contracts | Verifier / AI | Web | Exit check |
| --- | --- | --- | --- | --- | --- |
| 1 | Tue Nov 3 | Workspace, `musdc`, unit contract skeleton; confirm the global-contract action in near-sdk | `GET /v1/models` on NEAR AI; claim credits | Next.js scaffold, tokens, `BracketCard`, landing hero | Accounts funded; repo public with MIT LICENSE |
| 2 | Wed Nov 4 | Unit contract done + tests | Verifier compiles for `wasm32-wasip2`; one real OutLayer testnet run from CLI | Wallet login (near-connect) | **Gate 1: worker returns a verdict on OutLayer** |
| 3 | Thu Nov 5 | Estate: `new`, `add_units`, `reserve`, `sync`, NFT mint | NEAR AI prompt tuned on 12 fixtures (≥ 10/12 correct) | `/check`, `/estates/[e]` | Can reserve + pay + mint from the CLI |
| 4 | Fri Nov 6 | Milestones, `submit_evidence` → OutLayer → `on_verdict`; dynamic SVG | AI call inside the worker via secret | Unit page, buy wizard (Path A), faucet | Verdict lands on-chain from a contract call |
| 5 | Sat Nov 7 | `qs_sign`, `claim_release`, `refund`; invariants test | Edge cases: no GPS, HEIC, huge image | `/qs` capture + sign, relayer | Release + refund pass in sandbox |
| 6 | Sun Nov 8 | Deploy to testnet; seed demo | Fallback 6.6 only if needed | Proof page, `/me`, `/dev` releases | **Gate 2: full testnet flow end to end in the browser** |
| 7 | Mon Nov 9 | Resale, default, holder votes | — | `/market`, vote pages | A holder vote replaces the surveyor on testnet |
| 8 | Tue Nov 10 | Fix list from Gate 2 | — | 1Click Path B + status page; mainnet Lite | **Gate 3: Must list done; $2 lands on a mainnet unit** |
| 9 | Wed Nov 11 | Gas/storage tuning | — | Developer score, watch page + OG, celebration | Should list done or cut |
| 10 | Thu Nov 12 | Reproducible build, final deploy, delete estate keys (on video) | Pin worker commit in config | Landing polish, logo final, mobile pass, Lighthouse | Frozen code |
| 11 | Fri Nov 13 | — | — | README, record + edit video, draft X post | Video uploaded; README reproduced on a clean machine |
| 12 | Sat Nov 14 | — | — | Post on X, submit form by 18:00 UTC | **Submitted** |

If you're working alone, Contracts and Web alternate by half-day; Claude Code can carry the web pages from this spec while you focus on contracts and the worker.

### Cut order if behind

Cut from the bottom: C-items → S9 relayer (surveyor pays own gas) → S7 score → S6 votes (keep `propose/vote` in the contract, call them from the CLI in the demo) → S5 default → S4 resale → S2 mainnet (show a recorded dry quote instead). Never cut M6 (TEE check) or M8 (refund) — they are the story.

## 19. Demo, README, X post and submission

### 19.1 Demo video (3:00, screen + voice, 1080p)

Record on Nov 13 with OBS or Screen Studio. Phone footage via QuickTime/scrcpy. Keep every on-chain step real; cut waiting time with a visible "⏩ 2 min later" card.

| Time | Screen | Voice-over |
| --- | --- | --- |
| 0:00–0:15 | Black → headline quotes from the news sources, then the Plote mark | "In Nigeria, people pay for off-plan homes for two years before they see them. Some developers sell the same flat twice. Some take the money and stop building. Plote fixes the part that's fixable: where the money waits." |
| 0:15–0:35 | `/check` on a phone → type `a-4b` → TAKEN | "Every unit is its own NEAR account. Anyone can check who holds it and how much is in escrow. No login." |
| 0:35–1:00 | New wallet → faucet → reserve `a-1a` → pay 10% → NFT reveal; NearBlocks shows USDC on the unit account | "I reserve a unit and pay into the unit's account, not the developer's. The allocation NFT is minted — the only one this unit will ever have. Try to mint another and the contract refuses." |
| 1:00–1:40 | Phone at a real site/street: `/qs` capture → live log → verdict pass → proof page | "The contract issues a one-time code. The surveyor writes it on paper and takes the photo. Inside an OutLayer TEE the photo's hash, EXIF time, GPS and perceptual hash are checked, and NEAR AI's vision model confirms the stage. The verdict comes back to the contract with an attestation." |
| 1:40–1:55 | Upload a reused photo → red proof page `phash_reuse:3` | "Reuse last month's photo and it fails. Money can't move." |
| 1:55–2:15 | QS signs → ⏩ veto window → developer claims → 20% moves | "The surveyor signs, holders get a veto window, then exactly 20% of each unit's money is released. Not a cent more." |
| 2:15–2:30 | `baobab-heights` unit, deadline passed → "Get my money back" → balance returned | "If the deadline passes, the buyer takes back everything not yet released. Nobody has to approve it." |
| 2:30–2:45 | Mainnet: 1Click from Base → status SUCCESS → USDC on the mainnet unit account | "A buyer in London pays from Base. NEAR Intents delivers USDC straight into the unit's account on mainnet." |
| 2:45–3:00 | Watch page shared in WhatsApp + dynamic NFT → logo + URL | "The NFT holds the money, the refund, the resale and the vote — and it shows the house going up. Plote: pay for the house you can see." |

Also record a 30-second cut (0:15–1:40 compressed) for the X post if the platform limits length for your account.

### 19.2 README (judge-facing, top of repo)

````md
# Plote — pay for the house you can see

**Track:** NFTs That Do Something · **Live app:** https://plote.vercel.app · **Video:** <link> · **Licence:** MIT

Every off-plan housing unit is its own NEAR account holding the buyer's USDC.
The allocation NFT is the key to that account: it receives refunds, sells atomically,
votes in the estate (one vote per unit), and becomes the gate pass. Money moves to the developer only
after a site photo passes a TEE check (OutLayer + NEAR AI Cloud) and a surveyor signs.

## Try it in 5 minutes (testnet, no install)
1. Open https://plote.vercel.app/check and type `a-4b` → you see **TAKEN**, holder and escrow.
2. Connect a testnet wallet → open /faucet → get 5,000 test USDC.
3. Open Harmattan Court → unit `a-1a` (or any AVAILABLE unit) → Reserve → Pay 10%.
   → You now hold the allocation NFT; /me shows it. The unit account's USDC balance is on NearBlocks (link on the page).
4. Open /proof/harmattan-court/1 → see a passed photo check and its attestation links.
   Open /proof/harmattan-court/2 → see a failed check (reused photo).
5. Open Plote Playground → Capture → write the challenge code on paper and photograph it (anywhere) → watch the TEE verdict land → Sign → Claim: 20% moves.
6. Open Baobab Heights → unit `b-2a` is held by the shared judge wallet (seed phrase in `docs/judge-wallet.md`, testnet only)
   → "Get my money back" → refund lands; unit becomes AVAILABLE.
7. Mainnet any-chain payment: see tx links in "Mainnet evidence" below.

## What runs where
| Piece | Account / URL |
|---|---|
| Estate contract | `harmattan-court.plote.testnet` (code hash `…`) |
| Unit contract (global, by hash) | `…` |
| Mock USDC | `musdc.plote.testnet` |
| Playground estate | `playground.plote.testnet` |
| Verifier worker | github.com/<you>/plote-verifier @ `<commit>` on `outlayer.testnet` |
| Mainnet unit | `a-4b.harmattan-court.plote.<you>.near` |

## Mainnet evidence
- 1Click deposit: <explorer.near-intents.org link> · origin tx <link> · NEAR delivery tx <link>

## Build it yourself
```bash
git clone https://github.com/<you>/plote && cd plote
just build && just test
cp web/.env.example web/.env.local   # fill values (section in docs/SPEC.md §16.4)
just deploy-testnet && just seed && just web
```

## How it works
Architecture diagram + 8-step milestone flow (docs/SPEC.md §3). Contract spec (§5). Verifier (§6).

## Built during the hackathon
All code in this repo was written Nov 1–14, 2026 (see commit history). Third-party: near-sdk, near-contract-standards,
OutLayer, NEAR AI Cloud, 1Click API.

## Honest limits
Not a land title. Surveyor is a trusted, replaceable role. GPS may come from the device when EXIF lacks it (shown on proof page).
Mainnet shows the payment rail; escrow logic is demonstrated on testnet.
````

The AI screeners read the README first, so every step is "do X, see Y". Test it on a clean machine and a clean browser profile on Nov 13.

### 19.3 X post (Nov 14, morning UTC)

> Off-plan homes in Nigeria: buyers pay for 2 years before they see a wall. Some units get sold twice.
>
> Plote gives every unit its own NEAR account. Your money waits there and moves only when a site photo passes a TEE check — or comes back to you if the build stalls.
>
> The NFT *is* the unit: escrow, refund, resale, vote, gate pass.
>
> Built for @NEARProtocol #NEARHackathon · NFTs That Do Something 🎥 video below · try it: plote.vercel.app

Attach the 3-minute video (or the 30-second cut plus a link to the full one). Pin the post. Reply-thread with: architecture image, proof page screenshot, mainnet 1Click tx link, GitHub link.

### 19.4 Submission form (or `POST https://nearhackathon.com/api/applications`)

| Field | Value |
| --- | --- |
| `projectName` | Plote |
| `leadName` | Your name |
| `email` | Your email |
| `size` | Your team size |
| `tracks` | NFTs That Do Something (one track only) |
| `nearAddress` | Your mainnet account for prizes |
| `projectUrl` | https://github.com/\<you>/plote |
| `demoUrl` | Link to the X post with the video |
| `idea` | Text below (≤ 2,000 characters) |
| `consent` | true |
| `website` | **leave empty** (honeypot) |
| `requestId` | A fresh UUID if using the API |

**`idea` (≈ 1,700 characters — count before pasting):**

> Plote puts off-plan home deposits into escrow you can check. Every housing unit is its own NEAR account (e.g. a-4b.harmattan-court.plote.testnet) holding the buyer's USDC. The allocation NFT is unique per unit, so a developer can't sell the same flat twice, and anyone can check a unit's holder and escrow on a public page without logging in.
>
> The NFT does the work: it holds the unit's money, pulls a refund when a construction deadline is missed, sells atomically (payment and transfer in one transaction, escrow stays with the unit), turns a missed-instalment default into an automatic resale at a fixed 5% penalty instead of forfeiture, gives its holder one vote per unit in the estate (replace the surveyor, veto a sign-off, freeze releases), and becomes the gate pass after handover. Its image is drawn by the contract and fills in as the building goes up.
>
> Money goes to the developer only per milestone (20/30/30/20). A surveyor's site photo is checked inside an OutLayer TEE: SHA-256 matches the on-chain commitment, EXIF time is fresh, GPS is inside the site geofence, the perceptual hash isn't a reused photo, and NEAR AI Cloud's vision model confirms the stage and reads a one-time challenge code written on paper in the shot. The attested verdict returns to the contract via yield/resume; then the surveyor signs with a scoped function-call key.
>
> Diaspora buyers can pay from Base, Solana or Ethereum: NEAR Intents (1Click) delivers USDC straight into the unit's account — shown live on mainnet. Full flow on testnet; MIT licensed.

Submissions can't be edited: check every link opens in a private window before pressing submit.

## 20. Risks, open questions and sources

### 20.1 Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Yield/resume times out (about 200 blocks) before OutLayer finishes a cold build of a new worker commit | Medium | High | Warm the cache with a CLI run after each commit; pin the commit; freeze it 48 h before recording; HTTPS fallback (6.6). |
| Demo deadlines pass during judging | High (if left at Nov dates) | High | Harmattan Court deadlines in 2027; only Baobab Heights is past due; playground deadlines a year out with `playground_reset`. |
| Playground units run out or milestones are used up | Medium | Medium | 60 units, `scripts/reset-playground.ts` on a schedule, `playground_reset` callable by anyone. |
| OutLayer yield/resume callback shape differs from what 5.6 assumes | Medium | High | Gate 1 on Day 2 with a real run; tolerant parser; HTTPS fallback (6.6). |
| Image crates too heavy for the TEE instruction limit | Medium | Medium | Downscale to 512 px first; hash on thumbnail; raise `max_instructions` (limit is 500B). |
| HTTP from the WASI worker is awkward | Medium | High | Use OutLayer's documented HTTP support; fallback: pass a downscaled image as base64 in `input_data` (EXIF extracted separately and its bytes included in the hash commitment). |
| NEAR AI vision misclassifies stages | Medium | Medium | Tune prompt on fixtures; accept adjacent stages (6.4 table); `demo_mode` turns AI failure into a warning; QS still signs. |
| NEAR AI model renamed/unavailable | Low | Medium | Check `/v1/models` Day 1 and Day 12; model name is a secret/config, not code. |
| Global contract action API differs in pinned near-sdk | Medium | Low | Embedded-WASM fallback (section 4). |
| Phones strip EXIF/GPS | High | Medium | Device GPS fallback shown honestly; fixture photos from a known-good camera for the demo. |
| 1Click slow or refunds during live demo | Medium | Medium | Record the mainnet payment in advance; show explorer links; keep a second $2 attempt ready. |
| Judges' shared wallet used by someone else first (refund demo consumed) | Medium | Medium | Seed 3 refundable units (`b-2a`, `b-2b`, `b-2c`); `scripts/seed-demo.ts --refund-only` re-creates them; README tells judges to pick any "REFUND OPEN" unit. |
| Testnet RPC rate limits during judging | Medium | Medium | FastNEAR + near.org failover; cache views 5 s; `/status` page. |
| Wallet connector bugs | Medium | Medium | Test two wallets Day 3; wallet-selector fallback. |
| Scope creep | High | High | Gates + cut order (18). |
| Solo builder fatigue | High | High | Claude Code builds web pages from this spec; you own contracts + worker. Sleep before recording day. |
| Similar projects in the track | Medium | Medium | Lead with the problem and the TEE-checked photo; few teams will show real-world proof + refunds + any-chain payment together. |

### 20.2 Open questions (answer by the day noted)

1. **Day 1:** exact near-sdk 5.x API for deploying a global contract to a new account inside a promise batch.
2. **Day 2:** OutLayer callback payload shape; `estimate_execution_cost` for our limits; `secrets_ref` format; whether GitHub builds support `wasm32-wasip2` with HTTP.
3. **Day 2:** `image` / `image_hasher` / `kamadak-exif` on `wasm32-wasip2`.
4. **Day 3:** near-connect constructor options and function-call-key plugin name; which wallets render data-URI NFT media.
5. **Day 3:** NEAR AI Cloud: does the vision model accept external `image_url`s or only base64; signature endpoint parameters.
6. **Day 5:** NearBlocks API paths and free-tier limits.
7. **Day 7:** yield/resume timeout versus OutLayer's cold build of a new worker commit.
8. **Day 8:** 1Click field names against the OpenAPI spec; explorer URL format; JWT worth getting.
9. **Day 8:** NEAR price → Mainnet Lite vs Full.
10. **Before submitting:** re-read the hackathon rules and FAQ for any changes since Nov 3.

### 20.3 Sources

**Problem evidence**

- [TechEconomy — developer resold subscribers' units](https://techeconomy.ng/?p=164669)
- [Nigeria Housing Market — 20 real-estate scams](https://www.nigeriahousingmarket.com/news/20-real-estate-scams-nigerian-property-buyers-must-avoid)
- [allAfrica — Revolutionplus diaspora investors (Jan 2026)](https://allafrica.com/stories/202601290263.html)
- [Nairametrics — allocation delays](https://nairametrics.com/?p=520082)
- [Guardian Nigeria — diaspora investors and off-plan](https://guardian.ng/property/diasporan-investors-drive-growth-expose-fault-lines-in-real-estate-sector/)
- [Nation (Kenya) — off-plan scams](https://nation.africa/kenya/news/off-plan-scams-from-dream-homes-to-dust--5347430)

**NEAR and partner docs**

- [NEAR HACKATHON](https://nearhackathon.com/)
- [NEAR docs — events (NEP-297)](https://docs.near.org/smart-contracts/anatomy/events)
- [NEP-171 events spec](https://nomicon-pr-504.onrender.com/Standards/Tokens/NonFungibleToken/Event)
- [near-contract-standards NFT events](https://docs.rs/near-contract-standards/5.7.1/near_contract_standards/non_fungible_token/events/index.html)
- [near-api-js](https://www.pkgstats.com/pkg:near-api-js) · [near-api-js v6.3.0 release](https://github.com/near/near-api-js/releases/tag/near-api-js@6.3.0)
- [OutLayer docs — overview](https://outlayer.fastnear.com/docs) · [getting started](https://outlayer.fastnear.com/docs/getting-started) · [NEAR integration](https://outlayer.fastnear.com/docs/near-integration) · [developer guide](https://outlayer.fastnear.com/docs/dev-guide) · [pricing & limits](https://outlayer.fastnear.com/docs/pricing)
- [outlayer-cli source (request\_execution args)](https://docs.rs/crate/outlayer-cli/latest/source/src/commands/run.rs)
- [Circle — USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses) · [USDC on NEAR](https://www.circle.com/multi-chain-usdc/near) · [near-kit known tokens (testnet USDC)](https://docs.rs/near-kit/0.7.2/src/near_kit/tokens/known.rs.html)
- [image\_hasher crate](https://docs.rs/crate/image_hasher/latest)
- 1Click API: `https://1click.chaindefuser.com/docs/v0/openapi.yaml` · NEAR AI Cloud: `https://cloud-api.near.ai/v1` · NEAR MCP: `@nearai/near-mcp` · NEAR docs MCP: `https://docs.near.org/mcp` · Agent skills: `near/agent-skills`

---

*Facts marked "verify" were not confirmed against primary docs while writing this spec. Treat them as the first task on their day, not as settled.*
