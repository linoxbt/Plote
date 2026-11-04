//! Unit tests that simulate the chain around the estate: unit balances, cross-contract callbacks
//! and the clock. Names follow SPEC 17.1 (flow::, refund::, resale::, default::, verify::, vote::, ...).

use crate::milestones::extract_verdict;
use crate::views::UnitView;
use crate::*;
use near_contract_standards::non_fungible_token::metadata::{
    NFTContractMetadata, NFT_METADATA_SPEC,
};
use near_sdk::json_types::{Base58CryptoHash, U128, U64};
use near_sdk::mock::MockAction;
use near_sdk::serde_json::{self, json};
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::{testing_env, AccountId, PromiseOrValue, PromiseResult, RuntimeFeesConfig};
use std::collections::HashMap;

const USDC: u128 = 1_000_000;
const PRICE: u128 = 85_000 * USDC;
const T0: u64 = 1_800_000_000_000_000_000; // ~2027
const MIN: u64 = 60_000_000_000;
const PHASH: &str = "8e71c0d2a4b39f05";

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn estate_id() -> AccountId {
    acc("estate.testnet")
}

fn unit_acc(id: &str) -> AccountId {
    acc(&format!("{}.estate.testnet", id))
}

struct Env {
    c: Estate,
    now: u64,
    bal: HashMap<String, u128>,
}

fn params(playground: bool) -> Params {
    Params {
        reserve_ttl_ns: U64(30 * MIN),
        min_initial_bps: 1_000,
        mobilisation_bps: 0,
        grace_ns: U64(2 * MIN),
        veto_window_ns: U64(2 * MIN),
        default_grace_ns: U64(2 * MIN),
        penalty_bps: 500,
        dust_threshold: U128(USDC),
        late_claim_ns: U64(10 * MIN),
        capture_ttl_ns: U64(30 * MIN),
        proposal_period_ns: U64(10 * MIN),
        max_phash_distance: 8,
        max_exif_age_h: 72,
        min_ai_confidence: 70,
        demo_mode: true,
        playground,
    }
}

fn new_args(p: Params, deadlines: [u64; 4]) -> NewArgs {
    let keys = ["foundation", "roofing", "finishing", "handover"];
    let bps = [2000u16, 3000, 3000, 2000];
    let hash: Base58CryptoHash = [7u8; 32].into();
    NewArgs {
        developer_id: acc("dev.testnet"),
        payout_id: acc("payout.testnet"),
        surveyor_id: acc("qs.testnet"),
        recovery_id: acc("plote.testnet"),
        usdc_id: acc("usdc.testnet"),
        outlayer_id: acc("outlayer.testnet"),
        verdict_relayer: Some(acc("relayer.testnet")),
        verify_mode: None,
        verifier: VerifierSource {
            repo: "https://github.com/x/plote-verifier".into(),
            commit: "abc".into(),
            build_target: "wasm32-wasip2".into(),
        },
        unit_code_hash: hash,
        name: "Harmattan Court".into(),
        location: "Lekki, Lagos".into(),
        geofence: Geofence {
            lat_e6: 6_447_000,
            lon_e6: 3_474_000,
            radius_m: 300,
        },
        milestones: (0..4)
            .map(|i| MilestoneInput {
                key: keys[i].into(),
                title: keys[i].into(),
                bps: bps[i],
                deadline: U64(deadlines[i]),
            })
            .collect(),
        params: p,
        nft_metadata: NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: "Harmattan Court allocations".into(),
            symbol: "PLOTE".into(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        },
        app_url: None,
    }
}

fn set_ctx(now: u64, who: &AccountId, deposit: NearToken, results: Vec<PromiseResult>) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(estate_id())
        .predecessor_account_id(who.clone())
        .signer_account_id(who.clone())
        .attached_deposit(deposit)
        .block_timestamp(now)
        .account_balance(NearToken::from_near(100));
    testing_env!(
        b.build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        results
    );
}

fn fresh(a: NewArgs) -> Env {
    set_ctx(
        T0,
        &acc("deployer.testnet"),
        NearToken::from_yoctonear(0),
        vec![],
    );
    Env {
        c: Estate::new(a),
        now: T0,
        bal: HashMap::new(),
    }
}

impl Env {
    fn ctx(&self, who: &AccountId, deposit: NearToken, results: Vec<PromiseResult>) {
        set_ctx(self.now, who, deposit, results);
    }

    fn as_(&self, who: &str) {
        self.ctx(&acc(who), NearToken::from_yoctonear(0), vec![]);
    }

    fn as_dep(&self, who: &str, d: NearToken) {
        self.ctx(&acc(who), d, vec![]);
    }

    fn cb(&self, results: Vec<PromiseResult>) {
        self.ctx(&estate_id(), NearToken::from_yoctonear(0), results);
    }

    fn new_with(p: Params, deadlines: [u64; 4], units: &[(&str, u128, Vec<Instalment>)]) -> Env {
        let mut e = fresh(new_args(p, deadlines));
        e.as_dep("dev.testnet", NearToken::from_near(5));
        e.c.add_units(
            units
                .iter()
                .map(|(id, price, plan)| UnitInput {
                    id: id.to_string(),
                    label: format!("Unit {}", id),
                    price: U128(*price),
                    plan: plan.clone(),
                })
                .collect(),
        );
        for (id, _, _) in units {
            e.cb(vec![PromiseResult::Successful(vec![])]);
            assert!(e.c.on_unit_created(id.to_string()));
            e.bal.insert(id.to_string(), 0);
        }
        e.as_dep("dev.testnet", NearToken::from_near(1));
        e.c.fund_verification();
        e
    }

    fn standard() -> Env {
        let d = [
            T0 + 60 * MIN,
            T0 + 120 * MIN,
            T0 + 180 * MIN,
            T0 + 240 * MIN,
        ];
        Env::new_with(
            params(false),
            d,
            &[
                ("a-1a", PRICE, vec![]),
                ("a-4b", PRICE, vec![]),
                ("b-2a", PRICE, vec![]),
            ],
        )
    }

    fn advance(&mut self, ns: u64) {
        self.now += ns;
        self.as_("viewer.testnet");
    }

    fn unit(&self, id: &str) -> UnitView {
        self.as_("viewer.testnet");
        self.c.get_unit(id.to_string()).unwrap()
    }

    /// The chain's view of the unit's USDC balance after `amount` lands on it.
    fn land(&mut self, id: &str, amount: u128) {
        *self.bal.get_mut(id).unwrap() += amount;
    }

    fn sync(&mut self, id: &str) -> u128 {
        self.as_("anyone.testnet");
        let _ = self.c.sync(id.to_string());
        self.cb(vec![PromiseResult::Successful(
            serde_json::to_vec(&U128(self.bal[id])).unwrap(),
        )]);
        self.c.on_balance(id.to_string()).0
    }

