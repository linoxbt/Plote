//! Milestones: challenge capture → evidence → TEE verdict (OutLayer) → surveyor sign-off → veto window.

use crate::events::emit;
use crate::*;
use near_sdk::json_types::U64;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::{env, near, Promise};

/// Challenge alphabet: no 0/O, 1/I/L, so handwriting can't be misread.
const ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LEN: usize = 6;
const MAX_VERDICT_BYTES: usize = 16 * 1024;
/// The model returns up to 4 short observations (SPEC 6.4); keep what is stored bounded.
const MAX_OBSERVATIONS: usize = 4;
const MAX_OBSERVATION_CHARS: usize = 160;

pub(crate) fn make_code(seed: &[u8]) -> String {
    let h = env::sha256(seed);
    h.iter()
        .take(CODE_LEN)
        .map(|b| ALPHABET[(*b as usize) % ALPHABET.len()] as char)
        .collect()
}

fn is_hex64(s: &str) -> bool {
    s.len() == 64
        && s.chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
}

/// Find the verdict inside whatever OutLayer hands back: a bare verdict, a JSON string, or a wrapper
/// such as `{status, output: "<stdout>", attestation}`. Returns the verdict and any attestation reference.
pub(crate) fn extract_verdict(v: &Value, depth: u8) -> Option<(Verdict, Option<String>)> {
    if depth > 4 {
        return None;
    }
    match v {
        Value::String(s) => {
            let inner: Value = serde_json::from_str(s.trim()).ok()?;
            extract_verdict(&inner, depth + 1)
        }
        Value::Object(map) => {
            if map.get("pass").map(|p| p.is_boolean()).unwrap_or(false) {
                let mut norm = v.clone();
                if let Some(t) = norm.get_mut("exif_time") {
                    if let Some(n) = t.as_u64() {
                        *t = Value::String(n.to_string());
                    }
                }
                let verdict: Verdict = serde_json::from_value(norm).ok()?;
                return Some((verdict, None));
            }
            for key in [
                "output",
                "result",
                "data",
                "stdout",
                "value",
                "Ok",
                "ok",
                "response",
                "execution",
            ] {
                if let Some(inner) = map.get(key) {
                    if let Some((verdict, att)) = extract_verdict(inner, depth + 1) {
                        let att = att.or_else(|| attestation_ref(map));
                        return Some((verdict, att));
                    }
                }
            }
            None
        }
        _ => None,
    }
}

/// `evidence_id` and `sha256` the worker echoes next to its verdict (review L3), from the same object
/// `extract_verdict` accepts. Absent fields (older worker builds) are `None`.
pub(crate) fn verdict_binding(v: &Value, depth: u8) -> (Option<u64>, Option<String>) {
    if depth > 4 {
        return (None, None);
    }
    match v {
        Value::String(s) => serde_json::from_str::<Value>(s.trim())
            .map(|inner| verdict_binding(&inner, depth + 1))
            .unwrap_or((None, None)),
        Value::Object(map) => {
            if map.get("pass").map(|p| p.is_boolean()).unwrap_or(false) {
                let id = match map.get("evidence_id") {
                    Some(Value::Number(n)) => n.as_u64(),
                    Some(Value::String(s)) => s.parse().ok(),
                    _ => None,
                };
                let sha = map
                    .get("sha256")
                    .and_then(|s| s.as_str())
                    .map(|s| s.to_ascii_lowercase());
                return (id, sha);
            }
            for key in [
                "output",
                "result",
                "data",
                "stdout",
                "value",
                "Ok",
                "ok",
                "response",
                "execution",
            ] {
                if let Some(inner) = map.get(key) {
                    let r = verdict_binding(inner, depth + 1);
                    if r.0.is_some() || r.1.is_some() {
                        return r;
                    }
                }
            }
            (None, None)
        }
        _ => (None, None),
    }
}

fn attestation_ref(map: &serde_json::Map<String, Value>) -> Option<String> {
    for key in [
        "attestation",
        "attestation_id",
        "execution_id",
        "request_id",
        "tx_hash",
        "id",
    ] {
        match map.get(key) {
            Some(Value::String(s)) if !s.is_empty() => return Some(s.chars().take(200).collect()),
            Some(Value::Number(n)) => return Some(n.to_string()),
            Some(Value::Object(o)) => {
                return Some(
                    Value::Object(o.clone())
                        .to_string()
                        .chars()
                        .take(200)
                        .collect(),
                )
            }
            _ => {}
        }
    }
    None
}

