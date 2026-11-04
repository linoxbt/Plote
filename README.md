# Plote — pay for the house you can see

**Track:** NFTs That Do Something · **Live app:** https://plote.vercel.app (after deploy) · **Video:** _link_ · **Licence:** MIT

Every off-plan housing unit is its own NEAR account holding the buyer's USDC. The allocation NFT is the key to that
account: it pulls refunds, sells atomically, votes in its estate (one vote per unit), and becomes the gate pass.
Money moves to the developer only after a site photo — with a one-time challenge code written on paper in the
shot — passes a TEE check (OutLayer + NEAR AI Cloud) and a surveyor signs.

> Demo estates (Harmattan Court, Baobab Heights, Plote Playground) and every person in them are fictional.

## Try it in 10 minutes (testnet, no install)

1. Open `/check` and type `a-4b` → **TAKEN**, with holder and escrow.
2. Connect a testnet wallet → `/faucet` → get 5,000 test USDC.
3. **Plote Playground** → any AVAILABLE unit (`p-01`…`p-60`, $1,000 each) → Reserve → Pay 10% or more.
   You now hold the allocation NFT; `/me` shows it, and the unit account's USDC balance is on NearBlocks.
4. Still in the Playground (anyone can act as surveyor there): **Capture** → write the 6-character code on paper,
   photograph it anywhere → watch the TEE verdict land → **Sign** → wait 2 minutes → **Claim**: 20% of each unit's
   paid amount moves to the developer. Not a cent more.
5. `/proof/harmattan-court/1` → a passed check with attestation links; `/proof/harmattan-court/2` → a failed one
   (reused photo).
6. **Baobab Heights** → unit `b-2a` is held by the shared judge wallet (`docs/judge-wallet.md`, testnet only; its
   foundation deadline has passed) → **Get my money back** → refund lands; the unit becomes AVAILABLE.
   If someone used it first, pick any unit marked REFUND OPEN.
7. Mainnet any-chain payment: see "Mainnet evidence" below.

## What runs where

| Piece | Account / URL |
|---|---|
| Estate contract | `harmattan-court.plote.testnet` (code hash in `config/deployments.testnet.json`) |
| Refund-demo estate | `baobab-heights.plote.testnet` |
| Judge playground | `playground.plote.testnet` |
| Unit contract (global, by hash) | NEP-591 global contract; hash in `config/deployments.testnet.json` |
| Mock USDC | `musdc.plote.testnet` |
| Verifier worker | `verifier/` (OutLayer project built from source) on `outlayer.testnet` |
| Mainnet unit | `a-4b.harmattan-court.plote.<you>.near` |

## Mainnet evidence

- 1Click deposit: _explorer.near-intents.org link_ · origin tx _link_ · NEAR delivery tx _link_

## Repository

```
contracts/estate     estate contract: units, NFT, milestones, verdicts, releases, refunds, resale, votes
contracts/unit       runs on every unit account; holds the USDC; obeys only its estate
contracts/musdc      testnet USDC with an open faucet
contracts/mocks/outlayer-mock   canned verdicts for offline demos (marked "mock_verifier")
verifier/            OutLayer TEE worker: SHA-256, EXIF, GPS, pHash, NEAR AI stage + challenge-code check
web/                 Next.js app: public pages, buyer, surveyor, developer, votes, API routes
scripts/             near-api-js deploy and demo scripts
config/              estate configs (deadlines in 2027 except the refund demo)
supabase/            migrations (photo index, event cache, 1Click quotes)
docs/SPEC.md         full build spec · docs/INTERFACE.md exact contract JSON interface
```

## Build it yourself

Prerequisites: Rust stable with `wasm32-unknown-unknown` and `wasm32-wasip2`, `cargo-near`, Node 22, pnpm, `just`.

```bash
git clone https://github.com/linoxbt/plote && cd plote
just test                       # contracts + verifier + web unit tests
just build                      # contract WASMs into target/near/
pnpm -C scripts install
# put plote.testnet's key in ~/.near-credentials/testnet/plote.testnet.json, then:
just accounts                   # developer, surveyor, relayer, buyers, judge (keys stay in ~/.near-credentials)
just deploy-testnet             # mock USDC, global unit code, three estates and their units
just seed                       # demo purchases; the refund units for judges
cp web/.env.example web/.env.local && just web
```

