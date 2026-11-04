//! `plote-verifier`: checks one milestone photo (SPEC 6) and returns a
//! `Verdict`. The binary (`main.rs`) is a thin stdin → stdout wrapper.

pub mod ai;
pub mod challenge;
pub mod checks;
pub mod exif;
pub mod fetch;
pub mod geo;
pub mod img;
pub mod input;
pub mod phash;
#[cfg(any(test, feature = "synth"))]
pub mod synth;

use base64::Engine;
use checks::{ImageFacts, Observed, Verdict};
use sha2::{Digest, Sha256};

/// Git commit baked in by `build.rs`.
pub const WORKER_COMMIT: &str = env!("PLOTE_WORKER_COMMIT");

/// Where the image bytes come from (abstracted so tests never touch the
/// network).
pub trait Fetcher {
    fn get(&self, url: &str) -> Result<Vec<u8>, fetch::FetchError>;
}

pub struct HttpFetcher;
impl Fetcher for HttpFetcher {
    fn get(&self, url: &str) -> Result<Vec<u8>, fetch::FetchError> {
        fetch::get(url, fetch::MAX_IMAGE_BYTES)
    }
}

fn log(msg: impl AsRef<str>) {
    eprintln!("plote-verifier: {}", msg.as_ref());
}

/// Full pipeline for one stdin document. Never panics on bad input.
pub fn run(raw: &str, ai_cfg: &ai::AiConfig, fetcher: &dyn Fetcher) -> Verdict {
    let parsed = match input::parse(raw) {
        Ok(p) => p,
        Err(e) => {
            log(format!("bad_input: {e}"));
            return Verdict::bad_input(input::sniff_evidence_id(raw));
        }
    };
    let inp = &parsed.input;

    // 1. Fetch (or take inline bytes).
    let bytes = match &inp.image_base64 {
        Some(b64) => {
            let b64 = b64.trim();
            let b64 = b64
                .strip_prefix("data:")
                .and_then(|s| s.split_once(','))
                .map_or(b64, |(_, d)| d);
            match base64::engine::general_purpose::STANDARD.decode(b64) {
                Ok(b) if b.len() <= fetch::MAX_IMAGE_BYTES => Ok(b),
                Ok(_) => Err(fetch::FetchError::TooLarge),
                Err(e) => {
                    log(format!("bad_input: image_base64: {e}"));
                    return Verdict::bad_input(Some(inp.evidence_id));
                }
            }
        }
        None => fetcher.get(inp.url.as_deref().unwrap_or_default()),
    };

    let mut work = None;
    let observed = match bytes {
        Err(e) => {
            log(format!("fetch_failed: {e}"));
            Observed::FetchFailed
        }
        Ok(bytes) => {
            // 2. Integrity, over the exact bytes.
            let digest = hex::encode(Sha256::digest(&bytes));
            if !digest.eq_ignore_ascii_case(inp.sha256.trim()) {
                log(format!("hash_mismatch: got {digest}"));
                Observed::HashMismatch
            } else {
                // 3. Decode.
                let ex = exif::read(&bytes);
                match img::decode(&bytes, ex.orientation) {
                    Err(e) => {
                        log(format!("bad_image: {e}"));
                        Observed::Undecodable
                    }
                    Ok(d) => {
                        let facts = ImageFacts {
                            width: d.width,
                            height: d.height,
                            exif_time: ex.time_ns,
                            exif_gps: ex.gps,
                            phash: phash::phash(&d.work),
                        };
                        work = Some(d.work);
                        Observed::Image(facts)
                    }
                }
            }
        }
    };

    let milestone = inp.milestone.clone();
    let mut ai_call = || {
        let Some(w) = work.as_ref() else {
            return ai::AiOutcome::Unavailable("no image".into());
        };
        // Skip encoding when a mock answer is configured.
        let jpeg = if ai_cfg.mock.is_some() {
            Vec::new()
        } else {
            match img::to_jpeg(w) {
                Ok(j) => j,
                Err(e) => return ai::AiOutcome::Unavailable(format!("encode: {e}")),
            }
        };
        let out = ai::classify(ai_cfg, &milestone, &jpeg);
        if let ai::AiOutcome::Unavailable(e) = &out {
            log(format!("ai_unavailable: {e}"));
        }
        out
    };
    checks::decide(inp, &parsed.known, &observed, &mut ai_call)
}

#[cfg(test)]
mod tests {
    //! End-to-end through `run` with synthetic photos, inline bytes and a
    //! mocked model. No network.
    use super::*;
    use crate::synth;
    use serde_json::json;

