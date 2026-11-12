#!/usr/bin/env bash
# Reproducible release build of the OutLayer worker (README "Reproducible build").
# Same source tree + same pinned toolchain (rust-toolchain.toml) + Cargo.lock => same WASM bytes, on any machine and
# in any checkout path. Prints the SHA-256 (= OutLayer version key) on the last line.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$here"
cargo_home="$(cd "${CARGO_HOME:-$HOME/.cargo}" && pwd -P)"

# Nothing machine-specific may reach the binary: panic locations carry source paths, so map the checkout and the
# cargo registry to fixed prefixes. Encoded flags keep paths with spaces intact. Anything set by the caller is ignored.
unset RUSTFLAGS CARGO_BUILD_RUSTFLAGS GIT_SHA CARGO_TARGET_WASM32_WASIP2_RUSTFLAGS
sep=$'\x1f'
export CARGO_ENCODED_RUSTFLAGS="--remap-path-prefix=${here}=/plote-verifier${sep}--remap-path-prefix=${cargo_home}=/cargo"
export CARGO_TARGET_DIR="$here/target"
export SOURCE_DATE_EPOCH=0
export CARGO_INCREMENTAL=0
export TZ=UTC LC_ALL=C

cargo build --release --locked --target wasm32-wasip2
wasm="$CARGO_TARGET_DIR/wasm32-wasip2/release/plote-verifier.wasm"
echo "toolchain: $(rustc --version)"
echo "$(sha256sum "$wasm" | cut -d' ' -f1)  target/wasm32-wasip2/release/plote-verifier.wasm"
