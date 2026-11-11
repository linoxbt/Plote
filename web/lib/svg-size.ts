// Intrinsic size of an SVG (or SVG data URI), so token images render at their true aspect.

/** Width/height from an SVG's viewBox (or width/height attributes), so the image keeps its true aspect. */
export function svgSize(svg: string): [number, number] | null {
  const head = svg.slice(0, Math.max(0, svg.indexOf(">")) + 1);
  const vb = head.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/);
  if (vb) return [Number(vb[1]), Number(vb[2])];
  const w = head.match(/\swidth\s*=\s*["']([\d.]+)/)?.[1];
  const h = head.match(/\sheight\s*=\s*["']([\d.]+)/)?.[1];
  return w && h ? [Number(w), Number(h)] : null;
}

/** Size of an inline SVG data URI (base64 or URL-encoded); null for anything else. */
export function dataUriSvgSize(uri: string): [number, number] | null {
  const m = uri.match(/^data:image\/svg\+xml(;base64)?,(.*)$/s);
  if (!m) return null;
  try {
    return svgSize(m[1] ? atob(m[2]) : decodeURIComponent(m[2]));
  } catch {
    return null;
  }
}
