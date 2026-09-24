import { isValidId } from "@/lib/id";
import { validateCaptionStyle } from "@/domain/style-engine/validateStyle";
import type { CaptionSegment, CaptionStyle, CaptionWord } from "@/types";

/**
 * Validation of an export request body (POST /api/export). The client
 * sends the current, possibly edited caption segments and style — the
 * server never trusts either. Only known fields are copied out, every
 * string is length-capped and every number must be finite, so the rest of
 * the pipeline can treat the result as well-formed.
 */

export const EXPORT_LIMITS = {
  maxSegments: 100_000,
  maxWordsPerSegment: 500,
  maxTotalWords: 400_000,
  maxSegmentTextLength: 4_000,
  maxWordTextLength: 200,
  maxIdLength: 100,
  maxTimeSeconds: 24 * 3600,
} as const;

export interface ExportRequest {
  videoId: string;
  segments: CaptionSegment[];
  style: CaptionStyle;
}

export interface ExportRequestIssue {
  code: "invalid_body" | "invalid_video_id" | "invalid_captions" | "invalid_style";
  message: string;
}

export type ExportRequestResult = { ok: true; value: ExportRequest } | { ok: false; issue: ExportRequestIssue };

const fail = (code: ExportRequestIssue["code"], message: string): ExportRequestResult => ({ ok: false, issue: { code, message } });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= EXPORT_LIMITS.maxTimeSeconds;
}

function isShortString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max;
}

function parseWords(raw: unknown): CaptionWord[] | null {
  if (!Array.isArray(raw) || raw.length > EXPORT_LIMITS.maxWordsPerSegment) return null;
  const words: CaptionWord[] = [];
  for (const item of raw) {
    if (!isRecord(item)) return null;
    if (!isShortString(item.id, EXPORT_LIMITS.maxIdLength) || !isShortString(item.text, EXPORT_LIMITS.maxWordTextLength)) return null;
    if (!isTime(item.startTime) || !isTime(item.endTime)) return null;
    words.push({ id: item.id, text: item.text, startTime: item.startTime, endTime: item.endTime });
  }
  return words;
}

export function validateExportRequest(body: unknown): ExportRequestResult {
  if (!isRecord(body)) return fail("invalid_body", "Expected a JSON object.");

  const { videoId, captionDocument, styleConfig } = body;
  if (typeof videoId !== "string" || !isValidId(videoId)) return fail("invalid_video_id", "A valid videoId is required.");

  if (!isRecord(captionDocument) || !Array.isArray(captionDocument.segments)) {
    return fail("invalid_captions", "captionDocument.segments is required.");
  }
  if (captionDocument.segments.length === 0) return fail("invalid_captions", "There are no captions to export.");
  if (captionDocument.segments.length > EXPORT_LIMITS.maxSegments) return fail("invalid_captions", "Too many captions.");

  const segments: CaptionSegment[] = [];
  let totalWords = 0;
  for (const raw of captionDocument.segments) {
    if (!isRecord(raw)) return fail("invalid_captions", "A caption is malformed.");
    if (!isShortString(raw.id, EXPORT_LIMITS.maxIdLength) || !isShortString(raw.text, EXPORT_LIMITS.maxSegmentTextLength)) {
      return fail("invalid_captions", "A caption has an invalid id or text.");
    }
    if (!isTime(raw.startTime) || !isTime(raw.endTime) || raw.endTime < raw.startTime) {
      return fail("invalid_captions", "A caption has invalid timing.");
    }
    const words = parseWords(raw.words ?? []);
    if (!words) return fail("invalid_captions", "A caption has invalid word timing.");
    totalWords += words.length;
    if (totalWords > EXPORT_LIMITS.maxTotalWords) return fail("invalid_captions", "Too many words.");
    segments.push({
      id: raw.id,
      startTime: raw.startTime,
      endTime: raw.endTime,
      text: raw.text,
      words,
      ...(raw.wordsStale === true ? { wordsStale: true } : {}),
    });
  }

  // The exporter (like the preview) assumes segments are ordered by start time.
  for (let i = 1; i < segments.length; i += 1) {
    if (segments[i].startTime < segments[i - 1].startTime) return fail("invalid_captions", "Captions must be ordered by start time.");
  }

  if (!isRecord(styleConfig) || !isRecord(styleConfig.style)) return fail("invalid_style", "styleConfig.style is required.");
  const issues = validateCaptionStyle(styleConfig.style as unknown as CaptionStyle);
  if (issues.length > 0) return fail("invalid_style", `The caption style is invalid: ${issues[0].path} — ${issues[0].message}`);

  return { ok: true, value: { videoId, segments, style: styleConfig.style as unknown as CaptionStyle } };
}
