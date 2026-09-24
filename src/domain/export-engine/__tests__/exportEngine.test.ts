import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { findActiveSegment, findActiveWord } from "@/domain/caption-engine/captionLookup";
import { normalizeTranscription } from "@/domain/caption-engine/normalizeTranscription";
import { resolveCaptionDisplay } from "@/domain/style-engine/captionDisplay";
import { getStylePreset, listStylePresets } from "@/domain/style-engine/styleRegistry";
import { parseWhisperCppOutput } from "@/services/transcription/parseWhisperCppOutput";
import type { CaptionSegment, CaptionStyle, CaptionWord } from "@/types";
import { assAlpha, assColor, assTime, escapeAssText, generateAss } from "../assGenerator";
import { computeCaptionLayout } from "../captionLayout";
import { applyTextTransform, buildCaptionTrack } from "../captionTrack";

const w = (id: string, text: string, startTime: number, endTime: number): CaptionWord => ({ id, text, startTime, endTime });
const seg = (id: string, startTime: number, endTime: number, words: CaptionWord[], extra: Partial<CaptionSegment> = {}): CaptionSegment => ({
  id,
  startTime,
  endTime,
  text: words.map((x) => x.text).join(" "),
  words,
  ...extra,
});

const segments: CaptionSegment[] = [
  seg("s1", 1, 3, [w("a", "Hello", 1, 1.5), w("b", "there", 1.5, 2), w("c", "friend.", 2.2, 2.9)]),
  seg("s2", 3, 5, [w("d", "Second", 3.1, 3.6), w("e", "caption", 3.6, 4.4)]),
  seg("s3", 8, 9, [w("f", "Late", 8.1, 8.5)]),
];

const style = (id: string) => getStylePreset(id) as CaptionStyle;
const VIDEO = { width: 1920, height: 1080 };

/** What the browser overlay shows at time t: [segment id, highlighted word text | null]. */
function previewAt(segs: CaptionSegment[], s: CaptionStyle, t: number): [string, string | null] | null {
  const active = findActiveSegment(segs, t);
  if (!active) return null;
  const display = resolveCaptionDisplay(active, s);
  let highlighted: string | null = null;
  if (display.kind === "words") {
    const id = display.trackActiveWord ? (findActiveWord(active, t)?.id ?? null) : display.emphasisWordId;
    highlighted = display.words.find((x) => x.id === id)?.text ?? null;
  }
  return [active.id, highlighted];
}

function trackAt(events: ReturnType<typeof buildCaptionTrack>, t: number): [string, string | null] | null {
  const hits = events.filter((e) => t >= e.startTime && t < e.endTime);
  expect(hits.length).toBeLessThanOrEqual(1); // states never overlap
  if (!hits[0]) return null;
  const run = hits[0].runs.find((r) => r.highlighted);
  return [hits[0].segmentId, run ? run.text.trim() : null];
}