**NEAR budget (testnet faucet NEAR).** Contract sizes from `just build`: estate ≈ 565 KB (≈ 5.7 NEAR of storage per
estate, each estate account gets 10 NEAR), unit ≈ 110 KB published once as a global contract (global deploys burn
about 10× normal storage, ≈ 11 NEAR), mock USDC ≈ 150 KB, outlayer-mock ≈ 115 KB. Plan for roughly 90 NEAR on
`plote.testnet` to deploy all three estates, the role accounts and the seed purchases.

No real OutLayer project yet? `pnpm -C scripts exec tsx deploy-outlayer-mock.ts` and set `"outlayer"` in a config to
`outlayer-mock.plote.testnet`. Every proof it produces carries a `mock_verifier` warning.

## How it works

- **One unit, one account, one token.** `a-4b.harmattan-court.plote.testnet` is created by the estate with no keys; the
  NFT's token ID is the unit ID, so a second sale of the same unit is impossible.
- **The balance is the truth.** Money can arrive by wallet, by a 1Click delivery or from a relative. The estate re-reads
  the unit's USDC balance and credits the change. Wallet payments to an unreserved unit bounce back; stray deposits are
  never credited to anyone and can be swept back to the person who reserved it.
- **Release only on proof.** Surveyor opens a capture → the contract issues a code → photo with the code on paper →
  SHA-256 committed on-chain → OutLayer worker checks hash, EXIF time, GPS geofence, perceptual-hash reuse, and asks NEAR
  AI's vision model for the stage and the code → verdict returns via yield/resume → surveyor signs → holders get a veto
  window → the stage's share is released.
- **Refund if it stalls.** After a deadline plus grace with no approval, the holder pulls back everything not released.
  Nobody has to approve it.
- **Fair exit.** Listings sell atomically (`ft_transfer_call` with `{"buy": "a-4b"}`); a missed instalment lists the
  unit for what was paid, minus a fixed 5%, instead of forfeiting it.
- **Holders have a voice.** One vote per allocation token, cast inside the estate contract: replace the surveyor, veto a
  sign-off, freeze releases, extend a deadline.

Details: architecture §3, contracts §5, verifier §6, payments §7, votes §8 in `docs/SPEC.md`.

## Verification status

| Layer | How it's checked | Result |
|---|---|---|
| Estate, unit, mock USDC logic | 47 unit tests with simulated balances, callbacks and clock, incl. a randomised 200-step conservation invariant | pass |
| The real WASMs together | `just test-integration`: near-mock runs the built contracts in-process (real receipts, metered gas): add_units creating unit accounts, buy → allocate, capture → evidence → verdict → sign → 20% release, reused-photo fail, freeze vote, resale, refund + burn | 5/5 pass |
| Verifier worker | 64 tests, incl. 4 that run the binary; wasm32-wasip2 build (1.2 MB) run under wasmtime | pass |
| Web | typecheck, lint, 60 Vitest tests, production build; pages and API routes served by `next start` | pass |
| Not yet exercised live | wallet `ft_transfer_call` → unit → estate hand-off (near-mock can't resolve a promise returned from inside a cross-contract receipt; covered by unit tests), OutLayer yield/resume, NEAR AI, 1Click, wallet flows | needs a testnet deploy |

Contracts pin near-sdk 5.29.1: 5.30 adds an import (`promise_batch_action_universal_state_init`) that older runtimes
and tools don't provide.

## Built during the hackathon

All code in this repo was written during NEAR HACKATHON, Nov 1–14 2026 (see commit history). Third-party: near-sdk,
near-contract-standards, OutLayer, NEAR AI Cloud, 1Click API.

## Honest limits

- Not a land title. Always check the C of O or governor's consent with a lawyer.
- The TEE proves the published checks ran on the committed photo, not that the scene is honest; EXIF can be forged.
  The challenge code rules out photos made before the capture opened, and the surveyor (a replaceable role) still signs.
- GPS may come from the device when the photo has none; the proof page says which.
- Mainnet shows the payment rail only; the escrow logic is demonstrated on testnet.
