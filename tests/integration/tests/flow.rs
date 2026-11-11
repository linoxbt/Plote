//! End-to-end on near-mock with the real WASMs from `just build`. Run: `cargo test --manifest-path tests/integration/Cargo.toml`.
//! near-mock has no global-contract cache, so the unit WASM is pre-loaded at each unit address; `add_units`
//! still creates, funds, initialises and registers every unit through the estate's own promises.

use near_mock::chain::{CallOutcome, MockChain};
use serde_json::{json, Value};

const ESTATE: &str = "estate.test.near";
const USDC: &str = "musdc.test.near";
const MOCK: &str = "outlayer.test.near";
const DEV: &str = "dev.test.near";
const QS: &str = "qs.test.near";
const ALICE: &str = "alice.test.near";
const BOB: &str = "bob.test.near";
const CAROL: &str = "carol.test.near";
/// The estate's `verdict_relayer`, which is also its deposit reporter (`report_deposit`).
const RELAYER: &str = "relayer.test.near";
const DAY: i64 = 86_400;
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const MILLI: u128 = NEAR / 1000;
const USD: u128 = 1_000_000;
const T0: i64 = 1_800_000_000; // seconds
const UNITS: [&str; 3] = ["a-4b", "b-2a", "c-1a"];

fn wasm(name: &str) -> Vec<u8> {
    let p = format!(
        "{}/../../target/near/{name}/{name}.wasm",
        env!("CARGO_MANIFEST_DIR")
    );
    std::fs::read(&p).unwrap_or_else(|_| panic!("missing {p}; run `just build` first"))
}

fn unit_acc(id: &str) -> &'static str {
    Box::leak(format!("{id}.{ESTATE}").into_boxed_str())
}

fn ok(o: CallOutcome, what: &str) -> CallOutcome {
    assert!(
        o.ok && o.receipt_failures.is_empty(),
        "{what} failed: {:?} {:?} {:?}",
        o.error,
        o.panic,
        o.receipt_failures
    );
    o
}

fn view(c: &MockChain, method: &'static str, args: Value) -> Value {
    let o = c
        .view(ESTATE, method)
        .args(args.to_string())
        .fire()
        .unwrap();
    assert!(o.ok, "view {method}: {:?}", o.error);
    serde_json::from_str(&o.return_string().unwrap_or_else(|| "null".into())).unwrap()
}

fn balance(c: &MockChain, who: &str) -> u128 {
    let o = c
        .view(USDC, "ft_balance_of")
        .args(json!({ "account_id": who }).to_string())
        .fire()
        .unwrap();
    let v: Value = serde_json::from_str(&o.return_string().unwrap()).unwrap();
    v.as_str().unwrap().parse().unwrap()
}

fn ns(secs: i64) -> String {
    (secs as u128 * 1_000_000_000).to_string()
}

