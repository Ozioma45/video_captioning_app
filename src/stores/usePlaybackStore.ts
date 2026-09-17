/**
 * Playback state shell (ARCHITECTURE.md §9).
 *
 * `currentTime` is a *read model* mirrored from the HTML5 `<video>`
 * element's own `currentTime` — the video element remains the source of
 * truth once real playback wiring exists (Phase 2). This store only holds
 * the shape; nothing here synchronizes with a real video yet.
 */

import { create } from "zustand";

interface PlaybackState {
  currentTime: number;
  durationSeconds: number;
  isPlaying: boolean;
  volume: number;
  isMuted: boolean;
  setCurrentTime: (seconds: number) => void;
  setDuration: (seconds: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setVolume: (volume: number) => void;
  setIsMuted: (muted: boolean) => void;
  reset: () => void;
}

const defaults = {
  currentTime: 0,
  durationSeconds: 0,
  isPlaying: false,
  volume: 1,
  isMuted: false,
};

export const usePlaybackStore = create<PlaybackState>((set) => ({
  ...defaults,
  setCurrentTime: (seconds) => set({ currentTime: seconds }),
  setDuration: (seconds) => set({ durationSeconds: seconds }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setVolume: (volume) => set({ volume }),
  setIsMuted: (muted) => set({ isMuted: muted }),
  reset: () => set(defaults),
}));