describe("buildCaptionTrack — same decisions as the preview", () => {
  for (const preset of listStylePresets()) {
    it(`${preset.name}: matches the overlay's active segment and highlighted word at every sampled time`, () => {
      const events = buildCaptionTrack(segments, preset);
      for (let t = 0; t < 10; t += 0.013) {
        const expected = previewAt(segments, preset, t);
        const got = trackAt(events, t);
        // transform-aware comparison: the track applies textTransform, the preview applies it via CSS
        const norm = (v: [string, string | null] | null) =>
          v && [v[0], v[1] === null ? null : applyTextTransform(v[1], preset.typography.textTransform)];
        expect(got, `${preset.name} at t=${t.toFixed(3)}`).toEqual(norm(expected));
      }
    });
  }

  it("uses the real word timestamps: highlight is on only inside a word's own interval", () => {
    const events = buildCaptionTrack(segments, style("karaoke"));
    const highlighted = events.filter((e) => e.runs.some((r) => r.highlighted));
    expect(highlighted.map((e) => [e.startTime, e.endTime, e.runs.find((r) => r.highlighted)!.text.trim()])).toEqual([
      [1, 1.5, "Hello"],
      [1.5, 2, "there"],
      [2.2, 2.9, "friend."],
      [3.1, 3.6, "Second"],
      [3.6, 4.4, "caption"],
      [8.1, 8.5, "Late"],
    ]);
    // nothing highlighted in the gap between "there" and "friend."
    expect(trackAt(events, 2.1)).toEqual(["s1", null]);
  });

  it("never highlights before a word starts or after it ends", () => {
    const events = buildCaptionTrack(segments, style("karaoke"));
    for (const e of events) {
      const run = e.runs.find((r) => r.highlighted);
      if (!run) continue;
      const word = segments.flatMap((s) => s.words).find((x) => x.text === run.text.trim())!;
      expect(e.startTime).toBeGreaterThanOrEqual(word.startTime);
      expect(e.endTime).toBeLessThanOrEqual(word.endTime);
    }
  });

  it("keeps every word exactly once and in order in each event", () => {
    for (const e of buildCaptionTrack(segments, style("karaoke")).filter((x) => x.segmentId === "s1")) {
      expect(e.runs.map((r) => r.text.trim())).toEqual(["Hello", "there", "friend."]);
    }
  });

  it("falls back to plain text when words are stale, missing or malformed — like the preview", () => {
    const stale = [seg("s", 0, 2, [w("a", "old", 0, 1)], { text: "Edited text", wordsStale: true })];
    const none = [seg("s", 0, 2, [], { text: "No words" })];
    const bad = [seg("s", 0, 2, [w("a", "x", 1, 0.5)], { text: "Bad timing" })];
    for (const segs of [stale, none, bad]) {
      const events = buildCaptionTrack(segs, style("karaoke"));
      expect(events).toHaveLength(1);
      expect(events[0].runs).toEqual([{ text: segs[0].text, highlighted: false }]);
    }
  });

  it("Highlight emphasizes the last word only, for the whole segment", () => {
    const events = buildCaptionTrack(segments, style("highlight")).filter((e) => e.segmentId === "s1");
    expect(events).toHaveLength(1);
    expect(events[0].runs.filter((r) => r.highlighted).map((r) => r.text.trim())).toEqual(["friend."]);
  });

  it("is cut short by the next segment when segments overlap, like findActiveSegment", () => {
    const overlapping = [seg("a", 0, 5, [w("1", "one", 0, 1)]), seg("b", 3, 6, [w("2", "two", 3, 4)])];
    const events = buildCaptionTrack(overlapping, style("classic"));
    expect(events.map((e) => [e.segmentId, e.startTime, e.endTime])).toEqual([["a", 0, 3], ["b", 3, 6]]);
  });

  it("does not mutate its input", () => {
    const copy = JSON.parse(JSON.stringify(segments));
    buildCaptionTrack(segments, style("karaoke"));
    generateAss(segments, style("karaoke"), VIDEO);
    expect(segments).toEqual(copy);
  });

  it("applies text transforms", () => {
    expect(applyTextTransform("hello world", "uppercase")).toBe("HELLO WORLD");
    expect(applyTextTransform("Hello World", "lowercase")).toBe("hello world");
    expect(applyTextTransform("hello wide world", "capitalize")).toBe("Hello Wide World");
  });
});

