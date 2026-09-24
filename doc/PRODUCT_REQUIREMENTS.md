# Caption Studio — Product Requirements (V1)

Status: Phase 0 proposal, derived from `PROJECT.md`. Nothing in this document has been implemented yet.

---

## 1. Product Goals

1. Let a person turn a raw video into a captioned, exportable MP4 without technical knowledge of transcription or video encoding.
2. Make caption *styling* — not just captioning — a first-class, polished experience: a handful of genuinely good-looking styles beats a long list of mediocre ones.
3. Treat video duration as a spectrum (15 seconds to 2 hours), not a fork in the product — the same editor should feel right for a TikTok clip and a podcast episode.
4. Keep the initial build free/local to develop and test, while architecting every processing boundary (transcription, storage, video processing) so a paid/cloud provider can be swapped in later without a rewrite.
5. Produce a technically sound foundation for a future SaaS, not a throwaway demo — extensibility (new styles, new providers) is a launch requirement, not a "someday."

## 2. Target Users

- **Content creators** — YouTube, Shorts, TikTok, Reels, talking-head/educational video.
- **Podcasters** — video podcasts, interviews, clips cut from long conversations.
- **Educators** — tutorials, courses, lectures, training video.
- **Businesses** — product/marketing/social/training video.
- **General users** — anyone who wants attractive captions on a video, without editing expertise.

The common thread across all five groups: they have a video, they want it captioned and to look professional, and they are not FFmpeg/Whisper experts. The product must hide all processing complexity behind a linear, understandable flow.

## 3. Core User Journey

```text
Open Caption Studio → Upload video → (automatic) transcript + timing generated
→ Open editor → Preview video+captions → Edit transcript/timing if needed
→ Select caption style → Customize style → Preview changes
→ Export → Download finished video
```

Everything in the product exists to support this single flow. Any V1 feature that doesn't serve a step in this journey should be questioned before it's built.

### Journey variants worth naming explicitly

- **Short-form creator**: uploads a 45-second clip, barely touches the transcript, picks "Dynamic" or "Karaoke," exports in under a minute of wall-clock processing. The editor must not feel heavyweight for this case.
- **Long-form creator**: uploads a 45-minute interview, expects transcription to take real, visible time, spot-checks/corrects a transcript with real-world errors (names, jargon), picks "Podcast" or "Classic," and is willing to wait minutes for render — but must always know the app hasn't hung.
- **Iterating on style**: a user who already has a finished transcript re-opens a project purely to try a different style and re-export — this must not force re-transcription.

## 4. Why Short-Form and Long-Form Are Both First-Class

These are not two products wearing one UI — they're the same product under different time constants:

- The **data model** (words → segments → styled captions) is identical regardless of duration; only the *number* of segments/words differs.
- The **editor UI** doesn't need two modes — a working transcript editor and timeline scale naturally from a handful of captions to hundreds.
- Where duration *does* matter is entirely in the **processing layer**: job duration, progress communication, temp storage, and (per `ARCHITECTURE.md` §13) where the work is allowed to run. The product requirement is that no UI or data-model decision may silently assume "this will always be short" — hard-coded assumptions like "captions fit in 2 lines" or "duration < 60s" are treated as bugs unless a specific feature explicitly opts into that constraint (e.g., a future "auto-clip for Shorts" feature would legitimately assume short output).

## 5. V1 Features

### 5.1 Video Upload
- Accept common formats (exact supported set is determined by what the chosen FFmpeg build can decode — never claim a format works without it being tested).
- Server-side validation (real file inspection, not just extension trust).
- Visible upload progress.
- Graceful, specific handling of invalid files (wrong type, corrupt, zero-length, no audio track).

### 5.2 Video Metadata
Extract and retain: filename, file size, duration, width, height, aspect ratio, frame rate, video codec, audio presence, audio codec. Used internally by the editor and processing pipeline (e.g., to preserve aspect ratio on export, to estimate processing time).

### 5.3 Video Preview
A real player: play/pause/seek/current time/duration/volume/mute/fullscreen-where-practical/timeline seeking, with captions rendered in sync (per `ARCHITECTURE.md` §9).

### 5.4 Automatic Caption Generation
Audio is transcribed automatically via a local, free provider (`LocalWhisperProvider`), producing a transcript with **word-level timestamps preserved** — this is treated as a hard requirement, not a nice-to-have, because it underpins karaoke/highlight styles.

### 5.5 Caption Data Model & Segmentation
Raw transcript is transformed into visual caption segments via a configurable segmentation layer (max words/characters/lines, min/max duration, punctuation/sentence-boundary awareness) — never a hard-coded UI assumption.

