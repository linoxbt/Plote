// Live refund check on Baobab Heights (foundation deadline already passed): the holder pulls back everything not released.
import { TGAS, USDC, account, call, view } from "../lib.js";
const E = "baobab-heights.plote.testnet", U = "musdc.plote.testnet", unit = process.argv[2] ?? "b-2c", holder = "judge.plote.testnet";
const bal = async (a: string) => Number(BigInt(await view<string>(U, "ft_balance_of", { account_id: a })) / 10_000n) / 100;
const u0 = await view<any>(E, "get_unit", { unit_id: unit });
console.log("before:", u0.status, "holder", u0.holder, "paid", Number(BigInt(u0.paid) / USDC), "refund_open", u0.refund_open ?? u0.refundable, "| holder USDC", await bal(holder));
const b0 = await bal(holder);
await call(account(holder), E, "refund", { unit_id: unit }, { gas: 200n * TGAS, deposit: 1n });
await new Promise((r) => setTimeout(r, 2500));
const u1 = await view<any>(E, "get_unit", { unit_id: unit });
console.log("after:", u1.status, "holder", u1.holder, "paid", Number(BigInt(u1.paid) / USDC), "| holder got back", (await bal(holder)) - b0, "USDC | unit acct", await bal(u1.account), "| NFT", JSON.stringify(await view(E, "nft_token", { token_id: unit })));
