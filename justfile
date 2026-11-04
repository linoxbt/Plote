# Plote — one-word commands (SPEC 16.5). Requires: cargo-near, pnpm, node 22.
set dotenv-load := true

build:
    cargo near build non-reproducible-wasm --manifest-path contracts/mocks/outlayer-mock/Cargo.toml
    cargo near build non-reproducible-wasm --manifest-path contracts/unit/Cargo.toml
    cargo near build non-reproducible-wasm --manifest-path contracts/musdc/Cargo.toml
    cargo near build non-reproducible-wasm --manifest-path contracts/estate/Cargo.toml

build-release:
    cargo near build reproducible-wasm --manifest-path contracts/unit/Cargo.toml
    cargo near build reproducible-wasm --manifest-path contracts/musdc/Cargo.toml
    cargo near build reproducible-wasm --manifest-path contracts/estate/Cargo.toml
    sha256sum target/near/*/*.wasm

test:
    cargo test --workspace
    pnpm -C web test
    cd verifier && cargo test

test-integration: build
    cargo test --release --manifest-path tests/integration/Cargo.toml

lint:
    cargo fmt --all -- --check
    cargo clippy --workspace --all-targets -- -D warnings
    pnpm -C web lint
    pnpm -C web typecheck
    pnpm -C scripts typecheck

accounts:
    pnpm -C scripts exec tsx create-accounts.ts

deploy-testnet:
    pnpm -C scripts exec tsx deploy-musdc.ts
    pnpm -C scripts exec tsx deploy-global-unit.ts
    pnpm -C scripts exec tsx deploy-estate.ts ../config/harmattan-court.testnet.json
    pnpm -C scripts exec tsx add-units.ts ../config/harmattan-court.testnet.json
    pnpm -C scripts exec tsx deploy-estate.ts ../config/baobab-heights.testnet.json
    pnpm -C scripts exec tsx add-units.ts ../config/baobab-heights.testnet.json
    pnpm -C scripts exec tsx deploy-estate.ts ../config/playground.testnet.json
    pnpm -C scripts exec tsx add-units.ts ../config/playground.testnet.json

seed:
    pnpm -C scripts exec tsx seed-demo.ts

seed-refunds:
    pnpm -C scripts exec tsx seed-demo.ts --refund-only

reset-playground:
    pnpm -C scripts exec tsx reset-playground.ts ../config/playground.testnet.json

status:
    pnpm -C scripts exec tsx status.ts

web:
    pnpm -C web dev

verifier:
    cd verifier && cargo build --release --target wasm32-wasip2

verifier-local:
    cd verifier && cargo build --release --target wasm32-wasip2 && \
      wasmtime run -S http target/wasm32-wasip2/release/plote-verifier.wasm < fixtures/example-input.json

mainnet-lite:
    NEAR_ENV=mainnet pnpm -C scripts exec tsx mainnet-lite.ts
