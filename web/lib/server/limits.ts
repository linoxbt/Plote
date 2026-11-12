// Rate-limit tables for routes that act for anyone on a playground estate (any account may be the surveyor there).
// Each entry is [key, limit, windowMs], counted with rateLimitShared after the caller is authenticated.
// Every "all" bucket is per estate, so traffic on the public playground can never use up a real estate's quota.

export type Limit = [key: string, limit: number, windowMs: number];

export const HOUR_MS = 3600_000;

/** /api/evidence/upload-url: 20/min per account; playground adds 5/hour per account and 50/hour per playground estate. */
export function uploadLimits(accountId: string, playground: boolean, estate = "?"): Limit[] {
  const base: Limit[] = [[`upload:${accountId}`, 20, 60_000]];
  return playground ? [...base, [`upload-pg:${estate}:${accountId}`, 5, HOUR_MS], [`upload-pg:${estate}:all`, 50, HOUR_MS]] : base;
}

/** Playground-only methods with an hourly cap on /api/relay (a capture is open_capture + submit_evidence; then qs_sign). */
export const PLAYGROUND_CAPPED_METHODS = ["open_capture", "submit_evidence", "qs_sign"];

/** Relayed calls per minute across all senders of one estate (a playground estate gets a smaller share). */
export const RELAY_ESTATE_PER_MIN = 300;
export const RELAY_PLAYGROUND_PER_MIN = 60;

/**
 * /api/relay: per sender (10/min), per IP (30/min) and per estate (300/min; 60/min on a playground). Playground capture
 * and sign calls add 10/hour per sender and 100/hour per playground estate.
 */
export function relayLimits(senderId: string, ip: string, estate: string, playground: boolean, methods: string[]): Limit[] {
  const base: Limit[] = [
    [`relay:${senderId}`, 10, 60_000],
    [`relay-ip:${ip}`, 30, 60_000],
    [`relay-estate:${estate}`, playground ? RELAY_PLAYGROUND_PER_MIN : RELAY_ESTATE_PER_MIN, 60_000],
  ];
  if (!playground || !methods.some((m) => PLAYGROUND_CAPPED_METHODS.includes(m))) return base;
  return [...base, [`relay-pg:${estate}:${senderId}`, 10, HOUR_MS], [`relay-pg:${estate}:all`, 100, HOUR_MS]];
}
