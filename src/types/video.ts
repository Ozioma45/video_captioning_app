/**
 * Video and metadata types.
 *
 * A `Video` never carries the underlying file bytes — only a reference to
 * where they live (see ARCHITECTURE.md §12, "never buffer a full video into
 * memory" / "no video blobs in React state"). Application state should only
 * ever hold objects shaped like this.
 */

export type VideoId = string;

export type VideoSourceRef =
  | { kind: "local-object-url"; url: string }
  | { kind: "server-path"; videoId: VideoId };

export interface VideoMetadata {
  filename: string;
  fileSizeBytes: number;
  durationSeconds: number;
  width: number;
  height: number;
  frameRate: number | null;
  videoCodec: string | null;
  hasAudio: boolean;
  audioCodec: string | null;
  /** ffprobe's format_name (e.g. "mov,mp4,m4a,3gp,3g2,mj2"); added in Phase 2. */
  containerFormat: string | null;
}

export interface Video {
  id: VideoId;
  source: VideoSourceRef;
  metadata: VideoMetadata | null;
  uploadedAt: string;
}

export type AspectRatioPreset = "16:9" | "9:16" | "1:1" | "original";
