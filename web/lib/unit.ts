// `plote-unit` client (INTERFACE §2). One contract per unit account, e.g. a-4b.harmattan-court.plote.testnet.

import { fnCall, view, type TxSpec } from "./near";
import { unitAccount } from "./estates";

export { unitAccount };

export const unit = {
  /** [estate_id, usdc_id, unit_id] */
  getInfo: (unitAcct: string) => view<[string, string, string]>(unitAcct, "get_info"),
  /** Anyone: asks the estate to sync this unit's balance (used after a plain ft_transfer, e.g. 1Click). */
  syncDeposits: (unitAcct: string): TxSpec => fnCall(unitAcct, "sync_deposits", {}, 80),
};
