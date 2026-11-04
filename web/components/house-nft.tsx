"use client";

import { useMemo } from "react";
import { houseSvgDataUri, type HouseSvgInput } from "@/lib/svg-house";

/** Renders the same SVG the contract produces, client-side, for instant preview. */
export function HouseNFT({ className, media, ...input }: HouseSvgInput & { className?: string; media?: string | null }) {
  const src = useMemo(
    () => media || houseSvgDataUri(input),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [media, input.estateName, input.unitLabel, input.unitId, input.approvedCount, input.total, input.status, input.paid, input.price],
  );
  return (
    <img
      src={src}
      alt={`${input.estateName} ${input.unitLabel}: ${input.approvedCount} of ${input.total} milestones approved, status ${input.status}`}
      className={className ?? "aspect-[300/330] w-full"}
      width={300}
      height={330}
    />
  );
}
