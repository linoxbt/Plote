import { TGAS, USDC, account, call, view } from "../lib.js";
const E = "playground.plote.testnet", U = "musdc.plote.testnet", unit = "p-55";
const bal = async (a: string) => Number(BigInt(await view<string>(U, "ft_balance_of", { account_id: a })) / 10_000n) / 100;
const u = await view<any>(E, "get_unit", { unit_id: unit }); const tok = await view<any>(E, "nft_token", { token_id: unit });
console.log("holder", u.holder, "| NFT owner", tok.owner_id, "| unit acct", await bal(u.account), "| paid", Number(BigInt(u.paid) / USDC), "| buyer-2 USDC", await bal("buyer-2.plote.testnet"));
const est = await view<any>(E, "get_estate", {});
try {
  const pid = await call<any>(account("buyer-3.plote.testnet"), E, "propose", { kind: { ReplaceSurveyor: { account: "buyer-4.plote.testnet" } } }, { gas: 50n * TGAS });
  console.log("proposal id", JSON.stringify(pid));
  await call(account("buyer-3.plote.testnet"), E, "vote", { proposal_id: String(pid), approve: false }, { gas: 50n * TGAS });
  console.log("voted no");
} catch (e) { console.log("vote path error:", (e as Error).message.split("\n")[0].slice(0, 300)); }
const ps = await view<any>(E, "list_proposals", { from_index: 0, limit: 10 }).catch((e) => `view err ${(e as Error).message.slice(0, 200)}`);
console.log("proposals:", JSON.stringify(ps).slice(0, 500));
await call(account("buyer-2.plote.testnet"), E, "propose", { kind: { Veto: { milestone: 0 } } }, { gas: 50n * TGAS }).then(() => console.log("! old holder could still propose")).catch((e) => console.log("old holder blocked:", (e as Error).message.match(/E_[A-Z_]+[^"]*/)?.[0]?.slice(0, 80)));
