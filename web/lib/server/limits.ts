// Rate-limit tables for routes that act for anyone on a playground estate (any account may be the surveyor there).
// Each entry is [key, limit, windowMs], counted with rateLimitShared after the caller is authenticated.
// Every "all" bucket is per estate, so traffic on the public playground can never use up a real estate's quota.
// On a playground, throwaway accounts are free, so the hourly caps are also per IP and per network prefix (/24 for
// IPv4, /48 for IPv6): a handful of accounts behind one address or one hosting range can't use up the estate-wide
// backstop and lock judges out.

export type Limit = [key: string, limit: number, windowMs: number];

export const HOUR_MS = 3600_000;

/** The caller's network bucket: the /24 of an IPv4 address, the /48 of an IPv6 one, else the value itself. */
export function ipPrefix(ip: string): string {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(ip.trim());
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  const s = ip.trim().toLowerCase();
  if (s.includes(":")) {
    const [head] = s.split("::");
    const groups = head.split(":").filter(Boolean);
    return `${groups.slice(0, 3).join(":")}::/48`;
  }
  return s || "unknown";
}

/** Playground caps per hour (per account / per IP / per network prefix / whole estate). */
export const PG_UPLOAD = { account: 5, ip: 10, net: 20, estate: 300 } as const;
export const PG_RELAY = { account: 10, ip: 20, net: 40, estate: 600 } as const;

/** /api/evidence/upload-url: 20/min per account; a playground adds the hourly PG_UPLOAD caps. */
export function uploadLimits(accountId: string, playground: boolean, estate = "?", ip = "unknown"): Limit[] {
  const base: Limit[] = [[`upload:${accountId}`, 20, 60_000]];
  if (!playground) return base;
  return [
    ...base,
    [`upload-pg:${estate}:${accountId}`, PG_UPLOAD.account, HOUR_MS],
    [`upload-pg-ip:${estate}:${ip}`, PG_UPLOAD.ip, HOUR_MS],
    [`upload-pg-net:${estate}:${ipPrefix(ip)}`, PG_UPLOAD.net, HOUR_MS],
    [`upload-pg:${estate}:all`, PG_UPLOAD.estate, HOUR_MS],
  ];
}

/** Playground-only methods with an hourly cap on /api/relay (a capture is open_capture + submit_evidence; then qs_sign). */
export const PLAYGROUND_CAPPED_METHODS = ["open_capture", "submit_evidence", "qs_sign"];

/** Relayed calls per minute across all senders of one estate (a playground estate gets a smaller share). */
export const RELAY_ESTATE_PER_MIN = 300;
export const RELAY_PLAYGROUND_PER_MIN = 60;

/**
 * /api/relay: per sender (10/min), per IP (30/min) and per estate (300/min; 60/min on a playground). Playground capture
 * and sign calls add the hourly PG_RELAY caps.
 */
export function relayLimits(senderId: string, ip: string, estate: string, playground: boolean, methods: string[]): Limit[] {
  const base: Limit[] = [
    [`relay:${senderId}`, 10, 60_000],
    [`relay-ip:${ip}`, 30, 60_000],
    [`relay-estate:${estate}`, playground ? RELAY_PLAYGROUND_PER_MIN : RELAY_ESTATE_PER_MIN, 60_000],
  ];
  if (!playground || !methods.some((m) => PLAYGROUND_CAPPED_METHODS.includes(m))) return base;
  return [
    ...base,
    [`relay-pg:${estate}:${senderId}`, PG_RELAY.account, HOUR_MS],
    [`relay-pg-ip:${estate}:${ip}`, PG_RELAY.ip, HOUR_MS],
    [`relay-pg-net:${estate}:${ipPrefix(ip)}`, PG_RELAY.net, HOUR_MS],
    [`relay-pg:${estate}:all`, PG_RELAY.estate, HOUR_MS],
  ];
}
