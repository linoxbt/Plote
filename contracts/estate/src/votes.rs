//! Holder votes (SPEC §8): each allocation token votes once, recorded per token, weighted by the money it has at stake
//! (`min(paid, price)` at vote time, in whole USDC); a proposal executes on a majority of the weight of the tokens
//! allocated when it opened (`electorate`, kept in step as those tokens are paid up).

use crate::events::emit;
use crate::*;
use near_sdk::json_types::U64;
use near_sdk::serde_json::json;
use near_sdk::{env, near, AccountId, Promise};

/// Marks a proposal created by this code: its `yes`/`no`/`electorate` are vote weights (whole USDC). Stored as the
/// first entry of `voted` (a unit id can never contain `~`), so proposals opened before weighted voting, whose numbers
/// are token counts, keep being counted per token until they expire. Hidden by the views.
pub(crate) const WEIGHTED_MARK: &str = "~weighted";

/// Votes that move money, stop or restart the estate, or move a deadline need a minimum electorate
/// (`MIN_ELECTORATE` tokens and a quarter of all units). Only `Veto` stays fast: it must fit inside the veto window.
fn needs_quorum(kind: &ProposalKind) -> bool {
    !matches!(kind, ProposalKind::Veto { .. })
}

/// A token's vote weight: `min(paid, price)` in whole USDC, rounded up (an allocated token always weighs ≥ 1).
pub(crate) fn vote_weight(unit: &Unit) -> u32 {
    let at_stake = unit.paid.min(unit.price);
    at_stake.div_ceil(VOTE_WEIGHT_UNIT).min(u32::MAX as u128) as u32
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
                ensure!(
                    new_deadline.0 > now,
                    "E_DEADLINES",
                    "new deadline must be in the future"
                );
                if i > 0 {
                    ensure!(
                        new_deadline.0 > self.milestones[i - 1].deadline,
                        "E_DEADLINES",
                        "must stay after the previous milestone"
                    );
                }
                if i + 1 < self.milestones.len() {
                    ensure!(
                        new_deadline.0 < self.milestones[i + 1].deadline,
                        "E_DEADLINES",
                        "must stay before the next milestone"
                    );
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
        let weight = if is_weighted(&p) {
            eligible
                .iter()
                .filter_map(|id| self.units.get(id))
                .fold(0u32, |w, u| w.saturating_add(vote_weight(u)))
        } else {
            n // a proposal opened before weighted voting keeps counting tokens
        };
        p.voted.extend(eligible);
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
        if yes * 2 > electorate && !self.still_executable(&p.kind, now) {
            // Passed, but its precondition lapsed meanwhile (e.g. an unfreeze before a step-in passed).
            env::log_str("proposal passed but its precondition no longer holds; rejected");
            p.status = ProposalStatus::Rejected;
            self.proposals.insert(p.id, p);
            emit("proposal_rejected", json!({ "proposal_id": proposal_id }));
        } else if yes * 2 > electorate {
            p.status = ProposalStatus::Executed;
            let kind = p.kind.clone();
            self.proposals.insert(p.id, p);
            self.execute(kind, now);
            emit("proposal_executed", json!({ "proposal_id": proposal_id }));
        } else if no * 2 >= electorate {
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
            .filter(|id| !p.voted.contains(id))
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

    /// A token's vote weight changed from `old_weight` (its money at stake grew, or it was just allocated): every open
    /// weighted proposal it can vote on counts the difference in its electorate, so a majority stays a majority of what
    /// the eligible tokens weigh now, not when the proposal opened. Bounded like `check_recent_proposals`: only
    /// proposals opened within the last `proposal_period_ns` can still be open.
    pub(crate) fn track_weight_change(&mut self, unit: &Unit, old_weight: u32, now: u64) {
        if !unit.status.has_token() {
            return;
        }
        let new_weight = vote_weight(unit);
        if new_weight <= old_weight {
            return;
        }
        let Some(allocated_at) = unit.allocated_at else {
            return;
        };
        let delta = new_weight - old_weight;
        let period = self.params.proposal_period_ns.0;
        let mut id = self.next_proposal_id;
        while id > 1 {
            id -= 1;
            let Some(p) = self.proposals.get(&id) else {
                continue;
            };
            if p.created_at.saturating_add(period) <= now {
                break;
            }
            if p.status != ProposalStatus::Open
                || now >= p.expires_at
                || !is_weighted(p)
                || allocated_at > p.created_at
            {
                continue;
            }
            let mut p = p.clone();
            p.electorate = p.electorate.saturating_add(delta);
            self.proposals.insert(id, p);
        }
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
            _ => true,
        }
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
