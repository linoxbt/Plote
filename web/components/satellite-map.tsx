"use client";

// Google satellite view of a site with Plote's own overlays on top: the geofence circle, the site pin and optional
// points (photo EXIF GPS, phone GPS, "you are here"). The Google iframe is purely visual (no pointer events, not
// focusable) so the overlay stays aligned with it; the overlay is computed with Web Mercator math from the centre,
// zoom and the box size (lib/satellite.ts) and recomputed on resize. Loaded only when scrolled into view.

import { useEffect, useRef, useState } from "react";
import { ExternalLink, MapPinOff } from "lucide-react";
import { clsx } from "clsx";
import { fitZoom, googleMapsLinks, hasSite, isValidLatLon, offsetPx, radiusPx, satelliteEmbedUrl, type LatLon } from "@/lib/satellite";

export type MapPoint = { at: LatLon; label: string; kind: "photo" | "device" | "you" | "other" };

const KIND: Record<MapPoint["kind"], { fill: string; ring: string }> = {
  photo: { fill: "#ff7a00", ring: "#ffffff" },
  device: { fill: "#0b6fa4", ring: "#ffffff" },
  you: { fill: "#0e7a52", ring: "#ffffff" },
  other: { fill: "#ffffff", ring: "#0b1220" },
};

function fmt(n: number) {
  return n.toFixed(6);
}

/** `value` after it has stopped changing for `ms` (typing coordinates shouldn't reload the iframe per keystroke). */
function useSettled<T>(value: T, ms = 400): T {
  const [v, setV] = useState(value);
  const key = JSON.stringify(value);
  useEffect(() => {
    const t = setTimeout(() => setV(JSON.parse(key) as T), ms);
    return () => clearTimeout(t);
  }, [key, ms]);
  return v;
}

