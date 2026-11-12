//! Read-only views. Shapes match docs/INTERFACE.md §1.3.

use crate::*;
use near_sdk::json_types::{U128, U64};
use near_sdk::{env, near, AccountId};

#[near(serializers = [json])]
pub struct Totals {
    pub paid: U128,
    pub released: U128,
    pub refunded: U128,
    pub in_escrow: U128,
}

#[near(serializers = [json])]
pub struct EstateView {
    pub name: String,
    pub location: String,
    pub account: AccountId,
    pub app_url: String,
    pub developer_id: AccountId,
    pub payout_id: AccountId,
    pub surveyor_id: AccountId,
    pub recovery_id: AccountId,
    pub usdc_id: AccountId,
    pub outlayer_id: AccountId,
    pub verdict_relayer: Option<AccountId>,
    pub verify_mode: String,
    pub verifier: VerifierSource,
    pub unit_code_hash: String,
    pub geofence: Geofence,
    pub params: Params,
    pub frozen: Option<Freeze>,
    pub payout_redirect: Option<AccountId>,
    pub unit_count: u32,
    pub allocated_count: u32,
    pub available_count: u32,
    pub totals: Totals,
    pub stats: DevStats,
    pub verification_budget: U128,
    pub refunds_open: bool,
    pub now: U64,
}

#[near(serializers = [json])]
pub struct NextDue {
    pub due_at: U64,
    pub cumulative: U128,
    pub shortfall: U128,
}

#[near(serializers = [json])]
pub struct UnitView {
    pub id: String,
    pub account: AccountId,
    pub label: String,
    pub price: U128,
    pub status: UnitStatus,
    pub ready: bool,
    pub holder: Option<AccountId>,
    pub allocated_at: Option<U64>,
    pub reservation: Option<Reservation>,
    pub last_reservation: Option<Reservation>,
    pub plan: Vec<Instalment>,
    pub paid: U128,
    pub unattributed: U128,
    pub released: U128,
    pub refunded_out: U128,
    pub in_flight: U128,
    pub listing: Option<Listing>,
    pub beneficiary: Option<AccountId>,
    pub guardians: Vec<AccountId>,
    pub recovery: Option<Recovery>,
    pub lien: Option<Lien>,
    pub refundable_now: U128,
    pub releasable_now: U128,
    pub excess_now: U128,
    pub refunds_open: bool,
    pub next_due: Option<NextDue>,
    pub progress_bps: u32,
    pub approved_bps: u32,
}

#[near(serializers = [json])]
pub struct TakenView {
    pub exists: bool,
    pub status: Option<UnitStatus>,
    pub holder: Option<AccountId>,
    pub paid: U128,
    pub released: U128,
    pub price: U128,
    pub label: Option<String>,
    pub account: Option<AccountId>,
    pub reserved_until: Option<U64>,
    pub allocated_at: Option<U64>,
}

#[near(serializers = [json])]
pub struct MilestoneView {
    pub index: u8,
    pub key: String,
    pub title: String,
    pub bps: u16,
    pub deadline: U64,
    pub status: MilestoneStatus,
    pub late: bool,
    pub evidence_ids: Vec<U64>,
    pub verified_at: Option<U64>,
    pub signed_at: Option<U64>,
    pub veto_until: Option<U64>,
    pub veto_passed: bool,
    pub refunds_open_at: U64,
}

#[near(serializers = [json])]
pub struct CaptureView {
    pub milestone: u8,
    pub code: String,
    pub by: AccountId,
    pub opened_at: U64,
    pub expires_at: U64,
}

#[near(serializers = [json])]
pub struct EvidenceView {
    pub id: U64,
    pub milestone: u8,
    pub url: String,
    pub sha256: String,
    pub captured_at: U64,
    pub device_gps: Option<(i32, i32)>,
    pub challenge: String,
    pub challenge_opened_at: U64,
    pub submitted_by: AccountId,
    pub submitted_at: U64,
    pub status: EvidenceStatus,
    pub verdict: Option<Verdict>,
    pub raw_response_hash: Option<String>,
    pub error: Option<String>,
    /// The AI model the verdict named (`ai_model` in the worker output), if any. Stored outside `Evidence` (key `zm`).
    pub ai_model: Option<String>,
}