#[near]
impl Estate {
    /// Issue a one-time code the surveyor must write on paper and keep in the photo.
    pub fn open_capture(&mut self, milestone: u8) -> String {
        self.assert_surveyor();
        self.assert_not_frozen();
        let i = self.assert_valid_milestone(milestone);
        let st = self.milestones[i].status;
        ensure!(
            matches!(st, MilestoneStatus::Open | MilestoneStatus::Vetoed),
            "E_MILESTONE_STATE",
            "milestone {} is {:?}; captures open only for Open or Vetoed milestones",
            milestone,
            st
        );
        let now = Self::now();
        let mut seed = env::random_seed_array().to_vec();
        seed.push(milestone);
        seed.extend_from_slice(&now.to_le_bytes());
        seed.extend_from_slice(env::predecessor_account_id().as_bytes());
        let code = make_code(&seed);
        let expires_at = now + self.params.capture_ttl_ns.0;
        let by = env::predecessor_account_id();
        self.captures.insert(
            milestone,
            Capture {
                code: code.clone(),
                by: by.clone(),
                opened_at: U64(now),
                expires_at: U64(expires_at),
            },
        );
        emit(
            "capture_opened",
            json!({ "milestone": milestone, "by": by, "expires_at": U64(expires_at) }),
        );
        code
    }

    /// Commit a photo's SHA-256 on-chain, then ask the TEE worker to check it.
    pub fn submit_evidence(
        &mut self,
        milestone: u8,
        url: String,
        sha256: String,
        captured_at: U64,
        device_gps: Option<(i32, i32)>,
    ) -> U64 {
        self.assert_surveyor();
        self.assert_not_frozen();
        let i = self.assert_valid_milestone(milestone);
        let st = self.milestones[i].status;
        ensure!(
            matches!(st, MilestoneStatus::Open | MilestoneStatus::Vetoed),
            "E_MILESTONE_STATE",
            "milestone {} is {:?}; evidence is accepted only for Open or Vetoed milestones",
            milestone,
            st
        );
        let caller = env::predecessor_account_id();
        let now = Self::now();
        let capture = self.captures.get(&milestone).cloned().unwrap_or_else(|| {
            errors::fail(
                "E_NO_CHALLENGE",
                "call open_capture first and photograph the code",
            )
        });
        ensure!(
            capture.by == caller,
            "E_NO_CHALLENGE",
            "this capture was opened by {}",
            capture.by
        );
        ensure!(
            now < capture.expires_at.0,
            "E_CHALLENGE_EXPIRED",
            "the challenge code expired; open a new capture"
        );
        ensure!(
            is_hex64(&sha256),
            "E_BAD_ARGS",
            "sha256 must be 64 lowercase hex characters"
        );
        ensure!(
            url.starts_with("https://") && url.len() <= 512,
            "E_BAD_ARGS",
            "url must be https and at most 512 characters"
        );
        let outlayer = self.verify_mode == "outlayer";
        if outlayer {
            ensure!(
                self.verification_budget >= VERIFY_DEPOSIT.as_yoctonear(),
                "E_BUDGET",
                "verification budget is below {}; call fund_verification",
                VERIFY_DEPOSIT
            );
            self.verification_budget -= VERIFY_DEPOSIT.as_yoctonear();
        }

        let id = self.next_evidence_id;
        self.next_evidence_id += 1;
        let ev = Evidence {
            id,
            milestone,
            url,
            sha256: sha256.clone(),
            captured_at: captured_at.0,
            device_gps,
            challenge: capture.code.clone(),
            challenge_opened_at: capture.opened_at.0,
            submitted_by: caller,
            submitted_at: now,
            status: EvidenceStatus::Pending,
            verdict: None,
            raw_response_hash: None,
            error: None,
        };
        self.evidence.insert(id, ev.clone());
        let m = &mut self.milestones[i];
        m.status = MilestoneStatus::Checking;
        m.evidence_ids.push(id);
        self.captures.remove(&milestone);
        self.stats.evidence_submitted += 1;
        emit(
            "evidence_submitted",
            json!({ "evidence_id": U64(id), "milestone": milestone, "sha256": sha256 }),
        );

        if outlayer {
            self.start_check(&ev).detach();
        }
        U64(id)
    }

