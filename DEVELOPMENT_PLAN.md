# Caption Studio — Development Plan

Status: Phase 0 proposal. This is a plan for future work — none of the phases below have started.

Each phase should be built, tested, and verified before moving to the next. Do not start a phase's files until the previous phase's Definition of Done is met.

---

## Phase 0 — Understanding (this phase)

**Objective**: Understand the product and produce architecture/requirements documentation before writing application code.

**Deliverables**: `ARCHITECTURE.md`, `PRODUCT_REQUIREMENTS.md`, `DEVELOPMENT_PLAN.md` (this file), `DESIGN_SYSTEM.md`, `CLAUDE.md`.

**Definition of done**: All five documents exist, are internally consistent with each other and with `PROJECT.md`, and the Unresolved Decisions list has been reviewed with the project owner.

---

## Phase 1 — Foundation

**Objective**: Stand up the Next.js application skeleton and the architectural scaffolding (folder structure, state layer, type definitions) with no real features yet.

**Features**:
- Next.js (App Router) + TypeScript project initialized.
- Tailwind CSS + shadcn/ui wired up, base design tokens from `DESIGN_SYSTEM.md` applied.
- Folder structure created per `ARCHITECTURE.md` §"Folder Structure" (empty modules with clear responsibilities, not placeholder features).
- Core shared TypeScript types (`Project`, `Video`, `CaptionDocument`, `CaptionSegment`, `CaptionWord`, `CaptionStyle`, `ExportJob`) defined in `types/`.
- Zustand store shells for project/playback/caption/style/export state (no real data flowing yet).
- Basic app shell/layout (no real editor UI yet — just navigation scaffolding).

**Files/modules likely involved**: `src/app/layout.tsx`, `src/app/page.tsx`, `src/types/*`, `src/state/*`, `tailwind.config.*`, `components.json` (shadcn).

**Dependencies**: None (first implementation phase).

**Testing requirements**: App builds and runs (`next dev`) with no errors; type-checking passes; no real functionality to test yet beyond "it renders."

**Definition of done**: `npm run dev` serves a blank-but-styled shell; folder structure matches the architecture doc; shared types compile and are imported successfully by at least one placeholder component.

---

## Phase 2 — Video Input

**Objective**: A user can upload a real video file and see it previewed with correct metadata, with no captions yet.

**Features**:
- Upload UI (drag/drop + file picker).
- Client-side fast validation (extension/size) + server-side authoritative validation (magic bytes via `ffprobe`).
- Upload streamed to local filesystem storage (`StorageProvider`/`LocalFilesystemStorage`).
- Metadata extraction via `ffprobe` (`VideoProcessor.getMetadata`).
- Video preview player: play/pause/seek/volume/duration/current time.
- Upload progress UI.
- Graceful error states for invalid/corrupt/no-audio files.

**Files/modules likely involved**: `features/upload/*`, `services/storage/*`, `services/video-processing/metadata.ts`, `app/api/upload/route.ts`, `components/video-player/*`.

**Dependencies**: Phase 1 (folder structure, types, state shells). Requires local FFmpeg/ffprobe binary available in dev environment.

**Testing requirements**: Manual test with a short video, a long video (5–30+ min), a landscape video, a vertical video, an invalid file (wrong type), and a video with no audio track — verify metadata extraction and graceful rejection paths (Rule 7 in `CLAUDE.md`).

**Definition of done**: A real video of varying length/aspect ratio can be uploaded, validated, stored, and played back with correct metadata displayed; invalid files are rejected with a clear message; no video bytes ever enter React/Zustand state.

---

## Phase 3 — Transcription

**Objective**: A user's uploaded video produces a transcript with word-level timestamps, generated locally.

**Features**:
- Audio extraction via FFmpeg (video → 16kHz mono WAV).
- `TranscriptionProvider` interface + `LocalWhisperProvider` implementation (shells out to `whisper.cpp`/`faster-whisper`).
- `TranscriptionJob` model + in-process job runner with status polling.
- Normalization of provider output into internal `CaptionWord`/`CaptionDocument` shape.
- Transcription progress UI (stage-based, honest).

**Files/modules likely involved**: `services/transcription/*`, `services/video-processing/audio-extraction.ts`, `services/jobs/*`, `app/api/transcribe/route.ts`, `app/api/jobs/[id]/route.ts`, `domain/caption-engine/normalize.ts`.

