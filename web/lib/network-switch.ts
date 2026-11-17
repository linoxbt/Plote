/**
 * The header's Testnet / Mainnet switch. Pages that exist and make sense on both networks keep their path; anything
 * tied to a testnet estate or a wallet's own units goes to the other network's landing page instead.
 */
const SHARED_PATHS = ["/", "/estates", "/check", "/pay", "/how-it-works", "/nft", "/verification", "/payments", "/builders", "/surveyors", "/security", "/faq", "/status", "/terms", "/privacy"];

export function switchPath(path: string): string {
  return SHARED_PATHS.includes(path) ? path : "/";
}

/** `otherUrl` is the other network's app URL (e.g. https://plote-vert.vercel.app/mainnet); `path` excludes this build's base path. */
export function switchTarget(otherUrl: string, path: string): string {
  const p = switchPath(path);
  return `${otherUrl.replace(/\/$/, "")}${p === "/" ? "" : p}` || "/";
}