describe("generateAss", () => {
  it("emits the video size, wrap mode and one text event per track event", () => {
    const ass = generateAss(segments, style("classic"), { width: 1280, height: 720 });
    expect(ass).toContain("PlayResX: 1280");
    expect(ass).toContain("PlayResY: 720");
    expect(ass).toContain("WrapStyle: 1");
    const dialogues = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(dialogues).toHaveLength(3); // Classic: one event per segment, no box layer
    expect(dialogues[0]).toContain(",0:00:01.00,0:00:03.00,Text,");
    expect(dialogues[0]).toContain("Hello there friend.");
    expect(dialogues[2]).toContain(",0:00:08.00,0:00:09.00,Text,");
  });

  it("uses the final segments' times, not anything else", () => {
    const ass = generateAss([seg("x", 12.34, 15.678, [w("a", "Hi", 12.4, 12.9)])], style("classic"), VIDEO);
    expect(ass).toContain("Dialogue: 1,0:00:12.34,0:00:15.68,Text,");
  });

  it("Karaoke: colors exactly the active word in the highlight color, per state event", () => {
    const ass = generateAss(segments, style("karaoke"), VIDEO);
    const first = ass.split("\n").filter((l) => l.startsWith("Dialogue:"))[0];
    expect(first).toContain(",0:00:01.00,0:00:01.50,Text,");
    expect(first).toContain("{\\1c&H4AD5FF&}Hello{\\1c&HFFFFFF&} there friend.");
  });

  it("Podcast: emits a box layer under the text layer with the background opacity as alpha", () => {
    const ass = generateAss(segments, style("podcast"), VIDEO);
    const events = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(events).toHaveLength(6);
    expect(events[0]).toContain("Dialogue: 0,");
    expect(events[0]).toContain("Box,");
    expect(events[0]).toContain("\\3a&H73&"); // 0.55 opacity → alpha 115 = 0x73
    expect(events[1]).toContain("Dialogue: 1,");
    expect(events[1]).toContain("\\fad(150,0)");
  });

  it("plays the entrance animation only on the first event of a segment", () => {
    const ass = generateAss(segments, style("dynamic"), VIDEO);
    const s1 = ass.split("\n").filter((l) => l.startsWith("Dialogue:") && l.includes("HELLO"));
    expect(s1.filter((l) => l.includes("\\fscx85"))).toHaveLength(1);
  });

  it("maps each animation kind to its tags", () => {
    const withAnim = (kind: CaptionStyle["animation"]["kind"]) =>
      generateAss(segments, { ...style("classic"), animation: { kind, durationMs: 200 } }, VIDEO);
    expect(withAnim("fade")).toContain("\\fad(200,0)");
    expect(withAnim("pop")).toContain("\\t(0,200,\\fscx100\\fscy100)");
    expect(withAnim("slide")).toContain("\\move(");
    expect(withAnim("none")).not.toContain("\\fad");
    expect(withAnim("wordHighlight")).not.toContain("\\move");
  });

  it("neutralizes ASS override blocks and escapes in caption text", () => {
    expect(escapeAssText("a {\\an9} b")).toBe("a \\{\\⁠an9\\} b");
    expect(escapeAssText("x\\Ny")).toBe("x\\⁠Ny");
    expect(escapeAssText("line1\nline2")).toBe("line1 line2");
    const ass = generateAss([seg("i", 0, 2, [], { text: "{\\an9\\pos(0,0)}INJECT \\N{\\p1}" })], style("classic"), VIDEO);
    const line = ass.split("\n").find((l) => l.startsWith("Dialogue:"))!;
    const text = line.slice(line.indexOf("{}") + 2).replace(/^\{\\1c&H[0-9A-F]{6}&\}/, "");
    expect(text).not.toMatch(/(^|[^\\])\{/); // every brace is escaped
    expect(text).not.toMatch(/\\[Nnh](?!⁠)/);
  });

  it("formats colors, alpha and time", () => {
    expect(assColor("#FFD54A")).toBe("&H4AD5FF&");
    expect(assColor("nonsense" as never)).toBe("&H000000&");
    expect(assAlpha(1)).toBe("&H00&");
    expect(assAlpha(0)).toBe("&HFF&");
    expect(assTime(3725.456)).toBe("1:02:05.46");
    expect(assTime(0)).toBe("0:00:00.00");
  });

  it("is deterministic", () => {
    expect(generateAss(segments, style("karaoke"), VIDEO)).toBe(generateAss(segments, style("karaoke"), VIDEO));
  });

  it("stays fast for a 60,000-word document", () => {
    const words = Array.from({ length: 60_000 }, (_, i) => w(`w${i}`, `word${i}`, i * 0.3, i * 0.3 + 0.25));
    const many: CaptionSegment[] = [];
    for (let i = 0; i < words.length; i += 6) many.push(seg(`s${i}`, words[i].startTime, words[i + 5].endTime, words.slice(i, i + 6)));
    const started = Date.now();
    const ass = generateAss(many, style("karaoke"), VIDEO);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(ass.split("\n").filter((l) => l.startsWith("Dialogue:")).length).toBeGreaterThan(60_000);
  });
});

describe("computeCaptionLayout — positioning from the real video size", () => {
  const sizes = { landscape: [1920, 1080], portrait: [1080, 1920], square: [1080, 1080], odd: [1280, 720] } as const;

  it("scales sizes with the video height, never a viewport", () => {
    const a = computeCaptionLayout(style("classic"), 1920, 1080);
    const b = computeCaptionLayout(style("classic"), 960, 540);
    expect(a.fontPx).toBeCloseTo(44);
    expect(b.fontPx).toBeCloseTo(22);
    expect(b.assFontSize / a.assFontSize).toBeCloseTo(0.5);
  });

  it("anchors bottom/center by default with the configured offset", () => {
    const l = computeCaptionLayout(style("classic"), 1920, 1080);
    expect(l.alignment).toBe(2);
    expect(l.marginV).toBeCloseTo(0.08 * 1080);
    expect(l.marginL).toBeCloseTo(l.marginR);
    // max width = 80% of the 88% padded frame
    expect(l.textWidthPx).toBeCloseTo(1920 * 0.88 * 0.8);
  });

  it("mirrors the preview: a vertically centered caption has no side padding, so its max width is a share of the full width", () => {
    const l = computeCaptionLayout(style("dynamic"), 1920, 1080);
    expect(l.alignment).toBe(5);
    expect(l.textWidthPx).toBeCloseTo(1920 * 0.7);
  });

  it("supports every vertical/horizontal combination", () => {
    const base = style("classic");
    const expected: Record<string, number> = {
      "bottom-left": 1, "bottom-center": 2, "bottom-right": 3,
      "center-left": 4, "center-center": 5, "center-right": 6,
      "top-left": 7, "top-center": 8, "top-right": 9,
    };
    for (const v of ["bottom", "center", "top"] as const) {
      for (const h of ["left", "center", "right"] as const) {
        const layout = computeCaptionLayout({ ...base, position: { ...base.position, vertical: v, horizontal: h } }, 1920, 1080);
        expect(layout.alignment).toBe(expected[`${v}-${h}`]);
        expect(layout.marginL).toBeGreaterThanOrEqual(0);
        expect(layout.marginR).toBeGreaterThanOrEqual(0);
        expect(layout.marginL + layout.textWidthPx + layout.marginR).toBeCloseTo(1920);
      }
    }
  });

  it("left/right alignment sit on the 6% side padding (plus box padding)", () => {
    const base = style("podcast");
    const left = computeCaptionLayout({ ...base, position: { ...base.position, horizontal: "left" } }, 1920, 1080);
    expect(left.marginL).toBeCloseTo(1920 * 0.06 + 14);
    const right = computeCaptionLayout({ ...base, position: { ...base.position, horizontal: "right" } }, 1920, 1080);
    expect(right.marginR).toBeCloseTo(1920 * 0.06 + 14);
  });

  it("works for every aspect ratio and keeps captions inside the frame", () => {
    for (const [width, height] of Object.values(sizes)) {
      for (const preset of listStylePresets()) {
        const l = computeCaptionLayout(preset, width, height);
        expect(l.textWidthPx).toBeGreaterThan(0);
        expect(l.marginL + l.textWidthPx + l.marginR).toBeCloseTo(width);
        expect(l.marginV).toBeLessThan(height / 2);
      }
    }
  });

  it("converts stroke width to the ASS outline (CSS strokes are centered)", () => {
    expect(computeCaptionLayout(style("dynamic"), 1920, 1080).outlinePx).toBeCloseTo(2.5); // 5px CSS stroke
  });
});

describe("real segmented captions (whisper.cpp fixture) export", () => {
  const raw = JSON.parse(readFileSync(new URL("../../../services/transcription/__tests__/fixtures/whisper-cpp-speech-40s.json", import.meta.url), "utf-8"));
  const doc = normalizeTranscription("v", parseWhisperCppOutput(raw));

  it("exports the final segmented captions, not whisper's segments", () => {
    const ass = generateAss(doc.segments, style("classic"), VIDEO);
    const events = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(events).toHaveLength(doc.segments.length);
    expect(doc.segments.length).toBeGreaterThan(raw.transcription.length); // more, shorter captions than whisper's segments
    expect(events[1]).toContain(doc.segments[1].text);
  });

  it("Karaoke on real word timing: every real word gets exactly one highlighted state matching its timestamps", () => {
    const events = buildCaptionTrack(doc.segments, style("karaoke"));
    const highlighted = events.filter((e) => e.runs.some((r) => r.highlighted));
    const usable = doc.originalWords.filter((x) => x.endTime > x.startTime);
    expect(highlighted).toHaveLength(usable.length);
    highlighted.forEach((e, i) => {
      expect(e.startTime).toBeCloseTo(usable[i].startTime, 6);
      expect(e.endTime).toBeCloseTo(usable[i].endTime, 6);
    });
  });
});
