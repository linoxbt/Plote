# Demo script (3:00) and recording checklist

Record with every on-chain step real; cut waiting time with a visible "⏩ 2 min later" card. 1080p, screen + voice.
Phone footage via QuickTime or scrcpy. Everything below runs on NEAR testnet with a wallet any judge can use; the
on-chain state described is what the estates showed on 13 Nov 2026 (check it again with `just status` before recording).

## Before recording (run `docs/SPEC.md` §17.5 too)

- [ ] `just status`: all three estates reachable, code hash `61CGp8J2…`, verifier `07cf9626…` pinned on each,
      verification budget above 1 NEAR on each.
- [ ] Harmattan Court: `a-4b` and `b-3b` TAKEN; `a-1a`, `a-2a`, `b-1a`, `c-ph` AVAILABLE; all four milestones Open
      (no photo evidence on this estate yet). Only its surveyor account can capture here, so the photo shots use the
      playground.
- [ ] Playground: foundation Approved (evidence 6, [`/proof/playground/6`](https://plote-vert.vercel.app/proof/playground/6)),
      roofing Open and next in order; 58 units AVAILABLE (only `p-55` and `p-56` are held). `just reset-playground`
      reopens every milestone (the next capture is then foundation again) and tops units up to at least 10 available.
- [ ] Baobab Heights: the judge wallet `judge.plote.testnet` holds `b-2a`, `b-2b` and `b-2c`, foundation Missed,
      REFUND OPEN on each (`just seed-refunds` if they are used up).
- [ ] The recording wallet has testnet NEAR and has minted test USDC at `/faucet`.
- [ ] A sheet of paper and a thick marker for the challenge code. A phone camera that writes EXIF capture time (the
      default camera app does; screenshots and edited exports often don't). The photo's short side must be ≥ 800 px.
- [ ] A copy of the evidence-6 photo (from its proof page) for the reuse shot.
- [ ] Warm the verifier with one OutLayer run before recording (yield/resume can time out on a cold build, SPEC 5.6).
      A run that fails only because NEAR AI or the worker was down is stored as Error and refunds its 0.05 NEAR; just
      capture again. One account can submit at most 5 playground photos per hour.
- [ ] `/status` and `/api/health` checked. Fresh browser profile, phone at 375 px.

## Shot list

Record the reuse failure (1:40) before the passing capture (1:00): both use the roofing stage, and a failed check
reopens it.

| Time | Screen | Voice-over |
|---|---|---|
| 0:00–0:15 | Black → news headlines from SPEC §20.3 sources → Plote mark | "In Nigeria, people pay for off-plan homes for two years before they see them. Some developers sell the same flat twice. Some take the money and stop building. Plote fixes the part that's fixable: where the money waits." |
| 0:15–0:35 | `/check` on a phone → type `a-4b.harmattan-court` → TAKEN, 8,500 USDC paid, nothing released | "Every unit is its own NEAR account. Anyone can check who holds it and how much is in escrow. No login." |
| 0:35–1:00 | Recording wallet → Playground → an available unit (e.g. `p-07`) → Reserve → Pay 10 % → NFT reveal; NearBlocks shows USDC on `p-07.playground.plote.testnet` | "I reserve a unit and pay into the unit's account, not the developer's. The allocation NFT is minted, and it is the only one this unit will ever have." |
| 1:00–1:40 | Phone: `/qs/playground/capture` → roofing → code on screen → write it on paper → photograph the paper → live log → PASS → proof page (a stage warning such as `ai_stage_mismatch` is expected and allowed on the playground: the photo is not of a roof) | "The contract issues a one-time code. The surveyor writes it on paper and takes the photo. Inside an OutLayer TEE the photo's hash, EXIF time and perceptual hash are checked, and NEAR AI's vision model reads the code. On a real estate the photo's position must also be inside the site's geofence and the model must see the right stage; this playground skips both so you can try it anywhere." |
| 1:40–1:55 | New roofing capture → submit the evidence-6 photo again → red proof page `phash_reuse:<distance>` | "Reuse an old photo and it fails. Money can't move." |
| 1:55–2:15 | `/qs/playground/sign` → Sign → ⏩ 2-minute veto window → `/dev/estates/playground/releases` → Claim → each unit's released amount steps up (foundation 20 % + roofing 30 % of what it paid) | "The surveyor signs, holders get a veto window, then each unit releases exactly the share of the stages approved so far, in order. Not a cent more." |
| 2:15–2:30 | Judge wallet → Baobab Heights `b-2a`, deadline missed → "Get my money back" → USDC returned, token burned, unit AVAILABLE | "If a deadline passes, the buyer takes back everything not yet released. Nobody has to approve it." |
| 2:30–2:45 | *Optional, only if a mainnet unit exists (`just mainnet-lite`, then `MAINNET_UNIT_ACCOUNT` set): 1Click from Base → status SUCCESS → USDC on that unit. Not done yet; otherwise cut this shot and extend the next one.* | "A buyer abroad pays from Base. NEAR Intents delivers USDC straight into the unit's account on mainnet." |
| 2:45–3:00 | Watch page `/w/playground/p-07` + the NFT image filling in → logo + URL | "The NFT holds the money, the refund, the resale and the vote, and it shows the house going up. Plote: pay for the house you can see." |

Fallback if the live check fails during recording: show [`/proof/playground/6`](https://plote-vert.vercel.app/proof/playground/6),
the first live pass (12 Nov), and say so on screen.

Also cut a 30-second version (0:15–1:40 compressed) for the X post.

## Say the honest limits

- Not a land title. The TEE proves the checks ran on the committed photo, not that the scene is honest.
- The code in the frame shows the photo was made after the capture opened; it cannot prove the paper was physically on
  site. Evidence 6 itself is a public-domain 1943 foundation photograph with the code composited in digitally and EXIF
  stamped, and the model accepted it. Real (non-demo) estates also require the phone's GPS inside the geofence; the
  surveyor's signature and the holders' veto are the backstop.
- The testnet estates still have a full-access key, so Plote could upgrade their code; the keys are deleted at mainnet
  launch (LAUNCH.md §3).
- Mainnet shows the payment rail (pending); the escrow logic runs on testnet.