    /// ft_transfer_call from a wallet into the unit account (Path A).
    fn wallet_pay(&mut self, id: &str, from: &str, amount: u128) -> u128 {
        self.land(id, amount);
        self.ctx(&unit_acc(id), NearToken::from_yoctonear(0), vec![]);
        let unused = self
            .c
            .on_unit_deposit(id.to_string(), acc(from), U128(amount), String::new())
            .0;
        // NEP-141 resolve gives back the unused part.
        *self.bal.get_mut(id).unwrap() -= unused;
        if unused == 0 {
            self.cb(vec![PromiseResult::Successful(
                serde_json::to_vec(&U128(self.bal[id])).unwrap(),
            )]);
            self.c.on_balance(id.to_string());
        }
        unused
    }

    fn reserve(&mut self, id: &str, who: &str) {
        self.as_dep(who, RESERVE_DEPOSIT);
        self.c.reserve(id.to_string());
    }

    fn buy(&mut self, id: &str, who: &str, amount: u128) {
        self.reserve(id, who);
        assert_eq!(self.wallet_pay(id, who, amount), 0);
    }

    /// Complete the pending transfer out of a unit (callback), succeeding or failing.
    fn finish_out(&mut self, id: &str, kind: OutKind, to: &str, amount: u128, ok: bool) -> bool {
        if ok {
            *self.bal.get_mut(id).unwrap() -= amount;
        }
        self.cb(vec![if ok {
            PromiseResult::Successful(vec![])
        } else {
            PromiseResult::Failed
        }]);
        self.c.on_out(id.to_string(), kind, acc(to), U128(amount))
    }

    fn approve_milestone(&mut self, m: u8) {
        let id = self.submit(m, "qs.testnet");
        self.verdict(id, true, &[]);
        self.as_("qs.testnet");
        self.c.qs_sign(m);
    }

    fn submit(&mut self, m: u8, who: &str) -> u64 {
        self.as_(who);
        let code = self.c.open_capture(m);
        assert_eq!(code.len(), 6);
        self.c
            .submit_evidence(
                m,
                "https://x.supabase.co/e/1.jpg".into(),
                "a".repeat(64),
                U64(self.now),
                None,
            )
            .0
    }

    fn verdict(&mut self, ev: u64, pass: bool, reasons: &[&str]) -> bool {
        let v = json!({ "evidence_id": ev, "pass": pass, "reasons": reasons, "warnings": [], "phash": PHASH,
            "nearest_distance": 27, "exif_time": 1793739420000000000u64, "gps": [6447118, 3474201], "gps_source": "exif",
            "distance_m": 23, "ai_stage": "roofing", "ai_confidence": 88, "challenge_read": "K7RQ4M", "ai_chat_id": "chatcmpl-1",
            "worker_commit": "abc" });
        self.cb(vec![PromiseResult::Successful(v.to_string().into_bytes())]);
        self.c.on_verdict(ev)
    }

    /// Conservation (SPEC 5.10 #2) for every unit, against the simulated chain balances.
    fn check_conservation(&self) {
        for (id, bal) in &self.bal {
            let u = self.unit(id);
            if u.in_flight.0 > 0 {
                continue;
            }
            assert_eq!(
                u.paid.0 + u.unattributed.0,
                bal + u.released.0 + u.refunded_out.0,
                "conservation broken for {}: {:?}",
                id,
                (u.paid, u.unattributed, u.released, u.refunded_out, bal)
            );
            assert!(
                u.released.0 <= u.paid.0.min(u.price.0),
                "release cap broken for {}",
                id
            );
        }
    }
}

fn ft_transfers() -> Vec<(String, AccountId, u128)> {
    let mut out = vec![];
    for r in get_created_receipts() {
        for a in r.actions {
            if let MockAction::FunctionCallWeight {
                method_name, args, ..
            } = a
            {
                let m = String::from_utf8(method_name).unwrap();
                if m == "ft_transfer" || m == "transfer_out" {
                    let v: serde_json::Value = serde_json::from_slice(&args).unwrap();
                    let amt: u128 = v["amount"].as_str().unwrap().parse().unwrap();
                    out.push((m, v["receiver_id"].as_str().unwrap().parse().unwrap(), amt));
                }
            }
        }
    }
    out
}

fn panics<F: FnOnce() + std::panic::UnwindSafe>(code: &str, f: F) {
    let r = std::panic::catch_unwind(f);
    let err = r.expect_err("expected a panic");
    let msg = err
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| err.downcast_ref::<&str>().map(|s| s.to_string()))
        .unwrap_or_default();
    assert!(
        msg.contains(code),
        "expected {} in panic, got: {}",
        code,
        msg
    );
}

// ---------------------------------------------------------------- init

#[test]
fn init_validates_bps_and_deadlines() {
    let e = Env::standard();
    e.as_("deployer.testnet");
    let mut a = new_args(params(false), [T0 + 1, T0 + 2, T0 + 3, T0 + 4]);
    a.milestones[0].bps = 1000;
    panics("E_BPS_SUM", move || {
        Estate::new(a);
    });
    let b = new_args(params(false), [T0 + 4, T0 + 3, T0 + 2, T0 + 1]);
    panics("E_DEADLINES", move || {
        Estate::new(b);
    });
    let mut p = params(false);
    p.mobilisation_bps = 1000;
    let mut c = new_args(p, [T0 + 1, T0 + 2, T0 + 3, T0 + 4]);
    c.milestones[3].bps = 1000; // 2000+3000+3000+1000 + 1000 = 10000
    Estate::new(c);
}

#[test]
fn add_units_creates_accounts_and_validates() {
    let mut e = Env::standard();
    assert_eq!(e.c.list_units(None, None).len(), 3);
    assert_eq!(e.unit("a-4b").account, unit_acc("a-4b"));
    e.as_dep("dev.testnet", NearToken::from_near(1));
    let bad = vec![UnitInput {
        id: "A_4B".into(),
        label: "x".into(),
        price: U128(1),
        plan: vec![],
    }];
    panics(
        "E_BAD_UNIT_ID",
        std::panic::AssertUnwindSafe(|| e.c.add_units(bad)),
    );
    e.as_dep("dev.testnet", NearToken::from_near(1));
    let dup = vec![UnitInput {
        id: "a-4b".into(),
        label: "x".into(),
        price: U128(1),
        plan: vec![],
    }];
    panics(
        "E_UNIT_EXISTS",
        std::panic::AssertUnwindSafe(|| e.c.add_units(dup)),
    );
    e.as_dep("mallory.testnet", NearToken::from_near(1));
    let ok = vec![UnitInput {
        id: "c-1".into(),
        label: "x".into(),
        price: U128(1),
        plan: vec![],
    }];
    panics(
        "E_NOT_DEVELOPER",
        std::panic::AssertUnwindSafe(|| e.c.add_units(ok)),
    );
    // failed creation removes the record
    e.as_dep("dev.testnet", NearToken::from_near(1));
    e.c.add_units(vec![UnitInput {
        id: "c-2".into(),
        label: "x".into(),
        price: U128(1),
        plan: vec![],
    }]);
    e.cb(vec![PromiseResult::Failed]);
    assert!(!e.c.on_unit_created("c-2".into()));
    assert!(e.c.get_unit("c-2".into()).is_none());
}

