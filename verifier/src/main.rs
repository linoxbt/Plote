//! OutLayer worker entry point: one JSON object on stdin → one JSON line on
//! stdout. Diagnostics go to stderr.

use plote_verifier::{ai::AiConfig, checks::Verdict, input, run, HttpFetcher};
use std::io::{Read, Write};

/// Inline `image_base64` of a 12 MB photo is ~16 MB; allow some headroom.
const MAX_STDIN: u64 = 20 * 1024 * 1024;

fn main() {
    let mut raw = Vec::new();
    let read_ok = std::io::stdin()
        .lock()
        .take(MAX_STDIN + 1)
        .read_to_end(&mut raw)
        .is_ok();
    let raw = String::from_utf8(raw)
        .ok()
        .filter(|r| read_ok && r.len() as u64 <= MAX_STDIN);

    let verdict = match raw {
        None => Verdict::bad_input(None),
        Some(raw) => {
            let cfg = AiConfig::from_env();
            // Natively a panic unwinds and is caught here; on wasm32 panics
            // abort, so the pipeline itself avoids panicking paths.
            std::panic::catch_unwind(|| run(&raw, &cfg, &HttpFetcher)).unwrap_or_else(|_| {
                eprintln!("plote-verifier: internal error");
                Verdict::bad_input(input::sniff_evidence_id(&raw))
            })
        }
    };

    let line = serde_json::to_string(&verdict).unwrap_or_else(|_| {
        r#"{"evidence_id":null,"pass":false,"reasons":["bad_input"],"warnings":[]}"#.to_string()
    });
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{line}");
    let _ = out.flush();
}
