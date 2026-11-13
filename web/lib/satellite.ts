// Google satellite embeds with Plote overlays (geofence circle, site pin, photo / phone GPS points) drawn on top.
// The embed shows Web Mercator tiles (256 px at zoom 0) centred on a known point at a known integer zoom, so an
// overlay point's offset from the centre in CSS pixels is the difference of their world-pixel coordinates.

import { metersPerPx, worldPx } from "./geo";

export type LatLon = [number, number];

// Read directly so the value is inlined into client bundles. Optional: without it the keyless embed is used.
const GOOGLE_MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() || undefined;

export const DEFAULT_ZOOM = 17;
export const MAX_ZOOM = 19;
export const MIN_ZOOM = 3;

function fmt(n: number): string {
  return Number(n.toFixed(6)).toString();
}

/** The iframe URL: the official Embed API (satellite) with a key, else the keyless `output=embed` URL (t=k = satellite). */
export function satelliteEmbedUrl(center: LatLon, zoom: number, key: string | undefined = GOOGLE_MAPS_KEY): string {
  const [lat, lon] = center;
  const z = Math.round(zoom);
  if (key) {
    const p = new URLSearchParams({ key, center: `${fmt(lat)},${fmt(lon)}`, zoom: String(z), maptype: "satellite" });
    return `https://www.google.com/maps/embed/v1/view?${p.toString()}`;
  }
  return `https://maps.google.com/maps?q=${fmt(lat)},${fmt(lon)}&t=k&z=${z}&output=embed&hl=en`;
}

/** "Open in Google Maps": a pin search link, and a satellite view of about `spanM` metres around the point. */
export function googleMapsLinks(center: LatLon, spanM = 600): { search: string; satellite: string } {
  const [lat, lon] = center;
  return {
    search: `https://www.google.com/maps/search/?api=1&query=${fmt(lat)},${fmt(lon)}`,
    satellite: `https://www.google.com/maps/@${fmt(lat)},${fmt(lon)},${Math.max(100, Math.round(spanM))}m/data=!3m1!1e3`,
  };
}

/** Radius in metres → CSS pixels at `zoom` and the centre's latitude. */
export function radiusPx(radiusM: number, lat: number, zoom: number): number {
  return radiusM / metersPerPx(lat, zoom);
}

/** Offset (dx, dy) in CSS pixels of `p` from the map centre at `zoom` (x right, y down). */
export function offsetPx(center: LatLon, p: LatLon, zoom: number): [number, number] {
  const [cx, cy] = worldPx(center[0], center[1], zoom);
  const [px, py] = worldPx(p[0], p[1], zoom);
  return [px - cx, py - cy];
}

/**
 * The largest integer zoom at which the geofence (and any extra points) fit in a `w`×`h` box with some margin.
 * Without a radius or points: DEFAULT_ZOOM.
 */
export function fitZoom(center: LatLon, radiusM: number, w: number, h: number, points: LatLon[] = [], fill = 0.8): number {
  if (!(w > 0 && h > 0)) return DEFAULT_ZOOM;
  if (radiusM <= 0 && points.length === 0) return DEFAULT_ZOOM;
  const halfW = (w / 2) * fill;
  const halfH = (h / 2) * fill;
  for (let z = MAX_ZOOM; z >= MIN_ZOOM; z--) {
    const r = radiusM > 0 ? radiusPx(radiusM, center[0], z) : 0;
    if (r > Math.min(halfW, halfH)) continue;
    const fits = points.every((p) => {
      const [dx, dy] = offsetPx(center, p, z);
      return Math.abs(dx) <= halfW && Math.abs(dy) <= halfH;
    });
    if (fits) return z;
  }
  return MIN_ZOOM;
}

/** A usable site: a real coordinate (the playground's 0,0 is "no site"). */
export function hasSite(latE6: number, lonE6: number): boolean {
  return Number.isFinite(latE6) && Number.isFinite(lonE6) && !(latE6 === 0 && lonE6 === 0) && Math.abs(latE6) <= 85_000_000 && Math.abs(lonE6) <= 180_000_000;
}

export function isValidLatLon(p: LatLon | null | undefined): p is LatLon {
  return !!p && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 85 && Math.abs(p[1]) <= 180 && !(p[0] === 0 && p[1] === 0);
}
