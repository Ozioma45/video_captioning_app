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

  it("useProcessingStore supports the processing_metadata stage with no fake percentage (Phase 2)", () => {
    useProcessingStore.getState().setState("upload", {
      stage: "processing_metadata",
      progressPercent: null,
      startedAt: new Date().toISOString(),
      error: null,
    });
    expect(useProcessingStore.getState().upload.stage).toBe("processing_metadata");
    expect(useProcessingStore.getState().upload.progressPercent).toBeNull();
    useProcessingStore.getState().resetAll();
  });

  it("usePlaybackStore mirrors real playback values and resets cleanly (Phase 2)", () => {
    usePlaybackStore.getState().setDuration(3600);
    usePlaybackStore.getState().setCurrentTime(120);
    usePlaybackStore.getState().setIsPlaying(true);
    usePlaybackStore.getState().setVolume(0.5);
    usePlaybackStore.getState().setIsMuted(true);

    const state = usePlaybackStore.getState();
    expect(state.durationSeconds).toBe(3600);
    expect(state.currentTime).toBe(120);
    expect(state.isPlaying).toBe(true);
    expect(state.volume).toBe(0.5);
    expect(state.isMuted).toBe(true);

    usePlaybackStore.getState().reset();
    expect(usePlaybackStore.getState().currentTime).toBe(0);
    expect(usePlaybackStore.getState().isPlaying).toBe(false);
  });

  it("useProjectStore.setVideo stores the uploaded video and reset clears it (Phase 2)", () => {
    useProjectStore.getState().setVideo({
      id: "11111111-1111-4111-8111-111111111111",
      source: { kind: "server-path", videoId: "11111111-1111-4111-8111-111111111111" },
      metadata: null,
      uploadedAt: new Date().toISOString(),
    });
    expect(useProjectStore.getState().video?.id).toBe("11111111-1111-4111-8111-111111111111");

    useProjectStore.getState().reset();
    expect(useProjectStore.getState().video).toBeNull();
  });
});