    const NOW: u64 = 1_793_743_600_000_000_000;
    const OPENED: u64 = 1_793_739_000_000_000_000;
    const EXIF_T: u64 = 1_793_739_420_000_000_000;

    struct NoNet;
    impl Fetcher for NoNet {
        fn get(&self, _: &str) -> Result<Vec<u8>, fetch::FetchError> {
            Err(fetch::FetchError::Transport("offline".into()))
        }
    }

    struct Fixed(Vec<u8>);
    impl Fetcher for Fixed {
        fn get(&self, _: &str) -> Result<Vec<u8>, fetch::FetchError> {
            Ok(self.0.clone())
        }
    }

    fn photo(seed: u64, gps: Option<(f64, f64)>, t: Option<u64>) -> Vec<u8> {
        synth::with_exif(
            &synth::jpeg(1200, 900, seed, 85),
            &synth::ExifSpec {
                datetime: t.map(|t| synth::exif_datetime(t, 60)),
                offset: t.map(|_| "+01:00".into()),
                gps,
                orientation: Some(1),
            },
        )
    }

    fn mock(answer: serde_json::Value) -> ai::AiConfig {
        ai::AiConfig {
            mock: Some(answer.to_string()),
            ..Default::default()
        }
    }

    fn good_ai() -> ai::AiConfig {
        mock(
            json!({"stage":"roofing","confidence":88,"is_photo_of_screen_or_print":false,
                    "is_render":false,"challenge_read":"K7RQ4M","observations":["trusses"]}),
        )
    }

    fn input_for(bytes: &[u8], f: impl FnOnce(&mut serde_json::Value)) -> String {
        let mut j = json!({
            "evidence_id": 17,
            "image_base64": base64::engine::general_purpose::STANDARD.encode(bytes),
            "sha256": hex::encode(Sha256::digest(bytes)),
            "captured_at": NOW - 3_600_000_000_000,
            "device_gps": [6_447_123, 3_474_190],
            "now": NOW,
            "milestone": "roofing",
            "geofence": {"lat_e6": 6_447_000, "lon_e6": 3_474_000, "radius_m": 300},
            "known_phashes": [],
            "limits": {"max_exif_age_h": 72, "max_phash_distance": 8, "min_ai_confidence": 70},
            "demo_mode": false,
            "playground": false,
            "challenge": "K7RQ4M",
            "challenge_opened_at": OPENED
        });
        f(&mut j);
        j.to_string()
    }

    #[test]
    fn e2e_pass() {
        let p = photo(11, Some((6.447118, 3.474201)), Some(EXIF_T));
        let v = run(&input_for(&p, |_| {}), &good_ai(), &NoNet);
        assert!(v.pass, "{v:?}");
        assert_eq!(v.exif_time, Some(EXIF_T));
        assert_eq!(v.gps_source, Some("exif"));
        assert_eq!(v.distance_m, Some(26));
        assert_eq!(v.phash.len(), 16);
        assert_eq!(v.nearest_distance, 64);
        assert_eq!(v.warnings, vec!["ai_mock"]);
        assert_eq!(v.ai_chat_id.as_deref(), Some("mock"));
        assert_eq!(v.worker_commit, WORKER_COMMIT);
        // One JSON line.
        let line = serde_json::to_string(&v).unwrap();
        assert!(!line.contains('\n'));
        assert!(line.starts_with("{\"evidence_id\":17,\"pass\":true,"));
    }

    #[test]
    fn e2e_fetch_via_fetcher_and_failures() {
        let p = photo(12, Some((6.447118, 3.474201)), Some(EXIF_T));
        let url_input = |bytes: &[u8]| {
            input_for(bytes, |j| {
                j.as_object_mut().unwrap().remove("image_base64");
                j["url"] = "https://example.supabase.co/x.jpg".into();
            })
        };
        let v = run(&url_input(&p), &good_ai(), &Fixed(p.clone()));
        assert!(v.pass, "{v:?}");
        let v = run(&url_input(&p), &good_ai(), &NoNet);
        assert_eq!(v.reasons, vec!["fetch_failed"]);
        // Tampered bytes.
        let mut tampered = p.clone();
        let n = tampered.len();
        tampered[n - 10] ^= 1;
        let v = run(&url_input(&p), &good_ai(), &Fixed(tampered));
        assert_eq!(v.reasons, vec!["hash_mismatch"]);
    }

