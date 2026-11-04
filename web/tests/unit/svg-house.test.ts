import { describe, expect, it } from "vitest";
import { houseSvg, houseSvgDataUri, litParts } from "@/lib/svg-house";

const base = { estateName: "Harmattan Court", unitLabel: "A-4B", unitId: "a-4b", total: 4, status: "Allocated", paid: "8500000000", price: "85000000000" };
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe("dynamic NFT SVG", () => {
  it.each([0, 1, 2, 3, 4])("draws %i filled progress segments of 4", (n) => {
    const svg = houseSvg({ ...base, approvedCount: n });
    expect(count(svg, /class="sf"/g)).toBe(n);
    expect(count(svg, /class="se"/g)).toBe(4 - n);
    expect(svg).toContain(`${n}/4`);
  });
  it("fills house parts in order and lights windows gold only at handover", () => {
    const parts = (svg: string) => count(svg, /<path class="f"/g);
    expect(parts(houseSvg({ ...base, approvedCount: 0 }))).toBe(0);
    expect(parts(houseSvg({ ...base, approvedCount: 2 }))).toBe(2);
    expect(houseSvg({ ...base, approvedCount: 3 })).not.toContain('class="g"');
    expect(houseSvg({ ...base, approvedCount: 4 })).toContain('class="g"');
    expect(houseSvg({ ...base, approvedCount: 1, status: "HandedOver" })).toContain('class="g"');
  });
  it("shows the status badge, mono unit label and paid / price", () => {
    const svg = houseSvg({ ...base, approvedCount: 2 });
    expect(svg).toContain("TAKEN");
    expect(svg).toContain(">A-4B<");
    expect(svg).toContain("font-family:monospace");
    expect(svg).toContain("$8,500 / $85,000");
    expect(houseSvg({ ...base, approvedCount: 0, status: "InDefault" })).toContain("IN DEFAULT");
  });
  it("stays under 2 KB", () => {
    for (const status of ["Available", "Reserved", "Allocated", "InDefault", "HandedOver"]) {
      expect(new TextEncoder().encode(houseSvg({ ...base, approvedCount: 4, status })).length).toBeLessThan(2048);
    }
  });
  it("supports other milestone counts and clamps input", () => {
    expect(count(houseSvg({ ...base, total: 6, approvedCount: 3 }), /class="sf"/g)).toBe(3);
    expect(count(houseSvg({ ...base, approvedCount: 99 }), /class="sf"/g)).toBe(4);
    expect(litParts(3, 6)).toBe(2);
    expect(litParts(0, 0)).toBe(0);
  });
  it("escapes text", () => {
    const svg = houseSvg({ ...base, estateName: "<script>&", approvedCount: 0 });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;&amp;");
  });
  it("builds a base64 data URI", () => {
    const uri = houseSvgDataUri({ ...base, approvedCount: 1 });
    expect(uri.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(atob(uri.split(",")[1])).toContain("<svg");
  });
});