#[near(serializers = [json])]
pub struct ProposalView {
    pub id: U64,
    pub kind: ProposalKind,
    pub proposer: AccountId,
    pub created_at: U64,
    pub expires_at: U64,
    pub electorate: u32,
    pub yes: u32,
    pub no: u32,
    pub voted: Vec<String>,
    /// true: `electorate`/`yes`/`no` are vote weights in whole USDC (net equity `min(paid − refunded_out, price)` per token, capped at its weight when the proposal opened); false: a proposal
    /// opened before weighted voting, counted per token.
    pub weighted: bool,
    /// Distinct current holders of the tokens eligible for this proposal, and those of them whose tokens voted yes /
    /// no. Every kind but `Veto` (on a weighted proposal) needs `holders_yes × 2 > holders_eligible` as well as the
    /// weight majority. Computed at view time.
    pub holders_eligible: u32,
    pub holders_yes: u32,
    pub holders_no: u32,
    pub status: ProposalStatus,
}

#[near]
impl Estate {
    pub fn get_estate(&self) -> EstateView {
        let now = Self::now();
        let (mut paid, mut released, mut refunded, mut escrow) = (0u128, 0u128, 0u128, 0u128);
        let (mut allocated, mut available) = (0u32, 0u32);
        for u in self.units.values() {
            paid += u.paid;
            released += u.released;
            refunded += u.refunded_out;
            escrow += (u.paid + u.unattributed).saturating_sub(u.released + u.refunded_out);
            if u.status.has_token() {
                allocated += 1;
            }
            if u.status == UnitStatus::Available && u.ready {
                available += 1;
            }
        }
        EstateView {
            name: self.name.clone(),
            location: self.location.clone(),
            account: env::current_account_id(),
            app_url: self.app_url.clone(),
            developer_id: self.developer_id.clone(),
            payout_id: self.payout_id.clone(),
            surveyor_id: self.surveyor_id.clone(),
            recovery_id: self.recovery_id.clone(),
            usdc_id: self.usdc_id.clone(),
            outlayer_id: self.outlayer_id.clone(),
            verdict_relayer: self.verdict_relayer.clone(),
            verify_mode: self.verify_mode.clone(),
            verifier: self.verifier.clone(),
            unit_code_hash: String::from(&self.unit_code_hash),
            geofence: self.geofence,
            params: self.params.clone(),
            frozen: self.frozen.clone(),
            payout_redirect: self.payout_redirect.clone(),
            unit_count: self.units.len(),
            allocated_count: allocated,
            available_count: available,
            totals: Totals {
                paid: U128(self.total_paid_in.max(paid)),
                released: U128(self.total_released.max(released)),
                refunded: U128(self.total_refunded.max(refunded)),
                in_escrow: U128(escrow),
            },
            stats: self.dev_stats(),
            verification_budget: U128(self.verification_budget),
            refunds_open: self.refunds_open(now),
            now: U64(now),
        }
    }

    pub fn get_unit(&self, unit_id: String) -> Option<UnitView> {
        self.units.get(&unit_id).map(|u| self.unit_view(u))
    }

