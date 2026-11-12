//! Holder votes (SPEC §8): each allocation token votes once, recorded per token, weighted by the money it has at stake
//! (`min(paid, price)` at vote time, in whole USDC). A proposal executes on a majority of `electorate`, the weight of
//! the tokens allocated when it opened (fixed at creation), and — for every kind but `Veto` — also on a strict majority
//! of the distinct holders of those tokens (final review: flash-weight capture).
//!
//! Why both: there is no per-token weight snapshot in state, so a holder can top a unit up right before voting (and
//! refund it after). The weight majority alone would let one such holder pass a `StepIn` / `ReplaceSurveyor` /
//! `Freeze` against everyone else. The distinct-holder majority is the binding safeguard: one account can never pass
//! a money-moving or estate-stopping vote alone while others hold eligible tokens; it would need tokens in other
//! hands (each one a real purchase). `Veto` stays fast and weight-only: it fits inside the veto window and only sends a
//! milestone back for new evidence.

use crate::events::emit;
use crate::*;
use near_sdk::json_types::U64;
use near_sdk::serde_json::json;
use near_sdk::{env, near, AccountId, Promise};
use std::collections::{HashMap, HashSet};

/// Marks a proposal created by this code: its `yes`/`no`/`electorate` are vote weights (whole USDC) and every later
/// `voted` entry is `"+<unit_id>"` (voted yes) or `"-<unit_id>"` (voted no). Stored as the first entry of `voted` (a unit
/// id can never contain `~`, `+` or `-` at its start), so proposals opened before this rule, whose numbers are token
/// counts and whose entries are bare unit ids, keep being counted per token until they expire. Hidden by the views.
pub(crate) const WEIGHTED_MARK: &str = "~weighted";

/// Kinds that also need a strict majority of distinct eligible holders (everything but the time-critical `Veto`).
fn needs_holder_majority(kind: &ProposalKind) -> bool {
    !matches!(kind, ProposalKind::Veto { .. })
}

/// The unit id of a `voted` entry and its direction (`Some(true)` yes, `Some(false)` no, `None` legacy / unknown).
/// `None` for the marker.
pub(crate) fn voted_entry(v: &str) -> Option<(&str, Option<bool>)> {
    if v == WEIGHTED_MARK {
        return None;
    }
    Some(match v.as_bytes().first() {
        Some(b'+') => (&v[1..], Some(true)),
        Some(b'-') => (&v[1..], Some(false)),
        _ => (v, None),
    })
}

/// Has unit `id` voted on `p`?
pub(crate) fn has_voted(p: &Proposal, id: &str) -> bool {
    p.voted
        .iter()
        .any(|v| voted_entry(v).map(|(u, _)| u == id).unwrap_or(false))
}

/// Votes that move money, stop or restart the estate, or move a deadline need a minimum electorate
/// (`MIN_ELECTORATE` tokens and a quarter of all units). Only `Veto` stays fast: it must fit inside the veto window.
fn needs_quorum(kind: &ProposalKind) -> bool {
    !matches!(kind, ProposalKind::Veto { .. })
}

/// A token's vote weight now: its net equity `min(paid − refunded_out, price)` in whole USDC, rounded up (audit round 4,
/// finding 2a: a lien-first or partial refund lowers it at once; an excess withdrawal doesn't, it only took money above
/// the price).
pub(crate) fn vote_weight(unit: &Unit) -> u32 {
    let at_stake = Estate::net_paid(unit).min(unit.price);
    at_stake.div_ceil(VOTE_WEIGHT_UNIT).min(u32::MAX as u128) as u32
}

/// Weight-history entries kept per unit (copy-on-write snapshots, see `note_weight_change`).
pub(crate) const MAX_WEIGHT_HISTORY: usize = 8;

/// Distinct holders: eligible for a proposal, and among them those whose tokens voted yes / no.
pub(crate) struct HolderTally {
    pub eligible: u64,
    pub yes: u64,
    pub no: u64,
}

