import { formatFileSize, formatTimecode } from "@/lib/format";
import type { Video } from "@/types";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right font-medium">{value}</span>
    </div>
  );
}

/**
 * "Video information" panel (Phase 2 brief §12: preview + basic metadata
 * is enough for this phase — no caption editor yet).
 */
export function VideoMetadataPanel({ video }: { video: Video }) {
  const metadata = video.metadata;
  if (!metadata) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-2 text-sm font-semibold">Video information</h2>
      <div className="divide-y divide-border">
        <Row label="Filename" value={metadata.filename} />
        <Row label="Size" value={formatFileSize(metadata.fileSizeBytes)} />
        <Row label="Duration" value={formatTimecode(metadata.durationSeconds)} />
        <Row label="Resolution" value={`${metadata.width}×${metadata.height}`} />
        <Row label="Frame rate" value={metadata.frameRate ? `${metadata.frameRate.toFixed(2)} fps` : "Unknown"} />
        <Row label="Video codec" value={metadata.videoCodec ?? "Unknown"} />
        <Row label="Audio" value={metadata.hasAudio ? (metadata.audioCodec ?? "Present") : "None"} />
        <Row label="Format" value={metadata.containerFormat ?? "Unknown"} />
      </div>
    </div>
  );
}