export function SatelliteMap({
  center: liveCenter, radiusM: liveRadius = 0, points = [], centerLabel = "Site", caption, className, aspect = "16 / 10", showCenterPin = true,
}: {
  center: LatLon;
  radiusM?: number;
  points?: MapPoint[];
  centerLabel?: string;
  caption?: React.ReactNode;
  className?: string;
  aspect?: string;
  showCenterPin?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  // Browsers without IntersectionObserver just load it.
  const [inView, setInView] = useState(() => typeof window !== "undefined" && typeof IntersectionObserver === "undefined");

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    const io = typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) setInView(true); }, { rootMargin: "200px" })
      : null;
    io?.observe(el);
    return () => {
      ro?.disconnect();
      io?.disconnect();
    };
  }, []);

  const center = useSettled(liveCenter);
  const radiusM = useSettled(liveRadius);
  const zoom = fitZoom(center, radiusM, size.w, size.h, points.map((p) => p.at));
  const cx = size.w / 2;
  const cy = size.h / 2;
  const r = radiusM > 0 ? radiusPx(radiusM, center[0], zoom) : 0;
  const links = googleMapsLinks(center, Math.max(400, radiusM * 4));
  const legend = [
    ...(showCenterPin ? [{ label: centerLabel, fill: "#e11d2a", ring: "#ffffff" }] : []),
    ...(radiusM > 0 ? [{ label: `Geofence ${radiusM} m`, fill: "transparent", ring: "#ff7a00" }] : []),
    ...points.map((p) => ({ label: p.label, ...KIND[p.kind] })),
  ];

  return (
    <figure className={clsx("space-y-2", className)}>
      <div ref={box} className="relative w-full overflow-hidden rounded-xl bg-surface-2 ring-1 ring-line" style={{ aspectRatio: aspect }}>
        {inView && size.w > 0 ? (
          <iframe
            key={`${zoom}`}
            src={satelliteEmbedUrl(center, zoom)}
            title={`Satellite view of ${centerLabel.toLowerCase()} at ${fmt(center[0])}, ${fmt(center[1])}`}
            className="pointer-events-none absolute inset-0 h-full w-full border-0"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            sandbox="allow-scripts allow-same-origin allow-popups"
            tabIndex={-1}
            aria-hidden
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted">Loading satellite view…</div>
        )}
        {size.w > 0 ? (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${size.w} ${size.h}`} role="img" aria-label={`${centerLabel}${radiusM > 0 ? ` with a ${radiusM} m geofence` : ""}${points.length ? `, ${points.map((p) => p.label).join(", ")}` : ""}`}>
            {r > 0 ? <circle cx={cx} cy={cy} r={r} fill="rgba(255,122,0,0.16)" stroke="#ff7a00" strokeWidth={2.5} strokeDasharray="7 5" /> : null}
            {showCenterPin ? <circle cx={cx} cy={cy} r={4} fill="#e11d2a" stroke="#ffffff" strokeWidth={2} /> : null}
            {points.map((p, i) => {
              const [dx, dy] = offsetPx(center, p.at, zoom);
              const x = Math.max(8, Math.min(size.w - 8, cx + dx));
              const y = Math.max(8, Math.min(size.h - 8, cy + dy));
              const k = KIND[p.kind];
              return (
                <g key={i}>
                  <circle cx={x} cy={y} r={8} fill={k.fill} stroke={k.ring} strokeWidth={2.5} />
                  <text x={x + 12} y={y + 4} fontSize={12} fontFamily="ui-monospace, monospace" fill="#ffffff" stroke="#0b1220" strokeWidth={3} paintOrder="stroke">{p.label}</text>
                </g>
              );
            })}
          </svg>
        ) : null}
        <a href={links.satellite} target="_blank" rel="noreferrer" className="absolute right-2 top-2 inline-flex min-h-9 items-center gap-1 rounded-full bg-white/95 px-3 text-xs font-medium text-[#0b1220] shadow ring-1 ring-black/10 hover:bg-white">
          Open in Google Maps <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
      </div>
      <figcaption className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted">
        <ul className="flex flex-wrap gap-x-3 gap-y-1">
          {legend.map((l) => (
            <li key={l.label} className="inline-flex items-center gap-1.5">
              <svg width="12" height="12" aria-hidden><circle cx="6" cy="6" r="4.5" fill={l.fill} stroke={l.ring} strokeWidth={2} strokeDasharray={l.fill === "transparent" ? "3 2" : undefined} /></svg>
              {l.label}
            </li>
          ))}
        </ul>
        <span className="mono">
          {fmt(center[0])}, {fmt(center[1])} · <a className="underline hover:text-orange-ink" href={links.search} target="_blank" rel="noreferrer">pin ↗</a>
        </span>
      </figcaption>
      {caption ? <div className="text-xs text-muted">{caption}</div> : null}
    </figure>
  );
}

/** The playground has no site: say so instead of showing the ocean at 0,0. */
export function NoFenceNote({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <p className={clsx("flex items-start gap-2 rounded-xl bg-surface-2 p-3 text-sm text-muted ring-1 ring-line", className)}>
      <MapPinOff className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden />
      <span>{children ?? "No location fence on the playground — photos can be taken anywhere."}</span>
    </p>
  );
}

/**
 * An estate's site (geofence centre + radius) on a satellite view, with optional extra points. Without a site (the
 * playground: radius 0 at 0,0) it says so, and still maps any known point (e.g. a proof photo's GPS) on its own.
 */
export function EstateSiteMap({
  geofence, points = [], aspect, caption, noFence,
}: {
  geofence: { lat_e6: number; lon_e6: number; radius_m: number };
  points?: MapPoint[];
  aspect?: string;
  caption?: React.ReactNode;
  noFence?: React.ReactNode;
}) {
  const valid = points.filter((p) => isValidLatLon(p.at));
  if (!hasSite(geofence.lat_e6, geofence.lon_e6) || geofence.radius_m <= 0) {
    const [first, ...rest] = valid;
    return (
      <div className="space-y-3">
        <NoFenceNote>{noFence}</NoFenceNote>
        {first ? <SatelliteMap center={first.at} centerLabel={first.label} points={rest} aspect={aspect} caption={caption} /> : null}
      </div>
    );
  }
  return <SatelliteMap center={[geofence.lat_e6 / 1e6, geofence.lon_e6 / 1e6]} radiusM={geofence.radius_m} points={valid} aspect={aspect} caption={caption} />;
}