// ---------------------------------------------------------------- flow

#[test]
fn flow_happy_path() {
    let mut e = Env::standard();
    e.buy("a-4b", "alice.testnet", PRICE / 10);
    let u = e.unit("a-4b");
    assert_eq!(u.status, UnitStatus::Allocated);
    assert_eq!(u.holder, Some(acc("alice.testnet")));
    assert_eq!(
        e.c.nft_token("a-4b".into()).unwrap().owner_id,
        acc("alice.testnet")
    );
    assert!(get_logs().iter().any(|l| l.contains("nft_mint")) || e.c.nft_total_supply().0 == 1);

    e.approve_milestone(0);
    assert_eq!(e.unit("a-4b").releasable_now.0, 0, "veto window still open");
    e.advance(3 * MIN);
    let due = e.unit("a-4b").releasable_now.0;
    assert_eq!(due, PRICE / 10 * 2000 / 10_000);
    e.as_("anyone.testnet");
    assert_eq!(e.c.claim_release(vec!["a-4b".into(), "a-1a".into()]), 1);
    let t = ft_transfers();
    assert!(t
        .iter()
        .any(|(m, to, a)| m == "transfer_out" && to == &acc("payout.testnet") && *a == due));
    e.finish_out("a-4b", OutKind::Release, "payout.testnet", due, true);
    assert_eq!(e.unit("a-4b").released.0, due);
    assert_eq!(e.unit("a-4b").releasable_now.0, 0);
    e.check_conservation();
}

#[test]
fn flow_double_mint_impossible() {
    let mut e = Env::standard();
    e.buy("a-4b", "alice.testnet", PRICE / 10);
    e.as_dep("bob.testnet", RESERVE_DEPOSIT);
    panics(
        "E_UNIT_TAKEN",
        std::panic::AssertUnwindSafe(|| e.c.reserve("a-4b".into())),
    );
    assert_eq!(e.c.nft_total_supply().0, 1);
}

#[test]
fn flow_plain_transfer_sync_like_1click() {
    let mut e = Env::standard();
    e.reserve("a-1a", "alice.testnet");
    e.land("a-1a", 3_000 * USDC); // plain ft_transfer: no callback
    assert_eq!(e.unit("a-1a").paid.0, 0);
    assert_eq!(e.sync("a-1a"), 3_000 * USDC);
    assert_eq!(e.unit("a-1a").paid.0, 3_000 * USDC);
    assert_eq!(e.unit("a-1a").status, UnitStatus::Reserved, "below 10%");
    e.land("a-1a", 6_000 * USDC);
    e.sync("a-1a");
    assert_eq!(e.unit("a-1a").status, UnitStatus::Allocated);
    assert_eq!(e.sync("a-1a"), 0, "idempotent");
    e.check_conservation();
}

#[test]
fn flow_reservation_expiry_and_cancel() {
    let mut e = Env::standard();
    e.reserve("a-1a", "alice.testnet");
    assert_eq!(e.wallet_pay("a-1a", "alice.testnet", 1_000 * USDC), 0);
    e.as_("bob.testnet");
    panics(
        "E_RESERVATION_ACTIVE",
        std::panic::AssertUnwindSafe(|| {
            let _ = e.c.expire_reservation("a-1a".into());
        }),
    );
    e.advance(31 * MIN);
    e.as_("bob.testnet");
    match e.c.expire_reservation("a-1a".into()) {
        PromiseOrValue::Promise(_) => {}
        _ => panic!("expected a refund promise"),
    }
    e.finish_out(
        "a-1a",
        OutKind::ReservationRefund,
        "alice.testnet",
        1_000 * USDC,
        true,
    );
    let u = e.unit("a-1a");
    assert_eq!(u.status, UnitStatus::Available);
    assert_eq!(u.paid.0, 0);
    assert_eq!(u.last_reservation.unwrap().by, acc("alice.testnet"));
    e.check_conservation();
    // cancel with nothing paid is synchronous
    e.reserve("a-1a", "carol.testnet");
    e.as_("carol.testnet");
    assert!(matches!(
        e.c.cancel_reservation("a-1a".into()),
        PromiseOrValue::Value(true)
    ));
    assert_eq!(e.unit("a-1a").status, UnitStatus::Available);
}

#[test]
fn deposit_bounce_unreserved() {
    let mut e = Env::standard();
    let unused = e.wallet_pay("b-2a", "stranger.testnet", 500 * USDC);
    assert_eq!(unused, 500 * USDC, "bounced in full");
    assert_eq!(e.bal["b-2a"], 0);
    assert_eq!(e.unit("b-2a").unattributed.0, 0);
    // only the unit account can report deposits
    e.as_("mallory.testnet");
    panics(
        "E_NOT_UNIT",
        std::panic::AssertUnwindSafe(|| {
            e.c.on_unit_deposit("b-2a".into(), acc("x.testnet"), U128(1), String::new());
        }),
    );
}

#[test]
fn sweep_dust_and_late_claim() {
    let mut e = Env::standard();
    // dust: credited to the next reserver, never blocks
    e.land("a-1a", USDC / 2);
    e.sync("a-1a");
    assert_eq!(e.unit("a-1a").unattributed.0, USDC / 2);
    e.as_("anyone.testnet");
    panics(
        "E_NOTHING_TO_SWEEP",
        std::panic::AssertUnwindSafe(|| {
            let _ = e.c.sweep_unattributed("a-1a".into());
        }),
    );
    e.reserve("a-1a", "alice.testnet");
    assert_eq!(e.unit("a-1a").paid.0, USDC / 2);
    e.check_conservation();

    // late 1Click delivery after a lapsed reservation → the lapsed reserver can get it back
    e.reserve("b-2a", "bob.testnet");
    e.advance(31 * MIN);
    e.as_("anyone.testnet");
    let _ = e.c.expire_reservation("b-2a".into());
    e.land("b-2a", 5 * USDC);
    e.sync("b-2a");
    assert_eq!(e.unit("b-2a").unattributed.0, 5 * USDC);
    e.as_dep("carol.testnet", RESERVE_DEPOSIT);
    panics(
        "E_BALANCE_PENDING",
        std::panic::AssertUnwindSafe(|| e.c.reserve("b-2a".into())),
    );
    e.as_("anyone.testnet");
    let _ = e.c.sweep_unattributed("b-2a".into());
    assert!(ft_transfers()
        .iter()
        .any(|(_, to, a)| to == &acc("bob.testnet") && *a == 5 * USDC));
    e.finish_out("b-2a", OutKind::Sweep, "bob.testnet", 5 * USDC, true);
    assert_eq!(e.unit("b-2a").unattributed.0, 0);
    e.check_conservation();

    // after late_claim_ns it goes to recovery_id
    e.land("b-2a", 7 * USDC);
    e.sync("b-2a");
    e.advance(11 * MIN);
    e.as_("anyone.testnet");
    let _ = e.c.sweep_unattributed("b-2a".into());
    assert!(ft_transfers()
        .iter()
        .any(|(_, to, a)| to == &acc("plote.testnet") && *a == 7 * USDC));
}