/// `holder_tally` against a prebuilt `token_index` (views build it once for a page of proposals).
pub(crate) fn tally(p: &Proposal, tokens: &HashMap<&str, (&AccountId, u64)>) -> HolderTally {
    let eligible: HashSet<&AccountId> = tokens
        .values()
        .filter(|(_, at)| *at <= p.created_at)
        .map(|(h, _)| *h)
        .collect();
    let (mut yes, mut no): (HashSet<&AccountId>, HashSet<&AccountId>) = Default::default();
    for v in &p.voted {
        let Some((id, Some(dir))) = voted_entry(v) else {
            continue;
        };
        let Some((h, _)) = tokens.get(id) else {
            continue;
        };
        if !eligible.contains(h) {
            continue;
        }
        if dir {
            yes.insert(h);
        } else {
            no.insert(h);
        }
    }
    HolderTally {
        eligible: eligible.len() as u64,
        yes: yes.len() as u64,
        no: no.len() as u64,
    }
}

pub(crate) fn is_weighted(p: &Proposal) -> bool {
    p.voted.first().map(|v| v == WEIGHTED_MARK).unwrap_or(false)
}

#[near]
impl Estate {
    /// Attach `PROPOSAL_DEPOSIT` (0.05 NEAR, kept by the estate for the proposal's storage; anything above is
    /// returned).
    #[payable]
    pub fn propose(&mut self, kind: ProposalKind) -> U64 {
        let caller = env::predecessor_account_id();
        let now = Self::now();
        let holds = self
            .owner_tokens
            .get(&caller)
            .map(|v| !v.is_empty())
            .unwrap_or(false);
        let is_dev_extension =
            caller == self.developer_id && matches!(kind, ProposalKind::ExtendDeadline { .. });
        ensure!(
            holds || is_dev_extension,
            "E_NOT_ELIGIBLE",
            "only holders can propose (the developer may propose deadline extensions)"
        );
        self.check_recent_proposals(&caller, now);
        let mut expires_at = now + self.params.proposal_period_ns.0;
        match &kind {
            ProposalKind::Veto { milestone } => {
                let i = self.assert_valid_milestone(*milestone);
                let m = &self.milestones[i];
                let veto_until = m.veto_until.unwrap_or(0);
                ensure!(
                    m.status == MilestoneStatus::Approved && now < veto_until,
                    "E_VETO_WINDOW",
                    "milestone {} isn't in its veto window",
                    milestone
                );
                expires_at = expires_at.min(veto_until);
            }
            ProposalKind::ExtendDeadline {
                milestone,
                new_deadline,
            } => {
                let i = self.assert_valid_milestone(*milestone);
                if let Err(e) = self.extension_valid(i, new_deadline.0, now) {
                    errors::fail("E_DEADLINES", e);
                }
                // Allowed after a miss too: it is the recovery path (refunds close, releases resume), so like every
                // kind but Veto it needs the quorum and a paid-weighted majority.
            }
            ProposalKind::ReplaceSurveyor { account } => {
                ensure!(
                    account != &self.surveyor_id,
                    "E_BAD_ARGS",
                    "that is already the surveyor"
                );
            }
            ProposalKind::Freeze { reason, .. } => {
                ensure!(
                    !reason.is_empty() && reason.len() <= 280,
                    "E_BAD_ARGS",
                    "reason must be 1-280 characters"
                );
            }
            ProposalKind::Unfreeze => ensure!(
                self.frozen.is_some(),
                "E_BAD_ARGS",
                "the estate isn't frozen"
            ),
            ProposalKind::StepIn { .. } => ensure!(
                self.step_in_allowed(now),
                "E_STEP_IN",
                "a step-in can only be proposed while releases are frozen or after a milestone deadline was missed"
            ),
        }
        // One pass over the units (≤ MAX_UNITS): how many tokens exist (quorum) and what they weigh (electorate).
        let (tokens, electorate) = self
            .units
            .values()
            .filter(|u| u.status.has_token())
            .fold((0u32, 0u32), |(n, w), u| {
                (n + 1, w.saturating_add(vote_weight(u)))
            });
        ensure!(
            tokens > 0 && electorate > 0,
            "E_NOT_ELIGIBLE",
            "no allocated tokens can vote yet"
        );
        // The judge sandbox has no real money and many units; its votes stay demo-able by a single judge.
        if needs_quorum(&kind) && !self.params.playground {
            let units = self.units.len();
            ensure!(
                tokens >= MIN_ELECTORATE && tokens.saturating_mul(MIN_ELECTORATE_SHARE) >= units,
                "E_QUORUM",
                "a {} vote needs at least {} allocated tokens and at least a quarter of the {} units allocated; {} are",
                kind.name(),
                MIN_ELECTORATE,
                units,
                tokens
            );
        }
        let deposit = env::attached_deposit();
        ensure!(
            deposit >= PROPOSAL_DEPOSIT,
            "E_DEPOSIT",
            "attach {} to propose (the proposal's storage; kept by the estate)",
            PROPOSAL_DEPOSIT
        );
        let extra = deposit.saturating_sub(PROPOSAL_DEPOSIT);
        if !extra.is_zero() {
            Promise::new(caller.clone()).transfer(extra).detach();
        }
        let id = self.next_proposal_id;
        self.next_proposal_id += 1;
        // Weight changes while this proposal is open are recorded per unit from now on (`note_weight_change`).
        let horizon = self.proposal_horizon().max(expires_at);
        crate::ext::set(crate::ext::K_PROPOSAL_HORIZON, &horizon);
        emit(
            "proposal_created",
            json!({ "proposal_id": U64(id), "kind": kind.name(), "proposer": caller, "expires_at": U64(expires_at) }),
        );
        self.proposals.insert(
            id,
            Proposal {
                id,
                kind,
                proposer: caller,
                created_at: now,
                expires_at,
                electorate,
                yes: 0,
                no: 0,
                voted: vec![WEIGHTED_MARK.to_string()],
                status: ProposalStatus::Open,
            },
        );
        U64(id)
    }

