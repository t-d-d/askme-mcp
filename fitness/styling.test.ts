import { describe, expect, it } from "vitest";
import { palette } from "../web/src/palette";

// Relative luminance and contrast ratio, as WCAG 2 defines them.
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const [r = 0, g = 0, b = 0] = channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

describe("fitness: the palette is readable (styling.md)", () => {
  it("measures contrast as WCAG does", () => {
    expect(contrast("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#777777")).toBe(1);
  });

  it.each(Object.entries(palette))(
    "keeps white on %s strong, and its ink on its tint, at 4.5 to 1",
    (_, colour) => {
      expect(contrast("#FFFFFF", colour.strong)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colour.ink, colour.tint)).toBeGreaterThanOrEqual(4.5);
    },
  );
});