#[test]
fn excess_withdraw() {
    let mut e = Env::standard();
    e.buy("a-4b", "alice.testnet", PRICE + PRICE / 10);
    assert_eq!(e.unit("a-4b").excess_now.0, PRICE / 10);
    e.as_dep("alice.testnet", NearToken::from_yoctonear(1));
    let _ = e.c.withdraw_excess("a-4b".into());
    e.finish_out("a-4b", OutKind::Excess, "alice.testnet", PRICE / 10, true);
    assert_eq!(e.unit("a-4b").excess_now.0, 0);
    // all milestones approved → release capped at price
    for m in 0..4 {
        e.approve_milestone(m);
    }
    e.advance(3 * MIN);
    assert_eq!(e.unit("a-4b").releasable_now.0, PRICE);
    e.check_conservation();
    e.as_dep("alice.testnet", NearToken::from_yoctonear(1));
    panics(
        "E_NO_EXCESS",
        std::panic::AssertUnwindSafe(|| {
            let _ = e.c.withdraw_excess("a-4b".into());
        }),
    );
}

#[test]
fn release_math_rounds_down_and_mobilisation() {
    let mut p = params(false);
    p.mobilisation_bps = 1000;
    let d = [
        T0 + 60 * MIN,
        T0 + 120 * MIN,
        T0 + 180 * MIN,
        T0 + 240 * MIN,
    ];
    let mut args_units = vec![("m-1", 1_000_001u128, vec![])];
    let mut e = {
        let mut a = new_args(p.clone(), d);
        a.milestones[3].bps = 1000;
        let mut e = fresh(a);
        e.as_dep("dev.testnet", NearToken::from_near(1));
        e.c.add_units(
            args_units
                .drain(..)
                .map(|(id, price, plan)| UnitInput {
                    id: id.into(),
                    label: "x".into(),
                    price: U128(price),
                    plan,
                })
                .collect(),
        );
        e.cb(vec![PromiseResult::Successful(vec![])]);
        e.c.on_unit_created("m-1".into());
        e.bal.insert("m-1".into(), 0);
        e
    };
    e.buy("m-1", "alice.testnet", 333_333);
    // mobilisation 10% unlocked at allocation; 333_333 * 1000 / 10000 = 33_333 (rounded down)
    assert_eq!(e.unit("m-1").releasable_now.0, 33_333);
}

// ---------------------------------------------------------------- refunds

#[test]
fn refund_missed_deadline() {
    let mut e = Env::standard();
    e.buy("a-4b", "alice.testnet", 10_000 * USDC);
    e.approve_milestone(0);
    e.advance(3 * MIN);
    e.as_("anyone.testnet");
    e.c.claim_release(vec!["a-4b".into()]);
    e.finish_out(
        "a-4b",
        OutKind::Release,
        "payout.testnet",
        2_000 * USDC,
        true,
    );

    e.as_dep("alice.testnet", NearToken::from_yoctonear(1));
    panics(
        "E_NO_REFUND_YET",
        std::panic::AssertUnwindSafe(|| {
            let _ = e.c.refund("a-4b".into());
        }),
    );
    // roofing deadline (T0+120min) + grace passes without approval
    e.now = T0 + 123 * MIN;
    assert!(e.unit("a-4b").refunds_open);
    assert_eq!(e.unit("a-4b").refundable_now.0, 8_000 * USDC);
    e.as_dep("bob.testnet", NearToken::from_yoctonear(1));
    panics(
        "E_NOT_HOLDER",
        std::panic::AssertUnwindSafe(|| {
            let _ = e.c.refund("a-4b".into());
        }),
    );
    e.as_dep("alice.testnet", NearToken::from_yoctonear(1));
    let _ = e.c.refund("a-4b".into());
    e.finish_out("a-4b", OutKind::Refund, "alice.testnet", 8_000 * USDC, true);
    let u = e.unit("a-4b");
    assert_eq!(u.status, UnitStatus::Available);
    assert!(u.holder.is_none());
    assert!(e.c.nft_token("a-4b".into()).is_none());
    assert_eq!(e.c.nft_supply_for_owner(acc("alice.testnet")).0, 0);
    assert_eq!(e.bal["a-4b"], 0);
    assert_eq!(e.c.dev_stats().units_refunded, 1);
    e.check_conservation();
}

#[test]
fn refund_failed_transfer_keeps_everything() {
    let mut e = Env::standard();
    e.buy("a-4b", "alice.testnet", 10_000 * USDC);
    e.now = T0 + 63 * MIN; // foundation missed
    e.as_dep("alice.testnet", NearToken::from_yoctonear(1));
    let _ = e.c.refund("a-4b".into());
    assert_eq!(e.unit("a-4b").in_flight.0, 10_000 * USDC);
    e.as_("anyone.testnet");
    panics(
        "E_IN_FLIGHT",
        std::panic::AssertUnwindSafe(|| {
            let _ = e.c.sync("a-4b".into());
        }),
    );
    e.finish_out(
        "a-4b",
        OutKind::Refund,
        "alice.testnet",
        10_000 * USDC,
        false,
    );
    let u = e.unit("a-4b");
    assert_eq!(u.in_flight.0, 0);
    assert_eq!(u.status, UnitStatus::Allocated);
    e.check_conservation();
}

#[test]
fn refund_extend_deadline_vote_closes_refunds() {
    let mut e = Env::standard();
    e.buy("a-4b", "alice.testnet", 10_000 * USDC);
    e.buy("a-1a", "bob.testnet", 10_000 * USDC);
    e.now = T0 + 63 * MIN;
    assert!(e.unit("a-4b").refunds_open);
    e.as_("dev.testnet");
    let pid = e.c.propose(ProposalKind::ExtendDeadline {
        milestone: 0,
        new_deadline: U64(T0 + 100 * MIN),
    });
    e.as_("alice.testnet");
    e.c.vote(pid, true);
    assert!(e.unit("a-4b").refunds_open, "1 of 2 isn't a majority");
    e.as_("bob.testnet");
    e.c.vote(pid, true);
    assert_eq!(
        e.c.get_proposal(pid).unwrap().status,
        ProposalStatus::Executed
    );
    assert!(!e.unit("a-4b").refunds_open);
}

// ---------------------------------------------------------------- resale and default

#[test]
fn resale_voluntary() {
    let mut e = Env::standard();
    e.buy("a-4b", "alice.testnet", 20_000 * USDC);
    e.as_("alice.testnet");
    e.c.list_for_sale("a-4b".into(), U128(21_000 * USDC));
    e.as_("usdc.testnet");
    let r = e.c.ft_on_transfer(
        acc("bob.testnet"),
        U128(21_500 * USDC),
        json!({ "buy": "a-4b" }).to_string(),
    );
    match r {
        PromiseOrValue::Value(v) => assert_eq!(v.0, 500 * USDC),
        _ => panic!(),
    }
    assert!(ft_transfers().iter().any(|(m, to, a)| m == "ft_transfer"
        && to == &acc("alice.testnet")
        && *a == 21_000 * USDC));
    let u = e.unit("a-4b");
    assert_eq!(u.holder, Some(acc("bob.testnet")));
    assert!(u.listing.is_none());
    assert_eq!(u.paid.0, 20_000 * USDC, "escrow stays with the unit");
    assert_eq!(
        e.c.nft_tokens_for_owner(acc("bob.testnet"), None, None)
            .len(),
        1
    );
    e.check_conservation();
}