fn setup() -> MockChain {
    let mut b = MockChain::builder()
        .contract_bytes(ESTATE, wasm("plote_estate"))
        .contract_bytes(USDC, wasm("plote_musdc"))
        .contract_bytes(MOCK, wasm("outlayer_mock"));
    for u in UNITS {
        b = b.contract_bytes(unit_acc(u), wasm("plote_unit"));
    }
    let c = b.signer(DEV).now(T0).build().unwrap();
    ok(c.call(USDC, "new").args("{}").fire().unwrap(), "musdc new");
    ok(c.call(MOCK, "new").args("{}").fire().unwrap(), "mock new");
    let args = json!({ "args": {
        "developer_id": DEV, "payout_id": DEV, "surveyor_id": QS, "recovery_id": "plote.test.near",
        "usdc_id": USDC, "outlayer_id": MOCK, "verdict_relayer": RELAYER, "verify_mode": "outlayer",
        "verifier": { "repo": "https://github.com/x/plote-verifier", "commit": "abc", "build_target": "wasm32-wasip2" },
        "unit_code_hash": "11111111111111111111111111111111",
        "name": "Harmattan Court", "location": "Lekki",
        "geofence": { "lat_e6": 6447000, "lon_e6": 3474000, "radius_m": 300 },
        "milestones": [
            { "key": "foundation", "title": "Foundation", "bps": 2000, "deadline": ns(T0 + 3600) },
            { "key": "roofing", "title": "Roofing", "bps": 3000, "deadline": ns(T0 + 7200) },
            { "key": "finishing", "title": "Finishing", "bps": 3000, "deadline": ns(T0 + 10800) },
            { "key": "handover", "title": "Handover", "bps": 2000, "deadline": ns(T0 + 14400) }
        ],
        "params": { "reserve_ttl_ns": "1800000000000", "min_initial_bps": 1000, "mobilisation_bps": 0,
            // outside the playground `new` needs ≥ 24 h veto/grace windows and no demo_mode (audit finding 9)
            "grace_ns": ns(DAY), "veto_window_ns": ns(DAY), "default_grace_ns": ns(DAY),
            "penalty_bps": 500, "dust_threshold": "1000000", "late_claim_ns": "600000000000",
            "capture_ttl_ns": "1800000000000", "proposal_period_ns": "600000000000",
            "max_phash_distance": 8, "max_exif_age_h": 72, "min_ai_confidence": 70, "demo_mode": false, "playground": false },
        "nft_metadata": { "spec": "nft-1.0.0", "name": "Harmattan Court allocations", "symbol": "PLOTE",
            "icon": null, "base_uri": null, "reference": null, "reference_hash": null },
        "app_url": "https://plote.vercel.app"
    }});
    ok(
        c.call(ESTATE, "new").args(args.to_string()).fire().unwrap(),
        "estate new",
    );
    // estate and developer need USDC accounts (resale escrow, payouts)
    for who in [ESTATE, DEV, ALICE, BOB, CAROL] {
        ok(
            c.call(USDC, "storage_deposit")
                .from(DEV)
                .args(json!({ "account_id": who, "registration_only": true }).to_string())
                .attach(1_250 * MILLI / 1000)
                .fire()
                .unwrap(),
            "register",
        );
    }
    let units = json!({ "units": UNITS.iter().map(|u| json!({ "id": u, "label": format!("Unit {u}"), "price": (85_000 * USD).to_string() })).collect::<Vec<_>>() });
    let o = ok(
        c.call(ESTATE, "add_units")
            .from(DEV)
            .args(units.to_string())
            .attach(35 * MILLI * UNITS.len() as u128)
            .fire()
            .unwrap(),
        "add_units",
    );
    println!(
        "add_units gas: {} Tgas (entry)",
        o.gas_burned / 1_000_000_000_000
    );
    ok(
        c.call(ESTATE, "fund_verification")
            .from(DEV)
            .attach(NEAR)
            .fire()
            .unwrap(),
        "fund",
    );
    c
}

/// Pays like 1Click does: plain `ft_transfer` to the unit account, then the deposit reporter (the app server, as
/// the estate's `verdict_relayer`) calls `report_deposit` with the delivered amount.
/// (near-mock 0.7.2 doesn't pass a promise returned from inside a cross-contract receipt through to
/// `ft_resolve_transfer`, so the wallet `ft_transfer_call` → unit → estate path is covered by the
/// estate's unit tests and must be checked live on testnet; see README "Verification status".)
fn buy(c: &MockChain, unit: &str, who: &'static str, amount: u128) {
    ok(
        c.call(USDC, "mint")
            .from(who)
            .args(json!({ "amount": amount.to_string() }).to_string())
            .attach(2 * MILLI)
            .fire()
            .unwrap(),
        "mint",
    );
    ok(
        c.call(ESTATE, "reserve")
            .from(who)
            .args(json!({ "unit_id": unit }).to_string())
            .attach(50 * MILLI)
            .fire()
            .unwrap(),
        "reserve",
    );
    ok(
        c.call(USDC, "ft_transfer")
            .from(who)
            .args(
                json!({ "receiver_id": unit_acc(unit), "amount": amount.to_string() }).to_string(),
            )
            .attach(1)
            .fire()
            .unwrap(),
        "ft_transfer",
    );
    report(c, unit, amount);
}