### 5.6 Caption Editing
Users can edit caption text, split/merge captions, adjust timing, delete/add captions, without needing to regenerate the whole transcript for a single correction.

### 5.7 Caption Timeline
A visual timeline showing when each caption appears/disappears, current playback position, and which caption is currently active.

### 5.8 Caption Styles (5 initial presets)
Classic, Karaoke, Dynamic, Highlight, Podcast — implemented as data (`CaptionStyle` configs), not one-off components, so the count can grow later without an architecture change.

### 5.9 Caption Customization
Typography (font family/size/weight/letter-spacing/line-height), colors (text/highlight/background/outline), position, appearance (stroke/shadow/background/opacity), layout (words per line/max lines/alignment), animation (fade/pop/slide/word-highlight/scale/none) — layered on top of a chosen preset via overrides, never a full fork.

### 5.10 Preview System
Style-applied preview that matches the exported result as closely as architecturally possible (shared resolver logic, per `ARCHITECTURE.md` §9).

### 5.11 Aspect Ratio Support
16:9, 9:16, 1:1 at minimum; original aspect ratio preserved by default; no forced conversion to vertical.

### 5.12 Export
FFmpeg-driven render → captions burned in → MP4 output → download, with real stage-based progress and clear success/error states.

### 5.13 Error Handling Throughout
Every processing step (invalid video, unsupported format, no audio, transcription failure, rendering failure, storage failure, timeout) surfaces a message that explains what happened, whether the user's work is safe, and what to do next — never a bare technical error like "FFmpeg exited with code 1" as the only message.

### 5.14 Processing Progress
Honest, stage-based progress for every long operation; never a fabricated percentage when a real one isn't available.

## 6. Non-Functional Requirements

- **Duration-agnostic**: the product must work (within documented, configurable limits — see Unresolved Decisions in `ARCHITECTURE.md`) for videos from ~15 seconds to ~2 hours.
- **No video blobs in application state**: React/Zustand state holds metadata, transcript, and style data only — never raw video bytes.
- **Free-first development**: the V1 dev loop must not require a paid API key to function end-to-end.
- **Extensibility**: adding a transcription provider, storage backend, or caption style must not require rewriting the editor or the renderer.
- **Reliability**: an exported video must actually play correctly with audio intact — reliability is a launch metric, not a stretch goal.
- **Performance**: the editor must stay responsive (no jank scrubbing the timeline, no blocked UI thread) regardless of video length, because the video itself is never loaded into JS memory.
- **Accessibility**: keyboard navigation, readable contrast, accessible controls, visible focus states, clear (non-color-only) error/status indicators.
- **Security**: uploaded files are treated as untrusted input at every boundary (see `ARCHITECTURE.md` §14).
- **Desktop-first responsiveness**: the full editor targets desktop; mobile is scoped to landing/upload/browsing/basic preview only for V1 (video editing needs the screen space).

## 7. V1 Non-Goals

Explicitly not built unless requested:

- Full multi-track video editing suite, transitions, color grading
- AI video/avatar generation, background removal, automatic B-roll, music generation
- Full social publishing integrations
- Team collaboration / real-time multi-user editing
- Complex billing, enterprise accounts
- Native mobile or desktop apps
- Complex authentication or complex analytics
- A general-purpose database or multi-user account system (no auth requirement in V1 — see `ARCHITECTURE.md` Unresolved Decisions)

The product is a **caption generation, styling, editing, and rendering tool** — not a general video editor.

## 8. Future Features (explicitly deferred, not designed against yet)

- AI: punctuation, filler-word removal, smart segmentation, important-word detection, translation/multilingual, title/description generation.
- Video: trim, crop, resize, backgrounds, progress bars, watermarks/logo overlays.
- Captions: more styles, custom templates/fonts, brand kits, speaker identification/multi-speaker.
- Long-form: chapters, transcript search, jump-to-word, automatic highlight extraction.
- Social: auto-generate short clips from long videos, per-platform styles/aspect ratios.

These inform the architecture (interfaces stay open) but are not designed or scaffolded in V1.

## 9. Definition of Done for V1

A user can, end to end, with a real video file:

1. Open the application.
2. Upload a real video (short or long).
3. See it processed with honest progress.
4. Get a generated transcript with word-level timestamps.
5. See timed captions.
6. Edit caption text.
7. Choose from at least 5 caption styles.
8. Customize caption appearance.
9. Preview captions synchronized with the video.
10. Export a captioned MP4.
11. Download the result — and the result actually plays correctly, audio intact, captions burned in and legible.

This must work for both a short clip (under a minute) and a genuinely long video (tens of minutes to hours), within the practical limits of the development machine — "practical limits" being an explicit, documented ceiling (see Unresolved Decisions), not an unstated assumption.