    #[test]
    fn e2e_bad_image() {
        let v = run(
            &input_for(b"definitely not a jpeg", |_| {}),
            &good_ai(),
            &NoNet,
        );
        assert_eq!(v.reasons, vec!["bad_image"]);
        let small = synth::jpeg(640, 480, 1, 80);
        let v = run(&input_for(&small, |_| {}), &good_ai(), &NoNet);
        assert_eq!(v.reasons, vec!["bad_image"]);
        assert_eq!(v.phash.len(), 16);
        // PNG decodes (no EXIF -> exif_missing, proving we got past decode).
        let png = synth::png(1000, 800, 3);
        let v = run(&input_for(&png, |_| {}), &good_ai(), &NoNet);
        assert_eq!(v.reasons, vec!["exif_missing"]);
    }

    #[test]
    fn e2e_reuse_detected_after_reencode() {
        let orig = photo(13, Some((6.447118, 3.474201)), Some(EXIF_T));
        let first = run(&input_for(&orig, |_| {}), &good_ai(), &NoNet);
        assert!(first.pass);
        // Re-encoded + resized copy, EXIF stripped; device GPS saves location
        // but EXIF is gone -> use playground to get past freshness and hit reuse.
        let copy = synth::reencode(&orig, 0.9, 70);
        let known = first.phash.clone();
        let v = run(
            &input_for(&copy, |j| {
                j["known_phashes"] = json!([known]);
                j["playground"] = true.into();
            }),
            &good_ai(),
            &NoNet,
        );
        assert!(!v.pass);
        assert!(v.reasons[0].starts_with("phash_reuse:"), "{v:?}");
        assert!(v.nearest_distance <= 8);
        // A different scene is not flagged.
        let other = photo(99, Some((6.447118, 3.474201)), Some(EXIF_T));
        let v = run(
            &input_for(&other, |j| j["known_phashes"] = json!([first.phash])),
            &good_ai(),
            &NoNet,
        );
        assert!(v.pass, "{v:?}");
        assert!(v.nearest_distance > 8);
    }

    #[test]
    fn e2e_ai_unavailable_without_key() {
        let p = photo(14, Some((6.447118, 3.474201)), Some(EXIF_T));
        let none = ai::AiConfig::default();
        let v = run(&input_for(&p, |_| {}), &none, &NoNet);
        assert_eq!(v.reasons, vec!["ai_unavailable"]);
        let v = run(
            &input_for(&p, |j| j["demo_mode"] = true.into()),
            &none,
            &NoNet,
        );
        assert!(v.pass);
        assert_eq!(v.warnings, vec!["ai_unavailable", "challenge_unverified"]);
    }

    #[test]
    fn e2e_fenced_mock_and_challenge() {
        let p = photo(15, Some((6.447118, 3.474201)), Some(EXIF_T));
        let cfg = ai::AiConfig {
            mock: Some("```json\n{\"stage\":\"roofing\",\"confidence\":91,\"is_photo_of_screen_or_print\":false,\"is_render\":false,\"challenge_read\":\"K7-RQ4N\"}\n```".into()),
            ..Default::default()
        };
        let v = run(&input_for(&p, |_| {}), &cfg, &NoNet);
        assert!(v.pass, "{v:?}");
        assert_eq!(v.challenge_read.as_deref(), Some("K7-RQ4N"));
        let v = run(
            &input_for(&p, |j| j["challenge"] = "AB12CD".into()),
            &cfg,
            &NoNet,
        );
        assert_eq!(v.reasons, vec!["challenge_mismatch"]);
    }

    #[test]
    fn bad_input_never_panics() {
        for raw in [
            "",
            "null",
            "{",
            "[1,2,3]",
            r#"{"evidence_id":3}"#,
            r#"{"evidence_id":"x"}"#,
            &input_for(b"x", |j| j["sha256"] = "abc".into()),
            &input_for(b"x", |j| j["image_base64"] = "!!!not base64!!!".into()),
            &input_for(b"x", |j| j["geofence"]["radius_m"] = (-1).into()),
            &input_for(b"x", |j| j["now"] = (-5).into()),
        ] {
            let v = run(raw, &good_ai(), &NoNet);
            assert!(!v.pass);
            assert_eq!(v.reasons, vec!["bad_input"], "{raw:.80}");
        }
        assert_eq!(
            run(r#"{"evidence_id":3}"#, &good_ai(), &NoNet).evidence_id,
            Some(3)
        );
        assert_eq!(run("", &good_ai(), &NoNet).evidence_id, None);
    }

    #[test]
    fn data_url_prefix_accepted() {
        let p = photo(16, Some((6.447118, 3.474201)), Some(EXIF_T));
        let raw = input_for(&p, |j| {
            let b = j["image_base64"].as_str().unwrap().to_string();
            j["image_base64"] = format!("data:image/jpeg;base64,{b}").into();
        });
        assert!(run(&raw, &good_ai(), &NoNet).pass);
    }
}