    /// Votes with every token the caller holds that was allocated before the proposal opened and hasn't voted on it
    /// yet (whoever held it then), up to `MAX_VOTE_TOKENS_PER_CALL` per call, each weighted by `min(paid, price)` now.
    pub fn vote(&mut self, proposal_id: U64, approve: bool) {
        let caller = env::predecessor_account_id();
        let now = Self::now();
        let mut p = self
            .proposals
            .get(&proposal_id.0)
            .cloned()
            .unwrap_or_else(|| errors::fail("E_PROPOSAL_STATE", "no such proposal"));
        ensure!(
            p.status == ProposalStatus::Open,
            "E_PROPOSAL_STATE",
            "proposal is {:?}",
            p.status
        );
        ensure!(
            now < p.expires_at,
            "E_PROPOSAL_STATE",
            "proposal expired; call expire_proposal"
        );
        let mut eligible = self.eligible_tokens(&p, &caller);
        // A token mid-`nft_transfer_call` can't vote: the receiver could vote with it and hand it back (finding 12).
        let before_pending = eligible.len();
        eligible.retain(|id| !self.nft_pending(id, now));
        if eligible.is_empty() && before_pending > 0 {
            errors::fail(
                "E_NFT_PENDING",
                "your eligible tokens are in a pending nft_transfer_call; vote after it resolves",
            );
        }
        if eligible.is_empty() {
            let any_old_enough = !self.snapshot_tokens(&p, &caller).is_empty();
            if any_old_enough {
                errors::fail(
                    "E_ALREADY_VOTED",
                    "every token you hold has already voted on this proposal",
                );
            }
            errors::fail(
                "E_NOT_ELIGIBLE",
                "no token you hold can vote on this proposal (allocated after it opened)",
            );
        }
        eligible.truncate(MAX_VOTE_TOKENS_PER_CALL);
        let n = eligible.len() as u32;
        let weighted = is_weighted(&p);
        let weight = if weighted {
            eligible
                .iter()
                .filter_map(|id| self.units.get(id))
                .fold(0u32, |w, u| {
                    w.saturating_add(self.weight_for(u, p.created_at))
                })
        } else {
            n // a proposal opened before weighted voting keeps counting tokens
        };
        if weighted {
            let sign = if approve { '+' } else { '-' };
            p.voted
                .extend(eligible.into_iter().map(|id| format!("{sign}{id}")));
        } else {
            p.voted.extend(eligible);
        }
        if approve {
            p.yes = p.yes.saturating_add(weight);
        } else {
            p.no = p.no.saturating_add(weight);
        }
        emit(
            "voted",
            json!({ "proposal_id": proposal_id, "voter": caller, "approve": approve, "tokens": n, "weight": weight }),
        );
        let (yes, no, electorate) = (p.yes as u64, p.no as u64, p.electorate as u64);
        let (mut passes, mut fails) = (yes * 2 > electorate, no * 2 >= electorate);
        if weighted && needs_holder_majority(&p.kind) {
            let t = self.holder_tally(&p);
            passes = passes && t.yes * 2 > t.eligible;
            fails = fails || t.no * 2 >= t.eligible;
        }
        if passes && !self.still_executable(&p.kind, now) {
            // Passed, but its precondition lapsed meanwhile (e.g. an unfreeze before a step-in passed).
            env::log_str("proposal passed but its precondition no longer holds; rejected");
            p.status = ProposalStatus::Rejected;
            self.proposals.insert(p.id, p);
            emit("proposal_rejected", json!({ "proposal_id": proposal_id }));
        } else if passes {
            p.status = ProposalStatus::Executed;
            let kind = p.kind.clone();
            self.proposals.insert(p.id, p);
            self.execute(kind, now);
            emit("proposal_executed", json!({ "proposal_id": proposal_id }));
        } else if fails {
            p.status = ProposalStatus::Rejected;
            self.proposals.insert(p.id, p);
            emit("proposal_rejected", json!({ "proposal_id": proposal_id }));
        } else {
            self.proposals.insert(p.id, p);
        }
    }