#[test]
fn resale_underpaid_and_wrong_token() {
    let mut e = Env::standard();
    e.buy("a-4b", "alice.testnet", 20_000 * USDC);
    e.as_("alice.testnet");
    e.c.list_for_sale("a-4b".into(), U128(21_000 * USDC));
    e.as_("usdc.testnet");
    match e.c.ft_on_transfer(
        acc("bob.testnet"),
        U128(20_999 * USDC),
        json!({ "buy": "a-4b" }).to_string(),
    ) {
        PromiseOrValue::Value(v) => assert_eq!(v.0, 20_999 * USDC),
        _ => panic!(),
    }
    assert_eq!(e.unit("a-4b").holder, Some(acc("alice.testnet")));
    e.as_("fake-usdc.testnet");
    match e.c.ft_on_transfer(
        acc("bob.testnet"),
        U128(30_000 * USDC),
        json!({ "buy": "a-4b" }).to_string(),
    ) {
        PromiseOrValue::Value(v) => assert_eq!(v.0, 30_000 * USDC),
        _ => panic!(),
    }
    assert_eq!(e.unit("a-4b").holder, Some(acc("alice.testnet")));
}

#[test]
fn default_penalty() {
    let d = [
        T0 + 600 * MIN,
        T0 + 700 * MIN,
        T0 + 800 * MIN,
        T0 + 900 * MIN,
    ];
    let plan = vec![Instalment {
        due_at: U64(T0 + 10 * MIN),
        cumulative: U128(30_000 * USDC),
    }];
    let mut e = Env::new_with(params(false), d, &[("a-4b", PRICE, plan)]);
    e.buy("a-4b", "alice.testnet", 10_000 * USDC);
    e.as_("anyone.testnet");
    panics(
        "E_NOT_DUE",
        std::panic::AssertUnwindSafe(|| e.c.declare_default("a-4b".into())),
    );
    e.advance(13 * MIN);
    e.as_("anyone.testnet");
    e.c.declare_default("a-4b".into());
    let u = e.unit("a-4b");
    assert_eq!(u.status, UnitStatus::InDefault);
    assert_eq!(u.listing.as_ref().unwrap().ask.0, 10_000 * USDC);
    // the defaulter can't move the token outside a sale
    e.as_dep("alice.testnet", NearToken::from_yoctonear(1));
    panics(
        "E_LISTING",
        std::panic::AssertUnwindSafe(|| {
            e.c.nft_transfer(acc("friend.testnet"), "a-4b".into(), None, None)
        }),
    );
    e.as_("usdc.testnet");
    let _ = e.c.ft_on_transfer(
        acc("bob.testnet"),
        U128(10_000 * USDC),
        json!({ "buy": "a-4b" }).to_string(),
    );
    let t = ft_transfers();
    assert!(
        t.iter()
            .any(|(_, to, a)| to == &acc("alice.testnet") && *a == 9_500 * USDC),
        "{:?}",
        t
    );
    assert!(
        t.iter()
            .any(|(_, to, a)| to == &acc("payout.testnet") && *a == 500 * USDC),
        "{:?}",
        t
    );
    let u = e.unit("a-4b");
    assert_eq!(u.status, UnitStatus::Allocated);
    assert_eq!(u.holder, Some(acc("bob.testnet")));
    assert_eq!(
        u.paid.0,
        10_000 * USDC,
        "new holder inherits the paid credit"
    );
    assert_eq!(
        u.next_due.unwrap().shortfall.0,
        20_000 * USDC,
        "and the remaining plan"
    );
}

#[test]
fn default_cured_by_paying() {
    let d = [
        T0 + 600 * MIN,
        T0 + 700 * MIN,
        T0 + 800 * MIN,
        T0 + 900 * MIN,
    ];
    let plan = vec![Instalment {
        due_at: U64(T0 + 10 * MIN),
        cumulative: U128(30_000 * USDC),
    }];
    let mut e = Env::new_with(params(false), d, &[("a-4b", PRICE, plan)]);
    e.buy("a-4b", "alice.testnet", 10_000 * USDC);
    e.advance(13 * MIN);
    e.as_("anyone.testnet");
    e.c.declare_default("a-4b".into());
    assert_eq!(e.wallet_pay("a-4b", "alice.testnet", 20_000 * USDC), 0);
    let u = e.unit("a-4b");
    assert_eq!(u.status, UnitStatus::Allocated);
    assert!(u.listing.is_none());
}

#[test]
fn estate_payout_failure_becomes_owed() {
    let mut e = Env::standard();
    e.cb(vec![PromiseResult::Failed]);
    assert!(!e.c.on_estate_payout(acc("alice.testnet"), U128(42)));
    assert_eq!(e.c.owed_of(acc("alice.testnet")).0, 42);
    e.as_("alice.testnet");
    let _ = e.c.withdraw_owed();
    assert_eq!(e.c.owed_of(acc("alice.testnet")).0, 0);
}

// ---------------------------------------------------------------- verification

#[test]
fn verify_fail_reasons_reopen_milestone() {
    let mut e = Env::standard();
    e.buy("a-4b", "alice.testnet", 10_000 * USDC);
    let ev = e.submit(1, "qs.testnet");
    assert_eq!(e.c.get_milestones()[1].status, MilestoneStatus::Checking);
    assert!(!e.verdict(ev, false, &["phash_reuse:3"]));
    assert_eq!(e.c.get_milestones()[1].status, MilestoneStatus::Open);
    let v = e.c.get_evidence(U64(ev)).unwrap();
    assert_eq!(v.status, EvidenceStatus::Fail);
    assert_eq!(
        v.verdict.unwrap().reasons,
        vec!["phash_reuse:3".to_string()]
    );
    e.as_("qs.testnet");
    panics(
        "E_NOT_VERIFIED",
        std::panic::AssertUnwindSafe(|| e.c.qs_sign(1)),
    );
    // a "pass" that carries reasons is a fail
    let ev2 = e.submit(1, "qs.testnet");
    assert!(!e.verdict(ev2, true, &["ai_stage_mismatch"]));
}

#[test]
fn verify_callback_error() {
    let mut e = Env::standard();
    let ev = e.submit(0, "qs.testnet");
    e.cb(vec![PromiseResult::Failed]);
    assert!(!e.c.on_verdict(ev));
    assert_eq!(
        e.c.get_evidence(U64(ev)).unwrap().status,
        EvidenceStatus::Error
    );
    assert_eq!(e.c.get_milestones()[0].status, MilestoneStatus::Open);
    let ev2 = e.submit(0, "qs.testnet");
    e.cb(vec![PromiseResult::Successful(
        b"\"not json at all\"".to_vec(),
    )]);
    assert!(!e.c.on_verdict(ev2));
    assert!(e
        .c
        .get_evidence(U64(ev2))
        .unwrap()
        .raw_response_hash
        .is_some());
}

