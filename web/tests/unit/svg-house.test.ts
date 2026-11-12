import { describe, expect, it } from "vitest";
import { dollars, houseSvg, houseSvgDataUri, litParts, type HouseSvgInput } from "@/lib/svg-house";
// Written by the Rust test `svg_fixtures_for_web` (contracts/estate/src/svg.rs) from the contract's own `unit_svg`.
import fixtures from "./fixtures/svg-house.json";

type Fixture = { input: HouseSvgInput; svg: string; dataUri: string };
const cases = fixtures as Fixture[];

const base: HouseSvgInput = {
  estateName: "Harmattan Court", unitLabel: "Block A · Unit 4B", unitId: "a-4b", approvedCount: 0, total: 4,
  status: "Allocated", paid: "8500000000", price: "85000000000",
};
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe("dynamic NFT SVG = the contract's unit_svg", () => {
  it("has fixtures from the contract", () => {
    expect(cases.length).toBeGreaterThanOrEqual(15);
  });
  it.each(cases.map((c, k) => [k, c] as const))("fixture %i matches byte for byte", (_k, c) => {
    expect(houseSvg(c.input)).toBe(c.svg);
    expect(houseSvgDataUri(c.input)).toBe(c.dataUri);
  });
  it("uses the brand palette and fonts", () => {
    const svg = houseSvg({ ...base, approvedCount: 2 });
    expect(svg).toContain("viewBox='0 0 400 400'");
    expect(svg).toContain("fill='#090909'");
    expect(svg).toContain("#FF9211");
    expect(svg).toContain("font-family='Lexend,sans-serif'");
    expect(houseSvg({ ...base, status: "InDefault" })).toContain("#f26b5b");
  });
  it("fills progress segments and lights windows gold only when all are approved", () => {
    for (let n = 0; n <= 4; n++) {
      const svg = houseSvg({ ...base, approvedCount: n });
      expect(count(svg, /height='6' rx='3' fill='#FF9211'/g)).toBe(n);
      expect(svg).toContain(`>${n}/4<`);
    }
    expect(houseSvg({ ...base, approvedCount: 3 })).not.toContain("#FFD27A");
    expect(houseSvg({ ...base, approvedCount: 4 })).toContain("fill='#FFD27A' stroke='#FFD27A'");
  });
  it("maps progress onto 4 parts with div_ceil, like the contract", () => {
    expect(litParts(3, 6)).toBe(2);
    expect(litParts(1, 6)).toBe(1);
    expect(litParts(5, 4)).toBe(4);
    expect(litParts(0, 0)).toBe(0);
    expect(litParts(1, 3)).toBe(2);
  });
  it("formats dollars like the contract", () => {
    expect(dollars("85000000000")).toBe("$85,000");
    expect(dollars("999000000")).toBe("$999");
    expect(dollars("1234567000000")).toBe("$1,234,567");
    expect(dollars("not a number")).toBe("$0");
  });
  it("escapes and bounds text", () => {
    const svg = houseSvg({ ...base, estateName: "<script>&", status: '<img src=x onerror="&#97;lert(1)">' });
    expect(svg).not.toContain("<script>");
    expect(svg).not.toContain("<img");
    expect(svg).toContain("&lt;script&gt;&amp;");
  });
  it("stays small", () => {
    for (const c of cases) expect(new TextEncoder().encode(houseSvg(c.input)).length).toBeLessThan(2600);
  });
});