    pub fn expire_proposal(&mut self, proposal_id: U64) {
        let mut p = self
            .proposals
            .get(&proposal_id.0)
            .cloned()
            .unwrap_or_else(|| errors::fail("E_PROPOSAL_STATE", "no such proposal"));
        ensure!(
            p.status == ProposalStatus::Open && Self::now() >= p.expires_at,
            "E_PROPOSAL_STATE",
            "proposal isn't open and expired"
        );
        p.status = ProposalStatus::Expired;
        self.proposals.insert(p.id, p);
    }
}

impl Estate {
    /// The caller's tokens that can still vote on `p`: allocated before it opened, not voted yet.
    pub(crate) fn eligible_tokens(&self, p: &Proposal, account: &AccountId) -> Vec<UnitId> {
        self.snapshot_tokens(p, account)
            .into_iter()
            .filter(|id| !has_voted(p, id))
            .collect()
    }

    /// The caller's tokens that were allocated when `p` opened (the snapshot rule), voted or not.
    pub(crate) fn snapshot_tokens(&self, p: &Proposal, account: &AccountId) -> Vec<UnitId> {
        let Some(ids) = self.owner_tokens.get(account) else {
            return vec![];
        };
        ids.iter()
            .filter(|id| {
                self.units
                    .get(*id)
                    .map(|u| {
                        u.status.has_token()
                            && u.allocated_at.map(|a| a <= p.created_at).unwrap_or(false)
                    })
                    .unwrap_or(false)
            })
            .cloned()
            .collect()
    }

    /// Fails `E_PROPOSAL_OPEN` if `caller` has a live proposal, and marks lapsed ones Expired. Bounded: ids
    /// are sequential and `created_at` never decreases with the id, and every proposal expires within
    /// `proposal_period_ns` of its creation, so the scan walks back from the newest and stops at the first proposal
    /// older than one period. Its cost is the number of proposals opened in the last period, not all proposals ever
    /// (each of which also cost its proposer `PROPOSAL_DEPOSIT`). Older proposals still marked Open are expired in
    /// fact; views report them as Expired and `vote` refuses them.
    fn check_recent_proposals(&mut self, caller: &AccountId, now: u64) {
        let period = self.params.proposal_period_ns.0;
        let mut id = self.next_proposal_id;
        while id > 1 {
            id -= 1;
            let Some(mut p) = self.proposals.get(&id).cloned() else {
                continue;
            };
            if p.created_at.saturating_add(period) <= now {
                break;
            }
            if p.status != ProposalStatus::Open {
                continue;
            }
            if now >= p.expires_at {
                p.status = ProposalStatus::Expired;
                self.proposals.insert(id, p);
            } else {
                ensure!(
                    &p.proposer != caller,
                    "E_PROPOSAL_OPEN",
                    "you already have an open proposal"
                );
            }
        }
    }