#[test]
fn verify_challenge_required() {
    let mut e = Env::standard();
    e.as_("qs.testnet");
    panics(
        "E_NO_CHALLENGE",
        std::panic::AssertUnwindSafe(|| {
            e.c.submit_evidence(0, "https://x/1.jpg".into(), "a".repeat(64), U64(0), None);
        }),
    );
    e.c.open_capture(0);
    assert_eq!(e.c.get_capture(0).unwrap().code.len(), 6);
    e.advance(31 * MIN);
    e.as_("qs.testnet");
    panics(
        "E_CHALLENGE_EXPIRED",
        std::panic::AssertUnwindSafe(|| {
            e.c.submit_evidence(0, "https://x/1.jpg".into(), "a".repeat(64), U64(0), None);
        }),
    );
    e.as_("mallory.testnet");
    panics(
        "E_NOT_SURVEYOR",
        std::panic::AssertUnwindSafe(|| {
            e.c.open_capture(0);
        }),
    );
    e.as_("qs.testnet");
    e.c.open_capture(0);
    panics(
        "E_BAD_ARGS",
        std::panic::AssertUnwindSafe(|| {
            e.c.submit_evidence(0, "https://x/1.jpg".into(), "XYZ".into(), U64(0), None);
        }),
    );
}

#[test]
fn verify_extracts_wrapped_verdicts() {
    let bare = json!({ "pass": true, "reasons": [], "phash": PHASH, "exif_time": 5u64, "worker_commit": "c" });
    let (v, _) = extract_verdict(&bare, 0).unwrap();
    assert!(v.pass);
    assert_eq!(v.exif_time, Some(U64(5)));
    let wrapped =
        json!({ "status": "Completed", "output": bare.to_string(), "attestation": "att-123" });
    let (v, att) = extract_verdict(&wrapped, 0).unwrap();
    assert!(v.pass);
    assert_eq!(att.as_deref(), Some("att-123"));
    let nested = json!({ "result": { "Ok": { "stdout": bare.to_string() } }, "execution_id": 9 });
    assert!(extract_verdict(&nested, 0).is_some());
    assert!(extract_verdict(&json!({ "status": "Failed", "error": "oom" }), 0).is_none());
}

#[test]
fn verify_https_fallback_by_relayer_only() {
    let mut e = Env::standard();
    let ev = e.submit(0, "qs.testnet");
    let v: Verdict =
        serde_json::from_value(json!({ "pass": true, "phash": PHASH, "worker_commit": "c" }))
            .unwrap();
    e.as_("mallory.testnet");
    let v2 = v.clone();
    panics(
        "E_NOT_RELAYER",
        std::panic::AssertUnwindSafe(|| {
            e.c.submit_verdict(U64(ev), v2);
        }),
    );
    let input: serde_json::Value =
        serde_json::from_str(&e.c.check_input(U64(ev)).unwrap()).unwrap();
    assert_eq!(input["evidence_id"], ev);
    assert_eq!(input["challenge"].as_str().unwrap().len(), 6);
    assert_eq!(input["geofence"]["radius_m"], 300);
    e.as_("relayer.testnet");
    assert!(e.c.submit_verdict(U64(ev), v));
    assert_eq!(e.c.get_milestones()[0].status, MilestoneStatus::Verified);
    assert_eq!(
        e.c.get_evidence(U64(ev))
            .unwrap()
            .verdict
            .unwrap()
            .source
            .as_deref(),
        Some("https")
    );
}

#[test]
fn verify_budget_enforced() {
    let d = [
        T0 + 60 * MIN,
        T0 + 120 * MIN,
        T0 + 180 * MIN,
        T0 + 240 * MIN,
    ];
    let mut e = Env::new_with(params(false), d, &[("a-1a", PRICE, vec![])]);
    e.c.verification_budget = 0;
    e.as_("qs.testnet");
    e.c.open_capture(0);
    panics(
        "E_BUDGET",
        std::panic::AssertUnwindSafe(|| {
            e.c.submit_evidence(0, "https://x/1.jpg".into(), "a".repeat(64), U64(0), None);
        }),
    );
}

// ---------------------------------------------------------------- votes

#[test]
fn vote_freeze_blocks_release() {
    let mut e = Env::standard();
    e.buy("a-4b", "alice.testnet", 10_000 * USDC);
    e.buy("a-1a", "bob.testnet", 10_000 * USDC);
    e.approve_milestone(0);
    e.advance(3 * MIN);
    e.as_("alice.testnet");
    let pid = e.c.propose(ProposalKind::Freeze {
        reason: "No work for 6 weeks".into(),
        refunds_open: true,
    });
    e.as_("alice.testnet");
    e.c.vote(pid, true);
    e.as_("bob.testnet");
    e.c.vote(pid, true);
    assert!(e.c.get_estate().frozen.is_some());
    e.as_("anyone.testnet");
    panics(
        "E_FROZEN",
        std::panic::AssertUnwindSafe(|| {
            e.c.claim_release(vec!["a-4b".into()]);
        }),
    );
    assert!(
        e.unit("a-4b").refunds_open,
        "refunds open by the freeze vote"
    );
    assert_eq!(e.unit("a-4b").releasable_now.0, 0);
}

#[test]
fn vote_replace_surveyor_and_one_token_one_vote() {
    let mut e = Env::standard();
    e.buy("a-4b", "alice.testnet", 10_000 * USDC);
    e.buy("a-1a", "bob.testnet", 10_000 * USDC);
    e.buy("b-2a", "carol.testnet", 10_000 * USDC);
    e.as_("alice.testnet");
    let pid = e.c.propose(ProposalKind::ReplaceSurveyor {
        account: acc("qs-new.testnet"),
    });
    e.as_("alice.testnet");
    e.c.vote(pid, true);
    // alice sells her token to dave mid-vote: dave can't vote with it again
    e.as_dep("alice.testnet", NearToken::from_yoctonear(1));
    e.c.nft_transfer(acc("dave.testnet"), "a-4b".into(), None, None);
    e.as_("dave.testnet");
    panics(
        "E_NOT_ELIGIBLE",
        std::panic::AssertUnwindSafe(|| e.c.vote(pid, true)),
    );
    assert_eq!(e.c.votes_available(pid, acc("bob.testnet")), 1);
    e.as_("bob.testnet");
    e.c.vote(pid, true);
    assert_eq!(e.c.get_estate().surveyor_id, acc("qs-new.testnet"));
    e.as_("qs.testnet");
    panics(
        "E_NOT_SURVEYOR",
        std::panic::AssertUnwindSafe(|| {
            e.c.open_capture(0);
        }),
    );
    // non-holders can't propose; one open proposal per account
    e.as_("mallory.testnet");
    panics(
        "E_NOT_ELIGIBLE",
        std::panic::AssertUnwindSafe(|| {
            e.c.propose(ProposalKind::Unfreeze);
        }),
    );
    e.as_("carol.testnet");
    e.c.propose(ProposalKind::StepIn {
        new_payout_id: acc("contractor.testnet"),
    });
    e.as_("carol.testnet");
    panics(
        "E_PROPOSAL_OPEN",
        std::panic::AssertUnwindSafe(|| {
            e.c.propose(ProposalKind::StepIn {
                new_payout_id: acc("x.testnet"),
            });
        }),
    );
}

