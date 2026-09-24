import { describe, expect, it } from "vitest";

import { InvalidStyleError } from "../errors";
import { createStyleConfig, getStylePreset } from "../styleRegistry";
import { patchCaptionStyle, resetStyleConfig, updateStyleConfig } from "../updateStyle";

describe("patchCaptionStyle", () => {
  it("merges a partial group, leaving its other fields alone", () => {
    const { style } = createStyleConfig("classic");
    const next = patchCaptionStyle(style, { typography: { fontSize: 60 } });
    expect(next.typography.fontSize).toBe(60);
    expect(next.typography.fontWeight).toBe(style.typography.fontWeight);
  });

  it("does not mutate its input", () => {
    const { style } = createStyleConfig("classic");
    const before = JSON.stringify(style);
    patchCaptionStyle(style, { colors: { text: "#000000" }, maxLines: 3 });
    expect(JSON.stringify(style)).toBe(before);
  });

  it("keeps object identity for groups the patch doesn't touch", () => {
    const { style } = createStyleConfig("classic");
    const next = patchCaptionStyle(style, { colors: { text: "#000000" } });
    expect(next.typography).toBe(style.typography);
    expect(next.position).toBe(style.position);
    expect(next.colors).not.toBe(style.colors);
  });

  it("applies top-level fields (highlightMode, maxLines)", () => {
    const { style } = createStyleConfig("classic");
    const next = patchCaptionStyle(style, { highlightMode: "activeWord", maxLines: 3 });
    expect(next.highlightMode).toBe("activeWord");
    expect(next.maxLines).toBe(3);
  });

  it("throws InvalidStyleError for an out-of-range value and returns nothing partial", () => {
    const { style } = createStyleConfig("classic");
    expect(() => patchCaptionStyle(style, { typography: { fontSize: 5000 } })).toThrow(InvalidStyleError);
    expect(style.typography.fontSize).toBe(getStylePreset("classic")!.typography.fontSize);
  });

  it("rejects an invalid color", () => {
    const { style } = createStyleConfig("classic");
    expect(() => patchCaptionStyle(style, { colors: { highlight: "yellow" } })).toThrow(InvalidStyleError);
  });
});

describe("updateStyleConfig / resetStyleConfig", () => {
  it("edits the config's style and keeps its base preset id", () => {
    const config = createStyleConfig("podcast");
    const next = updateStyleConfig(config, { background: { opacity: 0.8 } });
    expect(next.baseStyleId).toBe("podcast");
    expect(next.style.background.opacity).toBe(0.8);
  });

  it("never changes the shared preset when the config is edited", () => {
    const config = createStyleConfig("podcast");
    updateStyleConfig(config, { background: { opacity: 0.9 } });
    expect(getStylePreset("podcast")!.background.opacity).toBe(0.55);
  });

  it("resets to the preset the config started from", () => {
    const edited = updateStyleConfig(createStyleConfig("karaoke"), { colors: { highlight: "#FF00FF" }, maxLines: 4 });
    const reset = resetStyleConfig(edited);
    expect(reset.baseStyleId).toBe("karaoke");
    expect(reset.style).toEqual(getStylePreset("karaoke"));
  });
});
