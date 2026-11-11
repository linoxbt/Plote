// Rate-limit tables for routes that act for anyone on a playground estate (any account may be the surveyor there).
// Each entry is [key, limit, windowMs], counted with rateLimitShared after the caller is authenticated.

export type Limit = [key: string, limit: number, windowMs: number];

export const HOUR_MS = 3600_000;

/** /api/evidence/upload-url: 20/min per account; playground adds 5/hour per account and 50/hour in total. */
export function uploadLimits(accountId: string, playground: boolean): Limit[] {
  const base: Limit[] = [[`upload:${accountId}`, 20, 60_000]];
  return playground ? [...base, [`upload-pg:${accountId}`, 5, HOUR_MS], ["upload-pg:all", 50, HOUR_MS]] : base;
}

/** Playground-only methods with an hourly cap on /api/relay (a capture is open_capture + submit_evidence). */
export const PLAYGROUND_CAPPED_METHODS = ["open_capture", "submit_evidence"];

/** /api/relay: per sender, per IP and global per minute; playground capture calls add 10/hour per sender and 100/hour in total. */
export function relayLimits(senderId: string, ip: string, playground: boolean, methods: string[]): Limit[] {
  const base: Limit[] = [[`relay:${senderId}`, 10, 60_000], [`relay-ip:${ip}`, 30, 60_000], ["relay:all", 300, 60_000]];
  if (!playground || !methods.some((m) => PLAYGROUND_CAPPED_METHODS.includes(m))) return base;
  return [...base, [`relay-pg:${senderId}`, 10, HOUR_MS], ["relay-pg:all", 100, HOUR_MS]];
}
