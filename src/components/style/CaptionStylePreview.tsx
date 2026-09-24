import { cn } from "@/lib/utils";
import type { CaptionStyle } from "@/types";
import { previewStyleToCss } from "./previewCss";

interface CaptionStylePreviewProps {
  style: CaptionStyle;
  sampleText?: string;
  /** Reference-pixel → preview-pixel scale (1080-line reference frame). */
  scale?: number;
  className?: string;
}

/**
 * Static style-picker preview: a representative sample rendered with
 * plain HTML/CSS inside a 16:9 frame. NOT the video caption renderer —
 * nothing here reads playback time or the caption document, and no
 * animation runs (Phase 5 brief §8, §29). The highlighted word only shows
 * *which colors* the style would use; when a word is highlighted during
 * playback is a Phase 6 concern.
 */
export function CaptionStylePreview({
  style,
  sampleText = "This is a caption preview.",
  scale = 0.3,
  className,
}: CaptionStylePreviewProps) {
  const { frame, block } = previewStyleToCss(style, scale);
  const words = sampleText.split(" ");
  const highlightIndex =
    style.highlightMode === "activeWord" ? Math.min(1, words.length - 1) : style.highlightMode === "emphasis" ? words.length - 1 : -1;

  return (
    <div
      aria-hidden
      className={cn("aspect-video w-full overflow-hidden rounded-md bg-gradient-to-br from-zinc-700 to-zinc-900", className)}
      style={frame}
    >
      <div style={block}>
        {words.map((word, index) => (
          <span key={index} style={index === highlightIndex ? { color: style.colors.highlight } : undefined}>
            {word}
            {index < words.length - 1 ? " " : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