    /// Callback from OutLayer (yield/resume). Accepts a bare verdict or a wrapper with the verdict inside.
    #[private]
    pub fn on_verdict(&mut self, evidence_id: u64) -> bool {
        let Some(bytes) = result_bytes(0, MAX_VERDICT_BYTES) else {
            self.set_error(evidence_id, "OutLayer call failed or timed out");
            return false;
        };
        let raw_hash = hex_lower(&env::sha256(&bytes));
        let parsed: Option<Value> = serde_json::from_slice(&bytes).ok();
        let found = parsed.as_ref().and_then(|v| extract_verdict(v, 0));
        match found {
            Some((mut verdict, att)) => {
                if verdict.attestation.is_none() {
                    verdict.attestation = att;
                }
                // A verdict must be about this evidence and these exact bytes, when the worker says which.
                let (bound_id, bound_sha) = parsed
                    .as_ref()
                    .map(|v| verdict_binding(v, 0))
                    .unwrap_or((None, None));
                let committed = self
                    .evidence
                    .get(&evidence_id)
                    .map(|e| e.sha256.to_ascii_lowercase());
                let mismatch = bound_id.is_some_and(|id| id != evidence_id)
                    || matches!((&bound_sha, &committed), (Some(a), Some(b)) if a != b);
                if mismatch {
                    self.set_error_with(
                        evidence_id,
                        "the verdict is for different evidence or different photo bytes",
                        "verdict_mismatch",
                    );
                    if let Some(mut ev) = self.evidence.get(&evidence_id).cloned() {
                        ev.raw_response_hash = Some(raw_hash);
                        self.evidence.insert(evidence_id, ev);
                    }
                    return false;
                }
                self.apply_verdict(evidence_id, verdict, "outlayer", Some(raw_hash))
            }
            None => {
                // OutLayer resumes with `null` when it didn't run the worker at all (e.g. the secrets' access
                // condition refused the caller, or the build couldn't be fetched); say so instead of blaming the worker.
                let msg = if parsed.as_ref().is_some_and(Value::is_null) {
                    "OutLayer didn't run the check (it returned no output)"
                } else {
                    "unparsable worker output"
                };
                self.set_error(evidence_id, msg);
                if let Some(mut ev) = self.evidence.get(&evidence_id).cloned() {
                    ev.raw_response_hash = Some(raw_hash);
                    self.evidence.insert(evidence_id, ev);
                }
                false
            }
        }
    }

    /// HTTPS fallback (SPEC 6.6): the relayer passes through a verdict it fetched from OutLayer's API.
    /// Only for estates in `verify_mode: "https"`; an OutLayer-mode estate takes verdicts from OutLayer only.
    pub fn submit_verdict(&mut self, evidence_id: U64, verdict: Verdict) -> bool {
        ensure!(
            self.verdict_relayer.as_ref() == Some(&env::predecessor_account_id()),
            "E_NOT_RELAYER",
            "only the verdict relayer can submit verdicts"
        );
        ensure!(
            self.verify_mode == "https",
            "E_VERIFY_MODE",
            "this estate's verify_mode is {}; verdicts come only from OutLayer",
            self.verify_mode
        );
        let ev = self
            .evidence
            .get(&evidence_id.0)
            .cloned()
            .unwrap_or_else(|| errors::fail("E_BAD_ARGS", "no such evidence"));
        ensure!(
            matches!(ev.status, EvidenceStatus::Pending | EvidenceStatus::Error),
            "E_BAD_ARGS",
            "evidence {} already has a verdict",
            evidence_id.0
        );
        self.apply_verdict(evidence_id.0, verdict, "https", None)
    }

    /// Surveyor signs a Verified milestone. The holder veto window starts now.
    pub fn qs_sign(&mut self, milestone: u8) {
        self.assert_surveyor();
        let i = self.assert_valid_milestone(milestone);
        ensure!(
            self.milestones[i].status == MilestoneStatus::Verified,
            "E_NOT_VERIFIED",
            "milestone {} has no passed evidence",
            milestone
        );
        let now = Self::now();
        let veto_until = now + self.params.veto_window_ns.0;
        let m = &mut self.milestones[i];
        m.status = MilestoneStatus::Approved;
        m.signed_at = Some(now);
        m.veto_until = Some(veto_until);
        self.stats.signoffs += 1;
        emit(
            "qs_signed",
            json!({ "milestone": milestone, "by": env::predecessor_account_id(), "veto_until": U64(veto_until) }),
        );
    }

