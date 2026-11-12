//! Bakes the worker's version label into the binary as `PLOTE_WORKER_COMMIT`.
//!
//! Reproducible on purpose: nothing about the build machine or checkout (git HEAD,
//! dirty state, time, paths) goes in. The label is `GIT_SHA` when the builder sets
//! it explicitly (hex, 7–64 characters), else the fixed `plote-verifier@<version>`.
//! The build's real identity is the SHA-256 of the WASM (OutLayer's version key),
//! which anyone can reproduce with `./build-wasm.sh` (README "Reproducible build").
fn main() {
    println!("cargo:rerun-if-env-changed=GIT_SHA");
    println!("cargo:rerun-if-changed=build.rs");

    let explicit = std::env::var("GIT_SHA")
        .ok()
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| (7..=64).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_hexdigit()));
    let label = explicit.unwrap_or_else(|| {
        format!(
            "plote-verifier@{}",
            std::env::var("CARGO_PKG_VERSION").unwrap_or_default()
        )
    });
    println!("cargo:rustc-env=PLOTE_WORKER_COMMIT={label}");
}
