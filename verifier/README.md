# plote-verifier

The OutLayer TEE worker that checks a Plote milestone photo (SPEC §6). It reads **one JSON object on stdin** and prints **one JSON line on stdout** (the verdict). Diagnostics go to stderr. It never panics on bad input: malformed input produces `{"pass": false, "reasons": ["bad_input"], …}`.

This directory is its own Cargo workspace (`[workspace]` in `Cargo.toml`), so it can be moved into a separate public repo `plote-verifier` as-is. OutLayer builds from source, so the git commit is the code's identity.

## Checks (in order, fail fast)

| # | Check | Fails with |
|---|---|---|
| 1 | Fetch `url` over HTTPS, ≤ 12 MB (or use inline `image_base64`) | `fetch_failed` |
| 2 | `sha256(bytes) == sha256` | `hash_mismatch` |
| 3 | Decodes as JPEG/PNG, short side ≥ 800 px | `bad_image` |
| 4 | EXIF `DateTimeOriginal` (+`OffsetTimeOriginal`, default +01:00) within `max_exif_age_h` of `now`, not > 10 min in the future | `exif_missing`, `exif_stale`, `exif_future` |
| 5 | EXIF GPS (else `device_gps`, marked `gps_source: "device"`) within `geofence.radius_m` (haversine). Skipped, and nothing about location reported, when `radius_m == 0` | `outside_geofence`, `gps_missing` |
| 6 | 64-bit pHash, Hamming distance to every `known_phashes` > `max_phash_distance` | `phash_reuse:<distance>` |
| 7 | NEAR AI vision: stage matches the milestone, confidence ≥ `min_ai_confidence`, not a screen/print/render | `ai_stage_mismatch`, `ai_low_confidence`, `ai_screen_photo`, `ai_unavailable` |
| 8 | The challenge code the model read matches `challenge` (case-insensitive, spaces/dashes ignored, O≡0, I≡1≡L, ≤ 1 edit); EXIF time ≥ `challenge_opened_at` − 5 min | `challenge_missing`, `challenge_mismatch`, `exif_before_capture` |

Stages accepted per milestone: foundation → `foundation`/`walls`; roofing → `roofing`; finishing → `finishing`/`complete`; handover → `complete`. Any other milestone key accepts only the stage with the same name.

Warnings instead of failures (they go in `warnings`, and `pass` can still be `true`):

- `demo_mode`: `ai_unavailable` becomes a warning, plus `challenge_unverified`, since the code can't be read without the model.
- `playground`: `ai_stage_mismatch`, `ai_low_confidence`, `outside_geofence`, `gps_missing`, `exif_missing` and `exif_stale` become warnings.
- These always fail, in every mode: `hash_mismatch`, `bad_image`, `exif_future`, `phash_reuse`, `ai_screen_photo`, `challenge_*` and `exif_before_capture`.
- `ai_mock` is added whenever the answer came from `PLOTE_AI_MOCK` and not from NEAR AI.

## Input / output

See `fixtures/example-input.json` (SPEC §6.3 + `challenge`, `challenge_opened_at`, `playground`). `evidence_id`, `now`, `captured_at` and `challenge_opened_at` may be JSON numbers or strings. `limits` and its fields are optional and default to 72 h / 8 / 70.

Output:

```json
{"evidence_id":17,"pass":true,"reasons":[],"warnings":[],"phash":"65400d2596050400","nearest_distance":29,
 "exif_time":1793739420000000000,"gps":[6447118,3474201],"gps_source":"exif","distance_m":26,
 "ai_stage":"roofing","ai_confidence":88,"challenge_read":"K7RQ4M","ai_chat_id":"chatcmpl-…",
 "worker_commit":"<git sha>","attestation":null}
```

`worker_commit` is baked in at build time by `build.rs`. It uses the `GIT_SHA` env var if set, then `git rev-parse HEAD`, then `"unknown"`. `attestation` is always `null` from the worker; OutLayer adds its own attestation around the output.

