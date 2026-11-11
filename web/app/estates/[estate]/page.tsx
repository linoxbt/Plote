import type { Metadata } from "next";
import { APP_URL } from "@/lib/config";
import { estate as E } from "@/lib/estate";
import { estateAccount, estateSlug } from "@/lib/estates";
import { EstateClient } from "./estate-client";

type P = { params: Promise<{ estate: string }> };

const titleCase = (slug: string) => slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** The estate's on-chain name when the RPC answers quickly; the title-cased slug otherwise (never blocks the page for long). */
async function estateName(slug: string): Promise<{ name: string; location: string | null }> {
  const fallback = { name: titleCase(estateSlug(estateAccount(slug))), location: null };
  try {
    const e = await Promise.race([E.getEstate(estateAccount(slug)), new Promise<null>((r) => setTimeout(() => r(null), 2500))]);
    return e?.name ? { name: e.name, location: e.location || null } : fallback;
  } catch {
    return fallback;
  }
}

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { estate } = await params;
  const { name, location } = await estateName(decodeURIComponent(estate));
  const description = `${name}${location ? `, ${location}` : ""}: every unit's escrow, payments and construction proofs on Plote, read live from the chain.`;
  const url = `${APP_URL}/estates/${estateSlug(estateAccount(estate))}`;
  return { title: name, description, alternates: { canonical: url }, openGraph: { title: `${name} · Plote`, description, url, type: "website" } };
}

export default async function EstatePage({ params }: P) {
  const { estate } = await params;
  return <EstateClient slug={estate} />;
}
