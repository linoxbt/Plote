// Is this account a genuine Plote estate? Anyone can deploy a contract that answers `is_taken` / `get_unit` like an
// estate (e.g. `scam.testnet` reporting "available" and a unit account it controls), so the app only treats an
// account as an estate when it is
//   - one of the configured estates (NEXT_PUBLIC_ESTATES), or
//   - a direct subaccount of ROOT_ACCOUNT (`<name>.plote.testnet`) whose on-chain code hash (`view_account`) is one of
//     the published estate code hashes (NEXT_PUBLIC_ESTATE_CODE_HASHES, comma-separated base58).
// Money paths also check that the unit account is exactly `<unit id>.<estate>`, which only the estate can create.

import { ESTATES, ROOT_ACCOUNT } from "./config";
import { PloteError } from "./errors";
import { viewAccount } from "./near";

/** The reproducible build of affdf57 (README "Reproducible build"). New hashes are appended after an upgrade. */
const DEFAULT_ESTATE_CODE_HASHES = "J31YPbxD3kVvoezwLtMkiMW4FE52r51rRPbamEg9beNX";

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,64}$/;

export function parseCodeHashes(raw: string | undefined | null): string[] {
  return Array.from(new Set((raw ?? "").split(",").map((s) => s.trim()).filter((s) => BASE58_RE.test(s))));
}

/** Published estate code hashes. NEXT_PUBLIC_* must be read literally so Next inlines it. */
export const ESTATE_CODE_HASHES: string[] = (() => {
  const fromEnv = parseCodeHashes(process.env.NEXT_PUBLIC_ESTATE_CODE_HASHES);
  return fromEnv.length ? fromEnv : parseCodeHashes(DEFAULT_ESTATE_CODE_HASHES);
})();

/** `x.plote.testnet` is a direct subaccount of `plote.testnet`; `a.x.plote.testnet` and `x.scam.testnet` are not. */
export function isDirectSubaccount(account: string, root: string): boolean {
  if (!root || !account.endsWith(`.${root}`)) return false;
  const label = account.slice(0, -(root.length + 1));
  return /^[a-z0-9]+([-_][a-z0-9]+)*$/.test(label);
}

export type Genuineness = { genuine: true; how: "configured" | "code_hash" } | { genuine: false; why: string };

export type GenuineDeps = {
  estates?: string[];
  root?: string;
  hashes?: string[];
  codeHashOf?: (account: string) => Promise<string | null>;
};

const cache = new Map<string, { at: number; p: Promise<Genuineness> }>();
const TTL_MS = 5 * 60_000;

export async function checkEstate(account: string, deps: GenuineDeps = {}): Promise<Genuineness> {
  const estates = deps.estates ?? ESTATES;
  const root = deps.root ?? ROOT_ACCOUNT;
  const hashes = deps.hashes ?? ESTATE_CODE_HASHES;
  const a = account.trim().toLowerCase();
  if (estates.includes(a)) return { genuine: true, how: "configured" };
  if (!isDirectSubaccount(a, root)) {
    return { genuine: false, why: root ? `${a} isn't one of Plote's estates (they live directly under ${root}).` : `${a} isn't one of this site's estates.` };
  }
  const codeHashOf = deps.codeHashOf ?? (async (x: string) => (await viewAccount(x))?.code_hash ?? null);
  const hash = await codeHashOf(a);
  if (!hash || hash === "11111111111111111111111111111111") return { genuine: false, why: `${a} has no contract deployed.` };
  if (!hashes.includes(hash)) return { genuine: false, why: `${a} runs code (hash ${hash.slice(0, 8)}…) that isn't a published Plote estate build.` };
  return { genuine: true, how: "code_hash" };
}

/** Cached `checkEstate` (5 min; failures aren't cached). */
export function isGenuineEstate(account: string): Promise<Genuineness> {
  const key = account.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.p;
  const p = checkEstate(key);
  cache.set(key, { at: Date.now(), p });
  p.catch(() => cache.delete(key));
  return p;
}

/** The only account a genuine estate creates for unit `id`. */
export function expectedUnitAccount(estate: string, unitId: string): string {
  return `${unitId}.${estate}`;
}

/**
 * Before any money moves to a unit or an estate: the estate must be genuine and the unit account must be the one the
 * estate created for that id. Throws a PloteError (code NOT_PLOTE) with a plain explanation otherwise.
 */
export async function assertPayable(estate: string, u: { id: string; account: string }, deps?: GenuineDeps): Promise<void> {
  const g = deps ? await checkEstate(estate, deps) : await isGenuineEstate(estate);
  if (!g.genuine) throw new PloteError("NOT_PLOTE", g.why, `Payment stopped: ${g.why} Plote never sends money to an estate it can't verify.`);
  const want = expectedUnitAccount(estate, u.id);
  if (u.account !== want) {
    throw new PloteError("NOT_PLOTE", `unit account ${u.account} != ${want}`, `Payment stopped: the estate reported ${u.account} as the unit's account, but a Plote unit's account is always ${want}.`);
  }
}
