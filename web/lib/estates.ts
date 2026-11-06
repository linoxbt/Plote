import { ESTATES, ROOT_ACCOUNT } from "./config";

const ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
export const UNIT_ID_RE = /^[a-z0-9-]{1,16}$/;

export function isValidAccountId(id: string): boolean {
  return id.length >= 2 && id.length <= 64 && ACCOUNT_RE.test(id);
}

/** `harmattan-court.plote.testnet` → `harmattan-court` */
export function estateSlug(account: string): string {
  return account.split(".")[0] ?? account;
}

/** Resolve a URL slug (`harmattan-court`) or full account to the estate account. */
export function estateAccount(slugOrAccount: string): string {
  const s = decodeURIComponent(slugOrAccount).trim().toLowerCase();
  if (s.includes(".")) return s;
  const known = ESTATES.find((a) => estateSlug(a) === s);
  if (known) return known;
  return ROOT_ACCOUNT ? `${s}.${ROOT_ACCOUNT}` : s;
}

export function unitAccount(estate: string, unitId: string): string {
  return `${unitId}.${estate}`;
}

const ESTATE_PATH = /^\/(?:estates|buy|me\/units|dev\/estates|qs|w|gate|proof)\/([a-z0-9-]+(?:\.[a-z0-9-]+)*)/;

/**
 * The estate contract the sign-in login key is for (SPEC §9.1): the estate in the URL path
 * (`/estates/harmattan-court/…`, `/buy/…`, `/qs/…`), else the first configured estate, else null.
 */
export function loginKeyContract(pathname: string): string | null {
  const m = ESTATE_PATH.exec(pathname);
  if (m && m[1] !== "new" && m[1] !== "setup") return estateAccount(m[1]);
  return ESTATES[0] ?? null;
}

export function isKnownEstate(account: string): boolean {
  return ESTATES.includes(account);
}

export type UnitRef = { estate: string; unit: string };

/**
 * Parse what someone typed into /check: `a-4b`, `A-4B`, `a-4b.harmattan-court`,
 * `a-4b.harmattan-court.plote.testnet`, or a pasted Plote URL.
 * Returns null when it can't be read as a unit at all.
 */
export function parseUnitQuery(input: string, defaultEstate?: string): UnitRef | null {
  let q = input.trim().toLowerCase();
  if (!q) return null;
  // URLs: /estates/<e>/units/<u>, /w/<e>/<u>, /buy/<e>/<u>, /me/units/<e>/<u>
  if (/^https?:\/\//.test(q) || q.startsWith("/")) {
    try {
      const url = new URL(q, "https://x.invalid");
      const parts = url.pathname.split("/").filter(Boolean);
      const uParam = url.searchParams.get("u");
      if (uParam) return parseUnitQuery(uParam, defaultEstate);
      const i = parts.indexOf("units");
      if (parts[0] === "estates" && i === 2 && parts[3]) return { estate: estateAccount(parts[1]), unit: parts[3] };
      if ((parts[0] === "w" || parts[0] === "buy") && parts[1] && parts[2]) return { estate: estateAccount(parts[1]), unit: parts[2] };
      if (parts[0] === "me" && parts[1] === "units" && parts[2] && parts[3]) return { estate: estateAccount(parts[2]), unit: parts[3] };
      return null;
    } catch {
      return null;
    }
  }
  q = q.replace(/\s+/g, "");
  const dot = q.indexOf(".");
  if (dot === -1) {
    if (!UNIT_ID_RE.test(q)) return null;
    const estate = defaultEstate ?? ESTATES[0];
    return estate ? { estate, unit: q } : null;
  }
  const unit = q.slice(0, dot);
  const rest = q.slice(dot + 1);
  if (!UNIT_ID_RE.test(unit)) return null;
  // `a-4b.harmattan-court` (slug) or full estate account
  return { estate: estateAccount(rest), unit };
}
