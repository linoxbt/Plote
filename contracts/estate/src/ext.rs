//! State added after the first testnet deploy (audit round 4), kept OUT of the `Estate` struct.
//!
//! Live estates are upgraded in place, so the borsh layout of `Estate`, `Unit`, `Proposal`, `Milestone`, `Evidence` and
//! every type stored inside them must never change. Everything new lives under its own raw storage keys, read and
//! written directly with `env::storage_*` (no cached collection, so there is nothing to flush and two helpers can't
//! hold diverging copies).
//!
//! Key space: the root state is `STATE`; the original collections use the one-byte `StorageKey` prefixes `0x00..=0x07`.
//! Every key below starts with `z` (0x7a) followed by one more ASCII letter, and each map prefix is exactly two bytes,
//! so no key here can collide with the original ones or with another entry below.
//!
//! | key / prefix | kind | what |
//! |---|---|---|
//! | `zv` | value `u32` | state version (`STATE_VERSION`) |
//! | `zx` | value `u64` | latest `expires_at` of any proposal created by this code (when weight history is needed) |
//! | `zs` + unit id | `Vec<(u64, u32)>` | weight history: (changed_at, weight before the change), oldest first |
//! | `zl` + unit id | `PendingLien` | a lien the holder offered, waiting for the lender's `accept_lien` |
//! | `zu` + unit id | `SurplusRequest` | a pending request to book an unbooked surplus as unattributed |
//! | `zr` + account | `Vec<u64>` | playground: when this account submitted evidence (last hour) |
//! | `zt` | value `u64` | playground: last `playground_reset` |
//! | `zn` + unit id | `u64` | an `nft_transfer_call` of this token is pending since (cleared by the resolve callback) |
//! | `zw` + unit id | `u64` | when a `report_deposit` last credited this unit |
//! | `zm` + evidence id (u64 LE) | `String` | the AI model a verdict named (`ai_model`, optional) |
//! | `zh` + unit id | `Vec<(u64, AccountId)>` | holder history: (changed_at, holder before the change), oldest first |
//! | `zi` | value `Vec<String>` | unit ids that have a holder history (so views read only those) |
//! | `zd` + unit id | `u128` | USDC accepted by `on_unit_deposit` but deferred (not booked), not yet reported |

use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::{env, near, AccountId};

/// Bump when the stored state changes meaning; `migrate` brings an older estate up to it.
/// 1 = every estate deployed before this marker existed (no `zv` key). 2 = audit round 4.
pub const STATE_VERSION: u32 = 2;

pub(crate) const K_VERSION: &[u8] = b"zv";
pub(crate) const K_PROPOSAL_HORIZON: &[u8] = b"zx";
pub(crate) const P_WEIGHT_HISTORY: &[u8] = b"zs";
pub(crate) const P_PENDING_LIEN: &[u8] = b"zl";
pub(crate) const P_SURPLUS: &[u8] = b"zu";
pub(crate) const P_PLAYGROUND_SUBMITS: &[u8] = b"zr";
pub(crate) const K_PLAYGROUND_RESET: &[u8] = b"zt";
pub(crate) const P_NFT_PENDING: &[u8] = b"zn";
pub(crate) const P_LAST_REPORT: &[u8] = b"zw";
pub(crate) const P_AI_MODEL: &[u8] = b"zm";
pub(crate) const P_HOLDER_HISTORY: &[u8] = b"zh";
pub(crate) const K_HOLDER_INDEX: &[u8] = b"zi";
pub(crate) const P_DEFERRED: &[u8] = b"zd";

/// A lien offered by the holder (`set_lien`) that the lender hasn't accepted yet. `holder` is who offered it: if the
/// token changes hands before `accept_lien`, the offer is void.
#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct PendingLien {
    pub lender: AccountId,
    pub cap: u128,
    pub holder: AccountId,
}

/// `request_surplus_booking`: the surplus seen over the books at `at`; `finalize_surplus_booking` may book at most this
/// much, and only `SURPLUS_DELAY_NS` later.
#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct SurplusRequest {
    pub at: u64,
    pub amount: u128,
}

pub(crate) fn key(prefix: &[u8], id: &[u8]) -> Vec<u8> {
    let mut k = Vec::with_capacity(prefix.len() + id.len());
    k.extend_from_slice(prefix);
    k.extend_from_slice(id);
    k
}

pub(crate) fn get<T: BorshDeserialize>(k: &[u8]) -> Option<T> {
    env::storage_read(k).and_then(|b| borsh::from_slice(&b).ok())
}

pub(crate) fn set<T: BorshSerialize>(k: &[u8], v: &T) {
    env::storage_write(k, &borsh::to_vec(v).expect("borsh"));
}

pub(crate) fn del(k: &[u8]) {
    env::storage_remove(k);
}

pub(crate) fn state_version() -> u32 {
    get::<u32>(K_VERSION).unwrap_or(1)
}
