// USDC (NEP-141 + NEP-145) client. Testnet: Plote mock USDC with an open `mint` (INTERFACE §3).

import { USDC_ID } from "./config";
import { fnCall, ONE_YOCTO, view, type TxSpec } from "./near";
import { nearToYocto } from "./format";
import type { FtMetadata, StorageBalance, StorageBalanceBounds, U128 } from "./types";

/** NEP-145 registration on the mock token (and Circle USDC) is 0.00125 NEAR. */
export const USDC_STORAGE_DEPOSIT = nearToYocto("0.00125");
/** `mint` is capped at 10,000 USDC per call. */
export const MINT_CAP = "10000000000";
/** The faucet mints 5,000 test USDC (SPEC §13.4). */
export const FAUCET_AMOUNT = "5000000000";

export const usdc = {
  id: USDC_ID,
  storageBalanceOf: (account_id: string, token = USDC_ID) => view<StorageBalance | null>(token, "storage_balance_of", { account_id }),
  storageBalanceBounds: (token = USDC_ID) => view<StorageBalanceBounds>(token, "storage_balance_bounds"),
  balanceOf: (account_id: string, token = USDC_ID) => view<U128>(token, "ft_balance_of", { account_id }),
  metadata: (token = USDC_ID) => view<FtMetadata>(token, "ft_metadata"),
  totalSupply: (token = USDC_ID) => view<U128>(token, "ft_total_supply"),

  storageDeposit: (account_id: string, token = USDC_ID, deposit = USDC_STORAGE_DEPOSIT): TxSpec =>
    fnCall(token, "storage_deposit", { account_id, registration_only: true }, 10, deposit),
  ftTransfer: (receiver_id: string, amount: U128, memo: string | null = null, token = USDC_ID): TxSpec =>
    fnCall(token, "ft_transfer", { receiver_id, amount, memo }, 30, ONE_YOCTO),
  /** Path A deposit to a unit account (msg "" or a chip-in note) and resale buys to the estate (msg {"buy":id}). */
  ftTransferCall: (receiver_id: string, amount: U128, msg: string, token = USDC_ID): TxSpec =>
    fnCall(token, "ft_transfer_call", { receiver_id, amount, msg, memo: null }, 150, ONE_YOCTO),
  /** Mock USDC only. Registers the receiver if ≥ 0.00125 NEAR is attached. */
  mint: (amount: U128 = FAUCET_AMOUNT, account_id?: string, token = USDC_ID): TxSpec =>
    fnCall(token, "mint", account_id ? { amount, account_id } : { amount }, 30, USDC_STORAGE_DEPOSIT),
};

/** True when the account is registered on the token (can receive USDC). */
export async function isRegistered(account: string, token = USDC_ID): Promise<boolean> {
  const b = await usdc.storageBalanceOf(account, token);
  return !!b;
}
