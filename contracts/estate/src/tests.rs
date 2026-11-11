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
        app_url: "https://plote.vercel.app".into(),
    }
}

/// Protective params (what `new` requires outside the playground on a non-testnet account, audit finding 9). The
/// test estate lives at `estate.testnet`, which is exempt anyway; `fresh` still inits with these and then puts the
/// requested params in place, so tests don't depend on the exemption.
fn protective(p: &Params) -> Params {
    let mut safe = p.clone();
    if !safe.playground {
        safe.demo_mode = false;
        safe.veto_window_ns = U64(ONE_DAY_NS);
        safe.grace_ns = U64(ONE_DAY_NS);
        safe.default_grace_ns = U64(ONE_DAY_NS);
    }
    safe
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
    let wanted = a.params.clone();
    let mut a = a;
    a.params = protective(&wanted);
    let mut c = Estate::new(a);
    c.params = wanted;
    Env {
        c,
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

    /// Caller attaching 1 yoctoNEAR (holder methods that change who may take the token or its money).
    fn as_1y(&self, who: &str) {
        self.ctx(&acc(who), NearToken::from_yoctonear(1), vec![]);
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
            e.cb(vec![
                PromiseResult::Successful(vec![]),
                PromiseResult::Successful(vec![]),
            ]);
            assert!(e.c.on_unit_created(id.to_string(), None));
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

    /// A 1Click delivery (plain `ft_transfer`) reported by the deposit reporter: `report_deposit` for the whole surplus
    /// on the unit, both balance reads seeing the simulated chain balance. Returns what was credited.
    fn sync(&mut self, id: &str) -> u128 {
        let u = self.unit(id);
        let expected = u.paid.0 + u.unattributed.0 - u.released.0 - u.refunded_out.0;
        let surplus = self.bal[id].saturating_sub(expected);
        if surplus == 0 {
            return 0;
        }
        self.report(id, surplus)
    }

    /// `report_deposit(id, amount)` by the relayer, with both balance reads returning the simulated balance.
    fn report(&mut self, id: &str, amount: u128) -> u128 {
        let b = self.bal[id];
        self.report_with(id, amount, b, b)
    }

    /// `report_deposit` with the two balance reads returning `first` and `second`.
    fn report_with(&mut self, id: &str, amount: u128, first: u128, second: u128) -> u128 {
        let expected = self.start_report(id, amount);
        match self.report_first(id, amount, expected, first) {
            Some(()) => self.report_second(id, amount, expected, first, second),
            None => 0,
        }
    }

    /// Start `report_deposit` as the relayer; returns the `expected` snapshot it passes to its callbacks.
    fn start_report(&mut self, id: &str, amount: u128) -> U128 {
        let u = self.unit(id);
        let expected = U128(u.paid.0 + u.unattributed.0 - u.released.0 - u.refunded_out.0);
        self.as_("relayer.testnet");
        let _ = self.c.report_deposit(id.to_string(), U128(amount));
        expected
    }

    /// The first read callback; `Some(())` if it scheduled the second read.
    fn report_first(
        &mut self,
        id: &str,
        amount: u128,
        expected: U128,
        balance: u128,
    ) -> Option<()> {
        self.cb(vec![PromiseResult::Successful(
            serde_json::to_vec(&U128(balance)).unwrap(),
        )]);
        match self
            .c
            .on_report_first(id.to_string(), U128(amount), expected)
        {
            PromiseOrValue::Promise(_) => Some(()),
            PromiseOrValue::Value(v) => {
                assert_eq!(v.0, 0);
                None
            }
        }
    }

    fn report_second(
        &mut self,
        id: &str,
        amount: u128,
        expected: U128,
        first: u128,
        second: u128,
    ) -> u128 {
        self.cb(vec![PromiseResult::Successful(
            serde_json::to_vec(&U128(second)).unwrap(),
        )]);
        self.c
            .on_report_second(id.to_string(), U128(amount), expected, U128(first))
            .0
    }

    /// The public, check-only `sync`: returns the surplus it saw (credits nothing).
    fn check(&mut self, id: &str) -> u128 {
        self.as_("anyone.testnet");
        let _ = self.c.sync(id.to_string());
        self.cb(vec![PromiseResult::Successful(
            serde_json::to_vec(&U128(self.bal[id])).unwrap(),
        )]);
        self.c.on_balance(id.to_string()).0
    }

    /// ft_transfer_call from a wallet into the unit account (Path A): USDC credits the unit, the unit's
    /// `ft_on_transfer` asks `on_unit_deposit`, and `ft_resolve_transfer` takes back what it returns unused.
    fn wallet_pay(&mut self, id: &str, from: &str, amount: u128) -> u128 {
        self.land(id, amount);
        self.ctx(&unit_acc(id), NearToken::from_yoctonear(0), vec![]);
        let unused = self
            .c
            .on_unit_deposit(id.to_string(), acc(from), U128(amount), String::new())
            .0;
        // NEP-141 resolve gives back the unused part.
        *self.bal.get_mut(id).unwrap() -= unused;
        unused
    }

    /// `propose` with the required storage deposit.
    fn propose(&mut self, who: &str, kind: ProposalKind) -> U64 {
        self.as_dep(who, PROPOSAL_DEPOSIT);
        self.c.propose(kind)
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
        let v = Self::verdict_json(ev, pass, reasons, "abc");
        self.resume(ev, &v)
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
        }
        self.check_release_cap();
    }

    /// Release cap (SPEC 5.10 #3): `released ≤ min(paid, price) × approved_bps / 10_000`, for every unit.
    fn check_release_cap(&self) {
        let bps = self.c.approved_bps(self.now);
        for id in self.bal.keys() {
            let u = self.unit(id);
            let cap = u.paid.0.min(u.price.0) * bps / BPS;
            assert!(
                u.released.0 <= cap,
                "release cap broken for {}: released {} > min(paid {}, price {}) × {} bps",
                id,
                u.released.0,
                u.paid.0,
                u.price.0,
                bps
            );
            assert_eq!(u.approved_bps as u128, bps);
        }
    }

    /// A verdict as the worker prints it, from `worker_commit`.
    fn verdict_json(ev: u64, pass: bool, reasons: &[&str], commit: &str) -> serde_json::Value {
        json!({ "evidence_id": ev, "pass": pass, "reasons": reasons, "warnings": [], "phash": PHASH,
            "nearest_distance": 27, "exif_time": 1793739420000000000u64, "gps": [6447118, 3474201], "gps_source": "exif",
            "distance_m": 23, "ai_stage": "roofing", "ai_confidence": 88, "challenge_read": "K7RQ4M", "ai_chat_id": "chatcmpl-1",
            "ai_observations": ["roof trusses in place", "paper with code visible"], "worker_commit": commit })
    }

    /// OutLayer resumes `on_verdict` with this JSON.
    fn resume(&mut self, ev: u64, v: &serde_json::Value) -> bool {
        self.cb(vec![PromiseResult::Successful(v.to_string().into_bytes())]);
        self.c.on_verdict(ev)
    }
}

/// The worker's JSON as the contract's `Verdict` (the relayer route sends `exif_time` as a string).
fn verdict_of(v: serde_json::Value) -> Verdict {
    extract_verdict(&v, 0).unwrap().0
}

/// Every `transfer_out` receipt created by the last call: (unit account, receiver, amount).
fn transfer_outs() -> Vec<(AccountId, AccountId, u128)> {
    let mut out = vec![];
    for r in get_created_receipts() {
        for a in r.actions {
            if let MockAction::FunctionCallWeight {
                method_name, args, ..
            } = a
            {
                if method_name == b"transfer_out" {
                    let v: serde_json::Value = serde_json::from_slice(&args).unwrap();
                    let amt: u128 = v["amount"].as_str().unwrap().parse().unwrap();
                    out.push((
                        r.receiver_id.clone(),
                        v["receiver_id"].as_str().unwrap().parse().unwrap(),
                        amt,
                    ));
                }
            }
        }
    }
    out
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
    c.params = protective(&c.params);
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
    e.cb(vec![
        PromiseResult::Failed,
        PromiseResult::Successful(vec![]),
    ]);
    assert!(!e.c.on_unit_created("c-2".into(), None));
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
    // cancel with nothing paid is synchronous (after alice's late-claim window, so others may reserve)
    e.advance(10 * MIN);
    e.reserve("a-1a", "carol.testnet");
    e.as_1y("carol.testnet");
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
        e.cb(vec![
            PromiseResult::Successful(vec![]),
            PromiseResult::Successful(vec![]),
        ]);
        e.c.on_unit_created("m-1".into(), None);
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
    e.as_("relayer.testnet");
    panics(
        "E_IN_FLIGHT",
        std::panic::AssertUnwindSafe(|| {
            let _ = e.c.report_deposit("a-4b".into(), U128(1));
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
fn refund_extend_deadline_is_the_recovery_path_after_a_miss() {
    let mut e = Env::standard();
    e.buy("a-4b", "alice.testnet", 10_000 * USDC);
    e.buy("a-1a", "bob.testnet", 10_000 * USDC);
    e.buy("b-2a", "carol.testnet", 10_000 * USDC);
    e.approve_milestone(0); // foundation signed on time
                            // roofing (T0+120m) + 2m grace passes without a sign-off: refunds open, releases stop
    e.now = T0 + 123 * MIN;
    assert!(e.unit("a-4b").refunds_open);
    assert!(e.c.get_milestones()[1].late);
    assert_eq!(e.unit("a-4b").releasable_now.0, 0);
    e.as_("anyone.testnet");
    panics(
        "E_REFUNDS_OPEN",
        std::panic::AssertUnwindSafe(|| {
            e.c.claim_release(vec!["a-4b".into()]);
        }),
    );
    // the developer asks holders to move the missed deadline; a paid-weighted majority with the quorum passes it
    let pid = e.propose(
        "dev.testnet",
        ProposalKind::ExtendDeadline {
            milestone: 1,
            new_deadline: U64(T0 + 170 * MIN),
        },
    );
    assert!(e.c.get_proposal(pid).unwrap().weighted);
    e.as_("alice.testnet");
    e.c.vote(pid, true);
    assert!(
        e.unit("a-4b").refunds_open,
        "1 of 3 equal weights isn't a majority"
    );
    e.as_("bob.testnet");
    e.c.vote(pid, true);
    assert_eq!(
        e.c.get_proposal(pid).unwrap().status,
        ProposalStatus::Executed
    );
    assert_eq!(e.c.get_milestones()[1].deadline.0, T0 + 170 * MIN);
    // refunds close, releases resume
    let u = e.unit("a-4b");
    assert!(!u.refunds_open);
    assert!(!e.c.get_milestones()[1].late);
    assert_eq!(u.releasable_now.0, 2_000 * USDC);
    e.as_("anyone.testnet");
    assert_eq!(e.c.claim_release(vec!["a-4b".into()]), 1);
    assert_eq!(transfer_outs()[0].1, acc("payout.testnet"));

    // without the quorum (1 of 3 units allocated) an extension can't even be proposed
    let mut small = Env::standard();
    small.buy("a-4b", "alice.testnet", 10_000 * USDC);
    small.now = T0 + 63 * MIN;
    assert!(small.unit("a-4b").refunds_open);
    small.as_dep("dev.testnet", PROPOSAL_DEPOSIT);
    panics(
        "E_QUORUM",
        std::panic::AssertUnwindSafe(|| {
            small.c.propose(ProposalKind::ExtendDeadline {
                milestone: 0,
                new_deadline: U64(T0 + 100 * MIN),
            });
        }),
    );
    // a weighted minority can't pass it: one full payer outweighs two deposits
    let mut w = Env::standard();
    w.buy("a-4b", "alice.testnet", 8_500 * USDC);
    w.buy("a-1a", "bob.testnet", 8_500 * USDC);
    w.buy("b-2a", "carol.testnet", PRICE);
    w.now = T0 + 63 * MIN;
    let pid = w.propose(
        "dev.testnet",
        ProposalKind::ExtendDeadline {
            milestone: 0,
            new_deadline: U64(T0 + 100 * MIN),
        },
    );
    for who in ["alice.testnet", "bob.testnet"] {
        w.as_(who);
        w.c.vote(pid, true);
    }
    assert_eq!(w.c.get_proposal(pid).unwrap().status, ProposalStatus::Open);
    assert!(w.unit("a-4b").refunds_open);
    w.as_("carol.testnet");
    w.c.vote(pid, false);
    assert_eq!(
        w.c.get_proposal(pid).unwrap().status,
        ProposalStatus::Rejected
    );
    assert!(w.unit("a-4b").refunds_open, "refunds stay open");
}

// ---------------------------------------------------------------- resale and default

#[test]
fn resale_voluntary() {
    let mut e = Env::standard();
    e.buy("a-4b", "alice.testnet", 20_000 * USDC);
    e.as_1y("alice.testnet");
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
    e.as_1y("alice.testnet");
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
    e.c.verify_mode = "https".into();
    let ev = e.submit(0, "qs.testnet");
    let v: Verdict =
        serde_json::from_value(json!({ "pass": true, "phash": PHASH, "worker_commit": "abc" }))
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

#[test]
fn verify_submit_verdict_rejected_in_outlayer_mode() {
    // SPEC 3 / 6.6: an OutLayer-mode estate takes verdicts only from OutLayer's callback, never the relayer.
    let mut e = Env::standard();
    assert_eq!(e.c.get_estate().verify_mode, "outlayer");
    let ev = e.submit(0, "qs.testnet");
    let v: Verdict =
        serde_json::from_value(json!({ "pass": true, "phash": PHASH, "worker_commit": "abc" }))
            .unwrap();
    e.as_("relayer.testnet");
    panics(
        "E_VERIFY_MODE",
        std::panic::AssertUnwindSafe(|| {
            e.c.submit_verdict(U64(ev), v);
        }),
    );
    let got = e.c.get_evidence(U64(ev)).unwrap();
    assert_eq!(got.status, EvidenceStatus::Pending);
    assert!(got.verdict.is_none());
    assert_eq!(e.c.get_milestones()[0].status, MilestoneStatus::Checking);
}

#[test]
fn verify_submit_verdict_accepted_in_https_mode() {
    let d = [
        T0 + 60 * MIN,
        T0 + 120 * MIN,
        T0 + 180 * MIN,
        T0 + 240 * MIN,
    ];
    let mut a = new_args(params(false), d);
    a.verify_mode = Some("https".into());
    let mut e = fresh(a);
    assert_eq!(e.c.get_estate().verify_mode, "https");
    let budget = e.c.verification_budget;
    let ev = e.submit(0, "qs.testnet");
    // No OutLayer call and no budget spent in https mode.
    assert!(get_created_receipts().is_empty());
    assert_eq!(e.c.verification_budget, budget);
    let v: Verdict = verdict_of(Env::verdict_json(ev, true, &[], "abc"));
    e.as_("relayer.testnet");
    assert!(e.c.submit_verdict(U64(ev), v));
    let got = e.c.get_evidence(U64(ev)).unwrap();
    assert_eq!(got.status, EvidenceStatus::Pass);
    assert_eq!(got.verdict.unwrap().source.as_deref(), Some("https"));
    assert_eq!(e.c.get_milestones()[0].status, MilestoneStatus::Verified);
}

#[test]
fn verify_worker_commit_must_match_pinned_commit() {
    // GitHub source pinned to "abc" (SPEC 5.6): a verdict from another build is an Error, not a verdict.
    let mut e = Env::standard();
    let ev = e.submit(0, "qs.testnet");
    let v = Env::verdict_json(ev, true, &[], "deadbeef");
    assert!(!e.resume(ev, &v));
    let got = e.c.get_evidence(U64(ev)).unwrap();
    assert_eq!(got.status, EvidenceStatus::Error);
    assert!(got.verdict.is_none());
    assert!(got.raw_response_hash.is_some());
    assert!(got
        .error
        .unwrap()
        .contains("does not match the pinned verifier commit abc"));
    assert_eq!(e.c.get_milestones()[0].status, MilestoneStatus::Open);
    assert!(get_logs()
        .iter()
        .any(|l| l.contains("worker_commit_mismatch")));
    assert_eq!(e.c.dev_stats().evidence_passed, 0);
    // The surveyor resubmits; the pinned build's verdict lands (commit compared case-insensitively).
    let ev2 = e.submit(0, "qs.testnet");
    assert!(e.resume(ev2, &Env::verdict_json(ev2, true, &[], "ABC")));
    assert_eq!(e.c.get_milestones()[0].status, MilestoneStatus::Verified);

    // The same rule on the HTTPS path (own thread: the mocked chain is thread-local).
    std::thread::spawn(https_commit_mismatch).join().unwrap();

    // Unpinned GitHub commit or an OutLayer project source: worker_commit isn't compared.
    for (repo, commit) in [
        ("https://github.com/x/plote-verifier", ""),
        ("project:plote.testnet/plote-verifier", "v3"),
    ] {
        std::thread::spawn(move || {
            let mut e = Env::standard();
            e.c.verifier.repo = repo.into();
            e.c.verifier.commit = commit.into();
            let ev = e.submit(0, "qs.testnet");
            assert!(e.resume(ev, &Env::verdict_json(ev, true, &[], "anything")));
        })
        .join()
        .unwrap();
    }
}

fn https_commit_mismatch() {
    let mut e = Env::standard();
    e.c.verify_mode = "https".into();
    let ev = e.submit(0, "qs.testnet");
    let v: Verdict = verdict_of(Env::verdict_json(ev, true, &[], "other"));
    e.as_("relayer.testnet");
    assert!(!e.c.submit_verdict(U64(ev), v));
    assert_eq!(
        e.c.get_evidence(U64(ev)).unwrap().status,
        EvidenceStatus::Error
    );
    assert_eq!(e.c.get_milestones()[0].status, MilestoneStatus::Open);
}

#[test]
fn verify_ai_observations_stored_and_bounded() {
    let mut e = Env::standard();
    let ev = e.submit(1, "qs.testnet");
    let mut v = Env::verdict_json(ev, true, &[], "abc");
    v["ai_observations"] = json!(["a", "b", "x".repeat(500), "d", "e", "f"]);
    assert!(e.resume(ev, &v));
    let obs =
        e.c.get_evidence(U64(ev))
            .unwrap()
            .verdict
            .unwrap()
            .ai_observations;
    assert_eq!(obs.len(), 4);
    assert_eq!(obs[0], "a");
    assert_eq!(obs[2].chars().count(), 160);
    // Older workers that don't send observations still parse.
    let ev2 = e.submit(0, "qs.testnet");
    let mut v = Env::verdict_json(ev2, true, &[], "abc");
    v.as_object_mut().unwrap().remove("ai_observations");
    assert!(e.resume(ev2, &v));
    assert!(e
        .c
        .get_evidence(U64(ev2))
        .unwrap()
        .verdict
        .unwrap()
        .ai_observations
        .is_empty());
}

// ---------------------------------------------------------------- votes

#[test]
fn vote_freeze_blocks_release() {
    let mut e = Env::standard();
    e.buy("a-4b", "alice.testnet", 10_000 * USDC);
    e.buy("a-1a", "bob.testnet", 10_000 * USDC);
    e.buy("b-2a", "carol.testnet", 10_000 * USDC);
    e.approve_milestone(0);
    e.advance(3 * MIN);
    let pid = e.propose(
        "alice.testnet",
        ProposalKind::Freeze {
            reason: "No work for 6 weeks".into(),
            refunds_open: true,
        },
    );
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
    let pid = e.propose(
        "alice.testnet",
        ProposalKind::ReplaceSurveyor {
            account: acc("qs-new.testnet"),
        },
    );
    e.as_("alice.testnet");
    e.c.vote(pid, true);
    // alice sells her token to dave mid-vote: dave can't vote with it again
    e.as_dep("alice.testnet", NearToken::from_yoctonear(1));
    e.c.nft_transfer(acc("dave.testnet"), "a-4b".into(), None, None);
    e.as_("dave.testnet");
    panics(
        "E_ALREADY_VOTED",
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
    e.propose(
        "carol.testnet",
        ProposalKind::Freeze {
            reason: "x".into(),
            refunds_open: false,
        },
    );
    e.as_dep("carol.testnet", PROPOSAL_DEPOSIT);
    panics(
        "E_PROPOSAL_OPEN",
        std::panic::AssertUnwindSafe(|| {
            e.c.propose(ProposalKind::Unfreeze);
        }),
    );
}

#[test]
fn vote_veto_within_window_and_rejection() {
    let mut e = Env::standard();
    e.buy("a-4b", "alice.testnet", 10_000 * USDC);
    e.approve_milestone(0);
    let pid = e.propose("alice.testnet", ProposalKind::Veto { milestone: 0 });
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
    // a no-majority rejects
    e.approve_milestone(0);
    let pid2 = e.propose("alice.testnet", ProposalKind::Veto { milestone: 0 });
    e.as_("alice.testnet");
    e.c.vote(pid2, false);
    assert_eq!(
        e.c.get_proposal(pid2).unwrap().status,
        ProposalStatus::Rejected
    );
    // after the window a veto can't be proposed
    e.advance(3 * MIN);
    e.as_dep("alice.testnet", PROPOSAL_DEPOSIT);
    panics(
        "E_VETO_WINDOW",
        std::panic::AssertUnwindSafe(|| {
            e.c.propose(ProposalKind::Veto { milestone: 0 });
        }),
    );
}

#[test]
fn vote_token_allocated_after_proposal_cant_vote() {
    let d = [
        T0 + 60 * MIN,
        T0 + 120 * MIN,
        T0 + 180 * MIN,
        T0 + 240 * MIN,
    ];
    let units: Vec<(&str, u128, Vec<Instalment>)> = ["a-1", "a-2", "a-3", "a-4"]
        .iter()
        .map(|id| (*id, PRICE, vec![]))
        .collect();
    let mut e = Env::new_with(params(false), d, &units);
    e.buy("a-1", "alice.testnet", 10_000 * USDC);
    e.buy("a-2", "bob.testnet", 10_000 * USDC);
    e.buy("a-3", "carol.testnet", 10_000 * USDC);
    let pid = e.propose(
        "alice.testnet",
        ProposalKind::ExtendDeadline {
            milestone: 3,
            new_deadline: U64(T0 + 250 * MIN),
        },
    );
    e.advance(1);
    e.buy("a-4", "dave.testnet", 10_000 * USDC);
    e.as_("dave.testnet");
    panics(
        "E_NOT_ELIGIBLE",
        std::panic::AssertUnwindSafe(|| e.c.vote(pid, true)),
    );
    assert_eq!(e.c.votes_available(pid, acc("dave.testnet")), 0);
    e.advance(11 * MIN);
    e.as_("anyone.testnet");
    e.c.expire_proposal(pid);
    assert_eq!(
        e.c.get_proposal(pid).unwrap().status,
        ProposalStatus::Expired
    );
}

#[test]
fn vote_step_in_redirects_payout_and_emits_event() {
    let mut e = Env::standard();
    e.buy("a-4b", "alice.testnet", 10_000 * USDC);
    e.buy("a-1a", "bob.testnet", 10_000 * USDC);
    e.buy("b-2a", "carol.testnet", 10_000 * USDC);
    e.approve_milestone(0);
    e.advance(3 * MIN);
    // holders freeze releases (without opening refunds): the project is in trouble, a step-in is allowed
    let freeze = e.propose(
        "carol.testnet",
        ProposalKind::Freeze {
            reason: "contractor walked off".into(),
            refunds_open: false,
        },
    );
    for who in ["alice.testnet", "bob.testnet"] {
        e.as_(who);
        e.c.vote(freeze, true);
    }
    assert!(e.c.get_estate().frozen.is_some());
    let pid = e.propose(
        "alice.testnet",
        ProposalKind::StepIn {
            new_payout_id: acc("contractor.testnet"),
        },
    );
    e.as_("alice.testnet");
    e.c.vote(pid, true);
    e.as_("bob.testnet");
    e.c.vote(pid, true);
    let logs = get_logs();
    let ev = logs
        .iter()
        .find(|l| l.contains("\"payout_redirected\""))
        .expect("StepIn emits payout_redirected");
    let j: serde_json::Value =
        serde_json::from_str(ev.strip_prefix("EVENT_JSON:").unwrap()).unwrap();
    assert_eq!(j["standard"], "plote");
    assert_eq!(j["version"], "1.0.0");
    assert_eq!(j["data"][0]["old"], "payout.testnet");
    assert_eq!(j["data"][0]["new"], "contractor.testnet");
    assert!(logs.iter().any(|l| l.contains("proposal_executed")));
    assert_eq!(
        e.c.get_estate().payout_redirect,
        Some(acc("contractor.testnet"))
    );
    // Unfreezing needs the same quorum as freezing; then releases go to the replacement contractor.
    let unfreeze = e.propose("bob.testnet", ProposalKind::Unfreeze);
    for who in ["bob.testnet", "carol.testnet"] {
        e.as_(who);
        e.c.vote(unfreeze, true);
    }
    assert!(e.c.get_estate().frozen.is_none());
    e.as_("anyone.testnet");
    e.c.claim_release(vec!["a-4b".into()]);
    let outs = transfer_outs();
    assert_eq!(outs.len(), 1);
    assert_eq!(outs[0].1, acc("contractor.testnet"));
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
    e.as_1y("alice.testnet");
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
    e.as_1y("alice.testnet");
    e.c.set_guardians(
        "a-4b".into(),
        vec![acc("g1.testnet"), acc("g2.testnet"), acc("g3.testnet")],
    );
    e.as_1y("g1.testnet");
    e.c.guardian_recover("a-4b".into(), acc("alice-new.testnet"));
    e.as_("anyone.testnet");
    panics(
        "E_RECOVERY",
        std::panic::AssertUnwindSafe(|| e.c.finish_recovery("a-4b".into())),
    );
    e.as_1y("g2.testnet");
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
    e.as_1y("alice.testnet");
    panics(
        "E_HANDOVER",
        std::panic::AssertUnwindSafe(|| e.c.handover("a-4b".into())),
    );
    for m in 0..4 {
        e.approve_milestone(m);
    }
    e.advance(3 * MIN);
    e.as_1y("alice.testnet");
    e.c.handover("a-4b".into());
    assert_eq!(e.unit("a-4b").status, UnitStatus::HandedOver);
    assert!(!e.unit("a-4b").refunds_open);
}

// ---------------------------------------------------------------- invariants

/// Where a unit's USDC may go (SPEC 5.10 #4), from the unit's state before the call: the payout account
/// (release), the holder or the holder's lender (refund, excess), the current or last reserver
/// (expired/cancelled reservation, late claim), or recovery_id (swept unattributed money).
fn assert_exits(e: &Env, before: &UnitView, kind: &str, seen: &mut HashMap<String, u32>) {
    let outs = transfer_outs();
    for (from, to, amount) in &outs {
        assert_eq!(
            from, &before.account,
            "{} moved money out of another unit",
            kind
        );
        let allowed = match kind {
            "release" => to == &e.c.payout_account(),
            "refund" => {
                before.holder.as_ref() == Some(to)
                    || before.lien.as_ref().map(|l| &l.lender) == Some(to)
            }
            "excess" => before.holder.as_ref() == Some(to),
            "reservation" => before.reservation.as_ref().map(|r| &r.by) == Some(to),
            "sweep" => {
                before.last_reservation.as_ref().map(|r| &r.by) == Some(to)
                    || before.reservation.as_ref().map(|r| &r.by) == Some(to)
                    || to == &acc("plote.testnet")
            }
            _ => false,
        };
        assert!(
            allowed,
            "{} of {} from {} went to {}, which isn't allowed",
            kind, amount, before.id, to
        );
        *seen.entry(kind.to_string()).or_default() += 1;
    }
}

/// Randomised sequence of actions. After each: conservation (#2), the release cap against
/// approved_bps (#3), and every transfer out of a unit goes to an allowed place (#4).
/// Returns how many transfers of each kind it saw.
fn random_walk(mut seed: u64, steps: usize) -> HashMap<String, u32> {
    let d = [T0 + 40 * MIN, T0 + 80 * MIN, T0 + 400 * MIN, T0 + 800 * MIN];
    let units = [
        ("u-1", PRICE, vec![]),
        ("u-2", 50_000 * USDC, vec![]),
        ("u-3", 20_000 * USDC, vec![]),
    ];
    let mut e = Env::new_with(params(false), d, &units);
    let ids = ["u-1", "u-2", "u-3"];
    let people = ["alice.testnet", "bob.testnet", "carol.testnet"];
    let mut seen = HashMap::new();
    let mut rnd = |n: u64| {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed % n
    };
    for _ in 0..steps {
        let id = ids[rnd(3) as usize];
        let who = people[rnd(3) as usize];
        let u = e.unit(id);
        match rnd(10) {
            0 if u.status == UnitStatus::Available
                && u.unattributed.0 <= USDC
                && u.last_reservation
                    .as_ref()
                    .is_none_or(|r| r.by.as_str() == who || e.now >= r.expires_at.0 + 10 * MIN) =>
            {
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
                    assert_exits(&e, &u, "release", &mut seen);
                    let ok = rnd(4) != 0;
                    e.finish_out(id, OutKind::Release, "payout.testnet", due, ok);
                }
            }
            5 => {
                if u.refundable_now.0 > 0 && u.in_flight.0 == 0 {
                    let holder = u.holder.clone().unwrap();
                    e.ctx(&holder, NearToken::from_yoctonear(1), vec![]);
                    let _ = e.c.refund(id.into());
                    assert_exits(&e, &u, "refund", &mut seen);
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
                    assert_exits(&e, &u, "excess", &mut seen);
                    e.finish_out(id, OutKind::Excess, holder.as_str(), u.excess_now.0, true);
                }
            }
            7 => {
                if u.unattributed.0 > USDC && u.in_flight.0 == 0 {
                    e.as_("anyone.testnet");
                    let _ = e.c.sweep_unattributed(id.into());
                    assert_exits(&e, &u, "sweep", &mut seen);
                    let latest = match &u.reservation {
                        Some(r) if e.now >= r.expires_at.0 => Some(r),
                        _ => u.last_reservation.as_ref(),
                    };
                    let to = match latest {
                        Some(r) if e.now < r.expires_at.0 + 10 * MIN => r.by.to_string(),
                        _ => "plote.testnet".to_string(),
                    };
                    e.finish_out(id, OutKind::Sweep, &to, u.unattributed.0, true);
                }
            }
            8 => {
                if u.status == UnitStatus::Reserved && u.in_flight.0 == 0 {
                    let r = u.reservation.clone().unwrap();
                    e.as_1y(r.by.as_str());
                    if let PromiseOrValue::Promise(_) = e.c.cancel_reservation(id.into()) {
                        assert_exits(&e, &u, "reservation", &mut seen);
                        let amt = u.paid.0 - u.refunded_out.0;
                        e.finish_out(id, OutKind::ReservationRefund, r.by.as_str(), amt, true);
                    }
                }
            }
            _ => {
                e.advance(rnd(20) * MIN);
                if u.status == UnitStatus::Reserved && u.in_flight.0 == 0 {
                    if let Some(r) = &u.reservation {
                        if e.now >= r.expires_at.0 {
                            e.as_("anyone.testnet");
                            if let PromiseOrValue::Promise(_) = e.c.expire_reservation(id.into()) {
                                assert_exits(&e, &u, "reservation", &mut seen);
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
    seen
}

/// SPEC 5.10 #2 (and #3, #4 on the way): 200 random actions.
#[test]
fn invariants_conservation() {
    random_walk(0x9e3779b97f4a7c15, 200);
}

/// SPEC 5.10 #3: the cap follows approved_bps exactly — nothing before the veto window ends, the
/// stage's share of min(paid, price) after it, and never more.
#[test]
fn invariants_release_cap_against_approved_bps() {
    let mut e = Env::standard();
    e.buy("a-4b", "alice.testnet", PRICE + 5_000 * USDC); // overpaid: the cap uses price
    e.buy("a-1a", "bob.testnet", 10_000 * USDC); // underpaid: the cap uses paid
    e.approve_milestone(0);
    e.check_release_cap();
    assert_eq!(e.c.approved_bps(e.now), 0, "veto window still open");
    assert_eq!(e.unit("a-4b").releasable_now.0, 0);
    e.advance(3 * MIN);
    assert_eq!(e.c.approved_bps(e.now), 2_000);
    for (id, base) in [("a-4b", PRICE), ("a-1a", 10_000 * USDC)] {
        let due = e.unit(id).releasable_now.0;
        assert_eq!(due, base * 2_000 / BPS);
        e.as_("anyone.testnet");
        e.c.claim_release(vec![id.into()]);
        e.finish_out(id, OutKind::Release, "payout.testnet", due, true);
        e.check_release_cap();
        assert_eq!(e.unit(id).released.0, base * 2_000 / BPS);
        assert_eq!(
            e.unit(id).releasable_now.0,
            0,
            "nothing more until the next stage"
        );
    }
    // A second claim moves nothing.
    e.as_("anyone.testnet");
    e.c.claim_release(vec!["a-4b".into(), "a-1a".into()]);
    assert!(transfer_outs().is_empty());
    // Paying more raises the cap only up to price × approved_bps.
    e.wallet_pay("a-1a", "bob.testnet", 100_000 * USDC);
    assert_eq!(
        e.unit("a-1a").releasable_now.0,
        PRICE * 2_000 / BPS - 10_000 * USDC * 2_000 / BPS
    );
    e.check_conservation();
}

/// SPEC 5.10 #4: exits only to payout_id, the holder (or the holder's lender), the reserver or
/// recovery_id. Every kind of transfer out, once each, then a random walk with a different seed.
#[test]
fn invariants_exits_only_to_allowed_places() {
    let mut seen: HashMap<String, u32> = HashMap::new();
    let mut e = Env::standard();
    // Cancelled reservation with money on it → back to the reserver.
    e.reserve("a-1a", "alice.testnet");
    e.wallet_pay("a-1a", "alice.testnet", 1_000 * USDC);
    let u = e.unit("a-1a");
    e.as_1y("alice.testnet");
    let _ = e.c.cancel_reservation("a-1a".into());
    assert_exits(&e, &u, "reservation", &mut seen);
    e.finish_out(
        "a-1a",
        OutKind::ReservationRefund,
        "alice.testnet",
        1_000 * USDC,
        true,
    );
    // Expired reservation → back to the reserver.
    e.reserve("b-2a", "bob.testnet");
    e.wallet_pay("b-2a", "bob.testnet", 500 * USDC);
    e.advance(31 * MIN);
    let u = e.unit("b-2a");
    e.as_("anyone.testnet");
    let _ = e.c.expire_reservation("b-2a".into());
    assert_exits(&e, &u, "reservation", &mut seen);
    e.finish_out(
        "b-2a",
        OutKind::ReservationRefund,
        "bob.testnet",
        500 * USDC,
        true,
    );
    // Late delivery inside the late-claim window → the last reserver; after it → recovery_id.
    e.land("b-2a", 5 * USDC);
    e.sync("b-2a");
    let u = e.unit("b-2a");
    e.as_("anyone.testnet");
    let _ = e.c.sweep_unattributed("b-2a".into());
    assert_exits(&e, &u, "sweep", &mut seen);
    e.finish_out("b-2a", OutKind::Sweep, "bob.testnet", 5 * USDC, true);
    e.land("b-2a", 7 * USDC);
    e.sync("b-2a");
    e.advance(11 * MIN);
    let u = e.unit("b-2a");
    e.as_("anyone.testnet");
    let _ = e.c.sweep_unattributed("b-2a".into());
    assert_exits(&e, &u, "sweep", &mut seen);
    assert_eq!(transfer_outs()[0].1, acc("plote.testnet"));
    e.finish_out("b-2a", OutKind::Sweep, "plote.testnet", 7 * USDC, true);
    // Release → payout_id; excess → the holder.
    e.buy("a-4b", "alice.testnet", PRICE + 1_000 * USDC);
    e.approve_milestone(0);
    e.advance(3 * MIN);
    let u = e.unit("a-4b");
    e.as_("anyone.testnet");
    e.c.claim_release(vec!["a-4b".into()]);
    assert_exits(&e, &u, "release", &mut seen);
    e.finish_out(
        "a-4b",
        OutKind::Release,
        "payout.testnet",
        u.releasable_now.0,
        true,
    );
    let u = e.unit("a-4b");
    e.as_dep("alice.testnet", NearToken::from_yoctonear(1));
    let _ = e.c.withdraw_excess("a-4b".into());
    assert_exits(&e, &u, "excess", &mut seen);
    e.finish_out("a-4b", OutKind::Excess, "alice.testnet", 1_000 * USDC, true);
    // Refund after a missed deadline → the lender first, then the holder.
    e.buy("a-1a", "carol.testnet", 10_000 * USDC);
    e.as_1y("carol.testnet");
    e.c.set_lien("a-1a".into(), acc("bank.testnet"), U128(6_000 * USDC));
    e.now = T0 + 123 * MIN;
    for (to, amount) in [
        ("bank.testnet", 6_000 * USDC),
        ("carol.testnet", 4_000 * USDC),
    ] {
        let u = e.unit("a-1a");
        e.as_dep("carol.testnet", NearToken::from_yoctonear(1));
        let _ = e.c.refund("a-1a".into());
        assert_exits(&e, &u, "refund", &mut seen);
        assert_eq!(transfer_outs()[0].1, acc(to));
        e.finish_out("a-1a", OutKind::Refund, to, amount, true);
    }
    e.check_conservation();
    for kind in ["release", "refund", "excess", "reservation", "sweep"] {
        assert!(
            seen.get(kind).copied().unwrap_or(0) > 0,
            "no {} transfer",
            kind
        );
    }
    // And a random walk with another seed (assert_exits runs on every transfer it makes).
    // Own thread: the mocked chain (and its storage) is thread-local.
    std::thread::spawn(|| random_walk(0x2545f4914f6cdd1d, 200))
        .join()
        .unwrap();
}

/// SPEC 5.10 #8: a verdict only attaches to evidence whose SHA-256 was stored before the OutLayer call.
#[test]
fn invariants_evidence_committed_before_check() {
    let mut e = Env::standard();
    e.as_("qs.testnet");
    e.c.open_capture(1);
    let sha = "b".repeat(64);
    let ev =
        e.c.submit_evidence(
            1,
            "https://x.supabase.co/e/9.jpg".into(),
            sha.clone(),
            U64(e.now),
            None,
        )
        .0;
    // The record exists, Pending, with the hash, in the same receipt that starts the OutLayer call...
    let stored = e.c.get_evidence(U64(ev)).unwrap();
    assert_eq!(stored.status, EvidenceStatus::Pending);
    assert_eq!(stored.sha256, sha);
    // ...and the worker is asked to check exactly that hash for exactly that id.
    let mut calls = 0;
    for r in get_created_receipts() {
        for a in r.actions {
            if let MockAction::FunctionCallWeight {
                method_name, args, ..
            } = a
            {
                if method_name == b"request_execution" {
                    calls += 1;
                    assert_eq!(r.receiver_id, acc("outlayer.testnet"));
                    let v: serde_json::Value = serde_json::from_slice(&args).unwrap();
                    let input: serde_json::Value =
                        serde_json::from_str(v["input_data"].as_str().unwrap()).unwrap();
                    assert_eq!(input["sha256"], sha);
                    assert_eq!(input["evidence_id"], ev);
                }
            }
        }
    }
    assert_eq!(calls, 1);

    // A verdict for an evidence id that was never committed attaches nowhere.
    let ghost = ev + 100;
    assert!(!e.resume(ghost, &Env::verdict_json(ghost, true, &[], "abc")));
    assert!(e.c.get_evidence(U64(ghost)).is_none());
    assert_eq!(e.c.get_milestones()[0].status, MilestoneStatus::Open);
    e.c.verify_mode = "https".into();
    e.as_("relayer.testnet");
    let v: Verdict = verdict_of(Env::verdict_json(ghost, true, &[], "abc"));
    panics(
        "E_BAD_ARGS",
        std::panic::AssertUnwindSafe(|| {
            e.c.submit_verdict(U64(ghost), v);
        }),
    );
    e.c.verify_mode = "outlayer".into();

    // The verdict attaches to the committed record and can't rewrite its hash.
    assert!(e.resume(ev, &Env::verdict_json(ev, true, &[], "abc")));
    let after = e.c.get_evidence(U64(ev)).unwrap();
    assert_eq!(after.status, EvidenceStatus::Pass);
    assert_eq!(after.sha256, sha);
    // Once decided, a second (replayed or late) verdict is ignored.
    assert!(!e.resume(ev, &Env::verdict_json(ev, false, &["phash_reuse:0"], "abc")));
    assert_eq!(
        e.c.get_evidence(U64(ev)).unwrap().status,
        EvidenceStatus::Pass
    );
    assert_eq!(e.c.get_milestones()[1].status, MilestoneStatus::Verified);
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

#[test]
fn nft_media_uses_brand_palette() {
    use near_sdk::base64::{engine::general_purpose::STANDARD, Engine};
    let mut e = Env::standard();
    e.buy("a-4b", "alice.testnet", 10_000 * USDC);
    e.approve_milestone(0);
    let media =
        e.c.nft_token("a-4b".into())
            .unwrap()
            .metadata
            .unwrap()
            .media
            .unwrap();
    let svg = String::from_utf8(
        STANDARD
            .decode(media.trim_start_matches("data:image/svg+xml;base64,"))
            .unwrap(),
    )
    .unwrap();
    // Plote brand: orange proven parts on the near-black canvas; the old teal palette is gone.
    assert!(svg.contains("#FF9211"));
    assert!(svg.contains("fill='#090909'"));
    assert!(!svg.contains("#2DD4BF"));
}

#[test]
fn verify_callback_null_means_outlayer_did_not_run() {
    let mut e = Env::standard();
    let ev = e.submit(0, "qs.testnet");
    e.cb(vec![PromiseResult::Successful(b"null".to_vec())]);
    assert!(!e.c.on_verdict(ev));
    let got = e.c.get_evidence(U64(ev)).unwrap();
    assert_eq!(got.status, EvidenceStatus::Error);
    assert_eq!(
        got.error.as_deref(),
        Some("OutLayer didn't run the check (it returned no output)")
    );
    // the milestone reopens so the surveyor can resubmit
    assert_eq!(e.c.get_milestones()[0].status, MilestoneStatus::Open);
}

#[test]
fn verdict_bound_to_other_evidence_or_bytes_is_an_error() {
    let mut e = Env::standard();
    let ev = e.submit(0, "qs.testnet");
    let mut v = Env::verdict_json(ev, true, &[], &e.c.get_estate().verifier.commit);
    v["evidence_id"] = json!(ev + 7);
    assert!(!e.resume(ev, &v));
    let got = e.c.get_evidence(U64(ev)).unwrap();
    assert_eq!(got.status, EvidenceStatus::Error);
    assert_eq!(e.c.get_milestones()[0].status, MilestoneStatus::Open);

    let ev2 = e.submit(0, "qs.testnet");
    let mut v2 = Env::verdict_json(ev2, true, &[], &e.c.get_estate().verifier.commit);
    v2["sha256"] = json!("00".repeat(32));
    assert!(!e.resume(ev2, &v2));
    assert_eq!(
        e.c.get_evidence(U64(ev2)).unwrap().status,
        EvidenceStatus::Error
    );

    // the right id and the committed bytes still pass
    let ev3 = e.submit(0, "qs.testnet");
    let mut v3 = Env::verdict_json(ev3, true, &[], &e.c.get_estate().verifier.commit);
    v3["sha256"] = json!(e.c.get_evidence(U64(ev3)).unwrap().sha256);
    assert!(e.resume(ev3, &v3));
}

#[test]
fn mocked_ai_verdict_never_passes() {
    let mut e = Env::standard();
    let ev = e.submit(0, "qs.testnet");
    let mut v = Env::verdict_json(ev, true, &[], &e.c.get_estate().verifier.commit);
    v["warnings"] = json!(["ai_mock"]);
    assert!(!e.resume(ev, &v));
    let got = e.c.get_evidence(U64(ev)).unwrap();
    assert_eq!(got.status, EvidenceStatus::Fail);
    assert!(got
        .verdict
        .unwrap()
        .reasons
        .contains(&"ai_mock".to_string()));
}

#[test]
#[should_panic(expected = "E_BAD_ARGS")]
fn real_estate_cannot_turn_the_geofence_off() {
    let mut e = Env::standard();
    let mut v = e.c.get_estate().verifier.clone();
    v.commit = String::new();
    e.as_("dev.testnet");
    e.c.set_verifier(v);
}

// ---------------------------------------------------------------- pre-audit fixes

/// Buy a voluntary listing atomically (as the USDC contract would deliver it).
fn buy_listing(e: &mut Env, id: &str, buyer: &str, amount: u128) {
    e.as_("usdc.testnet");
    let _ =
        e.c.ft_on_transfer(acc(buyer), U128(amount), json!({ "buy": id }).to_string());
}

/// Audit #1: the seller's guardians/beneficiary don't survive a sale; a receiver of `nft_transfer_call` can't hand
/// the token back carrying a lien or guardians it set; an unparsable result returns the token (NEP-171, #9); and
/// a real recovery keeps the person's guardians and beneficiary.
#[test]
fn audit_safety_state_follows_the_owner() {
    let mut e = Env::standard();
    e.buy("a-4b", "alice.testnet", 10_000 * USDC);
    e.as_1y("alice.testnet");
    e.c.set_guardians(
        "a-4b".into(),
        vec![acc("alt1.testnet"), acc("alt2.testnet")],
    );
    e.c.set_beneficiary("a-4b".into(), Some(acc("alice-kin.testnet")));
    e.c.list_for_sale("a-4b".into(), U128(12_000 * USDC));
    buy_listing(&mut e, "a-4b", "bob.testnet", 12_000 * USDC);
    let u = e.unit("a-4b");
    assert_eq!(u.holder, Some(acc("bob.testnet")));
    assert!(u.guardians.is_empty(), "seller's guardians are gone");
    assert!(u.beneficiary.is_none());
    e.as_1y("alt1.testnet");
    panics(
        "E_NOT_GUARDIAN",
        std::panic::AssertUnwindSafe(|| e.c.guardian_recover("a-4b".into(), acc("alice.testnet"))),
    );

    // bob sets up his own safety state, then sends the token to a receiver that abuses it and returns it
    e.as_1y("bob.testnet");
    e.c.set_guardians("a-4b".into(), vec![acc("bg1.testnet"), acc("bg2.testnet")]);
    e.c.set_beneficiary("a-4b".into(), Some(acc("bob-kin.testnet")));
    let before = e.unit("a-4b");
    let snapshot = crate::nft::SafetySnapshot {
        guardians: before.guardians.clone(),
        beneficiary: before.beneficiary.clone(),
        lien: None,
    };
    for result in [b"true".to_vec(), b"\"yes\"".to_vec()] {
        e.as_dep("bob.testnet", NearToken::from_yoctonear(1));
        let _ = e.c.nft_transfer_call(
            acc("market.testnet"),
            "a-4b".into(),
            None,
            None,
            String::new(),
        );
        e.as_1y("market.testnet");
        e.c.set_lien("a-4b".into(), acc("market-friend.testnet"), U128(u128::MAX));
        e.as_1y("market.testnet");
        e.c.set_guardians("a-4b".into(), vec![acc("m1.testnet"), acc("m2.testnet")]);
        e.cb(vec![PromiseResult::Successful(result)]);
        let kept = e.c.nft_resolve_transfer(
            acc("bob.testnet"),
            acc("market.testnet"),
            "a-4b".into(),
            Some(HashMap::new()),
            Some(snapshot.clone()),
        );
        assert!(!kept, "true and unparsable results both return the token");
        let u = e.unit("a-4b");
        assert_eq!(u.holder, Some(acc("bob.testnet")));
        assert!(u.lien.is_none(), "the receiver's lien is undone");
        assert_eq!(u.guardians, before.guardians);
        assert_eq!(u.beneficiary, before.beneficiary);
    }
    // a callback from before the snapshot argument existed still drops a receiver's lien
    e.as_dep("bob.testnet", NearToken::from_yoctonear(1));
    let _ = e.c.nft_transfer_call(
        acc("market.testnet"),
        "a-4b".into(),
        None,
        None,
        String::new(),
    );
    e.as_1y("market.testnet");
    e.c.set_lien("a-4b".into(), acc("market-friend.testnet"), U128(1));
    e.cb(vec![PromiseResult::Failed]);
    assert!(!e.c.nft_resolve_transfer(
        acc("bob.testnet"),
        acc("market.testnet"),
        "a-4b".into(),
        None,
        None
    ));
    assert!(e.unit("a-4b").lien.is_none());

    // a genuine recovery (same person, new key) keeps guardians and beneficiary
    e.as_1y("bob.testnet");
    e.c.set_guardians("a-4b".into(), vec![acc("bg1.testnet"), acc("bg2.testnet")]);
    e.c.set_beneficiary("a-4b".into(), Some(acc("bob-kin.testnet")));
    for g in ["bg1.testnet", "bg2.testnet"] {
        e.as_1y(g);
        e.c.guardian_recover("a-4b".into(), acc("bob-new.testnet"));
    }
    e.advance(3 * MIN);
    e.as_("anyone.testnet");
    e.c.finish_recovery("a-4b".into());
    let u = e.unit("a-4b");
    assert_eq!(u.holder, Some(acc("bob-new.testnet")));
    assert_eq!(u.guardians, vec![acc("bg1.testnet"), acc("bg2.testnet")]);
    assert_eq!(u.beneficiary, Some(acc("bob-kin.testnet")));
}

fn defaulted_unit() -> Env {
    let d = [
        T0 + 600 * MIN,
        T0 + 700 * MIN,
        T0 + 800 * MIN,
        T0 + 900 * MIN,
    ];
    let plan = vec![
        Instalment {
            due_at: U64(T0 + 10 * MIN),
            cumulative: U128(30_000 * USDC),
        },
        Instalment {
            due_at: U64(T0 + 500 * MIN),
            cumulative: U128(60_000 * USDC),
        },
    ];
    let mut e = Env::new_with(params(false), d, &[("a-4b", PRICE, plan)]);
    e.buy("a-4b", "alice.testnet", 10_000 * USDC);
    e.advance(13 * MIN);
    e.as_("anyone.testnet");
    e.c.declare_default("a-4b".into());
    e
}

/// Audit #2: the buyer of a default listing gets a full default grace from the sale before they can default.
#[test]
fn audit_default_buyer_gets_a_fresh_grace() {
    let mut e = defaulted_unit();
    e.advance(5 * MIN);
    let sold_at = e.now;
    e.as_("usdc.testnet");
    let _ = e.c.ft_on_transfer(
        acc("bob.testnet"),
        U128(10_000 * USDC),
        json!({ "buy": "a-4b" }).to_string(),
    );
    let u = e.unit("a-4b");
    assert_eq!(u.holder, Some(acc("bob.testnet")));
    assert_eq!(
        u.plan[0].due_at.0, sold_at,
        "missed instalment moved to the sale"
    );
    assert_eq!(
        u.plan[1].due_at.0,
        T0 + 500 * MIN,
        "future instalment unchanged"
    );
    e.as_("anyone.testnet");
    panics(
        "E_NOT_DUE",
        std::panic::AssertUnwindSafe(|| e.c.declare_default("a-4b".into())),
    );
    // bob doesn't catch up within the grace → a default is possible again
    e.advance(3 * MIN);
    e.as_("anyone.testnet");
    e.c.declare_default("a-4b".into());
    assert_eq!(e.unit("a-4b").status, UnitStatus::InDefault);
}

/// Audit #5: a lien can't be used to escape a default listing.
#[test]
fn audit_no_lien_on_a_defaulted_unit() {
    let mut e = defaulted_unit();
    e.as_1y("alice.testnet");
    panics(
        "E_LISTING",
        std::panic::AssertUnwindSafe(|| {
            e.c.set_lien("a-4b".into(), acc("alice-alt.testnet"), U128(1))
        }),
    );
    let u = e.unit("a-4b");
    assert!(u.lien.is_none());
    assert_eq!(u.listing.unwrap().kind, ListingKind::Default);
}

/// Audit #3: StepIn / ReplaceSurveyor / Freeze need a minimum electorate; StepIn only for a project in trouble,
/// re-checked when it passes; Veto stays available to a single holder (vote_veto_within_window_and_rejection).
#[test]
fn audit_vote_capture_needs_quorum_and_trouble() {
    let mut e = Env::standard();
    e.buy("a-4b", "alice.testnet", 10_000 * USDC);
    let step_in = ProposalKind::StepIn {
        new_payout_id: acc("attacker.testnet"),
    };
    e.as_dep("alice.testnet", PROPOSAL_DEPOSIT);
    panics(
        "E_STEP_IN",
        std::panic::AssertUnwindSafe(|| {
            e.c.propose(step_in.clone());
        }),
    );
    for kind in [
        ProposalKind::Freeze {
            reason: "grief".into(),
            refunds_open: true,
        },
        ProposalKind::ReplaceSurveyor {
            account: acc("qs-mine.testnet"),
        },
    ] {
        e.as_dep("alice.testnet", PROPOSAL_DEPOSIT);
        panics(
            "E_QUORUM",
            std::panic::AssertUnwindSafe(|| {
                e.c.propose(kind.clone());
            }),
        );
    }
    // a single buyer can't redirect money even once a deadline is missed
    e.now = T0 + 63 * MIN;
    e.as_dep("alice.testnet", PROPOSAL_DEPOSIT);
    panics(
        "E_QUORUM",
        std::panic::AssertUnwindSafe(|| {
            e.c.propose(step_in.clone());
        }),
    );

    // three holders: freeze, then a step-in while frozen, but an unfreeze lands first → the step-in is rejected
    let mut e = Env::standard();
    e.buy("a-4b", "alice.testnet", 10_000 * USDC);
    e.buy("a-1a", "bob.testnet", 10_000 * USDC);
    e.buy("b-2a", "carol.testnet", 10_000 * USDC);
    let f = e.propose(
        "alice.testnet",
        ProposalKind::Freeze {
            reason: "No work".into(),
            refunds_open: false,
        },
    );
    for who in ["alice.testnet", "bob.testnet"] {
        e.as_(who);
        e.c.vote(f, true);
    }
    assert!(e.c.get_estate().frozen.is_some());
    let s = e.propose("alice.testnet", step_in.clone());
    let u = e.propose("bob.testnet", ProposalKind::Unfreeze);
    for who in ["alice.testnet", "bob.testnet"] {
        e.as_(who);
        e.c.vote(u, true);
    }
    assert!(e.c.get_estate().frozen.is_none());
    for who in ["alice.testnet", "bob.testnet"] {
        e.as_(who);
        e.c.vote(s, true);
    }
    assert_eq!(
        e.c.get_proposal(s).unwrap().status,
        ProposalStatus::Rejected
    );
    assert!(e.c.get_estate().payout_redirect.is_none());

    // the 25% share: 3 tokens out of 13 units isn't enough
    e.as_dep("dev.testnet", NearToken::from_near(5));
    let more: Vec<UnitInput> = (0..8)
        .map(|i| UnitInput {
            id: format!("x-{}", i),
            label: "x".into(),
            price: U128(PRICE),
            plan: vec![],
        })
        .collect();
    e.c.add_units(more);
    e.as_dep("dev.testnet", NearToken::from_near(5));
    e.c.add_units(
        (8..10)
            .map(|i| UnitInput {
                id: format!("x-{}", i),
                label: "x".into(),
                price: U128(PRICE),
                plan: vec![],
            })
            .collect(),
    );
    assert_eq!(e.c.list_units(None, None).len(), 13);
    e.as_dep("carol.testnet", PROPOSAL_DEPOSIT);
    panics(
        "E_QUORUM",
        std::panic::AssertUnwindSafe(|| {
            e.c.propose(ProposalKind::ReplaceSurveyor {
                account: acc("qs-new.testnet"),
            });
        }),
    );

    // the playground (judge sandbox, no real money) keeps single-judge votes
    let d = [
        T0 + 60 * MIN,
        T0 + 120 * MIN,
        T0 + 180 * MIN,
        T0 + 240 * MIN,
    ];
    let mut p = Env::new_with(params(true), d, &[("p-01", 1_000 * USDC, vec![])]);
    p.buy("p-01", "judge.testnet", 1_000 * USDC);
    let f = p.propose(
        "judge.testnet",
        ProposalKind::Freeze {
            reason: "try it".into(),
            refunds_open: false,
        },
    );
    p.as_("judge.testnet");
    p.c.vote(f, true);
    assert!(p.c.get_estate().frozen.is_some());
}

/// Audit #4: a lapsed reservation's late payment can't be captured by the next reserver, and a sweep pays the
/// current (expired, not yet ended) reserver rather than the one before them.
#[test]
fn audit_late_payment_stays_with_its_reserver() {
    let mut e = Env::standard();
    e.reserve("b-2a", "bob.testnet");
    e.advance(31 * MIN);
    e.as_("mallory.testnet");
    let _ = e.c.expire_reservation("b-2a".into());
    e.as_dep("mallory.testnet", RESERVE_DEPOSIT);
    panics(
        "E_LATE_CLAIM",
        std::panic::AssertUnwindSafe(|| e.c.reserve("b-2a".into())),
    );
    // bob's 1Click payment lands late: it can only go back to bob
    e.land("b-2a", 5 * USDC);
    e.sync("b-2a");
    assert_eq!(e.unit("b-2a").unattributed.0, 5 * USDC);
    e.as_("anyone.testnet");
    let _ = e.c.sweep_unattributed("b-2a".into());
    assert_eq!(transfer_outs()[0].1, acc("bob.testnet"));
    e.finish_out("b-2a", OutKind::Sweep, "bob.testnet", 5 * USDC, true);
    // bob himself may reserve again at once; others after late_claim_ns
    e.reserve("b-2a", "bob.testnet");
    e.as_1y("bob.testnet");
    let _ = e.c.cancel_reservation("b-2a".into());
    e.advance(10 * MIN);
    e.reserve("b-2a", "mallory.testnet");
    assert_eq!(e.unit("b-2a").status, UnitStatus::Reserved);

    // sweep while the current reservation lapsed but wasn't ended → that reserver
    e.reserve("a-1a", "alice.testnet");
    e.as_1y("alice.testnet");
    let _ = e.c.cancel_reservation("a-1a".into());
    e.advance(10 * MIN);
    e.reserve("a-1a", "dave.testnet");
    e.advance(31 * MIN);
    e.land("a-1a", 5 * USDC);
    e.sync("a-1a");
    assert_eq!(e.unit("a-1a").status, UnitStatus::Reserved);
    assert_eq!(e.unit("a-1a").unattributed.0, 5 * USDC);
    e.as_("anyone.testnet");
    let _ = e.c.sweep_unattributed("a-1a".into());
    assert_eq!(transfer_outs()[0].1, acc("dave.testnet"));
    e.finish_out("a-1a", OutKind::Sweep, "dave.testnet", 5 * USDC, true);
    e.check_conservation();
}

/// Audit #6: a unit is ready only if both its account and its USDC registration succeeded; a failed registration
/// keeps the record for `retry_unit_setup`.
#[test]
fn audit_unit_creation_checks_account_and_registration() {
    let mut e = Env::standard();
    e.as_dep("dev.testnet", NearToken::from_near(1));
    e.c.add_units(vec![UnitInput {
        id: "c-3".into(),
        label: "x".into(),
        price: U128(PRICE),
        plan: vec![],
    }]);
    e.cb(vec![
        PromiseResult::Successful(vec![]),
        PromiseResult::Failed,
    ]);
    assert!(!e.c.on_unit_created("c-3".into(), None));
    let u = e.c.get_unit("c-3".into()).expect("record kept");
    assert!(!u.ready);
    e.as_dep("alice.testnet", RESERVE_DEPOSIT);
    panics(
        "E_UNIT_NOT_FOUND",
        std::panic::AssertUnwindSafe(|| e.c.reserve("c-3".into())),
    );
    e.as_dep("mallory.testnet", USDC_STORAGE);
    panics(
        "E_NOT_DEVELOPER",
        std::panic::AssertUnwindSafe(|| {
            let _ = e.c.retry_unit_setup("c-3".into());
        }),
    );
    e.as_("dev.testnet");
    panics(
        "E_DEPOSIT",
        std::panic::AssertUnwindSafe(|| {
            let _ = e.c.retry_unit_setup("c-3".into());
        }),
    );
    e.as_dep("dev.testnet", USDC_STORAGE);
    let _ = e.c.retry_unit_setup("c-3".into());
    e.cb(vec![
        PromiseResult::Successful(vec![]),
        PromiseResult::Successful(vec![]),
    ]);
    assert!(e.c.on_unit_created("c-3".into(), Some(true)));
    assert!(e.c.get_unit("c-3".into()).unwrap().ready);
    e.as_dep("dev.testnet", USDC_STORAGE);
    panics(
        "E_BAD_ARGS",
        std::panic::AssertUnwindSafe(|| {
            let _ = e.c.retry_unit_setup("c-3".into());
        }),
    );
}

/// Audit #7: propose needs (and keeps) a storage deposit, and its scan only covers the last proposal period.
#[test]
fn audit_proposals_cost_a_deposit_and_scan_is_bounded() {
    let mut e = Env::standard();
    e.buy("a-4b", "alice.testnet", 10_000 * USDC);
    e.buy("a-1a", "bob.testnet", 10_000 * USDC);
    e.buy("b-2a", "carol.testnet", 10_000 * USDC); // ExtendDeadline needs the quorum
    let kind = ProposalKind::ExtendDeadline {
        milestone: 3,
        new_deadline: U64(T0 + 250 * MIN),
    };
    e.as_("alice.testnet");
    panics(
        "E_DEPOSIT",
        std::panic::AssertUnwindSafe(|| {
            e.c.propose(kind.clone());
        }),
    );
    // extra is returned
    e.as_dep("alice.testnet", NearToken::from_millinear(80));
    let p1 = e.c.propose(kind.clone());
    assert!(get_created_receipts().iter().any(|r| {
        r.receiver_id == acc("alice.testnet")
            && r.actions.iter().any(|a| {
                matches!(a, MockAction::Transfer { deposit, .. } if *deposit == NearToken::from_millinear(30))
            })
    }));
    // a token passed to a fresh account opens another proposal; each costs the deposit
    e.as_dep("alice.testnet", NearToken::from_yoctonear(1));
    e.c.nft_transfer(acc("sybil.testnet"), "a-4b".into(), None, None);
    let p2 = e.propose("sybil.testnet", kind.clone());
    assert_eq!(p2.0, p1.0 + 1);
    // after one proposal period, the old ones are expired in fact (views say so) and don't block anyone
    e.advance(11 * MIN);
    assert_eq!(
        e.c.get_proposal(p1).unwrap().status,
        ProposalStatus::Expired
    );
    let p3 = e.propose("sybil.testnet", kind.clone());
    let ids: Vec<u64> =
        e.c.list_proposals(None, None)
            .iter()
            .map(|p| p.id.0)
            .collect();
    assert_eq!(ids, vec![p3.0, p2.0, p1.0], "newest first");
    let page: Vec<u64> =
        e.c.list_proposals(Some(1), Some(1))
            .iter()
            .map(|p| p.id.0)
            .collect();
    assert_eq!(page, vec![p2.0]);
    assert_eq!(e.c.votes_available(p1, acc("sybil.testnet")), 0);
}

// ---------------------------------------------------------------- audit round 2

const ONE_YOCTO_MSG: &str = "Requires attached deposit of exactly 1 yoctoNEAR";

fn balance_bytes(b: u128) -> PromiseResult {
    PromiseResult::Successful(serde_json::to_vec(&U128(b)).unwrap())
}

/// Finding 1: a balance read during a pending `ft_transfer_call` that is then refunded books nothing — neither the
/// public check nor a deposit report whose second read comes after the refund.
#[test]
fn deposit_pending_then_refunded_ft_transfer_call_credits_nothing() {
    let mut e = Env::standard();
    // mallory ft_transfer_calls 9,000 to an unreserved unit: USDC credits the unit first
    e.land("a-1a", 9_000 * USDC);
    assert_eq!(
        e.check("a-1a"),
        9_000 * USDC,
        "the check sees the pending money"
    );
    assert!(get_logs().iter().any(|l| l.contains("balance_checked")));
    let u = e.unit("a-1a");
    assert_eq!((u.paid.0, u.unattributed.0), (0, 0), "but books none of it");
    // a report racing the refund: the first read sees the money, the second doesn't
    let expected = e.start_report("a-1a", 9_000 * USDC);
    assert!(e
        .report_first("a-1a", 9_000 * USDC, expected, 9_000 * USDC)
        .is_some());
    // on_unit_deposit refuses (not reserved) and ft_resolve_transfer refunds
    e.ctx(&unit_acc("a-1a"), NearToken::from_yoctonear(0), vec![]);
    let unused = e.c.on_unit_deposit(
        "a-1a".into(),
        acc("mallory.testnet"),
        U128(9_000 * USDC),
        String::new(),
    );
    assert_eq!(unused.0, 9_000 * USDC);
    *e.bal.get_mut("a-1a").unwrap() -= unused.0;
    assert_eq!(
        e.report_second("a-1a", 9_000 * USDC, expected, 9_000 * USDC, 0),
        0
    );
    let u = e.unit("a-1a");
    assert_eq!((u.paid.0, u.unattributed.0), (0, 0));
    assert_eq!(e.c.nft_total_supply().0, 0, "no token without money");
    // with the reservation active the money is taken, and booked from the accepted amount only
    e.reserve("a-1a", "mallory.testnet");
    assert_eq!(e.wallet_pay("a-1a", "mallory.testnet", 9_000 * USDC), 0);
    assert_eq!(e.unit("a-1a").paid.0, 9_000 * USDC);
    assert_eq!(e.check("a-1a"), 0);
    e.check_conservation();
}

/// Finding 1: a pending `ft_transfer_call` that is accepted is booked exactly once, even when a deposit report
/// read the balance while it was pending.
#[test]
fn deposit_pending_then_accepted_credits_exactly_once() {
    let mut e = Env::standard();
    e.reserve("a-1a", "alice.testnet");
    e.land("a-1a", 9_000 * USDC); // pending ft_transfer_call
    assert_eq!(e.check("a-1a"), 9_000 * USDC);
    assert_eq!(e.unit("a-1a").paid.0, 0);
    // the reporter (mistakenly) reports it while pending; on_unit_deposit accepts before the first callback
    let expected = e.start_report("a-1a", 9_000 * USDC);
    e.ctx(&unit_acc("a-1a"), NearToken::from_yoctonear(0), vec![]);
    assert_eq!(
        e.c.on_unit_deposit(
            "a-1a".into(),
            acc("alice.testnet"),
            U128(9_000 * USDC),
            String::new()
        )
        .0,
        0
    );
    assert_eq!(e.unit("a-1a").paid.0, 9_000 * USDC);
    assert_eq!(e.unit("a-1a").status, UnitStatus::Allocated);
    e.cb(vec![balance_bytes(9_000 * USDC)]);
    panics(
        "E_BALANCE_PENDING",
        std::panic::AssertUnwindSafe(|| {
            let _ =
                e.c.on_report_first("a-1a".into(), U128(9_000 * USDC), expected);
        }),
    );
    // same if the credit lands between the two reads
    let mut f = Env::standard();
    f.reserve("a-1a", "alice.testnet");
    f.land("a-1a", 9_000 * USDC);
    let expected = f.start_report("a-1a", 9_000 * USDC);
    assert!(f
        .report_first("a-1a", 9_000 * USDC, expected, 9_000 * USDC)
        .is_some());
    f.ctx(&unit_acc("a-1a"), NearToken::from_yoctonear(0), vec![]);
    f.c.on_unit_deposit(
        "a-1a".into(),
        acc("alice.testnet"),
        U128(9_000 * USDC),
        String::new(),
    );
    f.cb(vec![balance_bytes(9_000 * USDC)]);
    panics(
        "E_BALANCE_PENDING",
        std::panic::AssertUnwindSafe(|| {
            f.c.on_report_second(
                "a-1a".into(),
                U128(9_000 * USDC),
                expected,
                U128(9_000 * USDC),
            );
        }),
    );
    // a later report finds nothing above the books
    assert_eq!(e.sync("a-1a"), 0);
    assert_eq!(e.report("a-1a", 9_000 * USDC), 0);
    assert_eq!(e.unit("a-1a").paid.0, 9_000 * USDC, "booked once");
    assert_eq!(f.unit("a-1a").paid.0, 9_000 * USDC, "booked once");
    e.check_conservation();
    f.check_conservation();
}

/// Findings 1 and 2: a transfer out of the unit that starts or lands between `report_deposit`'s reads and its
/// callbacks voids the report (the `expected` snapshot no longer matches), so it can't be booked as new money.
#[test]
fn deposit_report_voided_by_transfer_out_between_reads() {
    let mut e = Env::standard();
    e.buy("a-4b", "alice.testnet", 10_000 * USDC);
    e.approve_milestone(0);
    e.advance(3 * MIN);
    let due = e.unit("a-4b").releasable_now.0;
    assert_eq!(due, 2_000 * USDC);
    // 1Click delivers 1,000; the report starts, then a release starts and lands before the first callback
    e.land("a-4b", 1_000 * USDC);
    let stale = e.bal["a-4b"];
    let expected = e.start_report("a-4b", 1_000 * USDC);
    e.as_("anyone.testnet");
    assert_eq!(e.c.claim_release(vec!["a-4b".into()]), 1);
    // while the release is in flight
    e.cb(vec![balance_bytes(stale)]);
    panics(
        "E_BALANCE_PENDING",
        std::panic::AssertUnwindSafe(|| {
            let _ =
                e.c.on_report_first("a-4b".into(), U128(1_000 * USDC), expected);
        }),
    );
    // and once it landed (the read still shows the money that left)
    e.finish_out("a-4b", OutKind::Release, "payout.testnet", due, true);
    e.cb(vec![balance_bytes(stale)]);
    panics(
        "E_BALANCE_PENDING",
        std::panic::AssertUnwindSafe(|| {
            let _ =
                e.c.on_report_first("a-4b".into(), U128(1_000 * USDC), expected);
        }),
    );
    assert_eq!(e.unit("a-4b").paid.0, 10_000 * USDC, "nothing booked");
    // a fresh report books the real 1,000, and only up to what is attested and observed
    assert_eq!(
        e.report("a-4b", 400 * USDC),
        400 * USDC,
        "never more than attested"
    );
    assert_eq!(
        e.report("a-4b", 5_000 * USDC),
        600 * USDC,
        "never more than observed"
    );
    assert_eq!(e.unit("a-4b").paid.0, 11_000 * USDC);
    // the lower of the two reads counts
    e.land("a-4b", 700 * USDC);
    let b = e.bal["a-4b"];
    assert_eq!(
        e.report_with("a-4b", 700 * USDC, b, b - 500 * USDC),
        200 * USDC
    );
    assert_eq!(
        e.sync("a-4b"),
        500 * USDC,
        "the rest is booked by the next report"
    );
    e.check_conservation();
    // only the deposit reporter may report; the public sync never books
    e.as_("alice.testnet");
    panics(
        "E_NOT_RELAYER",
        std::panic::AssertUnwindSafe(|| {
            let _ = e.c.report_deposit("a-4b".into(), U128(1));
        }),
    );
    let before = e.unit("a-4b").paid.0;
    e.check("a-4b");
    assert_eq!(e.unit("a-4b").paid.0, before);
    // a failed balance read books nothing either
    let expected = e.start_report("a-4b", 1);
    e.cb(vec![PromiseResult::Failed]);
    panics(
        "E_BALANCE_PENDING",
        std::panic::AssertUnwindSafe(|| {
            let _ = e.c.on_report_first("a-4b".into(), U128(1), expected);
        }),
    );
}

/// Finding 1: an `ft_transfer_call` while a transfer out is pending bounces (a reservation refund resets `paid`).
#[test]
fn deposit_bounces_while_transfer_out_pending() {
    let mut e = Env::standard();
    e.reserve("a-1a", "alice.testnet");
    e.wallet_pay("a-1a", "alice.testnet", 1_000 * USDC);
    e.as_1y("alice.testnet");
    let _ = e.c.cancel_reservation("a-1a".into());
    assert_eq!(
        e.wallet_pay("a-1a", "alice.testnet", 500 * USDC),
        500 * USDC
    );
    e.finish_out(
        "a-1a",
        OutKind::ReservationRefund,
        "alice.testnet",
        1_000 * USDC,
        true,
    );
    assert_eq!(e.unit("a-1a").status, UnitStatus::Available);
    e.check_conservation();
}

/// Finding 3: every holder (or reserver, guardian, lender, developer) method that changes who may take the token
/// or its money needs exactly 1 yoctoNEAR, so an app function-call key can't call it.
#[test]
fn holder_methods_need_one_yocto() {
    let mut e = Env::standard();
    e.buy("a-4b", "alice.testnet", 10_000 * USDC);
    e.reserve("a-1a", "bob.testnet");
    e.as_("alice.testnet");
    type Call = Box<dyn FnOnce(&mut Estate)>;
    let cases: Vec<(&str, Call)> = vec![
        (
            "list_for_sale",
            Box::new(|c: &mut Estate| c.list_for_sale("a-4b".into(), U128(1))),
        ),
        (
            "cancel_listing",
            Box::new(|c: &mut Estate| c.cancel_listing("a-4b".into())),
        ),
        (
            "set_beneficiary",
            Box::new(|c: &mut Estate| c.set_beneficiary("a-4b".into(), None)),
        ),
        (
            "set_guardians",
            Box::new(|c: &mut Estate| c.set_guardians("a-4b".into(), vec![])),
        ),
        (
            "guardian_recover",
            Box::new(|c: &mut Estate| c.guardian_recover("a-4b".into(), acc("x.testnet"))),
        ),
        (
            "cancel_recovery",
            Box::new(|c: &mut Estate| c.cancel_recovery("a-4b".into())),
        ),
        (
            "set_lien",
            Box::new(|c: &mut Estate| c.set_lien("a-4b".into(), acc("bank.testnet"), U128(1))),
        ),
        (
            "clear_lien",
            Box::new(|c: &mut Estate| c.clear_lien("a-4b".into())),
        ),
        (
            "handover",
            Box::new(|c: &mut Estate| c.handover("a-4b".into())),
        ),
        (
            "cancel_reservation",
            Box::new(|c: &mut Estate| {
                let _ = c.cancel_reservation("a-1a".into());
            }),
        ),
        (
            "set_app_url",
            Box::new(|c: &mut Estate| c.set_app_url("https://plote.app".into())),
        ),
    ];
    for (name, f) in cases {
        let c = &mut e.c;
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| f(c)));
        let msg = r
            .expect_err(name)
            .downcast_ref::<String>()
            .cloned()
            .unwrap_or_default();
        assert!(msg.contains(ONE_YOCTO_MSG), "{name}: {msg}");
    }
    // with 1 yocto they work
    e.as_1y("alice.testnet");
    e.c.list_for_sale("a-4b".into(), U128(12_000 * USDC));
    e.as_1y("bob.testnet");
    let _ = e.c.cancel_reservation("a-1a".into());
    assert_eq!(e.unit("a-1a").status, UnitStatus::Available);
}

/// Finding 15: cancel_listing, cancel_recovery and clear_lien, each by the right account only.
#[test]
fn cancel_listing_recovery_and_clear_lien() {
    let mut e = Env::standard();
    e.buy("a-4b", "alice.testnet", 10_000 * USDC);
    e.as_1y("alice.testnet");
    panics(
        "E_LISTING",
        std::panic::AssertUnwindSafe(|| e.c.cancel_listing("a-4b".into())),
    );
    e.c.list_for_sale("a-4b".into(), U128(12_000 * USDC));
    e.as_1y("bob.testnet");
    panics(
        "E_NOT_HOLDER",
        std::panic::AssertUnwindSafe(|| e.c.cancel_listing("a-4b".into())),
    );
    e.as_1y("alice.testnet");
    e.c.cancel_listing("a-4b".into());
    assert!(e.unit("a-4b").listing.is_none());
    // a default listing can't be cancelled by the holder
    let mut d = defaulted_unit();
    d.as_1y("alice.testnet");
    panics(
        "E_LISTING",
        std::panic::AssertUnwindSafe(|| d.c.cancel_listing("a-4b".into())),
    );

    // cancel_recovery: the holder stops a guardian recovery
    e.as_1y("alice.testnet");
    e.c.set_guardians("a-4b".into(), vec![acc("g1.testnet"), acc("g2.testnet")]);
    for g in ["g1.testnet", "g2.testnet"] {
        e.as_1y(g);
        e.c.guardian_recover("a-4b".into(), acc("thief.testnet"));
    }
    assert!(e.unit("a-4b").recovery.unwrap().ready_at.is_some());
    e.as_1y("g1.testnet");
    panics(
        "E_NOT_HOLDER",
        std::panic::AssertUnwindSafe(|| e.c.cancel_recovery("a-4b".into())),
    );
    e.as_1y("alice.testnet");
    e.c.cancel_recovery("a-4b".into());
    assert!(e.unit("a-4b").recovery.is_none());
    e.advance(3 * MIN);
    e.as_("anyone.testnet");
    panics(
        "E_RECOVERY",
        std::panic::AssertUnwindSafe(|| e.c.finish_recovery("a-4b".into())),
    );

    // clear_lien: only the lender
    e.as_1y("alice.testnet");
    e.c.set_lien("a-4b".into(), acc("bank.testnet"), U128(1_000 * USDC));
    panics(
        "E_NOT_LENDER",
        std::panic::AssertUnwindSafe(|| e.c.clear_lien("a-4b".into())),
    );
    e.as_1y("bank.testnet");
    e.c.clear_lien("a-4b".into());
    assert!(e.unit("a-4b").lien.is_none());
    e.as_1y("bank.testnet");
    panics(
        "E_LIEN",
        std::panic::AssertUnwindSafe(|| e.c.clear_lien("a-4b".into())),
    );
}

/// Finding 15 + 7: nft_revoke / nft_revoke_all, the approval cap and the refund of the excess approval deposit.
#[test]
fn nft_revoke_revoke_all_and_approval_cap() {
    let mut e = Env::standard();
    e.buy("a-4b", "alice.testnet", 10_000 * USDC);
    e.as_dep("alice.testnet", NearToken::from_millinear(10));
    e.c.nft_approve("a-4b".into(), acc("m0.testnet"), None);
    assert!(get_created_receipts().iter().any(|r| {
        r.receiver_id == acc("alice.testnet")
            && r.actions.iter().any(|a| {
                matches!(a, MockAction::Transfer { deposit, .. } if *deposit == NearToken::from_millinear(9))
            })
    }));
    for k in 1..MAX_APPROVALS {
        e.as_dep("alice.testnet", NearToken::from_millinear(1));
        e.c.nft_approve("a-4b".into(), acc(&format!("m{k}.testnet")), None);
    }
    e.as_dep("alice.testnet", NearToken::from_millinear(1));
    panics(
        "E_TOO_MANY_APPROVALS",
        std::panic::AssertUnwindSafe(|| {
            e.c.nft_approve("a-4b".into(), acc("one-more.testnet"), None);
        }),
    );
    // re-approving an approved account is fine (new approval id)
    e.as_dep("alice.testnet", NearToken::from_millinear(1));
    e.c.nft_approve("a-4b".into(), acc("m0.testnet"), None);
    assert!(e
        .c
        .nft_is_approved("a-4b".into(), acc("m0.testnet"), Some(MAX_APPROVALS as u64)));
    // revoke one (holder only, 1 yocto)
    e.as_dep("bob.testnet", NearToken::from_yoctonear(1));
    panics(
        "E_NOT_HOLDER",
        std::panic::AssertUnwindSafe(|| e.c.nft_revoke("a-4b".into(), acc("m1.testnet"))),
    );
    e.as_("alice.testnet");
    panics(
        ONE_YOCTO_MSG,
        std::panic::AssertUnwindSafe(|| e.c.nft_revoke("a-4b".into(), acc("m1.testnet"))),
    );
    e.as_1y("alice.testnet");
    e.c.nft_revoke("a-4b".into(), acc("m1.testnet"));
    assert!(!e.c.nft_is_approved("a-4b".into(), acc("m1.testnet"), None));
    assert!(e.c.nft_is_approved("a-4b".into(), acc("m2.testnet"), None));
    e.as_dep("alice.testnet", NearToken::from_millinear(1));
    e.c.nft_approve("a-4b".into(), acc("one-more.testnet"), None);
    // revoke all
    e.as_1y("alice.testnet");
    e.c.nft_revoke_all("a-4b".into());
    assert!(e
        .c
        .nft_token("a-4b".into())
        .unwrap()
        .approved_account_ids
        .unwrap()
        .is_empty());
    e.as_dep("m2.testnet", NearToken::from_yoctonear(1));
    panics(
        "E_NOT_HOLDER",
        std::panic::AssertUnwindSafe(|| {
            e.c.nft_transfer(acc("m2.testnet"), "a-4b".into(), None, None)
        }),
    );
}

/// Finding 4: a vote weighs `min(paid, price)`; electorates follow later payments; the snapshot rule holds; a
/// proposal from before the upgrade keeps counting tokens.
#[test]
fn vote_weighted_by_money_at_stake() {
    let mut e = Env::standard();
    e.buy("a-4b", "alice.testnet", 8_500 * USDC);
    e.buy("a-1a", "bob.testnet", 8_500 * USDC);
    e.buy("b-2a", "carol.testnet", PRICE + 5_000 * USDC); // excess above the price doesn't count
    let pid = e.propose(
        "alice.testnet",
        ProposalKind::Freeze {
            reason: "no work".into(),
            refunds_open: true,
        },
    );
    let p = e.c.get_proposal(pid).unwrap();
    assert!(p.weighted);
    assert_eq!(p.electorate, 8_500 + 8_500 + 85_000);
    assert!(p.voted.is_empty(), "the marker is hidden");
    assert_eq!(e.c.votes_available(pid, acc("carol.testnet")), 1);
    assert_eq!(e.c.vote_weight_available(pid, acc("carol.testnet")), 85_000);
    for who in ["alice.testnet", "bob.testnet"] {
        e.as_(who);
        e.c.vote(pid, true);
    }
    assert!(
        e.c.get_estate().frozen.is_none(),
        "two small deposits aren't a majority"
    );
    assert!(get_logs().iter().any(|l| l.contains("\"weight\":8500")));
    // alice pays more meanwhile: her weight and the electorate grow together
    e.wallet_pay("a-4b", "alice.testnet", 20_000 * USDC);
    assert_eq!(
        e.c.get_proposal(pid).unwrap().electorate,
        28_500 + 8_500 + 85_000
    );
    e.as_("alice.testnet");
    panics(
        "E_ALREADY_VOTED",
        std::panic::AssertUnwindSafe(|| e.c.vote(pid, true)),
    );
    e.as_("carol.testnet");
    e.c.vote(pid, false);
    let p = e.c.get_proposal(pid).unwrap();
    assert_eq!((p.yes, p.no), (17_000, 85_000));
    assert_eq!(p.status, ProposalStatus::Rejected);

    // a proposal opened before weighted voting (no marker; numbers are token counts) still counts tokens
    let legacy = Proposal {
        id: 99,
        kind: ProposalKind::Freeze {
            reason: "legacy".into(),
            refunds_open: false,
        },
        proposer: acc("bob.testnet"),
        created_at: e.now,
        expires_at: e.now + 10 * MIN,
        electorate: 3,
        yes: 0,
        no: 0,
        voted: vec![],
        status: ProposalStatus::Open,
    };
    e.c.proposals.insert(99, legacy);
    assert!(!e.c.get_proposal(U64(99)).unwrap().weighted);
    e.as_("carol.testnet");
    e.c.vote(U64(99), true);
    let p = e.c.get_proposal(U64(99)).unwrap();
    assert_eq!(
        (p.yes, p.status),
        (1, ProposalStatus::Open),
        "one token, one vote"
    );
}

/// Finding 4: Unfreeze needs the Freeze quorum outside the playground; the playground is exempt.
#[test]
fn vote_unfreeze_needs_quorum() {
    let mut e = Env::standard();
    e.buy("a-4b", "alice.testnet", 10_000 * USDC);
    e.c.frozen = Some(Freeze {
        reason: "x".into(),
        since: U64(e.now),
        refunds_open: false,
    });
    e.as_dep("alice.testnet", PROPOSAL_DEPOSIT);
    panics(
        "E_QUORUM",
        std::panic::AssertUnwindSafe(|| {
            e.c.propose(ProposalKind::Unfreeze);
        }),
    );
    let d = [
        T0 + 60 * MIN,
        T0 + 120 * MIN,
        T0 + 180 * MIN,
        T0 + 240 * MIN,
    ];
    let mut p = Env::new_with(
        params(true),
        d,
        &[
            ("p-01", 1_000 * USDC, vec![]),
            ("p-02", 1_000 * USDC, vec![]),
        ],
    );
    p.buy("p-01", "judge.testnet", 1_000 * USDC);
    p.c.frozen = e.c.frozen.clone();
    let pid = p.propose("judge.testnet", ProposalKind::Unfreeze);
    p.as_("judge.testnet");
    p.c.vote(pid, true);
    assert!(p.c.get_estate().frozen.is_none());
}

/// Finding 5: a milestone signed after its deadline + grace doesn't unlock releases while refunds are open.
#[test]
fn claim_release_refused_while_refunds_open() {
    let mut e = Env::standard();
    e.buy("a-4b", "alice.testnet", 10_000 * USDC);
    e.now = T0 + 63 * MIN; // foundation (T0+60m) + 2m grace missed
    e.approve_milestone(0); // signed late
    e.advance(3 * MIN);
    let u = e.unit("a-4b");
    assert!(u.refunds_open);
    assert_eq!(u.releasable_now.0, 0, "the view agrees");
    assert_eq!(u.refundable_now.0, 10_000 * USDC);
    e.as_("anyone.testnet");
    panics(
        "E_REFUNDS_OPEN",
        std::panic::AssertUnwindSafe(|| {
            e.c.claim_release(vec!["a-4b".into()]);
        }),
    );
    // on time, the same sign-off releases
    let mut f = Env::standard();
    f.buy("a-4b", "alice.testnet", 10_000 * USDC);
    f.approve_milestone(0);
    f.advance(3 * MIN);
    f.as_("anyone.testnet");
    assert_eq!(f.c.claim_release(vec!["a-4b".into()]), 1);
}

/// Finding 6: a reservation refund the reserver can't receive goes to `owed` (via the estate's account) and the
/// reservation still ends.
#[test]
fn reservation_refund_failure_becomes_owed() {
    let mut e = Env::standard();
    e.reserve("a-1a", "alice.testnet");
    e.wallet_pay("a-1a", "alice.testnet", 1_000 * USDC);
    e.as_1y("alice.testnet");
    let _ = e.c.cancel_reservation("a-1a".into());
    // the refund to alice fails → the money moves to the estate's own account instead
    e.finish_out(
        "a-1a",
        OutKind::ReservationRefund,
        "alice.testnet",
        1_000 * USDC,
        false,
    );
    let outs = transfer_outs();
    assert_eq!(outs, vec![(unit_acc("a-1a"), estate_id(), 1_000 * USDC)]);
    assert_eq!(
        e.unit("a-1a").status,
        UnitStatus::Reserved,
        "until that lands"
    );
    // if that fails too, nothing moved and the reservation can be ended again
    e.finish_out(
        "a-1a",
        OutKind::OwedEscrow,
        estate_id().as_str(),
        1_000 * USDC,
        false,
    );
    let u = e.unit("a-1a");
    assert_eq!((u.status, u.in_flight.0), (UnitStatus::Reserved, 0));
    e.check_conservation();
    e.advance(31 * MIN);
    e.as_("anyone.testnet");
    let _ = e.c.expire_reservation("a-1a".into());
    e.finish_out(
        "a-1a",
        OutKind::ReservationRefund,
        "alice.testnet",
        1_000 * USDC,
        false,
    );
    e.finish_out(
        "a-1a",
        OutKind::OwedEscrow,
        estate_id().as_str(),
        1_000 * USDC,
        true,
    );
    assert!(get_logs().iter().any(|l| l.contains("\"owed\":true")));
    let u = e.unit("a-1a");
    assert_eq!(
        (u.status, u.paid.0, u.in_flight.0),
        (UnitStatus::Available, 0, 0)
    );
    assert_eq!(e.c.owed_of(acc("alice.testnet")).0, 1_000 * USDC);
    e.check_conservation();
    e.as_("alice.testnet");
    let _ = e.c.withdraw_owed();
    assert!(ft_transfers()
        .iter()
        .any(|(m, to, a)| m == "ft_transfer" && to == &acc("alice.testnet") && *a == 1_000 * USDC));
    assert_eq!(e.c.owed_of(acc("alice.testnet")).0, 0);
}

/// Finding 7: a milestone stuck in Checking (no verdict) can be reopened by anyone after an hour.
#[test]
fn reopen_stale_check_after_timeout() {
    let mut e = Env::standard();
    e.as_("anyone.testnet");
    panics(
        "E_MILESTONE_STATE",
        std::panic::AssertUnwindSafe(|| e.c.reopen_stale_check(0)),
    );
    let ev = e.submit(0, "qs.testnet");
    assert_eq!(e.c.get_milestones()[0].status, MilestoneStatus::Checking);
    e.advance(59 * MIN);
    e.as_("anyone.testnet");
    panics(
        "E_CHECK_PENDING",
        std::panic::AssertUnwindSafe(|| e.c.reopen_stale_check(0)),
    );
    e.advance(2 * MIN);
    e.as_("anyone.testnet");
    e.c.reopen_stale_check(0);
    assert_eq!(e.c.get_milestones()[0].status, MilestoneStatus::Open);
    let got = e.c.get_evidence(U64(ev)).unwrap();
    assert_eq!(got.status, EvidenceStatus::Error);
    assert!(get_logs().iter().any(|l| l.contains("check_timeout")));
    // a late verdict for the latest evidence still counts
    assert!(e.verdict(ev, true, &[]));
    assert_eq!(e.c.get_milestones()[0].status, MilestoneStatus::Verified);
    e.as_("anyone.testnet");
    panics(
        "E_BAD_ARGS",
        std::panic::AssertUnwindSafe(|| e.c.reopen_stale_check(9)),
    );
}

/// Finding 7: the per-milestone evidence index keeps only the newest MAX_EVIDENCE_IDS ids (root state stays small).
#[test]
fn milestone_evidence_index_is_bounded() {
    let mut e = Env::standard();
    e.c.verification_budget = NearToken::from_near(100).as_yoctonear();
    let mut last = 0;
    for _ in 0..(MAX_EVIDENCE_IDS + 3) {
        last = e.submit(0, "qs.testnet");
        e.verdict(last, false, &["exif_stale"]);
    }
    let m = &e.c.get_milestones()[0];
    assert_eq!(m.evidence_ids.len(), MAX_EVIDENCE_IDS);
    assert_eq!(m.evidence_ids.last().unwrap().0, last);
    assert!(
        e.c.get_evidence(U64(1)).is_some(),
        "old evidence is still stored"
    );
}

/// Finding 8: the developer corrects the app URL (https, bounded); `new` requires one.
#[test]
fn set_app_url_by_developer_only() {
    let mut e = Env::standard();
    e.buy("a-4b", "alice.testnet", 10_000 * USDC);
    e.as_1y("mallory.testnet");
    panics(
        "E_NOT_DEVELOPER",
        std::panic::AssertUnwindSafe(|| e.c.set_app_url("https://evil.example".into())),
    );
    e.as_1y("dev.testnet");
    for bad in [
        "http://plote.app".to_string(),
        "https://".to_string(),
        format!("https://{}", "a".repeat(MAX_APP_URL_LEN)),
        "https://plote.app/\"><script>".to_string(),
        "javascript:alert(1)".to_string(),
    ] {
        panics(
            "E_BAD_ARGS",
            std::panic::AssertUnwindSafe(|| e.c.set_app_url(bad.clone())),
        );
    }
    e.c.set_app_url("https://baobab.plote.app".into());
    assert_eq!(e.c.get_estate().app_url, "https://baobab.plote.app");
    assert!(get_logs().iter().any(|l| l.contains("app_url_changed")));
    let reference =
        e.c.nft_token("a-4b".into())
            .unwrap()
            .metadata
            .unwrap()
            .reference
            .unwrap();
    assert!(reference.starts_with("https://baobab.plote.app/api/meta/"));
    // new() refuses a bad app_url
    let mut a = new_args(protective(&params(false)), [T0 + 1, T0 + 2, T0 + 3, T0 + 4]);
    a.app_url = "http://plote.vercel.app".into();
    panics("E_BAD_ARGS", move || {
        Estate::new(a);
    });
}

/// `Estate::new(a)` with the estate deployed at `account` (the testnet exemption reads the current account).
fn init_on(account: &str, a: NewArgs) -> Result<Estate, String> {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc(account))
        .predecessor_account_id(acc("deployer.testnet"))
        .block_timestamp(T0)
        .account_balance(NearToken::from_near(100));
    testing_env!(b.build());
    std::panic::catch_unwind(move || Estate::new(a)).map_err(|err| {
        err.downcast_ref::<String>()
            .cloned()
            .or_else(|| err.downcast_ref::<&str>().map(|s| s.to_string()))
            .unwrap_or_default()
    })
}

/// Finding 9: outside the playground, an estate on any account but `.testnet` (i.e. mainnet) refuses demo timings in
/// `new`; testnet estates (the demo estates) and the playground may use them; a live demo estate keeps working through
/// set_verifier.
#[test]
fn init_refuses_unsafe_params_outside_playground_and_testnet() {
    let d = [T0 + 1, T0 + 2, T0 + 3, T0 + 4];
    let safe = protective(&params(false));
    assert!(init_on("harmattan-court.plote.near", new_args(safe.clone(), d)).is_ok());
    type Tweak = Box<dyn Fn(&mut Params)>;
    let cases: Vec<(&str, Tweak)> = vec![
        ("demo_mode", Box::new(|p: &mut Params| p.demo_mode = true)),
        (
            "veto_window_ns",
            Box::new(|p: &mut Params| p.veto_window_ns = U64(ONE_DAY_NS - 1)),
        ),
        (
            "grace_ns",
            Box::new(|p: &mut Params| p.grace_ns = U64(2 * MIN)),
        ),
        (
            "default_grace_ns",
            Box::new(|p: &mut Params| p.default_grace_ns = U64(2 * MIN)),
        ),
        (
            "dust_threshold",
            Box::new(|p: &mut Params| p.dust_threshold = U128(USDC + 1)),
        ),
        (
            "capture_ttl_ns",
            Box::new(|p: &mut Params| p.capture_ttl_ns = U64(MIN)),
        ),
        (
            "capture_ttl_ns",
            Box::new(|p: &mut Params| p.capture_ttl_ns = U64(ONE_DAY_NS + 1)),
        ),
    ];
    for (field, f) in cases {
        let mut p = safe.clone();
        f(&mut p);
        // mainnet-style account: refused
        let msg = init_on("harmattan-court.plote.near", new_args(p.clone(), d))
            .err()
            .unwrap_or_else(|| panic!("{field} accepted on .near"));
        assert!(
            msg.contains("E_BAD_ARGS") && msg.contains(field),
            "{field}: {msg}"
        );
        // testnet estate: allowed
        assert!(
            init_on("harmattan-court.plote.testnet", new_args(p, d)).is_ok(),
            "{field} refused on .testnet"
        );
    }
    // the demo estates' own params (demo_mode, 2-minute windows) deploy fresh on testnet, not on mainnet
    assert!(init_on("baobab-heights.plote.testnet", new_args(params(false), d)).is_ok());
    let msg = init_on("baobab-heights.plote.near", new_args(params(false), d))
        .err()
        .unwrap();
    assert!(msg.contains("demo_mode"), "{msg}");
    // ".testnet" must be the suffix, not just appear in the name
    assert!(init_on("x.testnet-lookalike.near", new_args(params(false), d)).is_err());
    // the photo checks stay enforced on testnet too (only demo timings are exempt)
    let mut a = new_args(params(false), d);
    a.geofence.radius_m = 0;
    let msg = init_on("baobab-heights.plote.testnet", a).err().unwrap();
    assert!(msg.contains("geofence"), "{msg}");
    // the playground keeps its demo timings anywhere
    assert!(init_on("playground.plote.near", new_args(params(true), d)).is_ok());
    // a live demo estate isn't bricked: set_verifier before the first sale still works
    let mut e = Env::standard();
    assert!(e.c.params.demo_mode && e.c.params.grace_ns.0 < ONE_DAY_NS);
    e.as_("dev.testnet");
    e.c.set_verifier(VerifierSource {
        repo: "https://github.com/x/plote-verifier".into(),
        commit: "def".into(),
        build_target: "wasm32-wasip2".into(),
    });
    assert_eq!(e.c.get_estate().verifier.commit, "def");
}

/// Coordinator: after the first sale only the playground may repoint the verifier, and only to a pinned build.
#[test]
fn set_verifier_after_sale_only_on_playground() {
    let v = |commit: &str| VerifierSource {
        repo: "https://github.com/x/plote-verifier".into(),
        commit: commit.into(),
        build_target: "wasm32-wasip2".into(),
    };
    let mut e = Env::standard();
    e.buy("a-4b", "alice.testnet", 10_000 * USDC);
    e.as_("dev.testnet");
    panics(
        "E_ALREADY_SOLD",
        std::panic::AssertUnwindSafe(|| e.c.set_verifier(v("def"))),
    );
    let d = [
        T0 + 60 * MIN,
        T0 + 120 * MIN,
        T0 + 180 * MIN,
        T0 + 240 * MIN,
    ];
    let mut p = Env::new_with(params(true), d, &[("p-01", 1_000 * USDC, vec![])]);
    p.buy("p-01", "judge.testnet", 1_000 * USDC);
    p.as_("judge.testnet");
    panics(
        "E_NOT_DEVELOPER",
        std::panic::AssertUnwindSafe(|| p.c.set_verifier(v("def"))),
    );
    p.as_("dev.testnet");
    panics(
        "E_BAD_ARGS",
        std::panic::AssertUnwindSafe(|| p.c.set_verifier(v("  "))),
    );
    p.c.set_verifier(v("def"));
    assert_eq!(p.c.get_estate().verifier.commit, "def");
}

/// Finding 10: on the playground nobody but the surveyor replaces another account's live capture.
#[test]
fn playground_capture_not_replaceable_by_others() {
    let d = [
        T0 + 60 * MIN,
        T0 + 120 * MIN,
        T0 + 180 * MIN,
        T0 + 240 * MIN,
    ];
    let mut e = Env::new_with(params(true), d, &[("p-01", 1_000 * USDC, vec![])]);
    e.as_("judge1.testnet");
    let code = e.c.open_capture(0);
    e.as_("judge2.testnet");
    panics(
        "E_CAPTURE_ACTIVE",
        std::panic::AssertUnwindSafe(|| {
            e.c.open_capture(0);
        }),
    );
    assert_eq!(e.c.get_capture(0).unwrap().code, code);
    // other milestones are free; the owner may reopen their own
    e.c.open_capture(1);
    e.as_("judge1.testnet");
    e.c.open_capture(0);
    // the estate's surveyor may take over
    e.as_("qs.testnet");
    e.c.open_capture(0);
    assert_eq!(e.c.get_capture(0).unwrap().by, acc("qs.testnet"));
    // once expired, anyone
    e.advance(31 * MIN);
    e.as_("judge2.testnet");
    e.c.open_capture(0);
    assert_eq!(e.c.get_capture(0).unwrap().by, acc("judge2.testnet"));
}

/// Finding 11: retry_unit_setup never deletes the unit record, even when get_info fails.
#[test]
fn retry_unit_setup_keeps_record_when_get_info_fails() {
    let mut e = Env::standard();
    e.as_dep("dev.testnet", NearToken::from_near(1));
    e.c.add_units(vec![UnitInput {
        id: "c-4".into(),
        label: "x".into(),
        price: U128(PRICE),
        plan: vec![],
    }]);
    e.cb(vec![
        PromiseResult::Successful(vec![]),
        PromiseResult::Failed,
    ]);
    assert!(!e.c.on_unit_created("c-4".into(), None));
    e.as_dep("dev.testnet", USDC_STORAGE);
    let _ = e.c.retry_unit_setup("c-4".into());
    assert!(get_created_receipts()
        .iter()
        .any(|r| r.receiver_id == unit_acc("c-4")));
    e.cb(vec![
        PromiseResult::Failed,
        PromiseResult::Successful(vec![]),
    ]);
    assert!(!e.c.on_unit_created("c-4".into(), Some(true)));
    let u = e.c.get_unit("c-4".into()).expect("record kept on retry");
    assert!(!u.ready);
    e.as_dep("dev.testnet", USDC_STORAGE);
    let _ = e.c.retry_unit_setup("c-4".into());
    e.cb(vec![
        PromiseResult::Successful(vec![]),
        PromiseResult::Successful(vec![]),
    ]);
    assert!(e.c.on_unit_created("c-4".into(), Some(true)));
    assert!(e.c.get_unit("c-4".into()).unwrap().ready);
}

/// Finding 12: a default listing's price follows what the holder has paid at purchase time.
#[test]
fn default_ask_tracks_later_payments() {
    let mut e = defaulted_unit();
    assert_eq!(e.unit("a-4b").listing.unwrap().ask.0, 10_000 * USDC);
    // alice pays 5,000 more but is still behind (30,000 was due): still in default, ask now 15,000
    e.wallet_pay("a-4b", "alice.testnet", 5_000 * USDC);
    let u = e.unit("a-4b");
    assert_eq!(u.status, UnitStatus::InDefault);
    assert_eq!(u.listing.unwrap().ask.0, 15_000 * USDC);
    e.as_("usdc.testnet");
    let r = e.c.ft_on_transfer(
        acc("bob.testnet"),
        U128(10_000 * USDC),
        json!({ "buy": "a-4b" }).to_string(),
    );
    assert!(
        matches!(r, PromiseOrValue::Value(v) if v.0 == 10_000 * USDC),
        "the old ask is refunded"
    );
    assert_eq!(e.unit("a-4b").holder, Some(acc("alice.testnet")));
    buy_listing(&mut e, "a-4b", "bob.testnet", 15_000 * USDC);
    let penalty = 15_000 * USDC * 500 / 10_000;
    assert!(ft_transfers()
        .iter()
        .any(|(_, to, a)| to == &acc("alice.testnet") && *a == 15_000 * USDC - penalty));
    assert_eq!(e.unit("a-4b").holder, Some(acc("bob.testnet")));
}

/// Finding 13: unit count and plan length are bounded.
#[test]
fn units_and_plans_are_bounded() {
    let mut e = Env::standard();
    e.as_dep("dev.testnet", NearToken::from_near(1));
    let long_plan: Vec<Instalment> = (0..=MAX_PLAN_LEN as u64)
        .map(|k| Instalment {
            due_at: U64(T0 + k + 1),
            cumulative: U128(k as u128),
        })
        .collect();
    panics(
        "E_TOO_MANY",
        std::panic::AssertUnwindSafe(|| {
            e.c.add_units(vec![UnitInput {
                id: "c-9".into(),
                label: "x".into(),
                price: U128(PRICE),
                plan: long_plan.clone(),
            }])
        }),
    );
    let mut n = e.c.units.len();
    let mut k = 0;
    while n < MAX_UNITS {
        let batch: Vec<UnitInput> = (0..MAX_UNITS_PER_CALL.min((MAX_UNITS - n) as usize))
            .map(|_| {
                k += 1;
                UnitInput {
                    id: format!("z-{k}"),
                    label: "x".into(),
                    price: U128(USDC),
                    plan: vec![],
                }
            })
            .collect();
        n += batch.len() as u32;
        e.as_dep("dev.testnet", NearToken::from_near(1));
        e.c.add_units(batch);
    }
    assert_eq!(e.c.units.len(), MAX_UNITS);
    e.as_dep("dev.testnet", NearToken::from_near(1));
    panics(
        "E_TOO_MANY",
        std::panic::AssertUnwindSafe(|| {
            e.c.add_units(vec![UnitInput {
                id: "y-1".into(),
                label: "x".into(),
                price: U128(USDC),
                plan: vec![],
            }])
        }),
    );
}
