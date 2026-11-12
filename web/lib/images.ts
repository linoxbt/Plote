// Evidence photos are full-size originals in Supabase Storage (the bytes whose SHA-256 is on-chain). Thumbnails go
// through Next's image optimiser, which next.config.ts allows only for this deployment's Supabase public bucket
// path; any other URL (a surveyor can submit any https URL) is shown as a plain lazy <img>, never through the optimiser.

// Read directly (not via ./config) so next.config.ts can import this file without evaluating the app config.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || undefined;

export const SUPABASE_PUBLIC_PATH = "/storage/v1/object/public/";

/** The `images.remotePatterns` entry for a Supabase project URL, or null when it isn't a usable https URL. */
export function supabaseImagePattern(supabaseUrl: string | undefined | null): { protocol: "https"; hostname: string; pathname: string } | null {
  if (!supabaseUrl) return null;
  try {
    const u = new URL(supabaseUrl);
    if (u.protocol !== "https:") return null;
    return { protocol: "https", hostname: u.hostname, pathname: `${SUPABASE_PUBLIC_PATH}**` };
  } catch {
    return null;
  }
}

/** True when `url` is a public object of this deployment's Supabase project (so next/image may optimise it). */
export function isOptimizableImage(url: string, supabaseUrl: string | undefined | null = SUPABASE_URL): boolean {
  const p = supabaseImagePattern(supabaseUrl);
  if (!p) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === p.hostname && u.pathname.startsWith(SUPABASE_PUBLIC_PATH);
  } catch {
    return false;
  }
}
