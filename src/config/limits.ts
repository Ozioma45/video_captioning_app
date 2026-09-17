/**
 * V1 processing ceilings, confirmed in Phase 0 (ARCHITECTURE.md §17,
 * Unresolved Decisions #4-5): soft, configurable validation limits, not
 * hard-coded assumptions baked into pipeline logic. Enforced in exactly one
 * place (upload validation, built in Phase 2) so raising them later never
 * requires touching downstream code.
 */

export const MAX_VIDEO_DURATION_SECONDS = 2 * 60 * 60; // 2 hours
export const MAX_VIDEO_FILE_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // ~2 GB

/**
 * Formats actually supported depend on the FFmpeg build used in Phase 2 —
 * this list must be verified against real test files before being trusted
 * (PROJECT.md §6: "do not claim support for a format unless the processing
 * pipeline actually supports it"). Treat as a starting point, not a
 * guarantee.
 */
export const CANDIDATE_VIDEO_FORMATS = ["mp4", "mov", "webm", "mkv"] as const;
