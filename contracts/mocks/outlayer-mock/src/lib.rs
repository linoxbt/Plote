//! `outlayer-mock`: a stand-in for `outlayer.testnet` used in tests and offline demos.
//! `request_execution` returns a canned verdict immediately (no TEE, no yield/resume), shaped like
//! OutLayer's wrapper so the estate's tolerant parser is exercised. Never use it for a real estate.
//!
//! Verdict rules (from the input JSON): a URL containing "reuse" fails with `phash_reuse:3`,
//! "offsite" fails `outside_geofence`, "stale" fails `exif_stale`; anything else passes.
//! `worker_commit` echoes the pinned `source.GitHub.commit` (the estate rejects a verdict from any other
//! commit), or `"mock"` for a `Project` source.

use near_sdk::serde_json::{self, json, Value};
use near_sdk::{env, near, PanicOnDefault};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct OutlayerMock {
    calls: u64,
}

#[near]
impl OutlayerMock {
    #[init]
    pub fn new() -> Self {
        Self { calls: 0 }
    }

    #[payable]
    pub fn request_execution(
        &mut self,
        source: Value,
        resource_limits: Value,
        input_data: String,
        secrets_ref: Option<Value>,
        response_format: Option<String>,
    ) -> Value {
        let _ = (resource_limits, secrets_ref, response_format);
        let worker_commit = source
            .pointer("/GitHub/commit")
            .and_then(Value::as_str)
            .filter(|c| !c.is_empty())
            .unwrap_or("mock")
            .to_string();
        self.calls += 1;
        let input: Value = serde_json::from_str(&input_data).unwrap_or(json!({}));
        let url = input["url"].as_str().unwrap_or("");
        let reasons: Vec<&str> = if url.contains("reuse") {
            vec!["phash_reuse:3"]
        } else if url.contains("offsite") {
            vec!["outside_geofence"]
        } else if url.contains("stale") {
            vec!["exif_stale"]
        } else {
            vec![]
        };
        let verdict = json!({
            "evidence_id": input["evidence_id"],
            "pass": reasons.is_empty(),
            "reasons": reasons,
            "warnings": ["mock_verifier"],
            "phash": format!("{:016x}", env::block_height().wrapping_mul(0x9e3779b97f4a7c15)),
            "nearest_distance": 27,
            "exif_time": input["captured_at"],
            "gps": input["device_gps"],
            "gps_source": "device",
            "distance_m": 0,
            "ai_stage": input["milestone"],
            "ai_confidence": 90,
            "challenge_read": input["challenge"],
            "ai_chat_id": null,
            "ai_observations": ["mock verifier: no model was asked"],
            "worker_commit": worker_commit,
        });
        // Mimic OutLayer's wrapper: stdout as a string plus an execution reference.
        json!({ "status": "Completed", "output": verdict.to_string(), "execution_id": format!("mock-{}", self.calls) })
    }

    pub fn calls(&self) -> u64 {
        self.calls
    }
}
