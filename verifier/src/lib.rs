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
    // Refuse unusable inputs (e.g. a geofence the playground alone may disable)
    // before touching the network.
    if let Some(v) = checks::reject_input(inp) {
        log(format!("rejected input: {:?}", v.reasons));
        return v;
    }

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
    // The sha256 echoed in the verdict. Never the digest of mismatching bytes: that
    // would turn the worker into a hash oracle for whatever the URL serves.
    let mut digest_echo = None;
    let observed = match bytes {
        Err(e) => {
            log(format!("fetch_failed: {e}"));
            Observed::FetchFailed
        }
        Ok(bytes) => {
            // 2. Integrity, over the exact bytes.
            let digest = hex::encode(Sha256::digest(&bytes));
            // On a mismatch echo the committed hash, so the contract's binding check
            // (echoed sha256 == committed) accepts this genuine `hash_mismatch`
            // verdict instead of classifying it as `verdict_mismatch`.
            digest_echo = Some(inp.sha256.trim().to_ascii_lowercase());
            if !digest.eq_ignore_ascii_case(inp.sha256.trim()) {
                log("hash_mismatch");
                Observed::HashMismatch
            } else {
                // 3. Decode.
                let ex = exif::read(&bytes);
                match img::decode(&bytes, ex.orientation) {
                    Err(img::DecodeError::TooLarge(e)) => {
                        log(format!("image_too_large: {e}"));
                        Observed::TooLarge
                    }
                    Err(img::DecodeError::Invalid(e)) => {
                        log(format!("bad_image: {e}"));
                        Observed::Undecodable
                    }
                    Ok(d) => {
                        let variants = phash::phash_variants(&d.work);
                        let facts = ImageFacts {
                            width: d.width,
                            height: d.height,
                            exif_time: ex.time_ns,
                            exif_gps: ex.gps,
                            phash: variants[0],
                            phash_variants: variants.to_vec(),
                        };
                        work = Some(d.work);
                        Observed::Image(facts)
                    }
                }
            }
        }
    };

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
        // The milestone is deliberately not sent to the model (SPEC 6.4 hardening).
        let out = ai::classify(ai_cfg, &jpeg);
        if let ai::AiOutcome::Unavailable(e) = &out {
            log(format!("ai_unavailable: {e}"));
        }
        out
    };
    let mut v = checks::decide(inp, &parsed.known, &observed, &mut ai_call);
    v.sha256 = digest_echo;
    v
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
    const PHOTO_URL: &str =
        "https://oshxsrhnynauyxcraymy.supabase.co/storage/v1/object/public/evidence/harmattan-court/17.jpg";

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
                    "is_render":false,"has_other_instructions":false,"challenge_read":"K7RQ4M",
                    "observations":["trusses"]}),
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
        assert_eq!(v.ai_observations, vec!["trusses"]);
        assert_eq!(v.worker_commit, WORKER_COMMIT);
        assert_eq!(v.sha256, Some(hex::encode(Sha256::digest(&p))));
        assert_eq!(v.ai_model.as_deref(), Some("mock"));
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
                j["url"] = PHOTO_URL.into();
            })
        };
        let v = run(&url_input(&p), &good_ai(), &Fixed(p.clone()));
        assert!(v.pass, "{v:?}");
        let v = run(&url_input(&p), &good_ai(), &NoNet);
        assert_eq!(v.reasons, vec!["fetch_failed"]);
        assert_eq!(v.sha256, None);
        // Tampered bytes.
        let mut tampered = p.clone();
        let n = tampered.len();
        tampered[n - 10] ^= 1;
        let v = run(&url_input(&p), &good_ai(), &Fixed(tampered.clone()));
        assert_eq!(v.reasons, vec!["hash_mismatch"]);
        // The committed hash is echoed (so the contract binds the verdict), never the
        // digest of the bytes that were served.
        assert_eq!(v.sha256, Some(hex::encode(Sha256::digest(&p))));
        let line = serde_json::to_string(&v).unwrap();
        assert!(!line.contains(&hex::encode(Sha256::digest(&tampered))));
        // Upper-case commitment: echoed lowercased.
        let upper = url_input(&p).replace(
            &hex::encode(Sha256::digest(&p)),
            &hex::encode(Sha256::digest(&p)).to_ascii_uppercase(),
        );
        let v = run(&upper, &good_ai(), &Fixed(tampered));
        assert_eq!(v.reasons, vec!["hash_mismatch"]);
        assert_eq!(v.sha256, Some(hex::encode(Sha256::digest(&p))));
    }

    #[test]
    fn e2e_url_not_allowed_never_fetches() {
        struct Panics;
        impl Fetcher for Panics {
            fn get(&self, _: &str) -> Result<Vec<u8>, fetch::FetchError> {
                panic!("must not fetch");
            }
        }
        let p = photo(19, Some((6.447118, 3.474201)), Some(EXIF_T));
        let with_url = |url: &str, prefix: Option<&str>| {
            input_for(&p, |j| {
                j.as_object_mut().unwrap().remove("image_base64");
                j["url"] = url.into();
                if let Some(px) = prefix {
                    j["allowed_url_prefix"] = px.into();
                }
            })
        };
        for url in [
            "https://example.supabase.co/storage/v1/object/public/evidence/x/17.jpg",
            "https://169.254.169.254/latest/meta-data/iam/",
            "https://localhost/x.jpg",
            "http://oshxsrhnynauyxcraymy.supabase.co/storage/v1/object/public/evidence/a.jpg",
            "https://oshxsrhnynauyxcraymy.supabase.co/rest/v1/units",
            "https://oshxsrhnynauyxcraymy.supabase.co/storage/v1/object/public/evidence/../../../rest/v1/x",
        ] {
            let v = run(&with_url(url, None), &good_ai(), &Panics);
            assert_eq!(v.reasons, vec!["url_not_allowed"], "{url}");
            assert_eq!(v.evidence_id, Some(17));
            assert_eq!(v.sha256, None);
            assert!(!v.pass);
        }
        // The estate's extra prefix admits its own storage.
        let v = run(
            &with_url(
                "https://cdn.example.org/plote/17.jpg",
                Some("https://cdn.example.org/plote/"),
            ),
            &good_ai(),
            &Fixed(p.clone()),
        );
        assert!(v.pass, "{v:?}");
        // A bad extra prefix is bad input.
        let v = run(
            &with_url(
                "https://10.0.0.1/plote/17.jpg",
                Some("https://10.0.0.1/plote/"),
            ),
            &good_ai(),
            &Panics,
        );
        assert_eq!(v.reasons, vec!["bad_input"]);
    }

    #[test]
    fn e2e_device_gps_required_outside_demo_and_playground() {
        // EXIF GPS on site, but the browser location was denied (device_gps null).
        let p = photo(20, Some((6.447118, 3.474201)), Some(EXIF_T));
        let no_dev = |j: &mut serde_json::Value| j["device_gps"] = serde_json::Value::Null;
        let v = run(&input_for(&p, no_dev), &good_ai(), &NoNet);
        assert!(!v.pass);
        assert_eq!(v.reasons, vec!["gps_device_missing"]);
        // Demo estate: a warning only.
        let v = run(
            &input_for(&p, |j| {
                no_dev(j);
                j["demo_mode"] = true.into();
            }),
            &good_ai(),
            &NoNet,
        );
        assert!(v.pass, "{v:?}");
        assert_eq!(v.warnings, vec!["gps_exif_only", "ai_mock"]);
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
        // Re-encoded + resized copy with fresh EXIF written back (freshness is never softened,
        // so a reused photo must also look fresh to reach the reuse check), in the playground too.
        let copy = synth::with_exif(
            &synth::reencode(&orig, 0.9, 70),
            &synth::ExifSpec {
                datetime: Some(synth::exif_datetime(EXIF_T, 60)),
                offset: Some("+01:00".into()),
                gps: Some((6.447118, 3.474201)),
                orientation: Some(1),
            },
        );
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
    fn e2e_mirrored_or_rotated_reuse_detected() {
        let orig = photo(17, Some((6.447118, 3.474201)), Some(EXIF_T));
        let first = run(&input_for(&orig, |_| {}), &good_ai(), &NoNet);
        assert!(first.pass, "{first:?}");
        let fresh = |jpeg: &[u8], orientation: u16| {
            synth::with_exif(
                jpeg,
                &synth::ExifSpec {
                    datetime: Some(synth::exif_datetime(EXIF_T, 60)),
                    offset: Some("+01:00".into()),
                    gps: Some((6.447118, 3.474201)),
                    orientation: Some(orientation),
                },
            )
        };
        let pixels = image::load_from_memory(&orig).unwrap();
        let copies = [
            // Mirrored via the EXIF Orientation tag alone (bytes otherwise identical scene).
            fresh(&synth::reencode(&orig, 1.0, 80), 2),
            // Mirrored and rotated in pixels, re-encoded.
            fresh(&synth::encode_jpeg(&pixels.fliph(), 75), 1),
            fresh(&synth::encode_jpeg(&pixels.rotate90(), 75), 1),
            fresh(&synth::encode_jpeg(&pixels.rotate180(), 75), 1),
        ];
        for (i, copy) in copies.iter().enumerate() {
            let v = run(
                &input_for(copy, |j| j["known_phashes"] = json!([first.phash])),
                &good_ai(),
                &NoNet,
            );
            assert!(!v.pass, "copy {i}: {v:?}");
            assert!(v.reasons[0].starts_with("phash_reuse:"), "copy {i}: {v:?}");
        }
    }

    #[test]
    fn e2e_bad_geofence_never_fetches() {
        struct Panics;
        impl Fetcher for Panics {
            fn get(&self, _: &str) -> Result<Vec<u8>, fetch::FetchError> {
                panic!("must not fetch");
            }
        }
        let p = photo(18, Some((6.447118, 3.474201)), Some(EXIF_T));
        let raw = input_for(&p, |j| {
            j.as_object_mut().unwrap().remove("image_base64");
            j["url"] = PHOTO_URL.into();
            j["geofence"]["radius_m"] = 0.into();
        });
        let v = run(&raw, &good_ai(), &Panics);
        assert_eq!(v.reasons, vec!["bad_geofence"]);
        assert_eq!(v.evidence_id, Some(17));
    }

    #[test]
    fn e2e_oversized_image() {
        let big = synth::png(img::MAX_DIMENSION + 1, 900, 5);
        let v = run(&input_for(&big, |_| {}), &good_ai(), &NoNet);
        assert_eq!(v.reasons, vec!["image_too_large"]);
        assert!(v.sha256.is_some());
    }

    #[test]
    fn e2e_ai_unavailable_without_key() {
        let p = photo(14, Some((6.447118, 3.474201)), Some(EXIF_T));
        let none = ai::AiConfig::default();
        let v = run(&input_for(&p, |_| {}), &none, &NoNet);
        assert_eq!(v.reasons, vec!["ai_unavailable"]);
        // demo_mode softens ai_unavailable, but the unread challenge still fails (SPEC 6.1).
        let v = run(
            &input_for(&p, |j| j["demo_mode"] = true.into()),
            &none,
            &NoNet,
        );
        assert!(!v.pass);
        assert_eq!(v.warnings, vec!["ai_unavailable"]);
        assert_eq!(v.reasons, vec!["challenge_unverified"]);
    }

    #[test]
    fn e2e_fenced_mock_and_challenge() {
        let p = photo(15, Some((6.447118, 3.474201)), Some(EXIF_T));
        let cfg = ai::AiConfig {
            mock: Some("```json\n{\"stage\":\"roofing\",\"confidence\":91,\"is_photo_of_screen_or_print\":false,\"is_render\":false,\"has_other_instructions\":false,\"challenge_read\":\"K7-RQ4N\"}\n```".into()),
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
