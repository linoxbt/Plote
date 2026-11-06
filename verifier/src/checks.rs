//! Pure decision logic (SPEC 6.1). No I/O: everything observed about the
//! photo comes in as `Observed`, and the AI is a lazy callback so it is only
//! consulted when checks 1–6 have not already failed.

use crate::ai::AiOutcome;
use crate::challenge::{self, ChallengeResult};
use crate::input::Input;
use serde::Serialize;

pub const NS_PER_MIN: u64 = 60 * 1_000_000_000;
pub const NS_PER_HOUR: u64 = 60 * NS_PER_MIN;
/// EXIF may be at most this far ahead of `now` (clock skew).
pub const FUTURE_TOLERANCE_NS: u64 = 10 * NS_PER_MIN;
/// EXIF may be at most this far before `challenge_opened_at`.
pub const CAPTURE_TOLERANCE_NS: u64 = 5 * NS_PER_MIN;
/// Minimum short side, pixels.
pub const MIN_SHORT_SIDE: u32 = 800;

/// One line of stdout. Field order follows SPEC 6.3 / INTERFACE `Verdict`.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Verdict {
    pub evidence_id: Option<u64>,
    pub pass: bool,
    pub reasons: Vec<String>,
    pub warnings: Vec<String>,
    pub phash: String,
    pub nearest_distance: u8,
    pub exif_time: Option<u64>,
    pub gps: Option<[i64; 2]>,
    pub gps_source: Option<&'static str>,
    pub distance_m: Option<u32>,
    pub ai_stage: Option<String>,
    pub ai_confidence: Option<u8>,
    pub challenge_read: Option<String>,
    /// The model's short notes on the photo (SPEC 6.4 `observations`), for the proof page.
    pub ai_observations: Vec<String>,
    pub ai_chat_id: Option<String>,
    pub worker_commit: String,
    pub attestation: Option<String>,
}

impl Verdict {
    pub fn empty(evidence_id: Option<u64>) -> Self {
        Verdict {
            evidence_id,
            pass: false,
            reasons: vec![],
            warnings: vec![],
            phash: String::new(),
            nearest_distance: 64,
            exif_time: None,
            gps: None,
            gps_source: None,
            distance_m: None,
            ai_stage: None,
            ai_confidence: None,
            challenge_read: None,
            ai_observations: vec![],
            ai_chat_id: None,
            worker_commit: crate::WORKER_COMMIT.to_string(),
            attestation: None,
        }
    }

    pub fn bad_input(evidence_id: Option<u64>) -> Self {
        let mut v = Self::empty(evidence_id);
        v.reasons.push("bad_input".into());
        v
    }
}

/// What we learned from the bytes, in check order.
#[derive(Debug, Clone)]
pub enum Observed {
    /// Check 1 failed.
    FetchFailed,
    /// Check 2 failed (we never decode bytes that don't match the commitment).
    HashMismatch,
    /// Check 3 failed: not a decodable JPEG/PNG.
    Undecodable,
    Image(ImageFacts),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ImageFacts {
    pub width: u32,
    pub height: u32,
    pub exif_time: Option<u64>,
    pub exif_gps: Option<(i64, i64)>,
    pub phash: u64,
}

/// Whether a failing code is softened by the run mode (SPEC 6.1): `ai_unavailable` in demo mode;
/// stage, confidence and geofence in the playground. Everything else (hash, freshness, reuse, screen
/// photo, challenge) always fails.
fn is_warning(code: &str, demo: bool, playground: bool) -> bool {
    match code {
        "ai_unavailable" => demo,
        "ai_stage_mismatch" | "ai_low_confidence" | "outside_geofence" => playground,
        _ => false,
    }
}

/// Accepted AI stages per milestone (SPEC 6.4). An unlisted milestone key
/// accepts only the stage of the same name.
pub fn stage_accepted(milestone: &str, stage: &str) -> bool {
    let m = milestone.trim().to_ascii_lowercase();
    let accepted: &[&str] = match m.as_str() {
        "foundation" => &["foundation", "walls"],
        "roofing" => &["roofing"],
        "finishing" => &["finishing", "complete"],
        "handover" => &["complete"],
        _ => return stage == m && stage != "not_construction",
    };
    accepted.contains(&stage)
}

struct Run<'a> {
    v: Verdict,
    input: &'a Input,
}

