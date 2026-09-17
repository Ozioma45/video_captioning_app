/**
 * Project + video state shell (ARCHITECTURE.md §5, §12).
 *
 * Holds the current `Project` and `Video` records — metadata and
 * references only, never video bytes (CLAUDE.md "never put huge video
 * blobs in React/Zustand state"). No persistence logic here yet; reading
 * from / writing to the local project JSON file is server-side work
 * introduced when Phase 2 builds real upload/storage.
 */

import { create } from "zustand";
import type { Project, Video } from "@/types";

interface ProjectState {
  project: Project | null;
  video: Video | null;
  setProject: (project: Project | null) => void;
  setVideo: (video: Video | null) => void;
  reset: () => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  project: null,
  video: null,
  setProject: (project) => set({ project }),
  setVideo: (video) => set({ video }),
  reset: () => set({ project: null, video: null }),
}));
