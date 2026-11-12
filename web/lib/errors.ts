// Contract errors are panics whose message starts with a stable code (INTERFACE §1.5).
// The web maps the code (text before the first `:`) to plain English.

export const ERROR_MESSAGES = {
  E_NOT_DEVELOPER: "Only the estate's developer can do this.",
  E_NOT_SURVEYOR: "Only the estate's surveyor can do this.",
  E_NOT_HOLDER: "Only the person holding this unit's token can do this.",
  E_NOT_RESERVER: "Only the account that reserved this unit can do this.",
  E_NOT_RELAYER: "Only Plote's relayer (the estate's verdict relayer and deposit reporter) can submit this.",
  E_NOT_LENDER: "Only the lender on this unit can clear the lien.",
  E_NOT_GUARDIAN: "Only one of this unit's guardians can do this.",
  E_UNIT_TAKEN: "Someone already holds this unit.",
  E_UNIT_NOT_FOUND: "There is no unit with that name in this estate.",
  E_UNIT_EXISTS: "A unit with that ID already exists in this estate.",
  E_BAD_UNIT_ID: "Unit IDs use lowercase letters, numbers and dashes, up to 16 characters.",
  E_BALANCE_PENDING: "This unit's balance changed while it was being checked, or it holds a payment nobody has claimed yet. Try again in a moment (or clear it with \"Sweep\" before reserving).",
  E_RESERVATION_ACTIVE: "This unit is reserved by someone else right now. Try again after the reservation ends.",
  E_NO_RESERVATION: "This unit isn't reserved.",
  E_DEPOSIT: "The attached NEAR deposit is wrong for this action.",
  E_MILESTONE_STATE: "This milestone isn't in the right stage for that action.",
  E_NOT_VERIFIED: "This milestone's photo hasn't passed the check yet, so it can't be signed.",
  E_VETO_WINDOW: "Holders can still veto this sign-off. Try again when the veto window closes.",
  E_FROZEN: "Releases are frozen by a holder vote.",
  E_NO_REFUND_YET: "Refunds aren't open yet. They open when a milestone deadline plus its grace period passes.",
  E_NOTHING_TO_REFUND: "There's nothing left to refund on this unit.",
  E_LIEN: "A lender's lien is set on this unit, so it can't be moved or sold until the lender clears it.",
  E_LISTING: "This unit has an open default listing, so it can't be transferred right now.",
  E_UNDERPAID: "The amount sent is less than the asking price.",
  E_IN_FLIGHT: "A transfer for this unit is still settling. Try again in a few seconds.",
  E_BUDGET: "The estate's verification budget is too low to check a photo. The developer needs to top it up.",
  E_BAD_TOKEN: "This estate only accepts its own USDC token.",
  E_BPS_SUM: "Milestone shares (plus mobilisation) must add up to exactly 100%.",
  E_DEADLINES: "Milestone deadlines must be in order, each later than the one before.",
  E_NO_CHALLENGE: "Open a capture first to get a challenge code for this milestone.",
  E_CHALLENGE_EXPIRED: "The challenge code expired. Open a new capture and photograph the new code.",
  E_NOTHING_TO_SWEEP: "There's no unclaimed payment above the dust threshold on this unit.",
  E_NO_EXCESS: "You haven't paid more than the price, so there's no excess to withdraw.",
  E_NOT_ELIGIBLE: "None of your tokens can vote on this proposal (they were allocated after it opened).",
  E_ALREADY_VOTED: "Your tokens have already voted on this proposal.",
  E_PROPOSAL_STATE: "This proposal is no longer open.",
  E_PROPOSAL_OPEN: "You already have an open proposal. Wait for it to finish first.",
  E_PLAYGROUND_ONLY: "That only works in the Plote Playground estate.",
  E_NOT_DUE: "Nothing is overdue on this unit, so it can't be declared in default.",
  E_HANDOVER: "Handover needs the handover milestone approved and its veto window over.",
  E_RECOVERY: "That recovery step isn't allowed right now.",
  E_TOO_MANY: "Too many items in one call. Split it into smaller batches.",
  E_BAD_ARGS: "The request had invalid arguments.",
  E_NOT_UNIT: "Only the unit's own account can call this.",
  E_ALREADY_SOLD: "This unit has already been sold.",
  E_VERIFY_MODE: "This estate gets its photo verdicts straight from OutLayer, so a relayed verdict isn't accepted.",
  E_NOT_ESTATE: "Only the estate contract can do this on a unit account.",
  E_STORAGE: "That account isn't registered on the USDC token yet. Attach 0.00125 NEAR to register it.",
  E_QUORUM: "Too few units are allocated yet for this kind of vote (it needs at least 3 tokens and a quarter of the units).",
  E_STEP_IN: "A step-in vote is only possible while releases are frozen or after a milestone deadline was missed.",
  E_REFUNDS_OPEN: "Refunds are open on this estate (a deadline was missed or holders voted a freeze), so nothing is released until holders vote to extend the deadline or lift the freeze.",
  E_TOO_MANY_APPROVALS: "This token already has the maximum number of approved accounts. Revoke one first.",
  E_CAPTURE_ACTIVE: "Someone else has an open capture for this milestone. Wait until their code expires.",
  E_CHECK_PENDING: "This photo check can still finish. A stuck check can be reopened an hour after the photo was submitted.",
  E_LATE_CLAIM: "This unit's last reservation ended moments ago and a late payment may still arrive for that buyer. Try again a little later.",
  E_VERDICT_MISMATCH: "This verdict doesn't name the photo it checked (evidence ID and SHA-256 must match the submitted photo).",
  E_TIMELOCK: "This step is time-locked. Try again once the waiting period has passed.",
  E_RATE_LIMIT: "Too many tries in a short time. Wait a while and try again.",
  E_NFT_PENDING: "This unit's token is in the middle of a transfer. Try again in a few seconds.",
  E_NOTHING_OWED: "Nothing is owed to this account.",
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export const ERROR_CODES = Object.keys(ERROR_MESSAGES) as ErrorCode[];

/** Non-contract failures the app can raise itself. */
const APP_MESSAGES: Record<string, string> = {
  WALLET_NOT_CONNECTED: "Connect a wallet first.",
  WALLET_REJECTED: "You cancelled the request in your wallet.",
  RPC_UNAVAILABLE: "Couldn't reach the NEAR network. Check your connection and try again.",
  VIEW_FAILED: "Couldn't read this from the chain.",
  CONTRACT_NOT_DEPLOYED: "This contract isn't deployed on this network yet.",
  NOT_CONFIGURED: "This feature isn't configured on this deployment.",
  NETWORK_ERROR: "Network error. Try again.",
  // raised by the web app itself (they usually carry a more specific message)
  NOT_PLOTE: "This isn't a genuine Plote estate or unit, so Plote won't send it money.",
  PAYMENT_REFUNDED: "The payment was refused and the USDC came back to your account.",
  PAYMENT_UNCONFIRMED: "Plote couldn't confirm the payment was accepted. Check the unit page before paying again.",
  BAD_VIEW: "The contract answered in a shape this site doesn't understand. It may be a different version than this site expects.",
  APP_KEY_UNSUPPORTED: "This browser can't keep a key that scripts can't read, so your wallet will ask you to approve each action.",
  APP_KEY_UNUSABLE: "This browser's app key can't send this call, so your wallet will ask instead.",
  LISTING_BLOCKED: "This listing can't be bought right now.",
  NOTHING_RELEASED: "Nothing was released: none of these units had money releasable at that moment.",
  SETUP_PENDING: "The unit still isn't set up. Try again in a minute.",
  // raised by the app's server routes
  REPLAY_CHECK_UNAVAILABLE: "The server couldn't check this request for replays right now, so it was refused. Try again in a minute.",
  QUOTE_NOT_RECORDED: "The payment quote couldn't be recorded, so no deposit address was issued. Try again.",
  POLL_LOCK_UNAVAILABLE: "Another update run is in progress or the lock couldn't be taken. Try again shortly.",
  UNKNOWN: "Something went wrong.",
};

/** Find the first `E_FOO` code in a message (panics are often wrapped: `Smart contract panicked: E_FOO: …`). */
export function parseErrorCode(message: string | null | undefined): string | null {
  if (!message) return null;
  const m = /\b(E_[A-Z0-9_]+)\b/.exec(message);
  return m ? m[1] : null;
}

export function isErrorCode(code: string): code is ErrorCode {
  return code in ERROR_MESSAGES;
}

export function messageForCode(code: string): string {
  if (isErrorCode(code)) return ERROR_MESSAGES[code];
  return APP_MESSAGES[code] ?? APP_MESSAGES.UNKNOWN;
}

export class PloteError extends Error {
  code: string;
  raw: string;
  constructor(code: string, raw?: string, message?: string) {
    super(message ?? messageForCode(code));
    this.name = "PloteError";
    this.code = code;
    this.raw = raw ?? code;
  }
}

function rawMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** Turn anything thrown into `{ code, message, raw }` for display. */
export function explainError(err: unknown): { code: string; message: string; raw: string } {
  if (err instanceof PloteError) return { code: err.code, message: err.message, raw: err.raw };
  const raw = rawMessage(err);
  const code = parseErrorCode(raw);
  if (code) return { code, message: messageForCode(code), raw };
  const lower = raw.toLowerCase();
  if (/(user (rejected|cancel)|rejected by user|cancelled|canceled|user closed)/.test(lower)) {
    return { code: "WALLET_REJECTED", message: APP_MESSAGES.WALLET_REJECTED, raw };
  }
  if (/codedoesnotexist|code does not exist|contract.*not.*deployed|accountdoesnotexist|does not exist while viewing/.test(lower)) {
    return { code: "CONTRACT_NOT_DEPLOYED", message: APP_MESSAGES.CONTRACT_NOT_DEPLOYED, raw };
  }
  if (/failed to fetch|networkerror|timeout|timed out|aborted|econn|enotfound/.test(lower)) {
    return { code: "RPC_UNAVAILABLE", message: APP_MESSAGES.RPC_UNAVAILABLE, raw };
  }
  return { code: "UNKNOWN", message: APP_MESSAGES.UNKNOWN, raw };
}
