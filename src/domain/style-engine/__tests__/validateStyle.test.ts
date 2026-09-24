import { describe, expect, it } from "vitest";

import type { CaptionStyle } from "@/types";
import { createStyleConfig } from "../styleRegistry";
import { validateCaptionStyle } from "../validateStyle";

function style(mutate?: (s: CaptionStyle) => void): CaptionStyle {
  const s = createStyleConfig("classic").style;
  mutate?.(s);
  return s;
}

function paths(s: CaptionStyle): string[] {
  return validateCaptionStyle(s).map((issue) => issue.path);
}

describe("validateCaptionStyle", () => {
  it("accepts a valid style", () => {
    expect(validateCaptionStyle(style())).toEqual([]);
  });

  it("rejects a font size out of range or not a number", () => {
    expect(paths(style((s) => (s.typography.fontSize = 2)))).toContain("typography.fontSize");
    expect(paths(style((s) => (s.typography.fontSize = 9999)))).toContain("typography.fontSize");
    expect(paths(style((s) => (s.typography.fontSize = Number.NaN)))).toContain("typography.fontSize");
  });

  it("rejects an invalid font weight", () => {
    expect(paths(style((s) => ((s.typography as { fontWeight: number }).fontWeight = 550)))).toContain(
      "typography.fontWeight",
    );
  });

  it("rejects a font that isn't in the registry (no arbitrary font-family strings)", () => {
    expect(
      paths(style((s) => ((s.typography as { fontFamily: string }).fontFamily = "Comic Sans; } body { display:none"))),
    ).toContain("typography.fontFamily");
  });

  it("rejects an opacity outside 0–1", () => {
    expect(paths(style((s) => (s.background.opacity = 1.5)))).toContain("background.opacity");
    expect(paths(style((s) => (s.background.opacity = -0.1)))).toContain("background.opacity");
  });

  it("rejects negative radius, outline width, and shadow values", () => {
    expect(paths(style((s) => (s.background.radiusPx = -1)))).toContain("background.radiusPx");
    expect(paths(style((s) => (s.outline.widthPx = -1)))).toContain("outline.widthPx");
    expect(paths(style((s) => (s.shadow.blurPx = -1)))).toContain("shadow.blurPx");
  });

  it("rejects invalid positioning", () => {
    expect(paths(style((s) => ((s.position as { horizontal: string }).horizontal = "diagonal")))).toContain(
      "position.horizontal",
    );
    expect(paths(style((s) => ((s.position as { vertical: string }).vertical = "middle")))).toContain(
      "position.vertical",
    );
    expect(paths(style((s) => (s.position.maxWidthPercent = 5)))).toContain("position.maxWidthPercent");
    expect(paths(style((s) => (s.position.offsetPercent = 80)))).toContain("position.offsetPercent");
  });

  it("rejects colors that aren't #RRGGBB", () => {
    for (const bad of ["red", "#FFF", "#GGGGGG", "rgb(0,0,0)", "#FFFFFF; background: url(x)", ""]) {
      expect(paths(style((s) => (s.colors.text = bad))), bad).toContain("colors.text");
    }
    expect(validateCaptionStyle(style((s) => (s.colors.text = "#abcdef")))).toEqual([]);
  });

  it("rejects unknown enum values for highlight mode and animation kind", () => {
    expect(paths(style((s) => ((s as { highlightMode: string }).highlightMode = "sparkle")))).toContain("highlightMode");
    expect(paths(style((s) => ((s.animation as { kind: string }).kind = "explode")))).toContain("animation.kind");
  });

  it("reports every problem, not just the first", () => {
    const found = paths(
      style((s) => {
        s.typography.fontSize = 0;
        s.colors.text = "nope";
      }),
    );
    expect(found).toEqual(expect.arrayContaining(["typography.fontSize", "colors.text"]));
  });

  it("does not throw on a malformed style object", () => {
    expect(() => validateCaptionStyle({} as CaptionStyle)).not.toThrow();
    expect(validateCaptionStyle({} as CaptionStyle).length).toBeGreaterThan(0);
  });
});