    /// Holder marks the unit handed over once the last milestone is approved and its veto window passed.
    pub fn handover(&mut self, unit_id: String) {
        let mut unit = self.unit(&unit_id);
        self.assert_holder(&unit);
        ensure!(
            unit.status == UnitStatus::Allocated,
            "E_HANDOVER",
            "only an Allocated unit can be handed over"
        );
        let last = self.milestones.last().unwrap();
        let now = Self::now();
        ensure!(
            last.status == MilestoneStatus::Approved
                && last.veto_until.map(|v| now >= v).unwrap_or(false),
            "E_HANDOVER",
            "the handover milestone isn't approved yet"
        );
        unit.status = UnitStatus::HandedOver;
        unit.listing = None;
        self.stats.units_handed_over += 1;
        emit("handed_over", json!({ "unit_id": unit_id }));
        self.save(unit);
    }

    /// View: the worker input for a pending evidence (used by the HTTPS fallback route, SPEC 6.6).
    pub fn check_input(&self, evidence_id: U64) -> Option<String> {
        self.evidence
            .get(&evidence_id.0)
            .map(|ev| self.check_input_json(ev))
    }
}

pub(crate) fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0xf) as usize] as char);
    }
    s
}

impl Estate {
    pub(crate) fn recent_phashes(&self, n: u32) -> Vec<String> {
        let len = self.accepted_phashes.len();
        let start = len.saturating_sub(n);
        (start..len)
            .filter_map(|i| self.accepted_phashes.get(i).map(|h| format!("{:016x}", h)))
            .collect()
    }

    /// The exact stdin the TEE worker gets for this evidence. Shared by the on-chain path and the HTTPS fallback.
    pub(crate) fn check_input_json(&self, ev: &Evidence) -> String {
        let m = &self.milestones[ev.milestone as usize];
        json!({
            "evidence_id": ev.id,
            "url": ev.url,
            "sha256": ev.sha256,
            "captured_at": ev.captured_at,
            "device_gps": ev.device_gps,
            "now": env::block_timestamp(),
            "milestone": m.key,
            "geofence": self.geofence,
            "known_phashes": self.recent_phashes(500),
            "limits": {
                "max_exif_age_h": self.params.max_exif_age_h,
                "max_phash_distance": self.params.max_phash_distance,
                "min_ai_confidence": self.params.min_ai_confidence
            },
            "demo_mode": self.params.demo_mode,
            "playground": self.params.playground,
            "challenge": ev.challenge,
            "challenge_opened_at": ev.challenge_opened_at,
        })
        .to_string()
    }

