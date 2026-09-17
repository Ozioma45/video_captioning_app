/**
 * Best-effort mapping from ffprobe's `format_name` to an HTTP Content-Type
 * for streaming the preview back to the browser. Deliberately not
 * exhaustive — falls back to whatever the client declared at upload time,
 * then to a generic binary type, rather than guessing wrong with
 * confidence.
 */
export function resolveContentType(containerFormat: string | null, declaredContentType: string): string {
  if (!containerFormat) return declaredContentType || "application/octet-stream";

  if (containerFormat.includes("mp4") || containerFormat.includes("mov")) return "video/mp4";
  if (containerFormat.includes("webm")) return "video/webm";
  if (containerFormat.includes("matroska")) return "video/x-matroska";
  if (containerFormat.includes("avi")) return "video/x-msvideo";

  return declaredContentType || "application/octet-stream";
}
