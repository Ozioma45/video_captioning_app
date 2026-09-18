/**
 * Playback state shell (ARCHITECTURE.md §9).
 *
 * `currentTime` is a *read model* mirrored from the HTML5 `<video>`
 * element's own `currentTime` — the video element remains the source of
 * truth (Phase 2). `seekRequestSeconds` is the one exception: it's a
 * *command* the video element watches for and applies to itself (Phase 4
 * — clicking/navigating a caption seeks the player), then clears. This
 * keeps the data flow one-directional in each case (element → store for
 * reads, store → element for this one command) rather than two stores
 * fighting over who owns `currentTime`.
 */

import { create } from "zustand";

interface PlaybackState {
  currentTime: number;
  durationSeconds: number;
  isPlaying: boolean;
  volume: number;
  isMuted: boolean;
  seekRequestSeconds: number | null;
  setCurrentTime: (seconds: number) => void;
  setDuration: (seconds: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setVolume: (volume: number) => void;
  setIsMuted: (muted: boolean) => void;
  requestSeek: (seconds: number) => void;
  clearSeekRequest: () => void;
  reset: () => void;
}

const defaults = {
  currentTime: 0,
  durationSeconds: 0,
  isPlaying: false,
  volume: 1,
  isMuted: false,
  seekRequestSeconds: null,
};

export const usePlaybackStore = create<PlaybackState>((set) => ({
  ...defaults,
  setCurrentTime: (seconds) => set({ currentTime: seconds }),
  setDuration: (seconds) => set({ durationSeconds: seconds }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setVolume: (volume) => set({ volume }),
  setIsMuted: (muted) => set({ isMuted: muted }),
  requestSeek: (seconds) => set({ seekRequestSeconds: seconds }),
  clearSeekRequest: () => set({ seekRequestSeconds: null }),
  reset: () => set(defaults),
}));
