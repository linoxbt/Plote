"use client";

import { houseSvg, houseSvgDataUri, type HouseSvgInput } from "@/lib/svg-house";

/**
 * Renders the same SVG the contract produces, client-side, for instant preview.
 * `animated` draws it inline so parts fade between stages (the markup is built locally with escaped text).
 */
export function HouseNFT({ className, media, animated, ...input }: HouseSvgInput & { className?: string; media?: string | null; animated?: boolean }) {
  // Both are a few hundred bytes of string building; cheap enough to do on every render.
  const svg = animated && !media ? houseSvg(input) : "";
  const src = svg ? "" : media || houseSvgDataUri(input);
  const alt = `${input.estateName} ${input.unitLabel}: ${input.approvedCount} of ${input.total} milestones approved, status ${input.status}`;
  if (svg) {
    return <div role="img" aria-label={alt} className={`nft-anim [&>svg]:h-full [&>svg]:w-full ${className ?? "aspect-[300/330] w-full"}`} dangerouslySetInnerHTML={{ __html: svg }} />;
  }
  return <img src={src} alt={alt} className={className ?? "aspect-[300/330] w-full"} width={300} height={330} />;
}
