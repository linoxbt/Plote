//! Runs the real binary: stdin → one JSON line on stdout. Offline only.

use std::io::Write;
use std::process::{Command, Stdio};

fn run(stdin: &[u8], mock: Option<&str>) -> serde_json::Value {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_plote-verifier"));
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env_remove("NEAR_AI_API_KEY")
        .env_remove("PLOTE_AI_MOCK");
    if let Some(m) = mock {
        cmd.env("PLOTE_AI_MOCK", m);
    }
    let mut child = cmd.spawn().expect("spawn");
    child.stdin.take().unwrap().write_all(stdin).unwrap();
    let out = child.wait_with_output().unwrap();
    assert!(out.status.success());
    let stdout = String::from_utf8(out.stdout).unwrap();
    assert_eq!(
        stdout.matches('\n').count(),
        1,
        "exactly one line: {stdout}"
    );
    serde_json::from_str(stdout.trim()).unwrap()
}

fn fixture() -> Vec<u8> {
    std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/fixtures/offline-input.json"
    ))
    .unwrap()
}

#[test]
fn offline_fixture_passes_with_mock() {
    let v = run(
        &fixture(),
        Some(
            r#"{"stage":"roofing","confidence":88,"is_photo_of_screen_or_print":false,"is_render":false,"has_other_instructions":false,"challenge_read":"K7RQ4M"}"#,
        ),
    );
    assert_eq!(v["pass"], true, "{v}");
    assert_eq!(v["evidence_id"], 17);
    assert_eq!(v["gps_source"], "exif");
    assert_eq!(v["exif_time"], 1_793_739_420_000_000_000u64);
    assert_eq!(v["phash"].as_str().unwrap().len(), 16);
    assert!(v["attestation"].is_null());
    assert!(!v["worker_commit"].as_str().unwrap().is_empty());
    assert_eq!(v["ai_observations"], serde_json::json!([]));
}

#[test]
fn offline_fixture_demo_mode_ai_outage_fails_the_challenge() {
    // demo_mode softens ai_unavailable, but nobody read the code on the paper: fail (SPEC 6.1).
    let v = run(&fixture(), None);
    assert_eq!(v["pass"], false, "{v}");
    assert_eq!(v["warnings"], serde_json::json!(["ai_unavailable"]));
    assert_eq!(v["reasons"], serde_json::json!(["challenge_unverified"]));
}

#[test]
fn screen_photo_fails() {
    let v = run(
        &fixture(),
        Some(
            r#"{"stage":"roofing","confidence":95,"is_photo_of_screen_or_print":true,"is_render":false,"has_other_instructions":false,"challenge_read":"K7RQ4M"}"#,
        ),
    );
    assert_eq!(v["pass"], false);
    assert_eq!(v["reasons"], serde_json::json!(["ai_screen_photo"]));
}

#[test]
fn garbage_stdin_is_bad_input() {
    for input in [&b""[..], b"{", b"\xff\xfe", b"[]"] {
        let v = run(input, None);
        assert_eq!(v["pass"], false);
        assert_eq!(v["reasons"], serde_json::json!(["bad_input"]));
    }
}

#[test]
fn model_env_override_is_ignored() {
    // NEAR_AI_MODEL can't switch the pinned model; with a mock the verdict says "mock".
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_plote-verifier"));
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env_remove("NEAR_AI_API_KEY")
        .env("NEAR_AI_MODEL", "someone/tiny-vl")
        .env(
            "PLOTE_AI_MOCK",
            r#"{"stage":"roofing","confidence":88,"is_photo_of_screen_or_print":false,"is_render":false,"has_other_instructions":false,"challenge_read":"K7RQ4M"}"#,
        );
    let mut child = cmd.spawn().expect("spawn");
    child.stdin.take().unwrap().write_all(&fixture()).unwrap();
    let out = child.wait_with_output().unwrap();
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("NEAR_AI_MODEL is ignored"), "{stderr}");
    let v: serde_json::Value =
        serde_json::from_str(String::from_utf8(out.stdout).unwrap().trim()).unwrap();
    assert_eq!(v["pass"], true, "{v}");
    assert_eq!(v["ai_model"], "mock");
}