**Dependencies**: Phase 2 (needs a stored, validated video with known metadata). Requires local Whisper implementation installed in dev environment.

**Testing requirements**: Test against a short clip, a long (30+ min) recording, a video with poor audio quality, and a video with multiple speakers (per `PROJECT.md` Rule 7) — verify word-level timestamps are present and reasonably accurate, and that job progress/status is honest and doesn't fake completion.

**Definition of done**: Uploading a real video results in a persisted `CaptionDocument` with word-level timestamps, visible to the client via job polling, for both short and long inputs, without blocking the UI thread or the HTTP request for the full transcription duration.

---

## Phase 4 — Caption Editor

**Objective**: A user can view, edit, and navigate the generated transcript as caption segments, with edits landing in the domain `CaptionDocument`, not a parallel UI-owned model.

**Actually implemented** (as built, not the original speculative sketch above):
- Segmentation engine — `domain/caption-engine/segmentCaptions.ts`, `(CaptionWord[], SegmentationRules) → CaptionSegment[]`, deterministic single-pass greedy algorithm (word/char/duration limits + pause/sentence-boundary detection). Available and fully unit-tested, but **not wired into the live transcription pipeline** — Phase 3's whisper.cpp segment boundaries are still used as-is for a freshly transcribed document; there is no "re-segment" UI trigger. Documented here rather than silently added, since it wasn't asked for.
- Pure mutation functions — `domain/caption-engine/captionMutations.ts`: `updateCaptionText`, `updateCaptionTiming`, `splitCaption`, `mergeCaptions`, all operating on and returning a `CaptionDocument`, all preserving object identity for unrelated segments (so editing one caption doesn't re-render every other one).
- Reusable timing validation — `domain/caption-engine/captionTimingValidation.ts` (`validateCaptionTiming`): negative/invalid range/overlap-with-neighbor/exceeds-video-duration, returns every issue found rather than a single boolean. Never auto-adjusts a neighboring segment — an edit that would overlap one is rejected, not accommodated.
- Time format helpers — `domain/caption-engine/captionTimeFormat.ts`: `MM:SS.ss` ⇄ seconds, distinct from the player's whole-second `formatTimecode`.
- Editor UI — `components/captions/{CaptionEditor,CaptionList,CaptionItem,CaptionTiming}.tsx`, replacing the Phase 3 read-only transcript list inside `features/transcription/TranscriptionPanel.tsx`. Per-caption: editable text (local state, committed on blur/Enter — never per keystroke), editable start/end time, select-on-focus/click, a word-boundary split picker and "merge with next" action shown only while selected.
- Store wiring — `stores/useCaptionStore.ts` gained `updateText`, `updateTiming`, `split`, `merge`, `selectNextCaption`, `selectPreviousCaption`, and a `lastError` field; all delegate to the pure functions above rather than reimplementing logic inline.
- One-directional player integration — selecting a caption (click or Arrow Up/Down) seeks the video to that caption's start time, via a new `seekRequestSeconds`/`requestSeek` command on `usePlaybackStore` that `VideoPlayer` applies to the real element. The reverse direction (video playback time → auto-selecting/highlighting the "current" caption) is **not** built — that's Phase 6's "synchronized caption preview" concern, not Phase 4's.
- Word-level data handling — editing a segment's text never rewrites or deletes `words`; it sets a new `wordsStale: true` flag (an additive field on `CaptionSegment`) so future consumers know the word list may no longer correspond to the text. This was a deliberate simplification over the vaguer "re-align" language in this doc's earlier §7 note — see ARCHITECTURE.md §7 and its Phase 4 notes for the reasoning.

**Explicitly not built** (deferred, not silently dropped):
- A caption timeline/scrubber component and "active caption follows video playback" highlighting — Phase 6 territory (synchronized visual preview), not requested for Phase 4.
- Delete/add-caption actions — not in the Phase 4 brief's required action list; adding one would have been unrequested scope.
- Undo/redo — mutations are structured as pure `(document, ...) → document` functions specifically so this can be added later without a rewrite, but no history stack exists yet.
- Drag-to-adjust timing — numeric `MM:SS.ss` fields only; direct-manipulation dragging is a future enhancement.

**Files/modules involved**: `domain/caption-engine/{segmentCaptions,captionMutations,captionTimingValidation,captionTimeFormat,wordsText,interpolateWords,errors}.ts`, `components/captions/*`, `stores/useCaptionStore.ts`, `stores/usePlaybackStore.ts` (seek command), `components/video-player/VideoPlayer.tsx` (applies it).

**Dependencies**: Phase 3 (needs a real `CaptionDocument`) — confirmed still intact; nothing in Phase 3's pipeline was changed except one bug fix (a whisper.cpp special token, `<|endoftext|>`, wasn't being filtered — found via a real end-to-end run while testing Phase 4, fixed in `parseWhisperCppOutput.ts`).

