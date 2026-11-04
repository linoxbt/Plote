//! Holder votes (SPEC §8): one vote per allocation token, recorded per token, executed on a majority
//! of the tokens allocated when the proposal opened.

use crate::events::emit;
use crate::*;
use near_sdk::json_types::U64;
use near_sdk::serde_json::json;
use near_sdk::{env, near, AccountId};

#[near]
impl Estate {
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
        self.expire_stale(now);
        ensure!(
            !self
                .proposals
                .values()
                .any(|p| p.status == ProposalStatus::Open && p.proposer == caller),
            "E_PROPOSAL_OPEN",
            "you already have an open proposal"
        );
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
            ProposalKind::StepIn { .. } => {}
        }
        let electorate = self.allocated_count();
        ensure!(
            electorate > 0,
            "E_NOT_ELIGIBLE",
            "no allocated tokens can vote yet"
        );
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
                voted: vec![],
                status: ProposalStatus::Open,
            },
        );
        U64(id)
    }

    /// One vote for every token the caller holds that was allocated before the proposal opened and
    /// hasn't voted on it yet (whoever held it then).
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
        let eligible = self.eligible_tokens(&p, &caller);
        ensure!(
            !eligible.is_empty(),
            "E_NOT_ELIGIBLE",
            "no token you hold can vote on this proposal (allocated later, or already voted)"
        );
        let n = eligible.len() as u32;
        p.voted.extend(eligible);
        if approve {
            p.yes += n;
        } else {
            p.no += n;
        }
        emit(
            "voted",
            json!({ "proposal_id": proposal_id, "voter": caller, "approve": approve, "tokens": n }),
        );
        if p.yes * 2 > p.electorate {
            p.status = ProposalStatus::Executed;
            let kind = p.kind.clone();
            self.proposals.insert(p.id, p);
            self.execute(kind, now);
            emit("proposal_executed", json!({ "proposal_id": proposal_id }));
        } else if p.no * 2 >= p.electorate {
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
    pub(crate) fn eligible_tokens(&self, p: &Proposal, account: &AccountId) -> Vec<UnitId> {
        let Some(ids) = self.owner_tokens.get(account) else {
            return vec![];
        };
        ids.iter()
            .filter(|id| !p.voted.contains(id))
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

    fn expire_stale(&mut self, now: u64) {
        let stale: Vec<u64> = self
            .proposals
            .values()
            .filter(|p| p.status == ProposalStatus::Open && now >= p.expires_at)
            .map(|p| p.id)
            .collect();
        for id in stale {
            if let Some(mut p) = self.proposals.get(&id).cloned() {
                p.status = ProposalStatus::Expired;
                self.proposals.insert(id, p);
            }
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
                self.payout_redirect = Some(new_payout_id);
            }
        }
    }
}