    /// Every allocated token: unit id → (holder, allocated_at). One pass over the units (≤ `MAX_UNITS`).
    pub(crate) fn token_index(&self) -> HashMap<&str, (&AccountId, u64)> {
        self.units
            .values()
            .filter(|u| u.status.has_token())
            .filter_map(|u| Some((u.id.as_str(), (u.holder.as_ref()?, u.allocated_at?))))
            .collect()
    }

    /// Distinct current holders of the tokens eligible for `p` (allocated at or before it opened), and how many of them
    /// hold a token that voted yes / no. A holder counts once however many tokens they hold; one who voted some tokens
    /// yes and others no counts on both sides.
    pub(crate) fn holder_tally(&self, p: &Proposal) -> HolderTally {
        tally(p, &self.token_index())
    }

    /// `StepIn` redirects every future release, so it is only for a project in trouble: releases frozen by a
    /// holder vote, or a milestone deadline (plus grace) missed without a timely sign-off.
    pub(crate) fn step_in_allowed(&self, now: u64) -> bool {
        self.frozen.is_some() || (0..self.milestones.len()).any(|i| self.milestone_missed(i, now))
    }

    fn still_executable(&self, kind: &ProposalKind, now: u64) -> bool {
        match kind {
            ProposalKind::StepIn { .. } => self.step_in_allowed(now),
            ProposalKind::Unfreeze => self.frozen.is_some(),
            // Re-checked at execution (finding 8): two extensions of neighbouring milestones, or one that the clock
            // overtook, must not leave deadlines out of order, in the past or shorter than they are now.
            ProposalKind::ExtendDeadline {
                milestone,
                new_deadline,
            } => self
                .extension_valid(*milestone as usize, new_deadline.0, now)
                .is_ok(),
            _ => true,
        }
    }

    /// An `ExtendDeadline` to `new_deadline` for milestone `i`: in the future, later than its current deadline (an
    /// extension never shortens), and strictly between its neighbours' deadlines.
    pub(crate) fn extension_valid(
        &self,
        i: usize,
        new_deadline: u64,
        now: u64,
    ) -> Result<(), String> {
        if i >= self.milestones.len() {
            return Err("no such milestone".into());
        }
        if new_deadline <= now {
            return Err("new deadline must be in the future".into());
        }
        if new_deadline <= self.milestones[i].deadline {
            return Err("an extension must move the deadline later, never earlier".into());
        }
        if i > 0 && new_deadline <= self.milestones[i - 1].deadline {
            return Err("must stay after the previous milestone".into());
        }
        if i + 1 < self.milestones.len() && new_deadline >= self.milestones[i + 1].deadline {
            return Err("must stay before the next milestone".into());
        }
        Ok(())
    }

    /// The latest `expires_at` of any proposal (0: none). Stored by `propose` (`zx`); an estate upgraded with
    /// proposals already open finds them with a scan bounded like `check_recent_proposals` until the first `propose`
    /// or `migrate` stores it.
    pub(crate) fn proposal_horizon(&self) -> u64 {
        if let Some(h) = crate::ext::get::<u64>(crate::ext::K_PROPOSAL_HORIZON) {
            return h;
        }
        let period = self.params.proposal_period_ns.0;
        let now = Self::now();
        let mut h = 0u64;
        let mut id = self.next_proposal_id;
        while id > 1 {
            id -= 1;
            let Some(p) = self.proposals.get(&id) else {
                continue;
            };
            if p.created_at.saturating_add(period) <= now {
                break;
            }
            h = h.max(p.expires_at);
        }
        h
    }

