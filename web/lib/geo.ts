// Small geo helpers for the proof page map (static OSM tiles, no API key).

export function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** World pixel coordinates at zoom z (256 px tiles). */
export function worldPx(lat: number, lon: number, z: number): [number, number] {
  const n = 256 * 2 ** z;
  const latRad = (lat * Math.PI) / 180;
  const x = ((lon + 180) / 360) * n;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return [x, y];
}

export function metersPerPx(lat: number, z: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
}

/** Pick a zoom where `radiusM` is roughly `targetPx` pixels. */
export function zoomFor(lat: number, radiusM: number, targetPx = 110): number {
  if (radiusM <= 0) return 16;
  for (let z = 19; z >= 3; z--) if (radiusM / metersPerPx(lat, z) <= targetPx) return z;
  return 3;
}

/** 64-bit hex pHash Hamming distance. */
export function hamming(a: string, b: string): number {
  try {
    let x = BigInt("0x" + a) ^ BigInt("0x" + b);
    let n = 0;
    while (x) {
      n += Number(x & 1n);
      x >>= 1n;
    }
    return n;
  } catch {
    return 64;
  }
}

/** Inverse of `worldPx`: world pixel coordinates at zoom z → [lat, lon]. */
export function fromWorldPx(x: number, y: number, z: number): [number, number] {
  const n = 256 * 2 ** z;
  const lon = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return [lat, lon];
}