#[test]
fn vote_veto_within_window_and_rejection() {
    let mut e = Env::standard();
    e.buy("a-4b", "alice.testnet", 10_000 * USDC);
    e.approve_milestone(0);
    e.as_("alice.testnet");
    let pid = e.c.propose(ProposalKind::Veto { milestone: 0 });
    e.as_("alice.testnet");
    e.c.vote(pid, true);
    assert_eq!(e.c.get_milestones()[0].status, MilestoneStatus::Vetoed);
    assert_eq!(e.c.dev_stats().vetoes, 1);
    e.advance(3 * MIN);
    assert_eq!(
        e.unit("a-4b").releasable_now.0,
        0,
        "vetoed stage releases nothing"
    );
    // after the window a veto can't be proposed
    e.approve_milestone(0);
    e.advance(3 * MIN);
    e.as_("alice.testnet");
    panics(
        "E_VETO_WINDOW",
        std::panic::AssertUnwindSafe(|| {
            e.c.propose(ProposalKind::Veto { milestone: 0 });
        }),
    );
    // a no-majority rejects
    let pid2 = e.c.propose(ProposalKind::StepIn {
        new_payout_id: acc("x.testnet"),
    });
    e.as_("alice.testnet");
    e.c.vote(pid2, false);
    assert_eq!(
        e.c.get_proposal(pid2).unwrap().status,
        ProposalStatus::Rejected
    );
}

#[test]
fn vote_token_allocated_after_proposal_cant_vote() {
    let mut e = Env::standard();
    e.buy("a-4b", "alice.testnet", 10_000 * USDC);
    e.buy("a-1a", "bob.testnet", 10_000 * USDC);
    e.as_("alice.testnet");
    let pid = e.c.propose(ProposalKind::StepIn {
        new_payout_id: acc("x.testnet"),
    });
    e.advance(1);
    e.buy("b-2a", "carol.testnet", 10_000 * USDC);
    e.as_("carol.testnet");
    panics(
        "E_NOT_ELIGIBLE",
        std::panic::AssertUnwindSafe(|| e.c.vote(pid, true)),
    );
    e.advance(11 * MIN);
    e.as_("anyone.testnet");
    e.c.expire_proposal(pid);
    assert_eq!(
        e.c.get_proposal(pid).unwrap().status,
        ProposalStatus::Expired
    );
}

// ---------------------------------------------------------------- playground

#[test]
fn playground_open_roles_and_reset() {
    let d = [
        T0 + 60 * MIN,
        T0 + 120 * MIN,
        T0 + 180 * MIN,
        T0 + 240 * MIN,
    ];
    let mut e = Env::new_with(params(true), d, &[("p-01", 1_000 * USDC, vec![])]);
    e.buy("p-01", "judge.testnet", 1_000 * USDC);
    let ev = e.submit(0, "judge.testnet");
    e.verdict(ev, true, &[]);
    e.as_("judge2.testnet");
    e.c.qs_sign(0);
    e.advance(3 * MIN);
    assert_eq!(e.unit("p-01").releasable_now.0, 200 * USDC);
    e.as_("anyone.testnet");
    e.c.playground_reset();
    assert!(e
        .c
        .get_milestones()
        .iter()
        .all(|m| m.status == MilestoneStatus::Open && m.deadline.0 > e.now));

    let mut normal = Env::standard();
    normal.as_("anyone.testnet");
    panics(
        "E_PLAYGROUND_ONLY",
        std::panic::AssertUnwindSafe(|| normal.c.playground_reset()),
    );
}

// ---------------------------------------------------------------- NFT, lien, guardians

#[test]
fn nft_views_and_dynamic_media() {
    let mut e = Env::standard();
    e.buy("a-4b", "alice.testnet", 10_000 * USDC);
    let t = e.c.nft_token("a-4b".into()).unwrap();
    let md = t.metadata.unwrap();
    assert_eq!(md.title.as_deref(), Some("Harmattan Court · A-4B"));
    assert!(md
        .media
        .as_ref()
        .unwrap()
        .starts_with("data:image/svg+xml;base64,"));
    let before = md.media.unwrap();
    e.approve_milestone(0);
    let after =
        e.c.nft_token("a-4b".into())
            .unwrap()
            .metadata
            .unwrap()
            .media
            .unwrap();
    assert_ne!(before, after, "image redraws when a milestone is approved");
    assert_eq!(e.c.nft_tokens(None, None).len(), 1);
    assert!(e.c.nft_token("a-1a".into()).is_none());
    assert_eq!(
        e.c.is_taken("A-4B.estate.testnet".into()).holder,
        Some(acc("alice.testnet"))
    );
    assert!(!e.c.is_taken("zz-9".into()).exists);
}

#[test]
fn nft_approval_and_transfer() {
    let mut e = Env::standard();
    e.buy("a-4b", "alice.testnet", 10_000 * USDC);
    e.as_dep("alice.testnet", NearToken::from_millinear(1));
    e.c.nft_approve("a-4b".into(), acc("market.testnet"), None);
    assert!(e
        .c
        .nft_is_approved("a-4b".into(), acc("market.testnet"), Some(0)));
    e.as_dep("market.testnet", NearToken::from_yoctonear(1));
    e.c.nft_transfer(acc("bob.testnet"), "a-4b".into(), Some(0), None);
    assert_eq!(e.unit("a-4b").holder, Some(acc("bob.testnet")));
    assert!(
        !e.c.nft_is_approved("a-4b".into(), acc("market.testnet"), None),
        "approvals cleared"
    );
    e.as_dep("market.testnet", NearToken::from_yoctonear(1));
    panics(
        "E_NOT_HOLDER",
        std::panic::AssertUnwindSafe(|| {
            e.c.nft_transfer(acc("carol.testnet"), "a-4b".into(), None, None)
        }),
    );
}

#[test]
fn lien_blocks_transfer_and_refunds_lender_first() {
    let mut e = Env::standard();
    e.buy("a-4b", "alice.testnet", 10_000 * USDC);
    e.as_("alice.testnet");
    e.c.set_lien("a-4b".into(), acc("bank.testnet"), U128(6_000 * USDC));
    e.as_dep("alice.testnet", NearToken::from_yoctonear(1));
    panics(
        "E_LIEN",
        std::panic::AssertUnwindSafe(|| {
            e.c.nft_transfer(acc("bob.testnet"), "a-4b".into(), None, None)
        }),
    );
    e.now = T0 + 63 * MIN;
    e.as_dep("alice.testnet", NearToken::from_yoctonear(1));
    let _ = e.c.refund("a-4b".into());
    assert!(ft_transfers()
        .iter()
        .any(|(_, to, a)| to == &acc("bank.testnet") && *a == 6_000 * USDC));
    e.finish_out("a-4b", OutKind::Refund, "bank.testnet", 6_000 * USDC, true);
    assert!(e.unit("a-4b").lien.is_none(), "lien repaid in full");
    e.as_dep("alice.testnet", NearToken::from_yoctonear(1));
    let _ = e.c.refund("a-4b".into());
    e.finish_out("a-4b", OutKind::Refund, "alice.testnet", 4_000 * USDC, true);
    assert_eq!(e.unit("a-4b").status, UnitStatus::Available);
    e.check_conservation();
}