    /// Copy-on-write weight snapshot (finding 2b). Called after a unit's weight changed from `before` to its current
    /// value at `now`. While any proposal may still be open, it appends `(now, before)` to the unit's history, so `vote`
    /// can find the weight a token had when a proposal opened: the `before` of the first change at or after that time.
    /// Entries older than one proposal period are dropped (every proposal created before them has expired), and past
    /// `MAX_WEIGHT_HISTORY` the two oldest merge into `(later time, smaller weight)`, which can only under-count.
    /// Cost: bounded, and only paid while proposals are open.
    pub(crate) fn note_weight_change(&mut self, unit: &Unit, before: u32, now: u64) {
        let after = vote_weight(unit);
        if after == before || now >= self.proposal_horizon() {
            return;
        }
        let k = crate::ext::key(crate::ext::P_WEIGHT_HISTORY, unit.id.as_bytes());
        let mut h: Vec<(u64, u32)> = crate::ext::get(&k).unwrap_or_default();
        let period = self.params.proposal_period_ns.0;
        h.retain(|(at, _)| at.saturating_add(period) > now);
        h.push((now, before));
        while h.len() > MAX_WEIGHT_HISTORY {
            let (_, w0) = h.remove(0);
            h[0].1 = h[0].1.min(w0);
        }
        crate::ext::set(&k, &h);
    }

    /// The weight `unit` had when a proposal created at `created_at` opened, if it changed since (see above).
    pub(crate) fn weight_at(&self, unit_id: &str, created_at: u64) -> Option<u32> {
        let k = crate::ext::key(crate::ext::P_WEIGHT_HISTORY, unit_id.as_bytes());
        let h: Vec<(u64, u32)> = crate::ext::get(&k)?;
        h.into_iter()
            .find(|(at, _)| *at >= created_at)
            .map(|(_, w)| w)
    }

    /// What a token votes with on a proposal opened at `created_at`: its weight now, but never more than it had then
    /// (a top-up after a proposal opened adds nothing; a refund since lowers it at once).
    pub(crate) fn weight_for(&self, unit: &Unit, created_at: u64) -> u32 {
        let now = vote_weight(unit);
        match self.weight_at(&unit.id, created_at) {
            Some(then) => now.min(then),
            None => now,
        }
    }

    pub(crate) fn clear_weight_history(&mut self, unit_id: &str) {
        crate::ext::del(&crate::ext::key(
            crate::ext::P_WEIGHT_HISTORY,
            unit_id.as_bytes(),
        ));
    }

    fn execute(&mut self, kind: ProposalKind, now: u64) {
        match kind {
            ProposalKind::ReplaceSurveyor { account } => {
                let old = std::mem::replace(&mut self.surveyor_id, account.clone());
                emit("surveyor_changed", json!({ "old": old, "new": account }));
            }
            ProposalKind::Veto { milestone } => {
                let m = &mut self.milestones[milestone as usize];
                if m.status == MilestoneStatus::Approved
                    && m.veto_until.map(|v| now < v).unwrap_or(false)
                {
                    m.status = MilestoneStatus::Vetoed;
                    m.signed_at = None;
                    m.veto_until = None;
                    m.verified_at = None;
                    self.stats.vetoes += 1;
                }
            }
            ProposalKind::Freeze {
                reason,
                refunds_open,
            } => {
                emit(
                    "frozen",
                    json!({ "reason": reason, "refunds_open": refunds_open }),
                );
                self.frozen = Some(Freeze {
                    reason,
                    since: U64(now),
                    refunds_open,
                });
            }
            ProposalKind::Unfreeze => {
                self.frozen = None;
                emit("unfrozen", json!({}));
            }
            ProposalKind::ExtendDeadline {
                milestone,
                new_deadline,
            } => {
                self.milestones[milestone as usize].deadline = new_deadline.0;
            }
            ProposalKind::StepIn { new_payout_id } => {
                let old = self.payout_account();
                emit(
                    "payout_redirected",
                    json!({ "old": old, "new": new_payout_id }),
                );
                self.payout_redirect = Some(new_payout_id);
            }
        }
    }
}