    pub fn list_units(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<UnitView> {
        let from = from_index.unwrap_or(0) as usize;
        let limit = limit.unwrap_or(100).min(200) as usize;
        self.units
            .values()
            .skip(from)
            .take(limit)
            .map(|u| self.unit_view(u))
            .collect()
    }

    pub fn is_taken(&self, unit_id: String) -> TakenView {
        let id = unit_id.trim().to_lowercase();
        let id = id.split('.').next().unwrap_or("").to_string();
        match self.units.get(&id) {
            None => TakenView {
                exists: false,
                status: None,
                holder: None,
                paid: U128(0),
                released: U128(0),
                price: U128(0),
                label: None,
                account: None,
                reserved_until: None,
                allocated_at: None,
            },
            Some(u) => TakenView {
                exists: true,
                status: Some(u.status),
                holder: u.holder.clone(),
                // Net equity (finding 5): what the holder has in and not taken back (`paid − refunded_out`).
                paid: U128(Self::net_paid(u)),
                released: U128(u.released),
                price: U128(u.price),
                label: Some(u.label.clone()),
                account: Some(u.account.clone()),
                reserved_until: u.reservation.as_ref().map(|r| r.expires_at),
                allocated_at: u.allocated_at.map(U64),
            },
        }
    }

    pub fn get_milestones(&self) -> Vec<MilestoneView> {
        let now = Self::now();
        self.milestones
            .iter()
            .enumerate()
            .map(|(i, m)| {
                let missed = self.milestone_missed(i, now);
                let status = if missed && m.status != MilestoneStatus::Approved {
                    MilestoneStatus::Missed
                } else {
                    m.status
                };
                MilestoneView {
                    index: i as u8,
                    key: m.key.clone(),
                    title: m.title.clone(),
                    bps: m.bps,
                    deadline: U64(m.deadline),
                    status,
                    late: missed,
                    evidence_ids: m.evidence_ids.iter().map(|e| U64(*e)).collect(),
                    verified_at: m.verified_at.map(U64),
                    signed_at: m.signed_at.map(U64),
                    veto_until: m.veto_until.map(U64),
                    veto_passed: m.status == MilestoneStatus::Approved
                        && m.veto_until.map(|v| now >= v).unwrap_or(false),
                    refunds_open_at: U64(m.deadline.saturating_add(self.params.grace_ns.0)),
                }
            })
            .collect()
    }

    pub fn get_capture(&self, milestone: u8) -> Option<CaptureView> {
        self.captures.get(&milestone).map(|c| CaptureView {
            milestone,
            code: c.code.clone(),
            by: c.by.clone(),
            opened_at: c.opened_at,
            expires_at: c.expires_at,
        })
    }

    pub fn get_evidence(&self, id: U64) -> Option<EvidenceView> {
        self.evidence.get(&id.0).map(evidence_view)
    }

    pub fn list_evidence(
        &self,
        milestone: Option<u8>,
        from_index: Option<u32>,
        limit: Option<u32>,
    ) -> Vec<EvidenceView> {
        let from = from_index.unwrap_or(0) as u64;
        let limit = limit.unwrap_or(50).min(100) as u64;
        let mut out = vec![];
        let mut skipped = 0u64;
        let mut id = self.next_evidence_id;
        while id > 1 && (out.len() as u64) < limit {
            id -= 1;
            let Some(ev) = self.evidence.get(&id) else {
                continue;
            };
            if milestone.map(|m| m != ev.milestone).unwrap_or(false) {
                continue;
            }
            if skipped < from {
                skipped += 1;
                continue;
            }
            out.push(evidence_view(ev));
        }
        out
    }

    pub fn get_proposal(&self, id: U64) -> Option<ProposalView> {
        let now = Self::now();
        self.proposals
            .get(&id.0)
            .map(|p| proposal_view(p, now, self.holder_tally(p)))
    }

    /// Newest first. Proposal ids are sequential from 1 and never removed, so this reads only the page asked for.
    pub fn list_proposals(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<ProposalView> {
        let now = Self::now();
        let tokens = self.token_index();
        let from = from_index.unwrap_or(0) as u64;
        let limit = limit.unwrap_or(50).min(100) as u64;
        let newest = self.next_proposal_id.saturating_sub(1);
        let top = newest.saturating_sub(from);
        (0..limit)
            .map_while(|k| top.checked_sub(k).filter(|id| *id >= 1))
            .filter_map(|id| self.proposals.get(&id))
            .map(|p| proposal_view(p, now, crate::votes::tally(p, &tokens)))
            .collect()
    }

    pub fn votes_available(&self, proposal_id: U64, account_id: AccountId) -> u32 {
        let now = Self::now();
        self.proposals
            .get(&proposal_id.0)
            .filter(|p| p.status == ProposalStatus::Open && now < p.expires_at)
            .map(|p| self.eligible_tokens(p, &account_id).len() as u32)
            .unwrap_or(0)
    }

    /// The vote weight `vote` would cast for `account_id` right now (same token cap per call as `vote`).
    pub fn vote_weight_available(&self, proposal_id: U64, account_id: AccountId) -> u32 {
        let now = Self::now();
        self.proposals
            .get(&proposal_id.0)
            .filter(|p| p.status == ProposalStatus::Open && now < p.expires_at)
            .map(|p| {
                let ids = self.eligible_tokens(p, &account_id);
                if !crate::votes::is_weighted(p) {
                    return ids.len().min(MAX_VOTE_TOKENS_PER_CALL) as u32;
                }
                ids.iter()
                    .filter(|id| !self.nft_pending(id, now))
                    .take(MAX_VOTE_TOKENS_PER_CALL)
                    .filter_map(|id| self.units.get(id))
                    .fold(0u32, |w, u| {
                        w.saturating_add(self.weight_for(u, p.created_at))
                    })
            })
            .unwrap_or(0)
    }

    pub fn dev_stats(&self) -> DevStats {
        let now = Self::now();
        let due = self
            .milestones
            .iter()
            .filter(|m| m.status == MilestoneStatus::Approved || m.deadline < now)
            .count() as u32;
        let on_time = self
            .milestones
            .iter()
            .filter(|m| {
                m.status == MilestoneStatus::Approved
                    && m.signed_at.map(|s| s <= m.deadline).unwrap_or(false)
            })
            .count() as u32;
        let s = &self.stats;
        DevStats {
            milestones_due: due,
            milestones_on_time: on_time,
            units_sold: s.units_sold,
            units_refunded: s.units_refunded,
            evidence_submitted: s.evidence_submitted,
            evidence_passed: s.evidence_passed,
            signoffs: s.signoffs,
            vetoes: s.vetoes,
            units_handed_over: s.units_handed_over,
        }
    }

    pub fn verification_budget(&self) -> U128 {
        U128(self.verification_budget)
    }

    pub fn owed_of(&self, account_id: AccountId) -> U128 {
        U128(self.owed.get(&account_id).copied().unwrap_or(0))
    }
}

fn evidence_view(e: &Evidence) -> EvidenceView {
    let ai_model = crate::ext::get::<String>(&crate::ext::key(
        crate::ext::P_AI_MODEL,
        &e.id.to_le_bytes(),
    ));
    EvidenceView {
        ai_model,
        id: U64(e.id),
        milestone: e.milestone,
        url: e.url.clone(),
        sha256: e.sha256.clone(),
        captured_at: U64(e.captured_at),
        device_gps: e.device_gps,
        challenge: e.challenge.clone(),
        challenge_opened_at: U64(e.challenge_opened_at),
        submitted_by: e.submitted_by.clone(),
        submitted_at: U64(e.submitted_at),
        status: e.status,
        verdict: e.verdict.clone(),
        raw_response_hash: e.raw_response_hash.clone(),
        error: e.error.clone(),
    }
}

/// An Open proposal past `expires_at` is reported as Expired (storage may still say Open: `propose` only expires
/// recent ones, `expire_proposal` any one).
fn proposal_view(p: &Proposal, now: u64, t: crate::votes::HolderTally) -> ProposalView {
    ProposalView {
        id: U64(p.id),
        kind: p.kind.clone(),
        proposer: p.proposer.clone(),
        created_at: U64(p.created_at),
        expires_at: U64(p.expires_at),
        electorate: p.electorate,
        yes: p.yes,
        no: p.no,
        voted: p
            .voted
            .iter()
            .filter_map(|v| crate::votes::voted_entry(v).map(|(id, _)| id.to_string()))
            .collect(),
        weighted: crate::votes::is_weighted(p),
        holders_eligible: t.eligible as u32,
        holders_yes: t.yes as u32,
        holders_no: t.no as u32,
        status: if p.status == ProposalStatus::Open && now >= p.expires_at {
            ProposalStatus::Expired
        } else {
            p.status
        },
    }
}

impl Estate {
    pub(crate) fn unit_view(&self, u: &Unit) -> UnitView {
        let now = Self::now();
        let refunds_open =
            u.status.has_token() && u.status != UnitStatus::HandedOver && self.refunds_open(now);
        let next_due = u
            .plan
            .iter()
            .find(|i| u.paid < i.cumulative.0)
            .map(|i| NextDue {
                due_at: i.due_at,
                cumulative: i.cumulative,
                shortfall: U128(i.cumulative.0 - u.paid),
            });
        let bps = self.approved_bps(now) as u32;
        UnitView {
            id: u.id.clone(),
            account: u.account.clone(),
            label: u.label.clone(),
            price: U128(u.price),
            status: u.status,
            ready: u.ready,
            holder: u.holder.clone(),
            allocated_at: u.allocated_at.map(U64),
            reservation: u.reservation.clone(),
            last_reservation: u.last_reservation.clone(),
            plan: u.plan.clone(),
            paid: U128(u.paid),
            unattributed: U128(u.unattributed),
            released: U128(u.released),
            refunded_out: U128(u.refunded_out),
            in_flight: U128(u.in_flight),
            // A default listing's ask is what the holder has paid now (what a purchase would cost).
            listing: u.listing.clone().map(|mut l| {
                l.ask = U128(Self::listing_ask(u, &l));
                l
            }),
            beneficiary: u.beneficiary.clone(),
            guardians: u.guardians.clone(),
            recovery: u.recovery.clone(),
            lien: u.lien.clone(),
            refundable_now: U128(if refunds_open { self.refundable(u) } else { 0 }),
            // claim_release moves nothing while frozen or while refunds are open (E_FROZEN / E_REFUNDS_OPEN).
            releasable_now: U128(if self.frozen.is_some() || self.refunds_open(now) {
                0
            } else {
                self.releasable(u, now)
            }),
            excess_now: U128(self.excess(u).min(self.refundable(u))),
            refunds_open,
            next_due,
            progress_bps: bps,
            approved_bps: bps,
        }
    }
}
