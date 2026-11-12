# plote-verifier

The OutLayer TEE worker that checks a Plote milestone photo (SPEC §6). It reads **one JSON object on stdin** and prints **one JSON line on stdout** (the verdict). Diagnostics go to stderr. It never panics on bad input: malformed input produces `{"pass": false, "reasons": ["bad_input"], …}`.

This directory is its own Cargo workspace (`[workspace]` in `Cargo.toml`), so it can be moved into a separate public repo `plote-verifier` as-is. OutLayer builds from source, so the git commit is the code's identity.

## Checks (in order, fail fast)

| # | Check | Fails with |
|---|---|---|
| 0 | Input sanity, before any fetch: `geofence.radius_m` must be > 0 (0 is allowed only with `playground: true`) and ≤ 5000 m; `url` must be a strict `https://` URL under an allowed storage prefix (see "Photo URL allowlist") | `bad_input`, `bad_geofence`, `url_not_allowed` |
| 1 | Fetch `url` over HTTPS, ≤ 12 MB, no redirects followed (or use inline `image_base64`) | `fetch_failed` |
| 2 | `sha256(bytes) == sha256` | `hash_mismatch` |
| 3 | Decodes as JPEG/PNG, short side ≥ 800 px; at most 8000 px per side and 128 MiB decoded | `bad_image`, `image_too_large` |
| 4 | EXIF `DateTimeOriginal` (+`OffsetTimeOriginal`, default +01:00) within `max_exif_age_h` of `now`, not > 10 min in the future | `exif_missing`, `exif_stale`, `exif_future` |
| 5 | `device_gps` is required outside the playground and demo estates (it is what a possibly forged EXIF position is cross-checked against); on the playground/demo its absence only adds the warning `gps_exif_only`. EXIF GPS (else `device_gps`, marked `gps_source: "device"` with warning `gps_device_only` outside the playground) within `geofence.radius_m` (haversine). When both are present they must agree within 100 m. Skipped, and nothing about location reported, when `radius_m == 0` (playground only) | `gps_device_missing`, `gps_mismatch`, `outside_geofence`, `gps_missing` |
| 6 | 64-bit pHash of all 8 orientations (rotations and mirrors); the smallest Hamming distance to every `known_phashes` must be > `max_phash_distance`. `phash` reports the canonical (orientation-applied) hash | `phash_reuse:<distance>` |
| 7 | NEAR AI vision (the claimed milestone is *not* sent to the model): stage matches the milestone, confidence ≥ `min_ai_confidence`, not a screen/print/render, no text addressed to the inspector in the image. A reply that isn't exactly one JSON object, or lacks `is_photo_of_screen_or_print`, `is_render` or `has_other_instructions`, counts as unavailable | `ai_stage_mismatch`, `ai_low_confidence`, `ai_screen_photo`, `ai_instruction_text`, `ai_unavailable` |
| 8 | The challenge code the model read matches `challenge` (case-insensitive, spaces/dashes ignored, O≡0, I≡1≡L, ≤ 1 edit); EXIF time ≥ `challenge_opened_at` − 5 min. If the model couldn't be asked, the code is unread and this fails | `challenge_missing`, `challenge_mismatch`, `challenge_unverified`, `exif_before_capture` |

Stages accepted per milestone: foundation → `foundation`/`walls`; roofing → `roofing`; finishing → `finishing`/`complete`; handover → `complete`. Any other milestone key accepts only the stage with the same name.

Warnings instead of failures (they go in `warnings`, and `pass` can still be `true`):

