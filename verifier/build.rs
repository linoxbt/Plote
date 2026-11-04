//! Bakes the git commit into the binary as `PLOTE_WORKER_COMMIT`.
//! Priority: `GIT_SHA` env var, then `git rev-parse HEAD`, then "unknown".
use std::process::Command;

fn git(args: &[&str]) -> Option<String> {
    let out = Command::new("git").args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8(out.stdout).ok()?.trim().to_string();
    (!s.is_empty()).then_some(s)
}

fn main() {
    println!("cargo:rerun-if-env-changed=GIT_SHA");
    println!("cargo:rerun-if-changed=build.rs");

    let sha = std::env::var("GIT_SHA")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| git(&["rev-parse", "HEAD"]))
        .unwrap_or_else(|| "unknown".to_string());

    // Re-run when HEAD moves (if we are in a git checkout).
    if let Some(dir) = git(&["rev-parse", "--absolute-git-dir"]) {
        let mut watch = vec![format!("{dir}/HEAD"), format!("{dir}/packed-refs")];
        if let Some(r) = git(&["symbolic-ref", "-q", "HEAD"]) {
            watch.push(format!("{dir}/{r}"));
        }
        for p in watch {
            // A missing path would force a rebuild every time; skip those.
            if std::path::Path::new(&p).exists() {
                println!("cargo:rerun-if-changed={p}");
            }
        }
    }

    println!("cargo:rustc-env=PLOTE_WORKER_COMMIT={sha}");
}