**Testing**: 61 new unit tests (segmentation, mutations, timing validation/format, store wiring), including two regression tests built directly from real whisper.cpp output captured during manual E2E testing (the special-token leak, and a run of degenerate identical-timestamp words from a long, un-segmented transcript). Full suite: 157 tests passing. UI-level interaction (clicking, typing, keyboard nav in a live browser) was not verified — no browser-automation tool is available in this environment; see the Phase 4 completion report's manual-testing section for exactly what was and wasn't exercised.

**Definition of done**: A user can select, edit text, edit timing, split, and merge captions for a real transcribed video, with word-level timing preserved or explicitly flagged stale, and editing one caption never touching another's data or triggering its re-render.

---

## Phase 5 — Caption Styles

**Objective**: A user can pick and customize one of 5 caption style presets. The result is a validated, serializable style configuration that Phase 6 (preview) and Phase 7 (export) will consume.

**Actually implemented**:
- Style model — `types/style.ts`: `CaptionStyle` (typography, colors, background, outline, shadow, position, highlight mode, animation, max lines) and `CaptionStyleConfig = { baseStyleId, style }`. Structured data only — hex colors, registry font ids, pixel values relative to a 1080-line reference frame; never CSS strings.
- Domain — `domain/style-engine/`: `stylePresets.ts` (Classic, Karaoke, Dynamic, Highlight, Podcast as data), `styleRegistry.ts` (deep-frozen presets, `listStylePresets`, `getStylePreset`, `createStyleConfig`, `isStyleModified`), `validateStyle.ts` (`STYLE_LIMITS`, reports every issue), `updateStyle.ts` (`patchCaptionStyle`, `resetStyleConfig`), `fonts.ts` (fixed font registry: self-hosted Inter + system stacks), `errors.ts`.
- Store — `stores/useStyleStore.ts`: `selectStyle`, `updateStyle`/`updateTypography`/`updateColors`/`updatePosition`, `resetStyle`, `reset`. Domain errors land in `lastError`; an invalid change leaves the config untouched.
- UI — `components/style/`: right-hand inspector with Info | Style tabs; preset selector with static previews; generic controls panel (typography, colors, appearance, position, word highlight & animation). Controls that would be inert under the current settings are hidden.

**Explicitly not built**: captions over the video, playback sync, word highlighting during playback, any animation actually running (Phase 6); ASS generation, burn-in, export (Phase 7); custom font upload; saving/loading named user presets; persisting the style with a project (no project persistence exists yet).

**Testing**: registry, validation, patch and store unit tests (including preset non-mutation, and that style changes never touch caption or processing state). Real-browser check via Chrome DevTools Protocol against the running app: upload → transcribe → select each preset → edit size/colors/background/position → reset; caption text/timing unchanged and no upload/transcription request issued by style changes.

**Definition of done**: All 5 presets selectable and visually distinct in the picker, customizable through one generic panel, resettable to preset defaults, with switching non-destructive to the transcript. Whether a style *looks right on video* is verified in Phase 6/7, not here.

---

## Phase 6 — Preview

**Objective**: Real-time preview accurately reflects the selected style and stays synchronized with video and caption timing.

**Features**:
- Preview overlay component consuming `style-engine.resolve()` output.
- rAF-driven sync loop reading `video.currentTime`.
- Real-time update on style/customization changes (no re-render lag).
- Timeline ↔ preview synchronization (scrubbing the timeline updates the preview and vice versa).

**Files/modules likely involved**: `components/caption-overlay/*`, `features/editor/preview-sync.ts`, `state/playbackStore.ts`.

**Dependencies**: Phases 4 and 5 (needs both segments and styles).

**Testing requirements**: Verify preview stays in sync during scrubbing, fast playback, and pause on both short and long videos; verify no visual drift between what the preview shows and what the style config describes.

**Definition of done**: Preview accurately and smoothly reflects the current style and caption timing at any point in a video of any tested length.

---

## Phase 7 — Export

**Objective**: A user can render and download a real captioned MP4.

