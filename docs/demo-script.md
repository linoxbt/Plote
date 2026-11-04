# Demo script (3:00) and recording checklist

Record with every on-chain step real; cut waiting time with a visible "⏩ 2 min later" card. 1080p, screen + voice.
Phone footage via QuickTime or scrcpy. Record the mainnet 1Click payment in advance and keep a second $2 attempt ready.

## Before recording (run `docs/SPEC.md` §17.5 too)

- [ ] `just status`: all three estates reachable; verification budget above 1 NEAR on each.
- [ ] Harmattan Court: `a-4b` TAKEN (10%), `b-3b` TAKEN, `a-2a` RESERVED; milestones 1–2 approved with real site photos.
- [ ] Playground: at least 10 units AVAILABLE (`just reset-playground` if not); milestones Open.
- [ ] Baobab Heights: `b-2a` held by the judge wallet, REFUND OPEN (`just seed-refunds` if used up).
- [ ] A sheet of paper and a thick marker for the challenge code.
- [ ] Verifier commit pinned in all configs and warmed with one OutLayer run (yield timeout, SPEC 5.6).
- [ ] `/status` all green. Fresh browser profile, phone at 375 px.

## Shot list

| Time | Screen | Voice-over |
|---|---|---|
| 0:00–0:15 | Black → news headlines from SPEC §20.3 sources → Plote mark | "In Nigeria, people pay for off-plan homes for two years before they see them. Some developers sell the same flat twice. Some take the money and stop building. Plote fixes the part that's fixable: where the money waits." |
| 0:15–0:35 | `/check` on a phone → type `a-4b` → TAKEN | "Every unit is its own NEAR account. Anyone can check who holds it and how much is in escrow. No login." |
| 0:35–1:00 | New wallet → `/faucet` → Playground `p-07` → Reserve → Pay 10% → NFT reveal; NearBlocks shows USDC on `p-07.playground.plote.testnet` | "I reserve a unit and pay into the unit's account, not the developer's. The allocation NFT is minted — the only one this unit will ever have." |
| 1:00–1:40 | Phone at a real site: `/qs/harmattan-court/capture` → code on screen → write it on paper → photo → live log → PASS → proof page | "The contract issues a one-time code. The surveyor writes it on paper and takes the photo. Inside an OutLayer TEE the photo's hash, time, location and perceptual hash are checked, and NEAR AI's vision model confirms the stage and reads the code. The verdict comes back to the contract with an attestation." |
| 1:40–1:55 | Upload last month's photo → red proof page `phash_reuse:3` | "Reuse an old photo and it fails. Money can't move." |
| 1:55–2:15 | QS signs → ⏩ 2-minute veto window → developer claims → 20% moves | "The surveyor signs, holders get a veto window, then exactly 20% of each unit's money is released. Not a cent more." |
| 2:15–2:30 | Baobab Heights `b-2a`, deadline passed → "Get my money back" → balance returned, unit AVAILABLE | "If a deadline passes, the buyer takes back everything not yet released. Nobody has to approve it." |
| 2:30–2:45 | Mainnet: 1Click from Base → status SUCCESS → USDC on `a-4b.harmattan-court.plote.<you>.near` | "A buyer in London pays from Base. NEAR Intents delivers USDC straight into the unit's account on mainnet." |
| 2:45–3:00 | Watch page in WhatsApp + the NFT image filling in → logo + URL | "The NFT holds the money, the refund, the resale and the vote — and it shows the house going up. Plote: pay for the house you can see." |

Also cut a 30-second version (0:15–1:40 compressed) for the X post.

## Say the honest limits

- Not a land title. The TEE proves the checks ran, not that the scene is honest; the challenge code and the surveyor's
  signature are what stop staged photos. GPS may come from the device (the proof page says so).
- Mainnet shows the payment rail; the escrow logic runs on testnet.