- `demo_mode`: `ai_unavailable` becomes a warning. The code on the paper still can't be read without the model, so the verdict then fails with `challenge_unverified` (SPEC 6.1: the challenge check fails hard in every mode).
- `playground`: `ai_stage_mismatch`, `ai_low_confidence` and `outside_geofence` become warnings (SPEC 6.1), so a judge can photograph the code anywhere.
- `playground` or `demo_mode`: a missing `device_gps` is the warning `gps_exif_only` instead of the failure `gps_device_missing`.
- Everything else always fails, in every mode: `bad_input`, `bad_geofence`, `url_not_allowed`, `fetch_failed`, `hash_mismatch`, `bad_image`, `image_too_large`, `exif_missing`, `exif_stale`, `exif_future`, `gps_missing`, `gps_mismatch`, `phash_reuse`, `ai_screen_photo`, `ai_instruction_text`, `challenge_*` and `exif_before_capture`.
- `ai_mock` is added whenever the answer came from `PLOTE_AI_MOCK` and not from NEAR AI.
- `gps_device_only` is added (outside the playground) when the location came only from the app's `device_gps`, which the submitter's browser reports and can't be cross-checked.
- `captured_at_mismatch` is added when the app's `captured_at` and the EXIF capture time differ by more than 30 min. `captured_at` is informational (the browser's own EXIF read, else the submit time); freshness is always judged on EXIF.
- `ai_model_mismatch` is added when NEAR AI reports a `model` other than the pinned one (it is still echoed in `ai_model`).

## Input / output

See `fixtures/example-input.json` (SPEC §6.3 + `challenge`, `challenge_opened_at`, `playground`). `evidence_id`, `now`, `captured_at` and `challenge_opened_at` may be JSON numbers or strings. `limits` and its fields are optional and default to 72 h / 8 / 70. Optional `allowed_url_prefix` (string): one more storage location the estate allows (below); it must be a strict `https://host/path/` prefix ending in `/`, else the input is `bad_input`.

### Photo URL allowlist

