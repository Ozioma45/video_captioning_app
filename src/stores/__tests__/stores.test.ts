import { describe, expect, it } from "vitest";

import { useProjectStore } from "../useProjectStore";
import { usePlaybackStore } from "../usePlaybackStore";
import { useCaptionStore } from "../useCaptionStore";
import { useStyleStore } from "../useStyleStore";
import { useProcessingStore } from "../useProcessingStore";

describe("store defaults", () => {
  it("useProjectStore starts with no project or video", () => {
    const state = useProjectStore.getState();
    expect(state.project).toBeNull();
    expect(state.video).toBeNull();
  });

  it("usePlaybackStore starts idle at time zero", () => {
    const state = usePlaybackStore.getState();
    expect(state.currentTime).toBe(0);
    expect(state.isPlaying).toBe(false);
    expect(state.volume).toBe(1);
  });

  it("useCaptionStore starts with no document selected", () => {
    const state = useCaptionStore.getState();
    expect(state.captionDocument).toBeNull();
    expect(state.selectedSegmentId).toBeNull();
  });

  it("useStyleStore starts with no style config", () => {
    expect(useStyleStore.getState().styleConfig).toBeNull();
  });

  it("useProcessingStore starts idle with no fake progress", () => {
    const state = useProcessingStore.getState();
    for (const kind of ["upload", "transcription", "rendering"] as const) {
      expect(state[kind].stage).toBe("idle");
      expect(state[kind].progressPercent).toBeNull();
      expect(state[kind].error).toBeNull();
    }
  });
});

describe("store actions", () => {
  it("useStyleStore.selectBaseStyle sets an empty-override config", () => {
    useStyleStore.getState().selectBaseStyle("classic");
    expect(useStyleStore.getState().styleConfig).toEqual({ baseStyleId: "classic", overrides: {} });
    useStyleStore.getState().reset();
  });

  it("useStyleStore.setOverride merges into overrides without touching the base style", () => {
    useStyleStore.getState().selectBaseStyle("classic");
    useStyleStore.getState().setOverride("textColor", "#ff0000");
    const config = useStyleStore.getState().styleConfig;
    expect(config?.baseStyleId).toBe("classic");
    expect(config?.overrides).toEqual({ textColor: "#ff0000" });
    useStyleStore.getState().reset();
  });

  it("useProcessingStore.setState updates only the targeted stage", () => {
    useProcessingStore.getState().setState("upload", {
      stage: "uploading",
      progressPercent: 42,
      startedAt: new Date().toISOString(),
      error: null,
    });
    const state = useProcessingStore.getState();
    expect(state.upload.stage).toBe("uploading");
    expect(state.upload.progressPercent).toBe(42);
    expect(state.transcription.stage).toBe("idle");
    useProcessingStore.getState().resetAll();
  });
});
