# Plote web

Next.js (App Router) app for Plote — off-plan home escrow on NEAR. Spec: `../docs/SPEC.md`; contract shapes: `../docs/INTERFACE.md`.

```bash
pnpm install
cp .env.example .env.local   # optional: everything has testnet defaults
pnpm dev                     # http://localhost:3000
pnpm typecheck && pnpm lint && pnpm test && pnpm build
PLAYWRIGHT_BASE_URL=https://<preview> pnpm test:e2e
```

- `lib/` — typed chain clients (`estate.ts`, `unit.ts`, `usdc.ts`), RPC with failover + 5 s cache and wallet helpers (`near.ts`),
  NEP-413 (`nep413.ts`), error mapping (`errors.ts`), the dynamic NFT SVG (`svg-house.ts`), events, formatting, score.
  `lib/server/` is for API routes only (relayer, Supabase service role, 1Click JWT).
- Wallet: `@hot-labs/near-connect` (`lib/near.ts#getConnector`). Non-payable calls (votes, sync) can use a browser-held
  function-call key ("one-tap voting"); the surveyor's phone key signs NEP-366 delegates that `/api/relay` submits.
- Pages render with no deployed contract: failed views show `—` or an error card with the raw code.
- `supabase/` migrations live at the repo root (owned by the lead); table names follow SPEC §14.2.
- Dark only (SPEC §11.2). Path B (1Click) is mainnet-only: build with `NEXT_PUBLIC_NETWORK=mainnet`.