The worker only fetches `https://` URLs under a compiled-in prefix (`fetch::ALLOWED_PHOTO_PREFIXES`, the app's Supabase bucket: `https://oshxsrhnynauyxcraymy.supabase.co/storage/v1/object/public/evidence/`) or under the input's `allowed_url_prefix`. It refuses (`url_not_allowed`, before any request) other hosts and schemes, IP literals in any notation, `localhost`/`.local`/`.internal` and other local names, single-label hosts, userinfo, ports other than 443, fragments, backslashes, and `.`/`..` or percent-encoded dot/slash segments. Redirects are never followed, natively (`ureq`, `max_redirects(0)`, https only) or on wasm (wasi:http doesn't follow them); a 3xx is `fetch_failed`.

Output:

```json
{"evidence_id":17,"pass":true,"reasons":[],"warnings":[],"phash":"65400d2596050400","nearest_distance":29,
 "exif_time":1793739420000000000,"gps":[6447118,3474201],"gps_source":"exif","distance_m":26,
 "ai_stage":"roofing","ai_confidence":88,"challenge_read":"K7RQ4M","ai_observations":["roof trusses in place"],"ai_chat_id":"chatcmpl-…",
 "worker_commit":"plote-verifier@0.1.0","attestation":null,"sha256":"8ca8c044…94ed",
 "ai_model":"Qwen/Qwen3-VL-30B-A3B-Instruct"}
```

`sha256` binds the verdict to the committed photo: once bytes were fetched it is the committed input `sha256`, lowercased (on success that equals the digest of the bytes; on `hash_mismatch` the digest of the served bytes is deliberately **not** echoed, so the worker is no hash oracle and the contract still accepts the genuine mismatch verdict); `null` if nothing was fetched. `ai_model` is the model that answered (the provider's `model` field if it sent one, else the pinned model; `"mock"` for mocked answers; `null` if the model wasn't asked or didn't answer). New fields are only ever appended.

`worker_commit` is baked in at build time by `build.rs`: `GIT_SHA` if the builder sets it explicitly (hex, 7–64 chars), else the fixed `plote-verifier@<crate version>`. Nothing from the checkout (git HEAD, dirty state) or the machine goes in, so the build is reproducible; the build's identity is the WASM's SHA-256 (OutLayer's version key). `attestation` is always `null` from the worker; OutLayer adds its own attestation around the output.

## Build

### Reproducible build (the one to publish / pin)

```sh
cd verifier
./build-wasm.sh
# -> target/wasm32-wasip2/release/plote-verifier.wasm; the last line is its SHA-256 (= OutLayer version key)
```

`build-wasm.sh` runs `cargo build --release --locked --target wasm32-wasip2` with:

- the toolchain pinned in `rust-toolchain.toml` (Rust 1.97.0 + `wasm32-wasip2`; rustup installs it on first use),
- `Cargo.lock` (`--locked`), release profile `lto = true`, `codegen-units = 1`, `strip = true`,
- `CARGO_ENCODED_RUSTFLAGS` = `--remap-path-prefix=<this dir>=/plote-verifier` and `--remap-path-prefix=<CARGO_HOME>=/cargo` (panic locations would otherwise embed the checkout and registry paths), any caller `RUSTFLAGS`/`GIT_SHA` unset, `CARGO_TARGET_DIR=<this dir>/target`, `SOURCE_DATE_EPOCH=0`, `CARGO_INCREMENTAL=0`, `TZ=UTC`, `LC_ALL=C`,
- `build.rs` embedding only the fixed version label (no git, no time).

Same commit ⇒ same bytes, whatever the checkout path or machine (checked: two clean builds and a build from a different directory give the same hash). The `verifier-build` GitHub workflow runs the same script on a clean runner and publishes the WASM, `hashes.txt` and the hash in the job summary. A plain `cargo build --release --target wasm32-wasip2 --locked` is deterministic too, but only for the same checkout and cargo home paths, since it doesn't remap them.

HTTP uses `wstd` (wasi:http) on wasm32 and `ureq` natively, chosen with `cfg(target_arch)`. Both have a 5 s connect timeout and 10 s between-chunk timeouts. The photo GET has a 10 s first-byte timeout and a 15 s whole-request deadline. The NEAR AI stage has a 35 s budget: the first attempt gets up to 25 s, and one retry is made on a transient failure (HTTP 408/429/5xx, transport errors, timeouts) after a 0.5 s pause if at least 6 s of the budget is left, with the remainder as its deadline. 15 + 35 = 50 s, under OutLayer's 60 s (compile-time asserted in `ai.rs`). On wasm, if the host's wasi:http rejects the per-phase timeout options, the request is resent without them; the overall deadline (wasi:clocks) still applies.

## Test

```sh
cargo test            # unit + end-to-end tests; offline, no API key needed
cargo clippy --all-targets --features synth
```

The tests build synthetic photos in code (`src/synth.rs`): scenes, EXIF time and GPS, and re-encoded or resized copies for pHash reuse. They mock the model, so nothing is downloaded and NEAR AI is never called.

## Run locally

Native, fully offline. `fixtures/offline-input.json` inlines a synthetic photo as `image_base64`; regenerate it with `cargo run --example gen_fixture --features synth`.

```sh
PLOTE_AI_MOCK='{"stage":"roofing","confidence":88,"is_photo_of_screen_or_print":false,"is_render":false,"has_other_instructions":false,"challenge_read":"K7RQ4M"}' \
  cargo run --release < fixtures/offline-input.json
cargo run --release < fixtures/offline-input.json          # no key: demo_mode → ai_unavailable warning, challenge_unverified fail
PLOTE_AI_MOCK=unavailable cargo run --release < fixtures/offline-input.json
```

With wasmtime (`cargo install wasmtime-cli`). `-S http` enables wasi:http:

```sh
wasmtime run -S http target/wasm32-wasip2/release/plote-verifier.wasm < fixtures/example-input.json
# real NEAR AI call:
wasmtime run -S http --env NEAR_AI_API_KEY="$NEAR_AI_API_KEY" \
  target/wasm32-wasip2/release/plote-verifier.wasm < fixtures/offline-input.json
```

`fixtures/example-input.json` points at a placeholder URL, so it returns `fetch_failed` until you put in a real photo URL and its sha256 (`sha256sum photo.jpg`).

`PLOTE_AI_MOCK` is ignored by the wasm build unless you compile it with `--features ai-mock`. The production build registered on OutLayer can therefore never be made to accept a fake model answer. Inline `image_base64` is safe to accept, because the bytes must still match the on-chain `sha256`.

## Environment / secrets

| Variable | Required | Meaning |
|---|---|---|
| `NEAR_AI_API_KEY` | yes (production) | NEAR AI Cloud key. Store it as an **OutLayer encrypted secret**; never commit it or put it on-chain. Without it every run is `ai_unavailable`. |
| `NEAR_AI_MODEL` | — | **Ignored** (a note goes to stderr). The model is pinned in the code (`ai::MODEL` = `Qwen/Qwen3-VL-30B-A3B-Instruct`), so whoever stores the secrets can't switch the check to a weaker model; changing it means a new build and a new version key. |
| `PLOTE_AI_MOCK` | no | Tests and offline runs only: the model's answer as a JSON string, or `unavailable`. |

The model is called at `POST https://cloud-api.near.ai/v1/chat/completions` with `temperature: 0`, `max_tokens: 300`, the SPEC §6.4 system prompt, and the photo as a base64 JPEG data URL (orientation-corrected, ≤ 1024 px long side), so the model never fetches external URLs. The reply must be exactly one JSON object, optionally after one `<think>` block and inside one ```` ```json ```` fence; anything else is `ai_unavailable`. The response `id` is returned as `ai_chat_id`, for `GET /v1/signature/{chat_id}`.

## Register on OutLayer

The supported path is `scripts/outlayer-setup.ts` (testnet by default; mainnet only with `--mainnet --i-know`): it takes the WASM from `./build-wasm.sh`, publishes it as a `WasmUrl` source whose hash OutLayer checks, creates or updates the project `<root>/plote-verifier`, stores the NEAR AI key per estate (`NEAR_AI_API_KEY_<ESTATE_SLUG_UPPER>`, falling back to `NEAR_AI_API_KEY`, saved under the secret name `NEAR_AI_API_KEY`, usable only by runs the estate contract requests), and pins the version key (= the WASM's SHA-256) in the estate as `verifier: {repo: "project:<root>/plote-verifier", commit: <sha256>}`. Anyone can rebuild with `./build-wasm.sh` and compare the hash with the pinned version key.

Don't pin a GitHub source (`repo: <url>`, `commit: <git sha>`) instead: the estate then requires `worker_commit` to equal that git commit, and a reproducible build embeds `plote-verifier@<version>` unless the builder sets `GIT_SHA`, so every verdict would be refused as `worker_commit_mismatch`.

Run one check on a throwaway capture to warm OutLayer before a demo, and don't change the pinned version in the 48 hours before one.

## Layout

```
src/main.rs       stdin → run → one stdout line
src/lib.rs        pipeline (fetch → sha256 → decode/EXIF/pHash → decide)
src/checks.rs     pure decision logic, reason codes, mode downgrades (unit-tested)
src/input.rs      stdin schema and validation
src/fetch.rs      HTTPS GET/POST (wstd on wasm32, ureq natively), URL allowlist, no redirects, size caps
src/exif.rs       DateTimeOriginal/OffsetTimeOriginal → Unix ns; GPS → e6
src/geo.rs        haversine
src/img.rs        decode, orientation, downscale, JPEG for the model
src/phash.rs      64-bit DCT pHash + Hamming
src/ai.rs         NEAR AI request/response (pinned model, one retry in a 35 s budget), strict JSON parsing
src/challenge.rs  fuzzy challenge-code match
src/synth.rs      synthetic test photos (tests / `synth` feature)
fixtures/         example-input.json, offline-input.json
build-wasm.sh     reproducible release build; prints the WASM SHA-256
rust-toolchain.toml  pinned toolchain for that build
```
