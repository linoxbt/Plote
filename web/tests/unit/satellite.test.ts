import { describe, expect, it } from "vitest";
import { haversineM } from "@/lib/geo";
import { fitZoom, googleMapsLinks, hasSite, isValidLatLon, offsetPx, radiusPx, satelliteEmbedUrl, DEFAULT_ZOOM } from "@/lib/satellite";

const LEKKI: [number, number] = [6.447, 3.474];

describe("satellite map math (Web Mercator, 256 px tiles)", () => {
  it("radius in pixels = metres / (156543.03392 · cos(lat) / 2^zoom)", () => {
    const mpp = (156543.03392 * Math.cos((6.447 * Math.PI) / 180)) / 2 ** 17;
    expect(radiusPx(300, 6.447, 17)).toBeCloseTo(300 / mpp, 6);
    expect(radiusPx(300, 6.447, 18)).toBeCloseTo(2 * radiusPx(300, 6.447, 17), 6);
    expect(radiusPx(300, 60, 17)).toBeCloseTo(radiusPx(300, 0, 17) / Math.cos((60 * Math.PI) / 180), 3);
  });

  it("offsets: east is +x, north is −y, and the pixel distance matches the ground distance", () => {
    const z = 17;
    const east: [number, number] = [LEKKI[0], LEKKI[1] + 0.001];
    const north: [number, number] = [LEKKI[0] + 0.001, LEKKI[1]];
    const [ex, ey] = offsetPx(LEKKI, east, z);
    const [nx, ny] = offsetPx(LEKKI, north, z);
    expect(ex).toBeGreaterThan(0);
    expect(Math.abs(ey)).toBeLessThan(1e-6);
    expect(ny).toBeLessThan(0);
    expect(Math.abs(nx)).toBeLessThan(1e-6);
    // ~110 m east → pixels ≈ metres / metres-per-pixel (within 1%)
    const m = haversineM(LEKKI, east);
    expect(ex).toBeCloseTo(radiusPx(m, LEKKI[0], z), 0);
    expect(offsetPx(LEKKI, LEKKI, z)).toEqual([0, 0]);
  });

  it("fits the geofence (and extra points) in the box", () => {
    const z = fitZoom(LEKKI, 300, 640, 400);
    expect(radiusPx(300, LEKKI[0], z)).toBeLessThanOrEqual(0.8 * 200);
    expect(radiusPx(300, LEKKI[0], z + 1)).toBeGreaterThan(0.8 * 200);
    expect(fitZoom(LEKKI, 0, 640, 400)).toBe(DEFAULT_ZOOM);
    expect(fitZoom(LEKKI, 300, 0, 0)).toBe(DEFAULT_ZOOM);
    const far: [number, number] = [LEKKI[0] + 0.05, LEKKI[1]];
    const zf = fitZoom(LEKKI, 300, 640, 400, [far]);
    expect(Math.abs(offsetPx(LEKKI, far, zf)[1])).toBeLessThanOrEqual(0.8 * 200);
    expect(zf).toBeLessThan(z);
  });
});

describe("Google URLs", () => {
  it("keyless embed is satellite (t=k) at the integer zoom, centred on the point", () => {
    expect(satelliteEmbedUrl(LEKKI, 17.4, undefined)).toBe("https://maps.google.com/maps?q=6.447,3.474&t=k&z=17&output=embed&hl=en");
  });

  it("with a key, the official Embed API view in satellite", () => {
    const u = new URL(satelliteEmbedUrl(LEKKI, 18, "KEY123"));
    expect(u.origin + u.pathname).toBe("https://www.google.com/maps/embed/v1/view");
    expect(u.searchParams.get("key")).toBe("KEY123");
    expect(u.searchParams.get("center")).toBe("6.447,3.474");
    expect(u.searchParams.get("zoom")).toBe("18");
    expect(u.searchParams.get("maptype")).toBe("satellite");
  });

  it("open-in-Google-Maps links", () => {
    expect(googleMapsLinks(LEKKI, 1200)).toEqual({
      search: "https://www.google.com/maps/search/?api=1&query=6.447,3.474",
      satellite: "https://www.google.com/maps/@6.447,3.474,1200m/data=!3m1!1e3",
    });
  });

  it("the playground's 0,0 is no site", () => {
    expect(hasSite(0, 0)).toBe(false);
    expect(hasSite(6447000, 3474000)).toBe(true);
    expect(isValidLatLon([0, 0])).toBe(false);
    expect(isValidLatLon([NaN, 3])).toBe(false);
    expect(isValidLatLon(LEKKI)).toBe(true);
  });
});