## Build

```sh
rustup target add wasm32-wasip2
cargo build --release --target wasm32-wasip2
# -> target/wasm32-wasip2/release/plote-verifier.wasm (~1.2 MB)

# to pin the commit explicitly:
GIT_SHA=$(git rev-parse HEAD) cargo build --release --target wasm32-wasip2
```

HTTP uses `wstd` (wasi:http) on wasm32 and `ureq` natively, chosen with `cfg(target_arch)`.

## Test

```sh
cargo test            # unit + end-to-end tests; offline, no API key needed
cargo clippy --all-targets --features synth
```

The tests build synthetic photos in code (`src/synth.rs`): scenes, EXIF time and GPS, and re-encoded or resized copies for pHash reuse. They mock the model, so nothing is downloaded and NEAR AI is never called.

## Run locally

Native, fully offline. `fixtures/offline-input.json` inlines a synthetic photo as `image_base64`; regenerate it with `cargo run --example gen_fixture --features synth`.

```sh
PLOTE_AI_MOCK='{"stage":"roofing","confidence":88,"is_photo_of_screen_or_print":false,"is_render":false,"challenge_read":"K7RQ4M"}' \
  cargo run --release < fixtures/offline-input.json
cargo run --release < fixtures/offline-input.json          # no key: demo_mode → ai_unavailable warning
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
| `NEAR_AI_MODEL` | no | Defaults to `Qwen/Qwen3-VL-30B-A3B-Instruct`. |
| `PLOTE_AI_MOCK` | no | Tests and offline runs only: the model's answer as a JSON string, or `unavailable`. |

The model is called at `POST https://cloud-api.near.ai/v1/chat/completions` with `temperature: 0`, `max_tokens: 300`, the SPEC §6.4 system prompt, and the photo as a base64 JPEG data URL (orientation-corrected, ≤ 1024 px long side), so the model never fetches external URLs. The reply is parsed even when wrapped in ```` ```json ```` fences, `<think>` blocks or prose. The response `id` is returned as `ai_chat_id`, for `GET /v1/signature/{chat_id}`.

## Register on OutLayer

1. Push this directory as the root of a public GitHub repo (e.g. `github.com/<org>/plote-verifier`) and note the commit SHA.
2. Sign in at app.outlayer.ai and create a project with source **GitHub**: repo URL, that commit, build target `wasm32-wasip2`. Run it once from the dashboard or CLI with `fixtures/example-input.json` (real URL and sha) to warm the build cache. The first build of a new commit can outlast the yield timeout.
3. Add `NEAR_AI_API_KEY` as an encrypted secret on the project or profile (SPEC 5.6 uses `secrets_ref: {"profile": "plote", "account_id": <estate>}`).
4. Put the same `{repo, commit, build_target: "wasm32-wasip2"}` in the estate's `verifier` config. The contract sends it as `source: {"GitHub": {…}}` in `request_execution` with `response_format: "Json"`, and resource limits of about 50 G instructions, 256 MB and 60 s.
5. Don't change the pinned commit in the 48 hours before a demo.

## Layout

```
src/main.rs       stdin → run → one stdout line
src/lib.rs        pipeline (fetch → sha256 → decode/EXIF/pHash → decide)
src/checks.rs     pure decision logic, reason codes, mode downgrades (unit-tested)
src/input.rs      stdin schema and validation
src/fetch.rs      HTTPS GET/POST (wstd on wasm32, ureq natively), size caps
src/exif.rs       DateTimeOriginal/OffsetTimeOriginal → Unix ns; GPS → e6
src/geo.rs        haversine
src/img.rs        decode, orientation, downscale, JPEG for the model
src/phash.rs      64-bit DCT pHash + Hamming
src/ai.rs         NEAR AI request/response, robust JSON parsing
src/challenge.rs  fuzzy challenge-code match
src/synth.rs      synthetic test photos (tests / `synth` feature)
fixtures/         example-input.json, offline-input.json
```
