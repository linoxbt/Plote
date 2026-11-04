# Plote
Spec: docs/SPEC.md (design) and docs/INTERFACE.md (exact JSON interface; wins on names/types).
Contracts in /contracts (Rust, near-sdk 5.30), web in /web (Next.js), TEE worker in /verifier, deploy/demo scripts in /scripts.

Rules:
- Testnet by default. Never put a private key in code; scripts read ~/.near-credentials or NEAR_KEY_* env.
- Every contract method change needs a test in contracts/estate/src/tests.rs (or the crate's tests).
- Amounts are USDC base units (6 dp) as strings in JSON; times are nanoseconds as strings.
- Panics start with a stable E_ code; add new codes to INTERFACE.md §1.5 and web/lib/errors.ts.
- Demo estates are fictional: harmattan-court, baobab-heights (refund demo), playground (judge sandbox).
- Before saying a task is done: `cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings && pnpm -C web typecheck && pnpm -C web test`.
