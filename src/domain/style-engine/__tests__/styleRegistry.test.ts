import { describe, expect, it } from "vitest";

import { UnknownStyleError } from "../errors";
import {
  createStyleConfig,
  DEFAULT_STYLE_ID,
  getStylePreset,
  isStyleModified,
  listStylePresets,
} from "../styleRegistry";
import { validateCaptionStyle } from "../validateStyle";

describe("style registry", () => {
  it("contains exactly the five V1 presets", () => {
    expect(listStylePresets().map((p) => p.id)).toEqual(["classic", "karaoke", "dynamic", "highlight", "podcast"]);
  });

  it("has unique ids and names", () => {
    const presets = listStylePresets();
    expect(new Set(presets.map((p) => p.id)).size).toBe(presets.length);
    expect(new Set(presets.map((p) => p.name)).size).toBe(presets.length);
  });

  it("gives every preset a valid configuration", () => {
    for (const preset of listStylePresets()) {
      expect(validateCaptionStyle(preset), preset.id).toEqual([]);
    }
  });

  it("looks presets up by id, and returns undefined for an unknown id", () => {
    expect(getStylePreset("karaoke")?.name).toBe("Karaoke");
    expect(getStylePreset("nope")).toBeUndefined();
    expect(getStylePreset("")).toBeUndefined();
  });

  it("defaults to a preset that exists", () => {
    expect(getStylePreset(DEFAULT_STYLE_ID)).toBeDefined();
  });

  it("throws UnknownStyleError when creating a config from an unknown id", () => {
    expect(() => createStyleConfig("nope")).toThrow(UnknownStyleError);
  });

  it("creates a config whose style is an independent clone of the preset", () => {
    const config = createStyleConfig("classic");
    const preset = getStylePreset("classic")!;
    expect(config.baseStyleId).toBe("classic");
    expect(config.style).toEqual(preset);
    expect(config.style).not.toBe(preset);
    expect(config.style.colors).not.toBe(preset.colors);
  });

  it("deep-freezes presets so they can't be mutated in place", () => {
    const preset = getStylePreset("classic")!;
    expect(() => {
      (preset.colors as { text: string }).text = "#000000";
    }).toThrow(TypeError);
    expect(() => {
      (preset.typography as { fontSize: number }).fontSize = 1;
    }).toThrow(TypeError);
  });

  it("allows editing a created config without affecting the preset", () => {
    const config = createStyleConfig("classic");
    config.style.colors.text = "#123456";
    expect(getStylePreset("classic")!.colors.text).toBe("#FFFFFF");
  });

  it("reports whether a config differs from its preset", () => {
    const config = createStyleConfig("classic");
    expect(isStyleModified(config)).toBe(false);
    config.style.typography.fontSize += 1;
    expect(isStyleModified(config)).toBe(true);
  });
});

describe("preset defaults", () => {
  const get = (id: string) => getStylePreset(id)!;

  it("Classic: plain, static, no highlighting — suitable for long-form", () => {
    const classic = get("classic");
    expect(classic.highlightMode).toBe("none");
    expect(classic.animation.kind).toBe("none");
    expect(classic.background.opacity).toBe(0);
  });

  it("Karaoke: declares active-word highlighting with a word-highlight animation", () => {
    const karaoke = get("karaoke");
    expect(karaoke.highlightMode).toBe("activeWord");
    expect(karaoke.animation.kind).toBe("wordHighlight");
    expect(karaoke.colors.highlight).not.toBe(karaoke.colors.text);
  });

  it("Dynamic: bolder/larger than Classic and animated", () => {
    const dynamic = get("dynamic");
    expect(dynamic.typography.fontSize).toBeGreaterThan(get("classic").typography.fontSize);
    expect(dynamic.animation.kind).not.toBe("none");
    expect(dynamic.animation.durationMs).toBeGreaterThan(0);
  });

  it("Highlight: emphasizes words with a distinct highlight color, without motion", () => {
    const highlight = get("highlight");
    expect(highlight.highlightMode).toBe("emphasis");
    expect(highlight.colors.highlight).not.toBe(highlight.colors.text);
    expect(highlight.animation.kind).toBe("none");
  });

  it("Podcast: a subtle background box and larger text than Classic", () => {
    const podcast = get("podcast");
    expect(podcast.background.opacity).toBeGreaterThan(0);
    expect(podcast.background.opacity).toBeLessThan(1);
    expect(podcast.typography.fontSize).toBeGreaterThan(get("classic").typography.fontSize);
    expect(podcast.highlightMode).toBe("none");
  });
});