impl Run<'_> {
    /// Record a failure (or warning, if the mode downgrades it).
    fn flag(&mut self, code: impl Into<String>) {
        let code = code.into();
        if is_warning(&code, self.input.demo_mode, self.input.playground) {
            self.v.warnings.push(code);
        } else {
            self.v.reasons.push(code);
        }
    }
    fn failed(&self) -> bool {
        !self.v.reasons.is_empty()
    }
    fn finish(mut self) -> Verdict {
        self.v.pass = self.v.reasons.is_empty();
        self.v
    }
}

/// Run checks 1–8 in order, failing fast on the first hard failure.
pub fn decide(
    input: &Input,
    known: &[u64],
    observed: &Observed,
    ai: &mut dyn FnMut() -> AiOutcome,
) -> Verdict {
    let mut r = Run {
        v: Verdict::empty(Some(input.evidence_id)),
        input,
    };

    // 1–3. Fetch, integrity, decode.
    let facts = match observed {
        Observed::FetchFailed => {
            r.flag("fetch_failed");
            return r.finish();
        }
        Observed::HashMismatch => {
            r.flag("hash_mismatch");
            return r.finish();
        }
        Observed::Undecodable => {
            r.flag("bad_image");
            return r.finish();
        }
        Observed::Image(f) => f,
    };
    // Facts we always report once the image decodes.
    r.v.phash = crate::phash::to_hex(facts.phash);
    r.v.nearest_distance = crate::phash::nearest(facts.phash, known).min(64) as u8;
    r.v.exif_time = facts.exif_time;

    if facts.width.min(facts.height) < MIN_SHORT_SIDE {
        r.flag("bad_image");
        return r.finish();
    }

    // 4. Freshness.
    match facts.exif_time {
        None => r.flag("exif_missing"),
        Some(t) if t > input.now.saturating_add(FUTURE_TOLERANCE_NS) => r.flag("exif_future"),
        Some(t)
            if input.now.saturating_sub(t)
                > input.limits.max_exif_age_h.saturating_mul(NS_PER_HOUR) =>
        {
            r.flag("exif_stale")
        }
        Some(_) => {}
    }
    if r.failed() {
        return r.finish();
    }

    // 5. Location (skipped entirely when radius_m == 0; nothing is reported
    // so a playground photo never publishes where the judge stood).
    if input.geofence.radius_m > 0.0 {
        let pos = match (facts.exif_gps, input.device_gps) {
            (Some(g), _) => Some((g, "exif")),
            (None, Some([lat, lon])) => Some(((lat, lon), "device")),
            (None, None) => None,
        };
        match pos {
            None => r.flag("gps_missing"),
            Some(((lat, lon), src)) => {
                let d =
                    crate::geo::haversine_m(input.geofence.lat_e6, input.geofence.lon_e6, lat, lon);
                r.v.gps = Some([lat, lon]);
                r.v.gps_source = Some(src);
                r.v.distance_m = Some(d.round().min(f64::from(u32::MAX)) as u32);
                if d > input.geofence.radius_m {
                    r.flag("outside_geofence");
                }
            }
        }
        if r.failed() {
            return r.finish();
        }
    }

    // 6. Not reused.
    if u32::from(r.v.nearest_distance) <= input.limits.max_phash_distance {
        let d = r.v.nearest_distance;
        r.flag(format!("phash_reuse:{d}"));
        return r.finish();
    }

    // 7. Right stage.
    let outcome = ai();
    let answer = match &outcome {
        AiOutcome::Unavailable(_) => {
            r.flag("ai_unavailable");
            None
        }
        AiOutcome::Answer {
            chat_id,
            answer,
            mocked,
        } => {
            r.v.ai_stage = Some(answer.stage.clone());
            r.v.ai_confidence = Some(answer.confidence);
            r.v.challenge_read = answer.challenge_read.clone();
            r.v.ai_observations = answer.observations.clone();
            r.v.ai_chat_id = chat_id.clone();
            if *mocked {
                r.v.warnings.push("ai_mock".into());
            }
            if answer.is_photo_of_screen_or_print || answer.is_render {
                r.flag("ai_screen_photo");
            }
            if !stage_accepted(&input.milestone, &answer.stage) {
                r.flag("ai_stage_mismatch");
            }
            if answer.confidence < input.limits.min_ai_confidence {
                r.flag("ai_low_confidence");
            }
            Some(answer)
        }
    };
    if r.failed() {
        return r.finish();
    }

    // 8. Challenge.
    match answer {
        // The code can't be read without the model, and the challenge check fails hard in every
        // mode (SPEC 6.1): a demo-mode AI outage softens `ai_unavailable`, not the challenge.
        None => r.flag("challenge_unverified"),
        Some(a) => match challenge::compare(&input.challenge, a.challenge_read.as_deref()) {
            ChallengeResult::Match => {}
            ChallengeResult::Missing => r.flag("challenge_missing"),
            ChallengeResult::Mismatch => r.flag("challenge_mismatch"),
        },
    }
    if let Some(t) = facts.exif_time {
        if t < input
            .challenge_opened_at
            .saturating_sub(CAPTURE_TOLERANCE_NS)
        {
            r.flag("exif_before_capture");
        }
    }
    r.finish()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::AiAnswer;
    use crate::input;

    const NOW: u64 = 1_793_743_600_000_000_000;
    const OPENED: u64 = 1_793_739_000_000_000_000;
    const EXIF_T: u64 = 1_793_739_420_000_000_000;
    const H: u64 = NS_PER_HOUR;
    const M: u64 = NS_PER_MIN;

    fn input_json() -> serde_json::Value {
        serde_json::json!({
            "evidence_id": 17,
            "url": "https://example.supabase.co/storage/v1/object/public/evidence/hc/17.jpg",
            "sha256": "00".repeat(32),
            "captured_at": 1_793_740_000_000_000_000u64,
            "device_gps": [6_447_123, 3_474_190],
            "now": NOW,
            "milestone": "roofing",
            "geofence": { "lat_e6": 6_447_000, "lon_e6": 3_474_000, "radius_m": 300 },
            "known_phashes": ["ffffffffffffffff"],
            "limits": { "max_exif_age_h": 72, "max_phash_distance": 8, "min_ai_confidence": 70 },
            "demo_mode": false,
            "playground": false,
            "challenge": "K7RQ4M",
            "challenge_opened_at": OPENED
        })
    }

    fn mk(f: impl FnOnce(&mut serde_json::Value)) -> (Input, Vec<u64>) {
        let mut j = input_json();
        f(&mut j);
        let p = input::parse(&j.to_string()).unwrap();
        (p.input, p.known)
    }

    fn facts() -> ImageFacts {
        ImageFacts {
            width: 4000,
            height: 3000,
            exif_time: Some(EXIF_T),
            exif_gps: Some((6_447_118, 3_474_201)),
            phash: 0, // distance 64 to the known all-ones hash
        }
    }

    fn good_answer() -> AiOutcome {
        AiOutcome::Answer {
            chat_id: Some("chatcmpl-1".into()),
            answer: AiAnswer {
                stage: "roofing".into(),
                confidence: 88,
                is_photo_of_screen_or_print: false,
                is_render: false,
                challenge_read: Some("K7RQ4M".into()),
                observations: vec!["roof trusses in place".into(), "paper with code".into()],
            },
            mocked: false,
        }
    }

    fn with_answer(f: impl FnOnce(&mut AiAnswer)) -> AiOutcome {
        let mut o = good_answer();
        if let AiOutcome::Answer { answer, .. } = &mut o {
            f(answer);
        }
        o
    }

    fn unavailable() -> AiOutcome {
        AiOutcome::Unavailable("down".into())
    }

    /// Run with the given input tweak, facts and AI outcome.
    fn run(
        tweak: impl FnOnce(&mut serde_json::Value),
        obs: Observed,
        ai: AiOutcome,
    ) -> (Verdict, bool) {
        let (inp, known) = mk(tweak);
        let mut called = false;
        let mut cb = || {
            called = true;
            ai.clone()
        };
        let v = decide(&inp, &known, &obs, &mut cb);
        (v, called)
    }

    fn img(f: impl FnOnce(&mut ImageFacts)) -> Observed {
        let mut x = facts();
        f(&mut x);
        Observed::Image(x)
    }

    fn noop(_: &mut serde_json::Value) {}

    #[test]
    fn happy_path_passes() {
        let (v, called) = run(noop, img(|_| {}), good_answer());
        assert!(called);
        assert!(v.pass, "{v:?}");
        assert!(v.reasons.is_empty() && v.warnings.is_empty());
        assert_eq!(v.evidence_id, Some(17));
        assert_eq!(v.phash, "0000000000000000");
        assert_eq!(v.nearest_distance, 64);
        assert_eq!(v.exif_time, Some(EXIF_T));
        assert_eq!(v.gps, Some([6_447_118, 3_474_201]));
        assert_eq!(v.gps_source, Some("exif"));
        assert_eq!(v.distance_m, Some(26));
        assert_eq!(v.ai_stage.as_deref(), Some("roofing"));
        assert_eq!(v.ai_confidence, Some(88));
        assert_eq!(v.challenge_read.as_deref(), Some("K7RQ4M"));
        assert_eq!(v.ai_chat_id.as_deref(), Some("chatcmpl-1"));
        assert_eq!(
            v.ai_observations,
            vec!["roof trusses in place", "paper with code"]
        );
        assert_eq!(v.attestation, None);
    }

    #[test]
    fn fetch_hash_decode_fail_fast() {
        for (obs, code) in [
            (Observed::FetchFailed, "fetch_failed"),
            (Observed::HashMismatch, "hash_mismatch"),
            (Observed::Undecodable, "bad_image"),
        ] {
            let (v, called) = run(noop, obs, good_answer());
            assert!(!called);
            assert!(!v.pass);
            assert_eq!(v.reasons, vec![code]);
            assert_eq!(v.phash, "");
        }
    }

    #[test]
    fn small_image_is_bad_image() {
        let (v, called) = run(noop, img(|f| f.height = 799), good_answer());
        assert!(!called);
        assert_eq!(v.reasons, vec!["bad_image"]);
        // Even in playground.
        let (v, _) = run(
            |j| j["playground"] = true.into(),
            img(|f| f.width = 640),
            good_answer(),
        );
        assert_eq!(v.reasons, vec!["bad_image"]);
    }

    #[test]
    fn exif_missing_stale_future() {
        let (v, c) = run(noop, img(|f| f.exif_time = None), good_answer());
        assert_eq!(
            (v.reasons.clone(), c),
            (vec!["exif_missing".to_string()], false)
        );
        let (v, _) = run(
            noop,
            img(|f| f.exif_time = Some(NOW - 73 * H)),
            good_answer(),
        );
        assert_eq!(v.reasons, vec!["exif_stale"]);
        let (v, _) = run(
            noop,
            img(|f| f.exif_time = Some(NOW + 11 * M)),
            good_answer(),
        );
        assert_eq!(v.reasons, vec!["exif_future"]);
        // 9 min ahead is tolerated (but then before... no: opened is earlier) -> pass.
        let (v, _) = run(
            noop,
            img(|f| f.exif_time = Some(NOW + 9 * M)),
            good_answer(),
        );
        assert!(v.pass, "{v:?}");
        // custom max age
        let (v, _) = run(
            |j| j["limits"]["max_exif_age_h"] = 1.into(),
            img(|f| f.exif_time = Some(NOW - 2 * H)),
            good_answer(),
        );
        assert_eq!(v.reasons, vec!["exif_stale"]);
    }

    #[test]
    fn exif_before_capture() {
        // 6 minutes before the capture opened: stale relative to the code.
        let (v, _) = run(
            noop,
            img(|f| f.exif_time = Some(OPENED - 6 * M)),
            good_answer(),
        );
        assert_eq!(v.reasons, vec!["exif_before_capture"]);
        // 4 minutes before is within tolerance.
        let (v, _) = run(
            noop,
            img(|f| f.exif_time = Some(OPENED - 4 * M)),
            good_answer(),
        );
        assert!(v.pass, "{v:?}");
        // Hard even in playground + demo.
        let (v, _) = run(
            |j| {
                j["playground"] = true.into();
                j["demo_mode"] = true.into();
            },
            img(|f| f.exif_time = Some(OPENED - 60 * M)),
            good_answer(),
        );
        assert_eq!(v.reasons, vec!["exif_before_capture"]);
    }

    #[test]
    fn geofence_exif_device_and_missing() {
        // ~1.1 km north: outside.
        let (v, c) = run(
            noop,
            img(|f| f.exif_gps = Some((6_457_000, 3_474_000))),
            good_answer(),
        );
        assert!(!c);
        assert_eq!(v.reasons, vec!["outside_geofence"]);
        assert_eq!(v.distance_m, Some(1112));
        // Fallback to device GPS (inside).
        let (v, _) = run(noop, img(|f| f.exif_gps = None), good_answer());
        assert!(v.pass);
        assert_eq!(v.gps_source, Some("device"));
        assert_eq!(v.gps, Some([6_447_123, 3_474_190]));
        // Device GPS outside.
        let (v, _) = run(
            |j| j["device_gps"] = serde_json::json!([6_500_000, 3_474_000]),
            img(|f| f.exif_gps = None),
            good_answer(),
        );
        assert_eq!(v.reasons, vec!["outside_geofence"]);
        assert_eq!(v.gps_source, Some("device"));
        // Nothing at all.
        let (v, _) = run(
            |j| j["device_gps"] = serde_json::Value::Null,
            img(|f| f.exif_gps = None),
            good_answer(),
        );
        assert_eq!(v.reasons, vec!["gps_missing"]);
        assert_eq!(v.gps_source, None);
    }

    #[test]
    fn radius_zero_skips_location() {
        let (v, _) = run(
            |j| {
                j["geofence"]["radius_m"] = 0.into();
                j["device_gps"] = serde_json::Value::Null;
            },
            img(|f| f.exif_gps = Some((51_000_000, 0))),
            good_answer(),
        );
        assert!(v.pass, "{v:?}");
        assert!(v.warnings.is_empty());
        assert_eq!((v.gps, v.gps_source, v.distance_m), (None, None, None));
    }

    #[test]
    fn phash_reuse() {
        // Known hash 0xff..ff; ours has 6 bits set -> distance 58. Make it close:
        let (v, c) = run(noop, img(|f| f.phash = u64::MAX ^ 0b1111), good_answer());
        assert!(!c);
        assert_eq!(v.reasons, vec!["phash_reuse:4"]);
        assert_eq!(v.nearest_distance, 4);
        // Exactly the threshold is reuse; threshold+1 is not.
        let (v, _) = run(noop, img(|f| f.phash = u64::MAX ^ 0xff), good_answer());
        assert_eq!(v.reasons, vec!["phash_reuse:8"]);
        let (v, _) = run(noop, img(|f| f.phash = u64::MAX ^ 0x1ff), good_answer());
        assert!(v.pass);
        assert_eq!(v.nearest_distance, 9);
        // Hard in playground + demo.
        let (v, _) = run(
            |j| {
                j["playground"] = true.into();
                j["demo_mode"] = true.into();
            },
            img(|f| f.phash = u64::MAX),
            good_answer(),
        );
        assert_eq!(v.reasons, vec!["phash_reuse:0"]);
        // No known hashes -> 64.
        let (v, _) = run(
            |j| j["known_phashes"] = serde_json::json!([]),
            img(|_| {}),
            good_answer(),
        );
        assert_eq!(v.nearest_distance, 64);
    }

    #[test]
    fn ai_reasons() {
        let (v, _) = run(noop, img(|_| {}), with_answer(|a| a.stage = "walls".into()));
        assert_eq!(v.reasons, vec!["ai_stage_mismatch"]);
        assert_eq!(v.ai_stage.as_deref(), Some("walls"));
        let (v, _) = run(noop, img(|_| {}), with_answer(|a| a.confidence = 69));
        assert_eq!(v.reasons, vec!["ai_low_confidence"]);
        let (v, _) = run(
            noop,
            img(|_| {}),
            with_answer(|a| a.is_photo_of_screen_or_print = true),
        );
        assert_eq!(v.reasons, vec!["ai_screen_photo"]);
        let (v, _) = run(noop, img(|_| {}), with_answer(|a| a.is_render = true));
        assert_eq!(v.reasons, vec!["ai_screen_photo"]);
        let (v, _) = run(noop, img(|_| {}), unavailable());
        assert_eq!(v.reasons, vec!["ai_unavailable"]);
        assert!(v.warnings.is_empty());
        // Multiple AI reasons are all reported; challenge not evaluated.
        let (v, _) = run(
            noop,
            img(|_| {}),
            with_answer(|a| {
                a.stage = "not_construction".into();
                a.confidence = 10;
                a.challenge_read = None;
            }),
        );
        assert_eq!(v.reasons, vec!["ai_stage_mismatch", "ai_low_confidence"]);
    }

    #[test]
    fn challenge_reasons() {
        let (v, _) = run(noop, img(|_| {}), with_answer(|a| a.challenge_read = None));
        assert_eq!(v.reasons, vec!["challenge_missing"]);
        let (v, _) = run(
            noop,
            img(|_| {}),
            with_answer(|a| a.challenge_read = Some("ZZ99XX".into())),
        );
        assert_eq!(v.reasons, vec!["challenge_mismatch"]);
        assert_eq!(v.challenge_read.as_deref(), Some("ZZ99XX"));
        let (v, _) = run(
            noop,
            img(|_| {}),
            with_answer(|a| a.challenge_read = Some("k7r-q4n".into())),
        );
        assert!(v.pass, "{v:?}");
        // Challenge failures stay hard in playground + demo.
        let pg = |j: &mut serde_json::Value| {
            j["playground"] = true.into();
            j["demo_mode"] = true.into();
        };
        let (v, _) = run(
            pg,
            img(|_| {}),
            with_answer(|a| a.challenge_read = Some("NOPE00".into())),
        );
        assert_eq!(v.reasons, vec!["challenge_mismatch"]);
        let (v, _) = run(pg, img(|_| {}), with_answer(|a| a.challenge_read = None));
        assert_eq!(v.reasons, vec!["challenge_missing"]);
    }

    #[test]
    fn demo_mode_downgrades_ai_unavailable_only() {
        let demo = |j: &mut serde_json::Value| j["demo_mode"] = true.into();
        // ai_unavailable is a warning, but nobody read the code: the challenge check fails.
        let (v, _) = run(demo, img(|_| {}), unavailable());
        assert!(!v.pass, "{v:?}");
        assert_eq!(v.warnings, vec!["ai_unavailable"]);
        assert_eq!(v.reasons, vec!["challenge_unverified"]);
        assert_eq!(v.ai_stage, None);
        assert!(v.ai_observations.is_empty());
        // Stage mismatch is still hard in demo mode.
        let (v, _) = run(demo, img(|_| {}), with_answer(|a| a.stage = "walls".into()));
        assert_eq!(v.reasons, vec!["ai_stage_mismatch"]);
        // And outside_geofence too.
        let (v, _) = run(
            demo,
            img(|f| f.exif_gps = Some((7_000_000, 3_474_000))),
            good_answer(),
        );
        assert_eq!(v.reasons, vec!["outside_geofence"]);
    }

    #[test]
    fn playground_downgrades() {
        let pg = |j: &mut serde_json::Value| {
            j["playground"] = true.into();
            j["device_gps"] = serde_json::Value::Null;
        };
        // stage mismatch + low confidence + outside geofence -> warnings, pass
        let (v, _) = run(
            pg,
            img(|f| f.exif_gps = Some((40_000_000, -74_000_000))),
            with_answer(|a| {
                a.stage = "not_construction".into();
                a.confidence = 30;
            }),
        );
        assert!(v.pass, "{v:?}");
        assert_eq!(
            v.warnings,
            vec!["outside_geofence", "ai_stage_mismatch", "ai_low_confidence"]
        );
        // Freshness and a missing location are never softened (SPEC 6.1 lists only stage,
        // confidence and geofence for the playground).
        let (v, c) = run(pg, img(|f| f.exif_time = None), good_answer());
        assert_eq!(
            (v.reasons.clone(), c),
            (vec!["exif_missing".to_string()], false)
        );
        assert!(v.warnings.is_empty());
        let (v, _) = run(pg, img(|f| f.exif_gps = None), good_answer());
        assert_eq!(v.reasons, vec!["gps_missing"]);
        let (v, _) = run(
            pg,
            img(|f| f.exif_time = Some(NOW - 100 * H)),
            good_answer(),
        );
        assert_eq!(v.reasons, vec!["exif_stale"]);
        let (v, _) = run(pg, img(|f| f.exif_time = Some(NOW + H)), good_answer());
        assert_eq!(v.reasons, vec!["exif_future"]);
        // A playground photo with a wrong or unreadable code still fails.
        let (v, _) = run(
            pg,
            img(|_| {}),
            with_answer(|a| {
                a.stage = "not_construction".into();
                a.challenge_read = Some("ZZZZZZ".into());
            }),
        );
        assert_eq!(v.warnings, vec!["ai_stage_mismatch"]);
        assert_eq!(v.reasons, vec!["challenge_mismatch"]);
        // Screen photo stays hard.
        let (v, _) = run(
            pg,
            img(|_| {}),
            with_answer(|a| a.is_photo_of_screen_or_print = true),
        );
        assert_eq!(v.reasons, vec!["ai_screen_photo"]);
        // ai_unavailable is hard in playground without demo_mode.
        let (v, _) = run(pg, img(|_| {}), unavailable());
        assert_eq!(v.reasons, vec!["ai_unavailable"]);
    }

    #[test]
    fn playground_plus_demo_with_ai_down() {
        // Even with every softening on, an unread challenge fails hard.
        let (v, _) = run(
            |j| {
                j["playground"] = true.into();
                j["demo_mode"] = true.into();
                j["geofence"]["radius_m"] = 0.into();
            },
            img(|_| {}),
            unavailable(),
        );
        assert!(!v.pass);
        assert_eq!(v.warnings, vec!["ai_unavailable"]);
        assert_eq!(v.reasons, vec!["challenge_unverified"]);
    }

    #[test]
    fn challenge_unverified_is_hard_in_every_mode() {
        for (demo, pg) in [(false, false), (true, false), (false, true), (true, true)] {
            let (v, _) = run(
                |j| {
                    j["demo_mode"] = demo.into();
                    j["playground"] = pg.into();
                },
                img(|_| {}),
                unavailable(),
            );
            assert!(!v.pass, "demo={demo} playground={pg}: {v:?}");
            assert!(!v.warnings.iter().any(|w| w.starts_with("challenge")));
            if demo {
                assert_eq!(v.reasons, vec!["challenge_unverified"]);
            } else {
                assert_eq!(v.reasons, vec!["ai_unavailable"]);
            }
        }
    }

    #[test]
    fn mock_answers_are_flagged() {
        let (v, _) = run(noop, img(|_| {}), {
            let mut o = good_answer();
            if let AiOutcome::Answer { mocked, .. } = &mut o {
                *mocked = true;
            }
            o
        });
        assert!(v.pass);
        assert_eq!(v.warnings, vec!["ai_mock"]);
    }

    #[test]
    fn stage_table() {
        assert!(stage_accepted("foundation", "foundation"));
        assert!(stage_accepted("foundation", "walls"));
        assert!(!stage_accepted("foundation", "roofing"));
        assert!(stage_accepted("roofing", "roofing"));
        assert!(!stage_accepted("roofing", "walls"));
        assert!(!stage_accepted("roofing", "finishing"));
        assert!(stage_accepted("finishing", "finishing"));
        assert!(stage_accepted("finishing", "complete"));
        assert!(stage_accepted("handover", "complete"));
        assert!(!stage_accepted("handover", "finishing"));
        assert!(stage_accepted("Roofing", "roofing"));
        // Unlisted milestones accept their own name only.
        assert!(stage_accepted("walls", "walls"));
        assert!(!stage_accepted("walls", "roofing"));
        assert!(!stage_accepted("not_construction", "not_construction"));
    }

    #[test]
    fn verdict_json_shape() {
        let (v, _) = run(noop, img(|_| {}), good_answer());
        let j = serde_json::to_value(&v).unwrap();
        let keys: Vec<&str> = j.as_object().unwrap().keys().map(String::as_str).collect();
        for k in [
            "evidence_id",
            "pass",
            "reasons",
            "warnings",
            "phash",
            "nearest_distance",
            "exif_time",
            "gps",
            "gps_source",
            "distance_m",
            "ai_stage",
            "ai_confidence",
            "challenge_read",
            "ai_observations",
            "ai_chat_id",
            "worker_commit",
            "attestation",
        ] {
            assert!(keys.contains(&k), "missing {k}");
        }
        assert_eq!(keys.len(), 17);
        assert!(j["ai_observations"].is_array());
        assert!(j["exif_time"].is_u64());
        assert!(j["attestation"].is_null());
    }
}