#[test]
fn guardian_recovery() {
    let mut e = Env::standard();
    e.buy("a-4b", "alice.testnet", 10_000 * USDC);
    e.as_("alice.testnet");
    e.c.set_guardians(
        "a-4b".into(),
        vec![acc("g1.testnet"), acc("g2.testnet"), acc("g3.testnet")],
    );
    e.as_("g1.testnet");
    e.c.guardian_recover("a-4b".into(), acc("alice-new.testnet"));
    e.as_("anyone.testnet");
    panics(
        "E_RECOVERY",
        std::panic::AssertUnwindSafe(|| e.c.finish_recovery("a-4b".into())),
    );
    e.as_("g2.testnet");
    e.c.guardian_recover("a-4b".into(), acc("alice-new.testnet"));
    e.advance(3 * MIN);
    e.as_("anyone.testnet");
    e.c.finish_recovery("a-4b".into());
    assert_eq!(e.unit("a-4b").holder, Some(acc("alice-new.testnet")));
}

#[test]
fn handover_requires_last_milestone() {
    let mut e = Env::standard();
    e.buy("a-4b", "alice.testnet", PRICE);
    e.as_("alice.testnet");
    panics(
        "E_HANDOVER",
        std::panic::AssertUnwindSafe(|| e.c.handover("a-4b".into())),
    );
    for m in 0..4 {
        e.approve_milestone(m);
    }
    e.advance(3 * MIN);
    e.as_("alice.testnet");
    e.c.handover("a-4b".into());
    assert_eq!(e.unit("a-4b").status, UnitStatus::HandedOver);
    assert!(!e.unit("a-4b").refunds_open);
}

// ---------------------------------------------------------------- invariants

/// Randomised sequence of 200 actions; conservation and the release cap hold after each.
#[test]
fn invariants_conservation() {
    let d = [T0 + 40 * MIN, T0 + 80 * MIN, T0 + 400 * MIN, T0 + 800 * MIN];
    let units = [
        ("u-1", PRICE, vec![]),
        ("u-2", 50_000 * USDC, vec![]),
        ("u-3", 20_000 * USDC, vec![]),
    ];
    let mut e = Env::new_with(params(false), d, &units);
    let ids = ["u-1", "u-2", "u-3"];
    let people = ["alice.testnet", "bob.testnet", "carol.testnet"];
    let mut seed: u64 = 0x9e3779b97f4a7c15;
    let mut rnd = |n: u64| {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed % n
    };
    for _ in 0..200 {
        let id = ids[rnd(3) as usize];
        let who = people[rnd(3) as usize];
        let u = e.unit(id);
        match rnd(9) {
            0 if u.status == UnitStatus::Available && u.unattributed.0 <= USDC => {
                e.reserve(id, who)
            }
            1 => {
                let amt = (rnd(12_000) + 1) as u128 * USDC;
                e.wallet_pay(id, who, amt);
            }
            2 => {
                e.land(id, (rnd(3_000) + 1) as u128 * USDC);
                if u.in_flight.0 == 0 {
                    e.sync(id);
                }
            }
            3 => {
                let ms = e.c.get_milestones();
                if let Some(m) = ms.iter().position(|m| m.status == MilestoneStatus::Open) {
                    if !e.c.get_estate().refunds_open {
                        e.approve_milestone(m as u8);
                    }
                }
            }
            4 => {
                let due = u.releasable_now.0;
                if due > 0 && u.in_flight.0 == 0 {
                    e.as_("anyone.testnet");
                    e.c.claim_release(vec![id.into()]);
                    let ok = rnd(4) != 0;
                    e.finish_out(id, OutKind::Release, "payout.testnet", due, ok);
                }
            }
            5 => {
                if u.refundable_now.0 > 0 && u.in_flight.0 == 0 {
                    let holder = u.holder.clone().unwrap();
                    e.ctx(&holder, NearToken::from_yoctonear(1), vec![]);
                    let _ = e.c.refund(id.into());
                    let to = u
                        .lien
                        .as_ref()
                        .map(|l| l.lender.to_string())
                        .unwrap_or(holder.to_string());
                    let ok = rnd(4) != 0;
                    e.finish_out(id, OutKind::Refund, &to, u.refundable_now.0, ok);
                }
            }
            6 => {
                if u.excess_now.0 > 0 && u.in_flight.0 == 0 {
                    let holder = u.holder.clone().unwrap();
                    e.ctx(&holder, NearToken::from_yoctonear(1), vec![]);
                    let _ = e.c.withdraw_excess(id.into());
                    e.finish_out(id, OutKind::Excess, holder.as_str(), u.excess_now.0, true);
                }
            }
            7 => {
                if u.unattributed.0 > USDC && u.in_flight.0 == 0 {
                    e.as_("anyone.testnet");
                    let _ = e.c.sweep_unattributed(id.into());
                    let to = match &u.last_reservation {
                        Some(r) if e.now < r.expires_at.0 + 10 * MIN => r.by.to_string(),
                        _ => "plote.testnet".to_string(),
                    };
                    e.finish_out(id, OutKind::Sweep, &to, u.unattributed.0, true);
                }
            }
            _ => {
                e.advance(rnd(20) * MIN);
                if u.status == UnitStatus::Reserved && u.in_flight.0 == 0 {
                    if let Some(r) = &u.reservation {
                        if e.now >= r.expires_at.0 {
                            e.as_("anyone.testnet");
                            if let PromiseOrValue::Promise(_) = e.c.expire_reservation(id.into()) {
                                let by = r.by.to_string();
                                let amt = u.paid.0 - u.refunded_out.0;
                                e.finish_out(id, OutKind::ReservationRefund, &by, amt, true);
                            }
                        }
                    }
                }
            }
        }
        e.check_conservation();
    }
}

#[test]
fn outlayer_source_project_or_github() {
    let mut e = Env::standard();
    assert_eq!(e.c.outlayer_source()["GitHub"]["commit"], "abc");
    e.c.verifier.repo = "project:plote.testnet/plote-verifier".into();
    e.c.verifier.commit = String::new();
    let s = e.c.outlayer_source();
    assert_eq!(s["Project"]["project_id"], "plote.testnet/plote-verifier");
    assert!(s["Project"]["version_key"].is_null());
    e.c.verifier.commit = "v3".into();
    assert_eq!(e.c.outlayer_source()["Project"]["version_key"], "v3");
}