**Features**:
- `domain/subtitle-generator` (CaptionDocument + CaptionStyle → ASS content).
- FFmpeg render invocation (libass burn-in + encode) via `VideoProcessor.render`.
- `ExportJob` model + job runner integration, with real progress via FFmpeg `-progress`.
- Export UI: trigger, progress, success (download link), and failure states.
- Failure handling that leaves source video/transcript/style untouched.

**Files/modules likely involved**: `domain/subtitle-generator/*`, `services/video-processing/render.ts`, `app/api/render/route.ts`, `features/export/*`.

**Dependencies**: Phases 5 and 6 (needs finalized style + a validated preview experience to build confidence they'll match).

**Testing requirements**: Export a short video and a long (30+ min) video end to end; verify the output file plays correctly, audio is intact, captions are legible and correctly timed, and aspect ratio/resolution match the source; deliberately trigger a failure (e.g. malformed input) and verify the project remains intact.

**Definition of done**: A real captioned MP4 can be exported and downloaded for both a short and a long video, matching the preview, with honest progress and safe failure handling.

---

## Phase 8 — Long-Video Optimization

**Objective**: Validate and harden the whole pipeline specifically against long-form content.

**Features/activities** (mostly testing and fixing, not new features):
- Test with large files (multi-GB), long transcription (1–2 hour audio), long renders.
- Measure and fix memory usage under load.
- Improve processing reliability (retries, clearer failure messages, timeout handling).
- Verify/tighten temporary-file management (no orphaned temp files after a long run).
- Tune default Whisper model choice / FFmpeg encode settings for a reasonable speed/quality tradeoff on long content.

**Files/modules likely involved**: Cuts across `services/*`, `services/jobs/*` — primarily hardening existing code, not new modules.

**Dependencies**: Phase 7 (needs the full pipeline working end to end first).

**Testing requirements**: This phase *is* testing — real 30-minute, 1-hour, and (if feasible) 2-hour videos run through the entire pipeline with memory/time measurements recorded.

**Definition of done**: A 1+ hour video can go through the full journey (upload → transcript → edit → style → export → download) on the development machine without crashing, without unbounded memory growth, and with accurate progress throughout; documented practical duration/size ceilings are confirmed or adjusted based on real measurements.

---

## Phase 9 — Polish

**Objective**: Bring the UI/UX to the "real creative tool" bar described in `PRODUCT_REQUIREMENTS.md` and `DESIGN_SYSTEM.md`.

**Features**:
- Loading, empty, and error states audited across every screen (per `DESIGN_SYSTEM.md`).
- Accessibility pass (keyboard navigation, contrast, focus states, non-color-only indicators).
- Responsive pass for landing/upload/basic preview on mobile (not the full editor, per non-goals).
- Performance pass (re-render profiling, especially timeline/preview during scrubbing).
- Visual polish pass against `DESIGN_SYSTEM.md`.

**Files/modules likely involved**: Cuts across `components/*`, `features/*` — refinement, not new subsystems.

**Dependencies**: Phase 8 (polish only makes sense once the pipeline is proven reliable).

**Testing requirements**: Manual UX pass against the full Definition of Done in `PRODUCT_REQUIREMENTS.md` §9; accessibility audit (keyboard-only pass, screen reader spot check, contrast check).

**Definition of done**: The V1 Definition of Done in `PRODUCT_REQUIREMENTS.md` is met with a polished, accessible, honestly-stated UI for both short and long video journeys.

---

## Notes on Sequencing

- Phases 2–3 (video input, transcription) can have their service-layer work (FFmpeg/Whisper wrappers) started somewhat in parallel with Phase 1's later stages, but the editor UI phases (4–6) genuinely depend on having a real `CaptionDocument` to work against — avoid building caption UI against mocked data for long, since that risks exactly the kind of fake-functionality PROJECT.md Rule 6 warns against.
- Export (Phase 7) is deliberately sequenced *after* preview (Phase 6), not before, because the preview's fidelity to the eventual export is validated by having the export path to compare against — but the underlying `subtitle-generator`/style-resolver contract (`ARCHITECTURE.md` §9) should be designed once, before Phase 5, so Preview and Export are never built as two independent interpretations of a style.
- Long-video optimization (Phase 8) is its own phase rather than "tested throughout" specifically because PROJECT.md places heavy emphasis on long-form as a first-class scenario — a dedicated hardening pass makes sure that emphasis survives contact with a real implementation schedule, rather than being deprioritized under short-video-first development pressure.
