//! Writes `fixtures/offline-input.json`: a synthetic 1200×900 "site photo"
//! with EXIF time + GPS, inlined as `image_base64`, so the worker can be run
//! end-to-end with no network (pair it with `PLOTE_AI_MOCK`).
//!
//!     cargo run --example gen_fixture --features synth [-- OUT [W H]]

use base64::Engine;
use plote_verifier::synth;
use sha2::{Digest, Sha256};

fn main() {
    let now: u64 = 1_793_743_600_000_000_000;
    let opened: u64 = 1_793_739_000_000_000_000;
    let shot: u64 = 1_793_739_420_000_000_000;
    let args: Vec<String> = std::env::args().collect();
    let dim = |i: usize, d: u32| args.get(i).and_then(|a| a.parse().ok()).unwrap_or(d);
    let (w, h) = (dim(2, 1200), dim(3, 900));
    let jpeg = synth::with_exif(
        &synth::jpeg(w, h, 2026, 70),
        &synth::ExifSpec {
            datetime: Some(synth::exif_datetime(shot, 60)),
            offset: Some("+01:00".into()),
            gps: Some((6.447118, 3.474201)),
            orientation: Some(1),
        },
    );
    let input = serde_json::json!({
        "evidence_id": 17,
        "url": "https://example.invalid/offline-fixture.jpg",
        "image_base64": base64::engine::general_purpose::STANDARD.encode(&jpeg),
        "sha256": hex::encode(Sha256::digest(&jpeg)),
        "captured_at": 1_793_740_000_000_000_000u64,
        "device_gps": [6_447_123, 3_474_190],
        "now": now,
        "milestone": "roofing",
        "geofence": { "lat_e6": 6_447_000, "lon_e6": 3_474_000, "radius_m": 300 },
        "known_phashes": ["c3a1f0e29b7d4410"],
        "limits": { "max_exif_age_h": 72, "max_phash_distance": 8, "min_ai_confidence": 70 },
        "demo_mode": true,
        "playground": false,
        "challenge": "K7RQ4M",
        "challenge_opened_at": opened
    });
    let path = args
        .get(1)
        .cloned()
        .unwrap_or_else(|| "fixtures/offline-input.json".into());
    std::fs::write(&path, format!("{input}\n")).expect("write fixture");
    eprintln!("wrote {path} ({} byte JPEG)", jpeg.len());
}
