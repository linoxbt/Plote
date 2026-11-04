"use client";

import { metersPerPx, worldPx, zoomFor } from "@/lib/geo";

/** Static OpenStreetMap tiles + geofence circle + photo pin. No API key. */
export function StaticMap({ center, radiusM, pin, pinLabel }: { center: [number, number]; radiusM: number; pin?: [number, number] | null; pinLabel?: string }) {
  const z = zoomFor(center[0], radiusM || 300);
  const [cx, cy] = worldPx(center[0], center[1], z);
  const W = 512;
  const x0 = cx - W / 2;
  const y0 = cy - W / 2;
  const tiles: { x: number; y: number }[] = [];
  const max = 2 ** z;
  for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x0 + W) / 256); tx++)
    for (let ty = Math.floor(y0 / 256); ty <= Math.floor((y0 + W) / 256); ty++) if (ty >= 0 && ty < max) tiles.push({ x: tx, y: ty });
  const r = radiusM / metersPerPx(center[0], z);
  const p = pin ? worldPx(pin[0], pin[1], z) : null;
  return (
    <figure className="corners relative overflow-hidden bg-surface-2">
      <svg viewBox={`${x0} ${y0} ${W} ${W}`} className="block aspect-square w-full" role="img" aria-label={`Map: site boundary of ${radiusM} m${pin ? ", with the photo location pinned" : ""}`}>
        {tiles.map((t) => (
          <image key={`${t.x}-${t.y}`} href={`https://tile.openstreetmap.org/${z}/${((t.x % max) + max) % max}/${t.y}.png`} x={t.x * 256} y={t.y * 256} width={256} height={256} style={{ filter: "invert(0.92) hue-rotate(180deg) saturate(0.4) brightness(0.9)" }} />
        ))}
        {radiusM > 0 ? <circle cx={cx} cy={cy} r={r} fill="rgba(45,212,191,0.12)" stroke="#2DD4BF" strokeWidth={2} strokeDasharray="6 4" /> : null}
        <circle cx={cx} cy={cy} r={3} fill="#2DD4BF" />
        {p ? (
          <g>
            <circle cx={p[0]} cy={p[1]} r={8} fill="#E8B04B" stroke="#0A0B0D" strokeWidth={2} />
            {pinLabel ? <text x={p[0] + 12} y={p[1] + 4} fill="#E8B04B" fontSize={14} fontFamily="monospace">{pinLabel}</text> : null}
          </g>
        ) : null}
      </svg>
      <figcaption className="mono absolute bottom-0 right-0 bg-bg/80 px-1 text-[10px] text-muted">
        © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline">OpenStreetMap</a> contributors
      </figcaption>
    </figure>
  );
}