fn report(c: &MockChain, unit: &str, amount: u128) -> u128 {
    let o = ok(
        c.call(ESTATE, "report_deposit")
            .from(RELAYER)
            .args(json!({ "unit_id": unit, "amount": amount.to_string() }).to_string())
            .fire()
            .unwrap(),
        "report_deposit",
    );
    let _ = c.settle();
    let credited = o
        .return_data
        .as_ref()
        .and_then(|d| serde_json::from_slice::<String>(d).ok())
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    println!(
        "report_deposit gas: {} Tgas (entry)",
        o.gas_burned / 1_000_000_000_000
    );
    credited
}

fn unit_view(c: &MockChain, unit: &str) -> Value {
    view(c, "get_unit", json!({ "unit_id": unit }))
}

fn paid(c: &MockChain, unit: &str) -> u128 {
    unit_view(c, unit)["paid"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap()
}

#[test]
fn units_are_created_ready() {
    let c = setup();
    for u in UNITS {
        let v = view(&c, "get_unit", json!({ "unit_id": u }));
        assert_eq!(
            v["ready"], true,
            "unit {u} should be ready after add_units: {v}"
        );
        assert_eq!(v["status"], "Available");
    }
}

#[test]
fn happy_path_buy_verify_sign_release() {
    let c = setup();
    buy(&c, "a-4b", ALICE, 8_500 * USD);
    let u = view(&c, "get_unit", json!({ "unit_id": "a-4b" }));
    assert_eq!(u["status"], "Allocated", "{u}");
    assert_eq!(u["holder"], ALICE);
    assert_eq!(u["paid"], (8_500 * USD).to_string());
    assert_eq!(
        balance(&c, unit_acc("a-4b")),
        8_500 * USD,
        "USDC sits on the unit's own account"
    );
    let tok = view(&c, "nft_token", json!({ "token_id": "a-4b" }));
    assert_eq!(tok["owner_id"], ALICE);
    assert!(tok["metadata"]["media"]
        .as_str()
        .unwrap()
        .starts_with("data:image/svg+xml;base64,"));

    // capture → evidence → mock verdict (no yield in the mock) → Verified
    ok(
        c.call(ESTATE, "open_capture")
            .from(QS)
            .args(json!({ "milestone": 0 }).to_string())
            .fire()
            .unwrap(),
        "open_capture",
    );
    let o = c.call(ESTATE, "submit_evidence").from(QS).args(json!({
        "milestone": 0, "url": "https://x.supabase.co/e/1.jpg", "sha256": "a".repeat(64), "captured_at": ns(T0), "device_gps": null
    }).to_string()).fire().unwrap();
    let o = ok(o, "submit_evidence");
    println!(
        "submit_evidence gas: {} Tgas (entry)",
        o.gas_burned / 1_000_000_000_000
    );
    let _ = c.settle();
    let ev = view(&c, "get_evidence", json!({ "id": "1" }));
    assert_eq!(ev["status"], "Pass", "{ev}");
    assert_eq!(
        ev["verdict"]["attestation"], "mock-1",
        "wrapper's execution id stored"
    );
    assert_eq!(
        view(&c, "get_milestones", json!({}))[0]["status"],
        "Verified"
    );

    ok(
        c.call(ESTATE, "qs_sign")
            .from(QS)
            .args(json!({ "milestone": 0 }).to_string())
            .fire()
            .unwrap(),
        "qs_sign",
    );
    c.advance(DAY + 60); // veto window
    let due = view(&c, "get_unit", json!({ "unit_id": "a-4b" }))["releasable_now"]
        .as_str()
        .unwrap()
        .parse::<u128>()
        .unwrap();
    assert_eq!(due, 1_700 * USD);
    let before = balance(&c, DEV);
    let o = ok(
        c.call(ESTATE, "claim_release")
            .from(DEV)
            .args(json!({ "unit_ids": ["a-4b"] }).to_string())
            .fire()
            .unwrap(),
        "claim_release",
    );
    let _ = o;
    let _ = c.settle();
    assert_eq!(
        balance(&c, DEV) - before,
        1_700 * USD,
        "exactly 20% of paid released"
    );
    assert_eq!(balance(&c, unit_acc("a-4b")), 6_800 * USD);
    assert_eq!(
        view(&c, "get_unit", json!({ "unit_id": "a-4b" }))["released"],
        (1_700 * USD).to_string()
    );
}

#[test]
fn refund_after_missed_deadline_and_resale() {
    let c = setup();
    buy(&c, "a-4b", ALICE, 10_000 * USD);
    // resale first: alice lists, bob buys atomically
    ok(
        c.call(ESTATE, "list_for_sale")
            .from(ALICE)
            .args(json!({ "unit_id": "a-4b", "ask": (11_000 * USD).to_string() }).to_string())
            .attach(1)
            .fire()
            .unwrap(),
        "list",
    );
    for amt in [6_000 * USD, 5_000 * USD] {
        ok(
            c.call(USDC, "mint")
                .from(BOB)
                .args(json!({ "amount": amt.to_string() }).to_string())
                .attach(2 * MILLI)
                .fire()
                .unwrap(),
            "mint",
        );
    }
    let alice_before = balance(&c, ALICE);
    ok(c.call(USDC, "ft_transfer_call").from(BOB)
        .args(json!({ "receiver_id": ESTATE, "amount": (11_000 * USD).to_string(), "msg": json!({ "buy": "a-4b" }).to_string() }).to_string())
        .attach(1).fire().unwrap(), "buy listing");
    let _ = c.settle();
    assert_eq!(
        view(&c, "get_unit", json!({ "unit_id": "a-4b" }))["holder"],
        BOB
    );
    assert_eq!(
        balance(&c, ALICE) - alice_before,
        11_000 * USD,
        "seller paid"
    );
    assert_eq!(
        balance(&c, unit_acc("a-4b")),
        10_000 * USD,
        "escrow never moved"
    );

    // foundation deadline (T0+1h) + grace passes with no approval → bob refunds everything
    c.advance(3_600 + DAY + 60);
    let u = view(&c, "get_unit", json!({ "unit_id": "a-4b" }));
    assert_eq!(u["refunds_open"], true, "{u}");
    ok(
        c.call(ESTATE, "refund")
            .from(BOB)
            .args(json!({ "unit_id": "a-4b" }).to_string())
            .attach(1)
            .fire()
            .unwrap(),
        "refund",
    );
    let _ = c.settle();
    assert_eq!(balance(&c, BOB), 10_000 * USD);
    let u = view(&c, "get_unit", json!({ "unit_id": "a-4b" }));
    assert_eq!(u["status"], "Available", "{u}");
    assert!(
        view(&c, "nft_token", json!({ "token_id": "a-4b" })).is_null(),
        "token burned"
    );
}

#[test]
fn reused_photo_fails_and_nothing_releases() {
    let c = setup();
    buy(&c, "a-4b", ALICE, 8_500 * USD);
    ok(
        c.call(ESTATE, "open_capture")
            .from(QS)
            .args(json!({ "milestone": 0 }).to_string())
            .fire()
            .unwrap(),
        "open_capture",
    );
    ok(c.call(ESTATE, "submit_evidence").from(QS).args(json!({
        "milestone": 0, "url": "https://x.supabase.co/e/reuse.jpg", "sha256": "b".repeat(64), "captured_at": ns(T0), "device_gps": null
    }).to_string()).fire().unwrap(), "submit_evidence");
    let _ = c.settle();
    let ev = view(&c, "get_evidence", json!({ "id": "1" }));
    assert_eq!(ev["status"], "Fail", "{ev}");
    assert_eq!(ev["verdict"]["reasons"][0], "phash_reuse:3");
    assert_eq!(view(&c, "get_milestones", json!({}))[0]["status"], "Open");
    let sign = c
        .call(ESTATE, "qs_sign")
        .from(QS)
        .args(json!({ "milestone": 0 }).to_string())
        .fire()
        .unwrap();
    assert!(!sign.ok && sign.panic.unwrap_or_default().contains("E_NOT_VERIFIED"));
}

#[test]
fn holder_freeze_vote_blocks_release() {
    let c = setup();
    buy(&c, "a-4b", ALICE, 8_500 * USD);
    buy(&c, "b-2a", BOB, 8_500 * USD);
    buy(&c, "c-1a", CAROL, 8_500 * USD);
    // Freeze needs at least 3 eligible tokens and 25% of units allocated; opening a proposal costs 0.05 NEAR.
    let o = ok(c.call(ESTATE, "propose").from(ALICE).args(json!({ "kind": { "Freeze": { "reason": "No work for 6 weeks", "refunds_open": true } } }).to_string()).attach(50 * MILLI).fire().unwrap(), "propose");
    let pid: String = serde_json::from_slice(&o.return_data.unwrap()).unwrap();
    ok(
        c.call(ESTATE, "vote")
            .from(ALICE)
            .args(json!({ "proposal_id": pid, "approve": true }).to_string())
            .fire()
            .unwrap(),
        "vote alice",
    );
    assert!(
        view(&c, "get_estate", json!({}))["frozen"].is_null(),
        "1 of 3 tokens isn't a majority"
    );
    ok(
        c.call(ESTATE, "vote")
            .from(BOB)
            .args(json!({ "proposal_id": pid, "approve": true }).to_string())
            .fire()
            .unwrap(),
        "vote bob",
    );
    assert_eq!(
        view(&c, "get_estate", json!({}))["frozen"]["reason"],
        "No work for 6 weeks"
    );
    let r = c
        .call(ESTATE, "claim_release")
        .from(DEV)
        .args(json!({ "unit_ids": ["a-4b"] }).to_string())
        .fire()
        .unwrap();
    assert!(!r.ok && r.panic.unwrap_or_default().contains("E_FROZEN"));
    assert_eq!(
        view(&c, "get_unit", json!({ "unit_id": "a-4b" }))["refunds_open"],
        true
    );
}

fn mint(c: &MockChain, who: &'static str, amount: u128) {
    ok(
        c.call(USDC, "mint")
            .from(who)
            .args(json!({ "amount": amount.to_string() }).to_string())
            .attach(2 * MILLI)
            .fire()
            .unwrap(),
        "mint",
    );
}

fn reserve(c: &MockChain, unit: &str, who: &'static str) {
    ok(
        c.call(ESTATE, "reserve")
            .from(who)
            .args(json!({ "unit_id": unit }).to_string())
            .attach(50 * MILLI)
            .fire()
            .unwrap(),
        "reserve",
    );
}

fn plain_transfer(c: &MockChain, from: &'static str, to: &str, amount: u128) {
    ok(
        c.call(USDC, "ft_transfer")
            .from(from)
            .args(json!({ "receiver_id": to, "amount": amount.to_string() }).to_string())
            .attach(1)
            .fire()
            .unwrap(),
        "ft_transfer",
    );
}

/// Audit finding 1 (plain transfers): the public `sync` only checks; only the deposit reporter books a 1Click-style
/// delivery, through the real two-read promise chain, and never more than it attests or than is on the unit.
#[test]
fn plain_transfer_is_booked_only_by_the_reporter() {
    let c = setup();
    mint(&c, ALICE, 9_000 * USD);
    reserve(&c, "a-4b", ALICE);
    plain_transfer(&c, ALICE, unit_acc("a-4b"), 9_000 * USD);
    ok(
        c.call(ESTATE, "sync")
            .from(BOB)
            .args(json!({ "unit_id": "a-4b" }).to_string())
            .fire()
            .unwrap(),
        "sync",
    );
    assert_eq!(paid(&c, "a-4b"), 0, "the public check books nothing");
    let r = c
        .call(ESTATE, "report_deposit")
        .from(BOB)
        .args(json!({ "unit_id": "a-4b", "amount": "1" }).to_string())
        .fire()
        .unwrap();
    assert!(!r.ok && r.panic.unwrap_or_default().contains("E_NOT_RELAYER"));
    assert_eq!(
        report(&c, "a-4b", 5_000 * USD),
        5_000 * USD,
        "capped by the attested amount"
    );
    assert_eq!(
        report(&c, "a-4b", 9_000 * USD),
        4_000 * USD,
        "capped by what is on the unit"
    );
    assert_eq!(report(&c, "a-4b", 9_000 * USD), 0, "idempotent");
    let u = unit_view(&c, "a-4b");
    assert_eq!(u["paid"], (9_000 * USD).to_string());
    assert_eq!(u["status"], "Allocated", "{u}");
}

/// Audit findings 1-2 (ordering): a report whose balance read lands after a release changed the books credits
/// nothing (E_BALANCE_PENDING); a fresh report then books exactly the delivered amount.
#[test]
fn report_voided_when_a_release_lands_before_its_read() {
    let c = setup();
    buy(&c, "a-4b", ALICE, 10_000 * USD);
    ok(
        c.call(ESTATE, "open_capture")
            .from(QS)
            .args(json!({ "milestone": 0 }).to_string())
            .fire()
            .unwrap(),
        "open_capture",
    );
    ok(c.call(ESTATE, "submit_evidence").from(QS).args(json!({
        "milestone": 0, "url": "https://x.supabase.co/e/1.jpg", "sha256": "a".repeat(64), "captured_at": ns(T0), "device_gps": null
    }).to_string()).fire().unwrap(), "submit_evidence");
    let _ = c.settle();
    ok(
        c.call(ESTATE, "qs_sign")
            .from(QS)
            .args(json!({ "milestone": 0 }).to_string())
            .fire()
            .unwrap(),
        "qs_sign",
    );
    c.advance(DAY + 60);
    // 1Click delivers 1,000 more; the report's receipts are delayed...
    mint(&c, BOB, 1_000 * USD);
    plain_transfer(&c, BOB, unit_acc("a-4b"), 1_000 * USD);
    let o = c
        .call(ESTATE, "report_deposit")
        .from(RELAYER)
        .args(json!({ "unit_id": "a-4b", "amount": (1_000 * USD).to_string() }).to_string())
        .fire_deferred()
        .unwrap();
    assert!(o.ok, "{:?}", o.error);
    // ...while a release starts and lands
    ok(
        c.call(ESTATE, "claim_release")
            .from(DEV)
            .args(json!({ "unit_ids": ["a-4b"] }).to_string())
            .fire()
            .unwrap(),
        "claim_release",
    );
    let _ = c.settle();
    assert_eq!(unit_view(&c, "a-4b")["released"], (2_000 * USD).to_string());
    let rep = c.settle().unwrap();
    let _ = rep;
    assert_eq!(
        paid(&c, "a-4b"),
        10_000 * USD,
        "the stale report booked nothing"
    );
    assert_eq!(report(&c, "a-4b", 1_000 * USD), 1_000 * USD);
    assert_eq!(paid(&c, "a-4b"), 11_000 * USD);
    assert_eq!(
        balance(&c, unit_acc("a-4b")),
        9_000 * USD,
        "books match the chain"
    );
}

/// Audit finding 1 (ft_transfer_call): while a transfer call is pending the money is on the unit, but neither the
/// public check nor anything else books it; only `on_unit_deposit` does, once, from the accepted amount.
#[test]
fn pending_ft_transfer_call_is_not_booked_by_a_balance_read() {
    let c = setup();
    mint(&c, ALICE, 9_000 * USD);
    reserve(&c, "a-4b", ALICE);
    let o = c
        .call(USDC, "ft_transfer_call")
        .from(ALICE)
        .args(json!({ "receiver_id": unit_acc("a-4b"), "amount": (9_000 * USD).to_string(), "msg": "" }).to_string())
        .attach(1)
        .fire_deferred()
        .unwrap();
    assert!(o.ok, "{:?}", o.error);
    assert_eq!(
        balance(&c, unit_acc("a-4b")),
        9_000 * USD,
        "USDC credits the receiver first"
    );
    ok(
        c.call(ESTATE, "sync")
            .from(BOB)
            .args(json!({ "unit_id": "a-4b" }).to_string())
            .fire()
            .unwrap(),
        "sync",
    );
    let u = unit_view(&c, "a-4b");
    assert_eq!(
        (u["paid"].as_str(), u["unattributed"].as_str()),
        (Some("0"), Some("0")),
        "{u}"
    );
    assert!(view(&c, "nft_token", json!({ "token_id": "a-4b" })).is_null());
    let _ = c.settle();
    assert_eq!(
        paid(&c, "a-4b"),
        9_000 * USD,
        "booked once, from the accepted amount"
    );
    assert_eq!(unit_view(&c, "a-4b")["status"], "Allocated");
}

/// Audit finding 6 (ordering): a reservation refund that fails (here: receipt 0, the unit's `transfer_out`, is forced
/// to fail — near-mock doesn't propagate the nested `ft_transfer` failure of an unregistered receiver) goes to the
/// estate's own account and is owed to the reserver; the reservation ends anyway.
#[test]
fn failed_reservation_refund_becomes_owed() {
    let c = setup();
    const DAVE: &str = "dave.test.near"; // never registered on USDC
    reserve(&c, "b-2a", DAVE);
    mint(&c, BOB, 1_000 * USD);
    plain_transfer(&c, BOB, unit_acc("b-2a"), 1_000 * USD); // a 1Click payment for dave's reservation
    assert_eq!(report(&c, "b-2a", 1_000 * USD), 1_000 * USD);
    let o = c
        .call(ESTATE, "cancel_reservation")
        .from(DAVE)
        .args(json!({ "unit_id": "b-2a" }).to_string())
        .attach(1)
        .fail_receipt(0)
        .fire()
        .unwrap();
    assert!(o.ok, "{:?}", o.error);
    let _ = c.settle();
    let u = unit_view(&c, "b-2a");
    assert_eq!(u["status"], "Available", "{u}");
    assert_eq!(u["in_flight"], "0");
    assert_eq!(balance(&c, unit_acc("b-2a")), 0);
    assert_eq!(
        view(&c, "owed_of", json!({ "account_id": DAVE })),
        json!((1_000 * USD).to_string())
    );
    ok(
        c.call(USDC, "storage_deposit")
            .from(DAVE)
            .args(json!({ "account_id": DAVE, "registration_only": true }).to_string())
            .attach(1_250 * MILLI / 1000)
            .fire()
            .unwrap(),
        "register dave",
    );
    ok(
        c.call(ESTATE, "withdraw_owed")
            .from(DAVE)
            .args("{}")
            .fire()
            .unwrap(),
        "withdraw_owed",
    );
    let _ = c.settle();
    assert_eq!(balance(&c, DAVE), 1_000 * USD);
}

/// Audit finding 3: holder methods need exactly 1 yoctoNEAR in the real WASM (#[payable] + assert_one_yocto).
#[test]
fn holder_methods_need_one_yocto_on_chain() {
    let c = setup();
    buy(&c, "a-4b", ALICE, 10_000 * USD);
    reserve(&c, "b-2a", BOB);
    let calls: Vec<(&'static str, &'static str, Value)> = vec![
        (
            ALICE,
            "list_for_sale",
            json!({ "unit_id": "a-4b", "ask": (12_000 * USD).to_string() }),
        ),
        (ALICE, "cancel_listing", json!({ "unit_id": "a-4b" })),
        (
            ALICE,
            "set_beneficiary",
            json!({ "unit_id": "a-4b", "beneficiary": CAROL }),
        ),
        (
            ALICE,
            "set_guardians",
            json!({ "unit_id": "a-4b", "guardians": [BOB, CAROL] }),
        ),
        (
            BOB,
            "guardian_recover",
            json!({ "unit_id": "a-4b", "new_owner": "alice2.test.near" }),
        ),
        (ALICE, "cancel_recovery", json!({ "unit_id": "a-4b" })),
        (
            ALICE,
            "set_lien",
            json!({ "unit_id": "a-4b", "lender": CAROL, "cap": "1" }),
        ),
        (CAROL, "clear_lien", json!({ "unit_id": "a-4b" })),
        (DEV, "set_app_url", json!({ "url": "https://plote.app" })),
        (BOB, "cancel_reservation", json!({ "unit_id": "b-2a" })),
    ];
    for (who, method, args) in calls {
        let r = c
            .call(ESTATE, method)
            .from(who)
            .args(args.to_string())
            .fire()
            .unwrap();
        assert!(
            !r.ok && r.panic.clone().unwrap_or_default().contains("1 yoctoNEAR"),
            "{method} without 1 yocto: {:?}",
            r.panic
        );
        ok(
            c.call(ESTATE, method)
                .from(who)
                .args(args.to_string())
                .attach(1)
                .fire()
                .unwrap(),
            method,
        );
        let _ = c.settle();
    }
    assert_eq!(
        view(&c, "get_estate", json!({}))["app_url"],
        "https://plote.app"
    );
}