    fn start_check(&self, ev: &Evidence) -> Promise {
        let input = self.check_input_json(ev);
        let args = json!({
            "source": self.outlayer_source(),
            "resource_limits": { "max_instructions": 50_000_000_000u64, "max_memory_mb": 256, "max_execution_seconds": 60 },
            "input_data": input,
            "secrets_ref": { "profile": "plote", "account_id": env::current_account_id() },
            "response_format": "Json",
        });
        Promise::new(self.outlayer_id.clone())
            .function_call(
                "request_execution".to_string(),
                args.to_string().into_bytes(),
                VERIFY_DEPOSIT,
                GAS_OUTLAYER,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_VERDICT)
                    .on_verdict(ev.id),
            )
    }

    /// OutLayer source: `verifier.repo = "project:<owner>/<name>"` selects a deployed OutLayer project
    /// (`version_key` = `verifier.commit`, or the active version when empty); anything else builds from GitHub.
    pub(crate) fn outlayer_source(&self) -> Value {
        match self.verifier.repo.strip_prefix("project:") {
            Some(project_id) => {
                let version = if self.verifier.commit.is_empty() {
                    Value::Null
                } else {
                    Value::String(self.verifier.commit.clone())
                };
                json!({ "Project": { "project_id": project_id, "version_key": version } })
            }
            None => json!({ "GitHub": {
                "repo": self.verifier.repo, "commit": self.verifier.commit, "build_target": self.verifier.build_target
            } }),
        }
    }

    /// The pinned GitHub commit a verdict must come from, if any. `project:` sources are pinned by
    /// OutLayer's version key instead (the worker can't know it), and an empty commit pins nothing.
    pub(crate) fn pinned_commit(&self) -> Option<&str> {
        if self.verifier.repo.starts_with("project:") {
            return None;
        }
        let c = self.verifier.commit.trim();
        (!c.is_empty()).then_some(c)
    }

    /// Mark a Pending (or earlier Error) evidence as Error and reopen its milestone, so the surveyor can resubmit.
    fn set_error(&mut self, evidence_id: u64, msg: &str) {
        self.set_error_with(evidence_id, msg, "worker_error");
    }

    fn set_error_with(&mut self, evidence_id: u64, msg: &str, reason: &str) {
        let Some(mut ev) = self.evidence.get(&evidence_id).cloned() else {
            return;
        };
        if !matches!(ev.status, EvidenceStatus::Pending | EvidenceStatus::Error) {
            return;
        }
        ev.status = EvidenceStatus::Error;
        ev.error = Some(msg.to_string());
        let i = ev.milestone as usize;
        self.evidence.insert(evidence_id, ev);
        let m = &mut self.milestones[i];
        if m.status == MilestoneStatus::Checking && m.evidence_ids.last() == Some(&evidence_id) {
            m.status = MilestoneStatus::Open;
        }
        emit(
            "verdict",
            json!({ "evidence_id": U64(evidence_id), "pass": false, "reasons": [reason] }),
        );
    }

    fn apply_verdict(
        &mut self,
        evidence_id: u64,
        mut verdict: Verdict,
        source: &str,
        raw_hash: Option<String>,
    ) -> bool {
        let Some(mut ev) = self.evidence.get(&evidence_id).cloned() else {
            return false;
        };
        if !matches!(ev.status, EvidenceStatus::Pending | EvidenceStatus::Error) {
            return false;
        }
        // A verdict from any other build than the pinned commit is not a verdict on this estate's checks
        // (SPEC 5.6): treat it like unparsable output, so the milestone reopens.
        if let Some(pinned) = self.pinned_commit() {
            let got = verdict.worker_commit.trim();
            if !got.eq_ignore_ascii_case(pinned) {
                let msg = format!(
                    "worker_commit {} does not match the pinned verifier commit {}",
                    got.chars().take(64).collect::<String>(),
                    pinned
                );
                self.set_error_with(evidence_id, &msg, "worker_commit_mismatch");
                if raw_hash.is_some() {
                    if let Some(mut ev) = self.evidence.get(&evidence_id).cloned() {
                        ev.raw_response_hash = raw_hash;
                        self.evidence.insert(evidence_id, ev);
                    }
                }
                return false;
            }
        }
        // A mocked AI answer is a test fixture, never evidence (review L3).
        if verdict.warnings.iter().any(|w| w.starts_with("ai_mock"))
            && !verdict.reasons.iter().any(|r| r == "ai_mock")
        {
            verdict.reasons.push("ai_mock".to_string());
        }
        // A pass with reasons attached is a fail; reasons win.
        let pass = verdict.pass && verdict.reasons.is_empty();
        verdict.pass = pass;
        verdict.source = Some(source.to_string());
        verdict.reasons.truncate(16);
        verdict.warnings.truncate(16);
        verdict.ai_observations.truncate(MAX_OBSERVATIONS);
        for o in verdict.ai_observations.iter_mut() {
            if o.chars().count() > MAX_OBSERVATION_CHARS {
                *o = o.chars().take(MAX_OBSERVATION_CHARS).collect();
            }
        }
        let phash = u64::from_str_radix(verdict.phash.trim(), 16).ok();
        ev.status = if pass {
            EvidenceStatus::Pass
        } else {
            EvidenceStatus::Fail
        };
        ev.error = None;
        if raw_hash.is_some() {
            ev.raw_response_hash = raw_hash;
        }
        let reasons = verdict.reasons.clone();
        ev.verdict = Some(verdict);
        let i = ev.milestone as usize;
        self.evidence.insert(evidence_id, ev);

        let now = Self::now();
        let m = &mut self.milestones[i];
        let is_latest = m.evidence_ids.last() == Some(&evidence_id);
        let waiting = matches!(
            m.status,
            MilestoneStatus::Checking | MilestoneStatus::Open | MilestoneStatus::Vetoed
        );
        if is_latest && waiting {
            if pass {
                m.status = MilestoneStatus::Verified;
                m.verified_at = Some(now);
            } else {
                m.status = MilestoneStatus::Open;
            }
        }
        if pass {
            if let Some(h) = phash {
                self.accepted_phashes.push(h);
            }
            self.stats.evidence_passed += 1;
        }
        emit(
            "verdict",
            json!({ "evidence_id": U64(evidence_id), "pass": pass, "reasons": reasons }),
        );
        pass
    }
}
