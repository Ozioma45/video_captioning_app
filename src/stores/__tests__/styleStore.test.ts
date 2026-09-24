import { beforeEach, describe, expect, it } from "vitest";

import { getStylePreset, listStylePresets } from "@/domain/style-engine/styleRegistry";
import { useCaptionStore } from "../useCaptionStore";
import { useProcessingStore } from "../useProcessingStore";
import { useStyleStore } from "../useStyleStore";

beforeEach(() => {
  useStyleStore.getState().reset();
});

describe("useStyleStore", () => {
  it("starts on Classic", () => {
    expect(useStyleStore.getState().styleConfig.baseStyleId).toBe("classic");
    expect(useStyleStore.getState().lastError).toBeNull();
  });

  it("selects every preset by id", () => {
    for (const preset of listStylePresets()) {
      useStyleStore.getState().selectStyle(preset.id);
      expect(useStyleStore.getState().styleConfig.baseStyleId).toBe(preset.id);
      expect(useStyleStore.getState().styleConfig.style).toEqual(preset);
    }
  });

  it("surfaces an error (and keeps the current style) for an unknown preset id", () => {
    useStyleStore.getState().selectStyle("karaoke");
    expect(() => useStyleStore.getState().selectStyle("nope")).not.toThrow();
    expect(useStyleStore.getState().lastError).toBeTruthy();
    expect(useStyleStore.getState().styleConfig.baseStyleId).toBe("karaoke");
  });

  it("modifies typography, colors, and position", () => {
    const { updateTypography, updateColors, updatePosition } = useStyleStore.getState();
    updateTypography({ fontSize: 70 });
    updateColors({ text: "#ABCDEF", highlight: "#123456" });
    updatePosition({ vertical: "top", horizontal: "left" });

    const { style } = useStyleStore.getState().styleConfig;
    expect(style.typography.fontSize).toBe(70);
    expect(style.colors.text).toBe("#ABCDEF");
    expect(style.colors.highlight).toBe("#123456");
    expect(style.position.vertical).toBe("top");
    expect(style.position.horizontal).toBe("left");
  });

  it("rejects an invalid change, surfaces why, and leaves the style unchanged", () => {
    const before = useStyleStore.getState().styleConfig;
    useStyleStore.getState().updateTypography({ fontSize: -3 });
    expect(useStyleStore.getState().lastError).toMatch(/fontSize/);
    expect(useStyleStore.getState().styleConfig).toBe(before);
  });

  it("clears the error on the next successful change", () => {
    useStyleStore.getState().updateTypography({ fontSize: -3 });
    useStyleStore.getState().updateTypography({ fontSize: 50 });
    expect(useStyleStore.getState().lastError).toBeNull();
  });

  it("resets edits back to the selected preset's defaults", () => {
    useStyleStore.getState().selectStyle("dynamic");
    useStyleStore.getState().updateColors({ text: "#000000" });
    useStyleStore.getState().updateStyle({ maxLines: 4 });
    useStyleStore.getState().resetStyle();

    const config = useStyleStore.getState().styleConfig;
    expect(config.baseStyleId).toBe("dynamic");
    expect(config.style).toEqual(getStylePreset("dynamic"));
  });

  it("never mutates the global preset definitions", () => {
    const snapshot = JSON.stringify(listStylePresets());
    useStyleStore.getState().selectStyle("classic");
    useStyleStore.getState().updateColors({ text: "#010203" });
    useStyleStore.getState().updateTypography({ fontSize: 99 });
    useStyleStore.getState().resetStyle();
    expect(JSON.stringify(listStylePresets())).toBe(snapshot);
  });

  it("keeps the config JSON-serializable (safe to persist with a project)", () => {
    useStyleStore.getState().updateColors({ text: "#010203" });
    const config = useStyleStore.getState().styleConfig;
    expect(JSON.parse(JSON.stringify(config))).toEqual(config);
  });

  it("does not touch caption or processing state when the style changes", () => {
    const captionBefore = useCaptionStore.getState().captionDocument;
    const processingBefore = useProcessingStore.getState().transcription;
    useStyleStore.getState().selectStyle("podcast");
    useStyleStore.getState().updateTypography({ fontSize: 60 });
    useStyleStore.getState().resetStyle();
    expect(useCaptionStore.getState().captionDocument).toBe(captionBefore);
    expect(useProcessingStore.getState().transcription).toBe(processingBefore);
  });
});
