"use client";

// Click-to-pick location map (SPEC §13.6 "location pin + geofence radius"). Same OpenStreetMap tile approach as
// StaticMap — plain <image> tiles in an SVG, no API key, no map library. Drag to pan, click to drop the pin,
// +/− to zoom (no wheel zoom, so the page still scrolls). The numeric lat/lon inputs next to it stay the keyboard / exact-entry fallback.

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Crosshair, Minus, Plus } from "lucide-react";
import { fromWorldPx, metersPerPx, worldPx, zoomFor } from "@/lib/geo";

const W = 512;
const TILE = 256;

export function PickMap({ lat, lon, radiusM, onPick }: { lat: number; lon: number; radiusM: number; onPick: (lat: number, lon: number) => void }) {
  const valid = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 85 && Math.abs(lon) <= 180;
  const pin: [number, number] = valid ? [lat, lon] : [6.447, 3.474];
  const [z, setZ] = useState(() => Math.min(17, zoomFor(pin[0], radiusM || 300, 90)));
  const [center, setCenter] = useState<[number, number]>(pin);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const [cx, cy] = worldPx(center[0], center[1], z);
  const x0 = cx - W / 2;
  const y0 = cy - W / 2;
  const max = 2 ** z;
  const tiles: { x: number; y: number }[] = [];
  for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x0 + W) / TILE); tx++)
    for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y0 + W) / TILE); ty++) if (ty >= 0 && ty < max) tiles.push({ x: tx, y: ty });
  const [px, py] = worldPx(pin[0], pin[1], z);
  const r = radiusM > 0 ? radiusM / metersPerPx(pin[0], z) : 0;

  /** Client coordinates → world pixels at the current zoom. */
  const toWorld = (clientX: number, clientY: number): [number, number] | null => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return null;
    const k = W / rect.width;
    return [x0 + (clientX - rect.left) * k, y0 + (clientY - rect.top) * k];
  };

  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    drag.current = { x: e.clientX, y: e.clientY, cx, cy, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const rect = svgRef.current?.getBoundingClientRect();
    const k = rect?.width ? W / rect.width : 1;
    const dx = (e.clientX - d.x) * k;
    const dy = (e.clientY - d.y) * k;
    if (Math.abs(dx) + Math.abs(dy) > 6) d.moved = true;
    if (d.moved) setCenter(fromWorldPx(d.cx - dx, d.cy - dy, z));
  };
  const onUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    const w = toWorld(e.clientX, e.clientY);
    if (!w) return;
    const [la, lo] = fromWorldPx(w[0], w[1], z);
    onPick(Math.round(la * 1e6) / 1e6, Math.round((((lo + 540) % 360) - 180) * 1e6) / 1e6);
  };
  const zoom = (dz: number) => setZ((v) => Math.max(3, Math.min(19, v + dz)));

  return (
    <figure className="corners relative overflow-hidden bg-surface-2">
      <svg
        ref={svgRef}
        viewBox={`${x0} ${y0} ${W} ${W}`}
        className="block aspect-square w-full cursor-crosshair touch-none select-none"
        role="img"
        aria-label={`Map for picking the site location. Click to drop the pin; the pin is at ${pin[0].toFixed(5)}, ${pin[1].toFixed(5)}${radiusM > 0 ? ` with a ${radiusM} m geofence` : ""}. You can also type the coordinates.`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        {tiles.map((t) => (
          <image key={`${z}-${t.x}-${t.y}`} href={`https://tile.openstreetmap.org/${z}/${((t.x % max) + max) % max}/${t.y}.png`} x={t.x * TILE} y={t.y * TILE} width={TILE} height={TILE} style={{ filter: "invert(0.92) hue-rotate(180deg) saturate(0.4) brightness(0.9)" }} />
        ))}
        {r > 0 ? <circle cx={px} cy={py} r={r} fill="rgba(45,212,191,0.12)" stroke="#2DD4BF" strokeWidth={2} strokeDasharray="6 4" /> : null}
        <circle cx={px} cy={py} r={7} fill="#E8B04B" stroke="#0A0B0D" strokeWidth={2} />
      </svg>
      <div className="absolute right-2 top-2 flex flex-col gap-1">
        <button type="button" className="btn btn-ghost corners btn-sm min-w-11 bg-bg/80 px-2" onClick={() => zoom(1)} aria-label="Zoom in"><Plus className="h-4 w-4" aria-hidden /></button>
        <button type="button" className="btn btn-ghost corners btn-sm min-w-11 bg-bg/80 px-2" onClick={() => zoom(-1)} aria-label="Zoom out"><Minus className="h-4 w-4" aria-hidden /></button>
        <button type="button" className="btn btn-ghost corners btn-sm min-w-11 bg-bg/80 px-2" onClick={() => setCenter(pin)} aria-label="Centre the map on the pin"><Crosshair className="h-4 w-4" aria-hidden /></button>
      </div>
      <figcaption className="mono absolute bottom-0 right-0 bg-bg/80 px-1 text-[10px] text-muted">
        © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline">OpenStreetMap</a> contributors
      </figcaption>
    </figure>
  );
}
