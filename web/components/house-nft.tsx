"use client";

import { houseSvg, houseSvgDataUri, type HouseSvgInput } from "@/lib/svg-house";
import { dataUriSvgSize, svgSize } from "@/lib/svg-size";

/** The contract's on-chain media is a square 400×400 SVG; used when a media URL can't be inspected. */
const MEDIA_FALLBACK: [number, number] = [400, 400];

/** The local drawing without its "$paid / $price" text (the only <text> holding a "$ / $" pair). */
function withoutMoney(svg: string): string {
  return svg.replace(/<text\b[^>]*>[^<]*\$[^<]*\/[^<]*\$[^<]*<\/text>/g, "");
}

/**
 * Renders the token image: the on-chain `media` when the caller has it (at its true aspect), else the same SVG the
 * contract produces, drawn client-side for an instant preview. `animated` draws it inline so parts fade between stages
 * (the markup is built locally with escaped text). Pass a className with an `aspect-…` class to crop instead.
 */
export function HouseNFT({ className, media, animated, showMoney = true, ...input }: HouseSvgInput & { className?: string; media?: string | null; animated?: boolean; showMoney?: boolean }) {
  // Both are a few hundred bytes of string building; cheap enough to do on every render.
  // `showMoney={false}` (previews with no real unit price) drops the "$paid / $price" line rather than draw "$0 / $0".
  const draw = (x: HouseSvgInput) => (showMoney ? houseSvg(x) : withoutMoney(houseSvg(x)));
  const svg = animated && !media ? draw(input) : "";
  const local = media ? null : draw(input);
  const src = svg ? "" : media || (showMoney ? houseSvgDataUri(input) : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(local ?? "")}`);
  const [w, h] = (media ? dataUriSvgSize(media) ?? MEDIA_FALLBACK : svgSize(svg || local || "")) ?? [300, 330];
  const cropped = !!className && /\baspect-/.test(className);
  const style = cropped ? undefined : { aspectRatio: `${w} / ${h}` };
  const cls = className ?? "w-full";
  const alt = `${input.estateName} ${input.unitLabel}: ${input.approvedCount} of ${input.total} milestones approved, status ${input.status}`;
  if (svg) {
    return <div role="img" aria-label={alt} className={`nft-anim [&>svg]:h-full [&>svg]:w-full ${cls}`} style={style} dangerouslySetInnerHTML={{ __html: svg }} />;
  }
  return <img src={src} alt={alt} className={cls} style={style} width={w} height={h} />;
}
