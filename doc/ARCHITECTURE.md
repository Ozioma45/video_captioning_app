# Caption Studio — Architecture

Status: Phase 0 proposal. Nothing in this document has been implemented yet.

---

## 1. System Overview

Caption Studio is a **modular monolith**: one Next.js application whose UI, editor state, caption/style domain logic, and processing services live in the same codebase, but are strictly layered so any piece (transcription provider, storage backend, rendering engine) can be swapped without touching the others.

The system has two runtime halves that must not be conflated:

- **Interactive half** (browser): upload UI, transcript/caption editor, style customization, live preview. Fast, synchronous, no video frames ever fully decoded into JS memory.
- **Heavy-processing half** (server / local worker process): metadata extraction, audio extraction, transcription, and final rendering. Slow, CPU-bound, job-based, must survive longer than a typical HTTP request.

The single biggest architectural decision this document makes is that **these two halves cannot both live inside Vercel serverless functions**. The interactive half can. The heavy-processing half needs a long-running process (a local Node server in development; a dedicated worker/VPS in production).

---

## 2. Architecture Diagram

```text
┌─────────────────────────────────────────────────────────────────┐
│                        Presentation Layer                       │
│   Next.js pages/routes · React components (shadcn/ui) · Canvas/ │
│   DOM caption overlay renderer                                   │
└───────────────────────────┬───────────────────────────────────┘
                             │ hooks / actions
┌───────────────────────────▼───────────────────────────────────┐
│                Application / Editor State Layer                 │
│   Zustand stores: project, playback, captionDocument, style,     │
│   exportJob. Client-only, framework-light, no I/O.               │
└───────────────────────────┬───────────────────────────────────┘
                             │ calls pure functions
┌───────────────────────────▼───────────────────────────────────┐
│                    Domain / Caption Engine Layer                 │
│   Pure TypeScript, framework-agnostic, no fetch/fs/ffmpeg:       │
│   - Segmentation engine (transcript → CaptionSegment[])          │
│   - Timing utilities (findActiveSegment, findActiveWord)         │
│   - Style resolver (CaptionStyle + time → resolved visual state) │
│   - ASS subtitle generator (CaptionDocument+Style → .ass text)   │
│   Runs identically in the browser (preview) and on the server    │
│   (export), because it is imported by both.                      │
└───────────────────────────┬───────────────────────────────────┘
                             │ async calls (HTTP / job queue)
┌───────────────────────────▼───────────────────────────────────┐
│                      Processing Services Layer                   │
│   Provider-abstracted interfaces, implemented server-side:       │
│   TranscriptionProvider · VideoProcessor · StorageProvider       │
│   JobRunner (in-process queue in V1)                             │
└───────────────────────────┬───────────────────────────────────┘
                             │ shells out / reads-writes disk
┌───────────────────────────▼───────────────────────────────────┐
│                          Infrastructure                          │
│   Local FFmpeg/ffprobe binary · Local whisper.cpp binary ·        │
│   Local filesystem (uploads/, temp/, exports/) · Node             │
│   child_process · (future: Postgres, S3-compatible storage)       │
└───────────────────────────────────────────────────────────────┘
```

Communication rules between layers:

- Presentation never talks to Processing Services or Infrastructure directly — only through Application State actions, which call either Domain functions (synchronous, in-process) or hit an API route (async, job-based).
- Domain layer has zero dependencies on React, Next.js, Node APIs, or FFmpeg. It is pure data-in/data-out TypeScript so it can be unit tested without a browser or a server, and so it can be safely imported by both a React component (preview) and a Node API route (export subtitle generation).
- Processing Services are the only layer allowed to spawn child processes or touch the filesystem/network. Everything is behind a small interface (`TranscriptionProvider`, `StorageProvider`, `VideoProcessor`) so a provider swap never leaks into UI or Domain code.
- Long-running Processing Services work is modeled as a **Job** (`TranscriptionJob`, `RenderingJob`, `ExportJob`) with a status the client polls or subscribes to — never a synchronous request that blocks on minutes of FFmpeg/Whisper work.

---

## 3. Major Modules

| Module | Responsibility | Depends on |
|---|---|---|
| `domain/caption-engine` | Segment transcripts into `CaptionSegment[]`, timing lookups | nothing (pure) |
| `domain/style-engine` | Resolve a `CaptionStyle` + timestamp into renderable visual state | `caption-engine` types |
| `domain/subtitle-generator` | Turn `CaptionDocument` + `CaptionStyle` into ASS subtitle text | `style-engine` |
| `services/transcription` | `TranscriptionProvider` interface + `LocalWhisperProvider` | infra (child_process) |
| `services/video-processing` | `ffprobe` metadata, audio extraction, FFmpeg render/encode | infra (child_process) |
| `services/storage` | `StorageProvider` interface + `LocalFilesystemStorage` | infra (fs) |
| `services/jobs` | In-process job runner, progress tracking, status persistence | services above |
| `state/*` | Zustand stores for project/playback/captions/style/export | domain types |
| `features/*` | Feature-level React composition (upload, editor, styles, export) | state, components |
| `components/*` | Presentational, style-agnostic UI primitives (shadcn-based) | none |

---

## 4. Data Flow (high level)

```text
User selects file
   → Upload feature streams file to /api/upload
   → StorageProvider writes to storage/uploads/{videoId}/source.mp4
   → VideoProcessor runs ffprobe → VideoMetadata
   → Project + Video records written (local JSON, see §11)
   → Client redirected into editor, video previewed via local blob URL
        while server-side processing continues in background

User triggers transcription (or it auto-starts on upload)
   → POST /api/transcribe { videoId } creates a TranscriptionJob
   → JobRunner: extract audio (ffmpeg) → LocalWhisperProvider.transcribe()
   → Raw provider output normalized into CaptionDocument (segments+words)
   → Job marked complete, CaptionDocument persisted
   → Client polls /api/jobs/{id}, loads CaptionDocument into editor state

User edits transcript / picks style / customizes
   → All in-browser, against Zustand state + domain pure functions
   → Autosave writes CaptionDocument + style refs back to local project file

User previews
   → HTML5 <video> is time source of truth
   → rAF loop reads video.currentTime → caption-engine finds active
     segment/word → style-engine resolves visual state → React renders
     overlay (DOM/CSS or Canvas)

User exports
   → POST /api/render { videoId, captionDocumentId, styleId, overrides }
     creates an ExportJob
   → subtitle-generator produces captions.ass in a job-scoped temp dir
   → FFmpeg burns via libass (`-vf "ass=captions.ass"`) + re-encodes
   → Progress parsed from ffmpeg `-progress` output, exposed via job status
   → On success, output file moved to storage/exports/, download link served
   → On failure, job marked failed; source video, transcript, and style
     configuration are untouched (Rule 8)
```

---

## 5. Video Processing Pipeline

```text
Upload → Validate → Extract Metadata → Extract Audio → Transcribe →
Normalize Transcript → Generate Caption Segments → Edit/Style →
Preview → Render → Encode → Export
```

| Stage | Where it runs | Why |
|---|---|---|
| Upload | Browser → Server (streamed) | Files must land on disk before FFmpeg/Whisper can touch them; browser only needs a local object-URL for instant preview, not the authoritative copy. |
| Validate | Server (authoritative) + Browser (fast feedback) | Never trust client-only checks; client check is UX sugar, server check (magic bytes, size, duration ceiling) is the real gate. |
| Extract Metadata | Server / local machine (`ffprobe`) | Needs the real file on disk; cheap and fast even for long videos. |
| Extract Audio | Server / local machine (`ffmpeg`) | Converts to 16kHz mono WAV once, so Whisper never touches raw video; also caps memory since audio is far smaller than video. |
| Transcribe | Server / local machine (Whisper) | CPU/GPU-bound, can take minutes on long audio — must be a background job, never inline in a request. |
| Normalize Transcript | Server or shared domain code (pure) | Converts provider-specific output into the internal `CaptionWord`/segment shape so the rest of the app never sees provider format. |
| Generate Caption Segments | Domain layer (pure, runs wherever it's called) | Deterministic function of transcript + segmentation rules; can re-run client-side instantly if the user changes max-words-per-caption without re-transcribing. |
| Edit / Style | Browser | Fully interactive, must feel instant; no server round trip needed except autosave. |
| Preview | Browser | Must run at video frame rate; uses the same domain style-resolution code the exporter uses. |
| Render | Server / local machine (FFmpeg) | CPU-bound, long-running for long videos — background job. |
| Encode | Server / local machine (FFmpeg, same process as render) | Combined with render in one FFmpeg invocation for V1; kept as a conceptually separate pipeline stage because a future implementation may split them (e.g. render captions to an intermediate, encode separately for multiple output resolutions). |
| Export | Server produces file; Browser downloads it | Server holds the authoritative rendered file; browser just requests the bytes. |

**Nothing above "Extract Audio" or below "Preview" should ever run as a synchronous Vercel serverless function invocation for anything but trivially short clips.** See §13.

---

## 6. Transcription Architecture

```ts
interface TranscriptionProvider {
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
}
```

- V1 ships exactly one implementation: `LocalWhisperProvider`, which shells out to a local `whisper.cpp` (or `faster-whisper`) binary via `execFile` (never a concatenated shell string — see Security, §14) and parses its JSON output into `TranscriptionResult`.
- `TranscriptionResult` always includes word-level timestamps (`words: { text, start, end }[]`) alongside segment-level text, even if a future provider naturally returns only segment-level timing — in that case the provider adapter must interpolate or mark words as `approximate: true` rather than silently dropping timing data.
- Providers never see or produce `CaptionSegment`/`CaptionStyle` — that's the domain layer's job. A `TranscriptionProvider` only knows "audio in, words with timestamps out."
- Swapping to `OpenAIWhisperProvider`, `DeepgramProvider`, etc. later means writing a new class behind the same interface and changing one config value — no other layer changes.

---

## 7. Caption Architecture

See §11 (data model) for full types. Key architectural points:

- The **original transcript** (as returned by the provider, normalized) is stored separately from the **edited transcript**. Editing never mutates provider output in place — it produces a new edited `CaptionDocument` state, so "reset to original transcript" is always possible without re-transcribing.
- Word-level timestamps are treated as first-class, permanent data — never discarded after segmentation. `CaptionSegment.words` always carries the underlying `CaptionWord[]` even after the user edits segment text. **Phase 4 decision, superseding this section's earlier "re-align" language**: editing a segment's text does not attempt to re-align the edited words to the preserved timing (that would require real diffing/NLP-ish guessing about which new word corresponds to which old timestamp). Instead the segment gains `wordsStale: true`, `words` is left exactly as it was, and any future consumer (word-highlight styles, word-accurate seeking) knows not to trust word-level sync for that segment until it's re-transcribed or re-split. Simpler, predictable, and never fabricates a timestamp — see `domain/caption-engine/captionMutations.ts`.
- Caption **segmentation is a derived, re-runnable transform**, not a one-time destructive step. The segmentation engine (`domain/caption-engine/segmentCaptions.ts`, built in Phase 4) takes `(words: CaptionWord[], rules: SegmentationRules) → CaptionSegment[]` as a pure function, so changing "max words per caption" recomputes segments instantly without touching transcription. Not yet wired to a "re-segment" UI action — see §22.

---

## 8. Caption Style Architecture

```text
Caption Data (CaptionDocument)
      ↓
Style Configuration (CaptionStyle, JSON-serializable)
      ↓
Style Resolver (domain, pure: style + time → resolved visual state)
      ↓
   ┌──────────────┴──────────────┐
   ▼                              ▼
Preview Renderer              Export Renderer
(DOM/CSS or Canvas,            (ASS subtitle generator
 browser)                       → FFmpeg libass)
```

- A style is **data, not a component.** All five V1 styles (Classic, Karaoke, Dynamic, Highlight, Podcast) are instances of the same `CaptionStyle` type with different field values (see PROJECT.md §15–17 for the type shape). There is exactly one `<CaptionOverlay style={style} />` component and one `assGenerator(style)` function — neither branches on "which of the 5 styles is this," they just read fields.
- Adding style #6 means adding a new `CaptionStyle` config object (and, if it needs a genuinely new animation behavior, one new case in the small, closed `AnimationConfig` union) — never a new React component or a new FFmpeg command template.
- **Styles are stored independently from caption documents.** A project holds a `CaptionStyleConfig = { baseStyleId, style }`: the preset it started from plus a full deep copy of that preset's `CaptionStyle`, which user edits modify. (An earlier sketch used sparse `styleOverrides` merged at resolve time; Phase 5 replaced it with a full copy because it needs no merge step, and a project keeps its look even if a preset is later revised.) Switching styles never touches the transcript. See §23.
- Animation is expressed through a small closed set of primitives (`fade`, `pop`/scale, `slide`, `wordHighlight`, `none`) chosen specifically because each one has a known, faithful ASS-tag equivalent (`\fad`, `\t` transforms, `\move`, `\k` karaoke). This constraint is deliberate — see §9.

---

## 9. Preview Architecture

```text
Video time (HTML5 <video>.currentTime, source of truth)
     ↕
Caption segment (caption-engine.findActiveSegment)
     ↕
Word timing (caption-engine.findActiveWord)
     ↕
Animation (style-engine.resolve → opacity/scale/color/position per word)
```

- The `<video>` element's `currentTime` is the single source of truth for "where are we." Nothing else (a separate playback clock, a Zustand `currentTime` field driving the video) is allowed to drift from it — Zustand's `currentTime` is a *read model* updated from the video element via `timeupdate` + a `requestAnimationFrame` loop for sub-tick smoothness, never the other way around.
- **The preview must not use any visual effect that cannot be reproduced by the exporter.** This is the core rule that prevents preview/export divergence (PROJECT.md §19 flags this as a risk). Concretely: the preview overlay is driven by calling the exact same `style-engine.resolve()` function that the export's ASS generator calls. If a style needs a CSS effect (e.g. a box-shadow blur) that has no ASS/libass equivalent, that effect is not allowed into `CaptionStyle` — it doesn't get added to either renderer's vocabulary.
- Practical implication: build the export (ASS) path's supported feature set first conceptually, then implement the preview strictly as a visual interpretation of that same feature set — not the other way around (don't build a flashy CSS preview and then discover FFmpeg can't reproduce it).

---

## 10. Export Architecture

**Recommendation: ASS (Advanced SubStation Alpha) subtitles burned in via FFmpeg's libass filter, generated from `CaptionDocument` + `CaptionStyle` by a pure generator.** *Built in Phase 7 — the as-built details, and where they differ from the sketch below, are in §26.*

Comparison of approaches considered:

| Approach | Verdict | Reasoning |
|---|---|---|
| **ASS subtitles + libass** (`-vf "ass=captions.ass"`) | **Recommended** | Purpose-built for exactly this: per-word karaoke highlighting (`\k`), position (`\pos`, `\an`), color (`\1c`, `\3c` for outline), fades and scale transforms (`\fad`, `\t`), all in one compact file FFmpeg burns in a single filter pass regardless of video length. libass ships with virtually all FFmpeg builds. Scales fine to hours of captions since it's a lightweight text file, not a filter graph. |
| **FFmpeg `drawtext` filter graphs** (one `drawtext` node per word/segment, gated with `enable='between(t,x,y)'`) | Rejected as primary | Works for a handful of static captions, but a 30–60 minute video with word-level highlighting means thousands of chained filter nodes — filter graph parsing/compile time degrades badly, command length can hit OS limits, and per-word color-swap highlighting is awkward to express. Kept as a documented fallback for extremely simple, static, non-word-highlighted styles or for debugging. |
| **Plain `.srt`/`.vtt` burned via `subtitles=` filter** | Rejected as primary rendering path | No word-level highlighting or animation support — loses the karaoke/dynamic/highlight styles entirely. Still valuable as a *separate export option* (sidecar subtitle file, see Unresolved Decision #11) since many creators want an editable subtitle file independent of the burned-in video. |
| **Browser-side canvas capture / WebCodecs re-encode** | Rejected for V1 | Immature/inconsistent cross-browser support for long-form, audio-preserving re-encode; would still need a server fallback for anything beyond trivial length, so it doesn't remove the server-side requirement — it just adds a second, less reliable code path. |

Export pipeline detail:

1. `subtitle-generator` (domain, pure) takes `CaptionDocument` (edited transcript) + `CaptionStyle` (+ overrides) → ASS file content as a string. No FFmpeg or filesystem knowledge in this function — fully unit-testable.
2. `VideoProcessor.render(videoPath, assContent, outputOptions)` writes the ASS string to a job-scoped temp file, then invokes FFmpeg with argument arrays (never a shell string — see Security), targeting output resolution/aspect ratio derived from the source video metadata (preserve by default, per PROJECT.md §20/§26).
3. FFmpeg is invoked with `-progress pipe:1`; the process wrapper parses `out_time_ms` against the known video duration to compute a real percentage, published to the job's status record.
4. Video and audio streams: video is re-encoded (H.264, CRF-based quality target, configurable) because burning captions requires re-encoding the video stream regardless; audio stream is copied (`-c:a copy`) whenever the source codec is MP4/AAC-compatible, avoiding unnecessary quality loss, falling back to re-encode only when the container/codec requires it.
5. Long videos are processed as a single FFmpeg invocation in V1 (no chunked/segmented rendering) — FFmpeg itself streams the video rather than loading it into memory, so duration mainly affects **wall-clock time**, not memory. Chunked parallel rendering is a valid future optimization, explicitly deferred (see Unresolved Decisions).
6. Failure handling: any non-zero FFmpeg exit marks the `ExportJob` `failed` with a captured (but user-friendly, translated) reason; the source video, `CaptionDocument`, and `CaptionStyle` are never touched by a failed render (Rule 8); temp files for that job are cleaned up; the user can retry render without re-transcribing.

---

## 11. Storage Architecture

- V1 uses a `StorageProvider` interface with one implementation, `LocalFilesystemStorage`, rooted at a `storage/` directory **outside** `src/` (gitignored):

```text
storage/
  uploads/{videoId}/source.{ext}
  temp/{jobId}/               ← audio.wav, captions.ass, work files
  exports/{videoId}/{exportId}.mp4
  projects/{projectId}.json   ← project + captionDocument + style refs
```

- No database in V1 (PROJECT.md §29 explicitly discourages one before the core editor works). Each project is one JSON file — small enough (transcripts, not video bytes) to read/write whole, and durable across browser refreshes without needing accounts.
- Future `SupabaseStorage`/`S3Storage`/`R2Storage` implementations satisfy the same `StorageProvider` interface; nothing above the services layer needs to change when that swap happens.
- Temp file cleanup: every job owns its own `temp/{jobId}/` subdirectory, deleted on job completion (success or failure) after a short retention window (useful for debugging a failed render), plus a startup sweep that removes orphaned temp directories older than a configurable TTL.

---

## 12. Long-Video Strategy

Duration is treated as a continuous variable, not a boolean "short vs. long" branch, but the following practices matter more as duration grows:

- **Never buffer a full video into memory.** Upload is streamed to disk (not buffered in a Node request handler's memory, not accumulated in a JS `Buffer`/array). FFmpeg/Whisper read from disk, not from an in-memory blob passed around the app.
- **Browser never holds the authoritative video bytes** — only a local `URL.createObjectURL` reference for instant local preview before/independent of upload completion, and the `<video>` element streams from that or from the server afterward. React/Zustand state holds metadata and captions, never video bytes (PROJECT.md §35, Rule "never put huge video blobs in React state").
- **All heavy stages are background jobs with real, stage-based progress** (upload %, extraction, transcription, rendering %), never a spinner with no feedback for a 40-minute operation.
- **Temp storage headroom**: a render job transiently needs roughly source size + extracted audio (small) + output size (~ same order as source) on disk — plan for ~2.5× source file size of scratch space during a render, cleaned up immediately after.
- **Processing time is expected to scale roughly with duration**, not spike unpredictably — set user expectations with an estimated time (derived from duration × a measured local throughput factor) rather than a fake percentage.
- **Development vs. production differ materially here** — see §13.

---

## 13. Deployment Considerations

**Do not assume Vercel serverless functions can run unlimited long-form FFmpeg/Whisper jobs.** Serverless execution-time and memory ceilings (seconds-to-minutes, capped RAM/disk) are fundamentally incompatible with a 1–2 hour video's transcription or render time.

- **Development**: everything (Next.js dev server, FFmpeg, Whisper binaries) runs on the developer's local machine as one long-lived Node process. No time limit, real local CPU, real local disk. This is the primary target environment for Phase 0 through the end of the "long-video optimization" phase (PROJECT.md Phase 8).
- **Production (future, not V1-blocking)**: the Next.js app (UI, lightweight API routes: create-job, check-status, list-projects) can deploy to Vercel or similar. The actual FFmpeg/Whisper work must run on a **separate, always-on worker process** — a small VPS, Fly.io/Railway machine, or self-hosted box with persistent disk and no execution-time ceiling — that the Next.js API talks to (initially: same-process if self-hosting the whole app on a VPS instead of Vercel at all; later: a queue/HTTP call to a separate worker). This is exactly the `VideoProcessingProvider` abstraction point (`LocalFFmpeg` vs. `CloudVideoProcessor`) PROJECT.md §46 anticipates.
- **V1 recommendation**: don't solve production deployment yet. Build the app as a single Node-hostable application (works great self-hosted on one VPS, or run locally) so the *architecture* is deployment-ready, but treat "deploy processing to Vercel" as explicitly out of scope until a dedicated worker exists. This is called out again in Unresolved Decisions.

---

## 14. Security Considerations

- **Never build FFmpeg/Whisper commands via string concatenation or a shell.** Always use `child_process.execFile`/`spawn` with an argument array. This eliminates command injection by construction — a malicious filename or transcript text can never be interpreted as a shell token.
- **Validate uploads by content, not just extension/MIME header** — sniff magic bytes / use `ffprobe` itself as the validator (if ffprobe can't identify it as a video, reject it) rather than trusting the browser-reported MIME type.
- **Enforce a configurable file size ceiling and duration ceiling** server-side (V1 default: ~2 hours / ~2GB, see Unresolved Decisions #4–5) — not to arbitrarily restrict legitimate long videos, but to bound worst-case resource usage and give a clear, honest rejection message rather than an OOM crash.
- **Sanitize/regenerate filenames.** Never use the user-supplied filename as a path component; generate an internal id (`videoId`) and store the original filename only as metadata for display/download purposes.
- **Isolate each job's working files** in its own temp subdirectory (`temp/{jobId}/`) so one job's files can never collide with or overwrite another's, and cleanup is a simple directory removal.
- **Process isolation**: FFmpeg/Whisper subprocesses run with the least privilege practical, with a timeout/kill safeguard so a hung or adversarial input can't run forever.
- **Temporary file cleanup** is mandatory, not optional — uploaded videos and extracted audio may contain private conversations (PROJECT.md §41); delete temp working files as soon as a job completes (success or failure), and never log full transcript contents to shared/persistent logs.
- **Storage access control**: in V1 (no auth), anyone with access to the local server can access any project file — acceptable for a single-user local tool, explicitly **not** acceptable once the app is exposed to multiple untrusted users; flagged as a hard prerequisite before any multi-user/cloud deployment (ties to Unresolved Decision #7, Authentication).

---

## 15. Technology Decisions

See `PRODUCT_REQUIREMENTS.md` is not the place for this — full stack review with keep/replace rationale lives in this section, condensed:

| Technology | Decision | Notes |
|---|---|---|
| Next.js (App Router) | Keep | Serves both UI and lightweight API routes; one codebase for the modular monolith. |
| React + TypeScript | Keep | Non-negotiable for a stateful, type-sensitive editor like this. |
| Tailwind CSS + shadcn/ui | Keep | Fast, consistent, unopinionated-enough to support a custom "creative tool" look (see `DESIGN_SYSTEM.md`). |
| FFmpeg (local binary) | Keep, server/local-only | Primary processing engine, invoked via `execFile`, never FFmpeg-WASM for the main render path (see §13, §10). |
| FFmpeg-WASM | Optional, narrow use only | Could power lightweight client-side thumbnail/scrubbing previews later; never the export path. Not needed for V1. |
| Whisper | Keep, local via `whisper.cpp` | Free, runs on CPU via `execFile`, supports word-level timestamps (`--word-timestamps`). Resolved per Unresolved Decision #2. |
| Zustand | Add | Lightweight, selector-based state management well suited to high-frequency playback-time updates without the boilerplate of Redux; fits "editor state separate from server state" requirement (PROJECT.md §36). |
| Supabase | Defer | Not needed while there's no auth/DB/multi-user requirement; keep `StorageProvider`/future DB access behind interfaces so it can be added without a rewrite. |
| Vercel | Keep for UI only | Good fit for the Next.js frontend/light API; explicitly **not** used for FFmpeg/Whisper jobs (§13). |
| Local filesystem | Keep for V1 | Simplest possible `StorageProvider` implementation; matches "no DB/no cloud needed yet." |

---

## 16. Technical Risks

See `PROJECT.md` risk prompts — full risk register:

1. **Serverless execution limits vs. long-form processing** — the single biggest architectural risk if unaddressed; mitigated by the local-worker-first, Vercel-for-UI-only deployment model (§13).
2. **Preview/export visual divergence** — mitigated by forcing both renderers through one shared `style-engine.resolve()` function and restricting `CaptionStyle` to effects with a known ASS equivalent (§9).
3. **Whisper transcription time on long audio** — a 1–2 hour episode can take tens of minutes on CPU depending on model size; mitigated by treating transcription as an always-async job with honest progress, and by defaulting to a smaller/faster model in development (configurable).
4. **FFmpeg render time on long, high-word-count videos** — mitigated by choosing ASS over `drawtext` filter graphs specifically because ASS doesn't degrade with word count (§10).
5. **Memory blow-up from treating video as an in-memory blob** — mitigated by the "stream to disk, never buffer" rule (§12) and the explicit "no video blobs in React state" rule.
6. **Disk exhaustion from uncleaned temp files** — mitigated by per-job temp directories with mandatory cleanup + startup sweep (§11).
7. **Command injection via filenames or transcript text passed to FFmpeg** — mitigated by mandatory `execFile`/argument-array invocation, never shell strings (§14).
8. **Silent loss of word-level timestamps during editing** — mitigated by the caption architecture keeping `CaptionWord[]` attached to segments through edits, and treating segmentation as a re-runnable derived transform rather than a destructive one (§7).
9. **Large uploads failing/timing out** — mitigated by streaming upload directly to disk rather than buffering, and (future) resumable/chunked upload for very large files — flagged, not required for V1's initial cut (Unresolved Decision #5).
10. **Fake or dishonest progress indicators** — mitigated by deriving progress from real signals (FFmpeg `-progress`, Whisper stage/segment counts) and falling back to honest stage-based ("Transcribing…") rather than invented percentages when exact numbers aren't available (PROJECT.md §38 is explicit about this).

---

## 17. Unresolved Decisions

Decisions marked **Resolved** below were confirmed by the project owner during Phase 0 review; everything else remains a recommendation pending confirmation before it becomes load-bearing for later phases.

### 1. Browser vs. server vs. local processing
- **Option A**: Do all heavy processing (transcription, rendering) server/local-machine-side, browser stays purely interactive. **Option B**: Push some work into the browser via WASM (ffmpeg.wasm, whisper.wasm). **Option C**: Hybrid — interactive/light work (thumbnails, quick previews) in-browser, everything else server/local.
- **Recommendation: Option C**, with heavy lifting strictly server/local. Browser WASM for transcription/rendering can't handle multi-hour audio/video within practical memory/time, and duplicating logic across two runtimes risks preview/export divergence.
- **Why it matters**: gets the whole system's resource model right from day one; hard to retrofit later.

### 2. Whisper implementation — **Resolved**
- Chosen: **whisper.cpp**, invoked as a local binary via `execFile`. Rejected for now: faster-whisper (adds a Python runtime dependency), OpenAI Whisper API (paid, contradicts free-first default).
- **Why it matters**: determines the `LocalWhisperProvider` implementation and dev-environment setup instructions.

### 3. FFmpeg rendering strategy
- **Option A**: ASS subtitles + libass burn-in. **Option B**: `drawtext` filter graphs. **Option C**: Plain SRT/VTT via `subtitles=` filter.
- **Recommendation: Option A** (already adopted in §10) — only degrades gracefully with long, word-heavy videos and supports karaoke/highlight/animation natively.
- **Why it matters**: affects the entire export pipeline and the ceiling on how expressive caption animation can be.

### 4–5. Maximum video duration / file size — **Resolved**
- Chosen: **2 hours / ~2GB** as the V1 design-and-test ceiling (matches the upper bound named in `PROJECT.md`'s own examples). This is a *soft, configurable* validation limit, not an architectural hard-code — enforced in one place (upload validation) so it can be raised later without touching the pipeline.
- **Why it matters**: sizes Phase 8 hardening tests, sets upload/validation rejection behavior, and bounds worst-case temp-storage/job-duration planning.

### 6. Local vs. cloud storage
- **Option A**: Local filesystem only for V1. **Option B**: Cloud storage (Supabase/S3/R2) from the start.
- **Recommendation: Option A** — no multi-user/deployment need yet; `StorageProvider` interface keeps Option B a later swap, not a rewrite.
- **Why it matters**: avoids introducing cloud costs/credentials before there's a reason to.

### 7. Authentication
- **Option A**: No auth in V1. **Option B**: Minimal auth (single shared login) from the start.
- **Recommendation: Option A**, per `PROJECT.md` §30 — the goal is proving the pipeline works, not access control.
- **Why it matters**: determines whether Phase 1 scaffolding needs any session/user concept at all (it shouldn't).

### 8. Database
- **Option A**: No database, project state as local JSON files. **Option B**: Lightweight embedded DB (SQLite). **Option C**: Full server DB (Postgres/Supabase).
- **Recommendation: Option A** for V1, per `PROJECT.md` §29 — transcripts are small; a JSON-per-project file is sufficient and trivially inspectable/debuggable during development.
- **Why it matters**: a DB introduces migration/schema overhead V1 doesn't need yet.

### 9. Project persistence
- **Option A**: Projects persist to disk automatically (autosave), surviving browser refresh, with no account needed. **Option B**: Projects are session-only, lost on refresh.
- **Recommendation: Option A** — `PROJECT.md` allows a "temporary/local project model" but losing a user's transcript edits on an accidental refresh would be a bad experience for zero architectural savings.
- **Why it matters**: determines whether autosave/project-file logic is built in Phase 1 or skipped entirely.

### 10–11. Export format / subtitle file export — **Resolved**
- Chosen: **Burned-in MP4 only for V1**; no standalone SRT/VTT export. Revisit post-V1 — it's a low-effort addition later since word-level timing is already preserved in the data model, so nothing here forecloses it.
- **Why it matters**: keeps the Phase 7 export scope to exactly one rendering path.

### 12. Caption animation architecture
- **Option A**: Small closed set of animation primitives (fade/pop/slide/word-highlight/none) each with a known ASS equivalent. **Option B**: Open-ended, arbitrary CSS-driven animation in preview.
- **Recommendation: Option A** (already adopted in §8–§9) — Option B is exactly what causes preview/export divergence.
- **Why it matters**: defines the entire `AnimationConfig` type and what "adding a new style" is allowed to mean.

### 13. Preview rendering technology
- **Option A**: DOM/CSS-based caption overlay. **Option B**: Canvas-based overlay.
- **Recommendation: Option A (DOM/CSS)** to start — simpler to build and debug, sufficient for the fade/pop/slide/highlight primitive set in §12, and easier to keep accessible (real text nodes). Revisit Canvas only if a specific style's timing precision or layering need proves DOM insufficient.
- **Why it matters**: affects the preview component's implementation approach in Phase 6; not yet confirmed with the project owner.

### 14. Long-video job processing
- **Option A**: In-process job runner (async functions + an in-memory/on-disk status map) for V1. **Option B**: External queue (Redis/BullMQ or similar) from the start.
- **Recommendation: Option A** — `PROJECT.md` §39 explicitly warns against introducing Redis/queues before they're actually needed; a single local Node process handling one job at a time is sufficient until concurrent multi-user load exists.
- **Why it matters**: avoids premature infrastructure; the `JobRunner` is still built behind an interface so swapping to a real queue later (production, multi-worker) doesn't require touching call sites.

---

## 18. Folder Structure

Established in Phase 1. Reflects the layering in §2-3, with two deliberate deviations from a "create every module folder up front" approach, explained below.

```text
src/
├── app/                    Next.js routes (App Router): layout, pages, and
│                            (from Phase 2 on) API route handlers.
├── components/
│   ├── ui/                 Style-agnostic primitives (shadcn/ui pattern,
│   │                        cva-based). Added incrementally as the editor
│   │                        needs them — not a bulk import of the library.
│   └── shared/              Small presentational components shared across
│                            more than one feature (e.g. AppHeader).
├── types/                   Shared TypeScript types: Video, CaptionWord,
│                            CaptionSegment, CaptionDocument, CaptionStyle,
│                            Project, ProcessingState, Job. The single
│                            source of truth for data shape across the app.
├── services/                Provider-abstracted interfaces only in Phase 1
│   ├── transcription/        (TranscriptionProvider). Concrete
│   ├── video-processing/     implementations (LocalWhisperProvider,
│   └── storage/               FFmpeg-backed VideoProcessor,
│                              LocalFilesystemStorage) land in Phases 2-3
│                              and 7 behind these same interfaces.
├── stores/                  Zustand store shells: project, playback,
│                            caption, style, processing. Holds metadata/ids
│                            only — never video bytes.
├── lib/                     Generic, domain-free utilities: cn() (class
│                            merging), id generation, time/size formatting.
└── config/                   App-wide constants: name, and the V1
                              duration/file-size ceilings confirmed in
                              Phase 0 (2 hours / ~2GB), kept in one place so
                              they're configurable, not hard-coded.
```

**Deliberately not created yet** (see CLAUDE.md "do not build ahead" / PROJECT.md §18 in the Phase 1 brief):

- **`domain/`** (`caption-engine`, `style-engine`, `subtitle-generator`) — this is where real segmentation, style-resolution, and ASS-generation *logic* will live. Phase 1 only defines the *data* those functions will operate on (`types/`); writing the functions now would mean implementing caption generation/synchronization ahead of schedule, which Phase 1 explicitly forbids. It arrives incrementally: `caption-engine/segmentation.ts` in Phase 4, `style-engine/resolve.ts` in Phase 5, `subtitle-generator/` in Phase 7.
- **`features/`** (`upload/`, `editor/`, `styles/`, `export/`) — feature-level composition has nothing to compose yet; the app shell lives directly in `app/` and `components/shared/` until Phase 2 gives it real content.
- **`hooks/`** — no custom hook has a reason to exist before real playback/upload wiring; introduced starting Phase 2.

Creating empty placeholder directories for these (git doesn't track empty folders, so it would mean placeholder files with no content) was judged worse than documenting the plan here and creating each folder when its first real file is written.

---

## 19. Summary of Cross-Cutting Rules

These recur throughout the document and are restated here because they constrain every subsystem:

- The domain (caption/style engine) layer is pure, framework-free TypeScript shared by preview and export — this is what keeps them from diverging.
- Nothing heavy runs synchronously in a request/response cycle — everything beyond metadata extraction is a background job with real progress.
- Styles are configuration, never components; adding a style must never require touching the renderer.
- Nothing about video bytes ever sits in React/Zustand state or gets JSON-serialized into a job payload — only paths/ids.
- Every subprocess call uses argument arrays, never shell string interpolation.

---

## 20. Phase 2 Implementation Notes

Four decisions made while building Video Input that refine (never contradict) the Phase 0/1 architecture:

1. **ffprobe via `@ffprobe-installer/ffprobe`, not an assumed system install.** The dev machine had no system FFmpeg/ffprobe. Rather than requiring every contributor to install FFmpeg system-wide (an environment change outside the project), `@ffprobe-installer/ffprobe` ships a real, pinned ffprobe binary as an ordinary npm dependency (same pattern as `esbuild`/`swc`: a per-platform optional-dependency package, no postinstall network fetch). `npm install` alone now gives a working ffprobe on any supported platform — closer to the "free-first, low-friction dev setup" goal than assuming a system package. `FfmpegVideoProcessor` still invokes it via `execFile` with an argument array exactly as ARCHITECTURE.md §14 requires.
2. **Upload is a raw streamed request body, not multipart/form-data.** Next.js Route Handlers buffer the entire body in memory when you call `request.formData()`; reading `request.body` directly as a stream and piping it to disk does not. For a file that can legitimately be 2GB, this is not a style preference — multipart parsing would contradict "never buffer the whole file in memory" (§12). The client sends the file as a raw XHR body (for real upload-progress events) with the original filename in an `X-Filename` header instead of a form field.
3. **`StorageProvider` gained `createReadStream(key, range?)`.** Documented in `services/storage/StorageService.ts` and summarized in §11: `read()` returning a whole `Buffer` cannot serve a multi-GB file's HTTP Range requests (required for native `<video>` seeking) without either buffering the whole file or giving up seek support. The addition generalizes to future cloud providers, all of which support ranged GETs.
4. **Two Phase 1 types grew one field each, additively:** `VideoMetadata.containerFormat` (ffprobe's `format_name`, needed to pick a correct streaming `Content-Type`) and `ProcessingStage` gained `"processing_metadata"` (the gap between "bytes fully uploaded" and "ffprobe has finished" needs its own honest, non-percentage stage — see PROJECT.md §38). Both are additive; nothing that read these types in Phase 1 breaks.

Preview strategy clarification: the player streams from `GET /api/videos/[videoId]/stream` (Range-aware, backed by `createReadStream`) rather than a client-side object URL. This was chosen over the "instant local preview while uploading" idea floated in §4/§12 — that remains a valid future enhancement, not implemented here — because it avoids running two different preview code paths (blob-before-upload vs. server-after-upload) for a first cut, and it satisfies the Phase 2 brief's literal requirement ("after successful upload and validation, display a real preview") with less code.

---

## 21. Phase 3 Implementation Notes

**whisper.cpp integration.** `WhisperCppTranscriptionProvider` (`services/transcription/`) implements the Phase 1 `TranscriptionProvider` interface exactly as §6 describes: it is the *only* place that knows whisper.cpp's CLI arguments or JSON output shape. It is invoked via `spawn` with an argument array (never a shell string), against a binary/model path read from `config/whisper.ts` — themselves sourced from `WHISPER_BINARY_PATH`/`WHISPER_MODEL_PATH` environment variables, never a hard-coded path. Neither the binary nor a model ships with this repo (see `.env.example` for setup) — both are either native binaries or multi-hundred-MB files, and PROJECT.md is explicit that neither belongs in version control.

**Word-level timestamps.** The provider requests whisper.cpp's `--output-json-full` (`-ojf`) output specifically, not the plainer `-oj`, because only the "full" mode includes a per-token `tokens[]` array with real timestamps — the officially documented mechanism for word-level timing, rather than the older `-ml 1` (max-segment-length=1) trick some whisper.cpp guides use, which produces awkward artificial segmentation instead of genuine word timing. Each token is treated as one `CaptionWord`; this is accurate for English in the common case but whisper.cpp's tokens can be sub-word BPE pieces for some languages/rare words — disclosed here and in code comments rather than silently assumed perfect (CLAUDE.md "preserve word-level timestamps... mark as approximate rather than silently dropping"). Special/control tokens (`[_TT_123]` and similar) are filtered out before they ever reach a `CaptionWord`.

**Configuration-missing is a distinct error, never "invalid video."** `assertWhisperConfigured()` does a real filesystem check *before* anything is spawned, and the job runner calls it *before* audio extraction even starts (not just inside the provider) — so a missing setup fails in milliseconds with a clear "not set up" error, not after wasting an ffmpeg pass, and never resembles the Phase 2 "invalid video" failure mode. This was manually verified end to end (see the Phase 3 completion report's Real E2E Verification section).

**Real, honest progress differs by stage — deliberately.** Audio extraction (ffmpeg) genuinely reports `-progress` output, so `services/video-processing/parseFfmpegProgress.ts` parses the human-readable `out_time=HH:MM:SS.ssssss` field (verified directly against the project's installed ffmpeg build — `out_time_ms` is actually microseconds in this build, a known long-standing ffmpeg quirk, so the ambiguous field is avoided entirely) into a real 0-100 percent. Transcription itself is reported as **indeterminate** (`progressPercent: null`) — whisper.cpp's streaming console output could theoretically be parsed for approximate progress, but doing so without a real binary available in this environment to verify the exact format against would mean shipping an unverified, version-fragile parser; PROJECT.md §38 explicitly sanctions an indeterminate state over a guessed one.

**Normalization boundary.** `domain/caption-engine/normalizeTranscription.ts` is the first real file in `domain/` (exactly where DEVELOPMENT_PLAN's Phase 3 row said it would land), and is provider-agnostic: it consumes the already-normalized `TranscriptionResult` type, never whisper-specific shapes. It also carries a fallback most providers won't need: if a future provider returns segment-level text with no word breakdown at all, words are evenly interpolated across the segment and marked `approximate: true` rather than the document failing outright — the same "disclose, don't fake" principle as elsewhere.

**Caption segmentation (superseded — see §25).** Phase 3 originally used whisper.cpp's own segment boundaries as-is for `CaptionDocument.segments`. Manual use of the Phase 6 preview showed that was wrong: the boundaries were whole 30 s windows. `normalizeTranscription` now flattens the provider's words and runs `segmentCaptions`.

**In-process job runner, not a queue.** `runTranscriptionJob` (`services/jobs/`) follows the same JSON-file-per-record pattern Phase 2 established for videos (`videoRecordStore`) — one file per `TranscriptionJob`, no database (Unresolved Decision #14, still Option A). The route handler (`POST /api/transcribe`) does not await it; the client polls `GET /api/jobs/[jobId]`. A small in-memory `Map<jobId, CancellableProcessHandle>` (`transcriptionJobStore.ts`) exists purely as a seam for a future cancel endpoint — no cancellation UI or queue was built, matching the brief's "avoid an architecture where the subprocess can't eventually be terminated" without building the feature itself.

**Cleanup.** Extracted audio and whisper's output JSON both live under `storage/temp/{jobId}/`, deleted as one directory in a `finally` block regardless of success or failure — the same whole-directory-delete pattern the Phase 2 debugging incident led to for uploads (§20 note; `LocalFilesystemStorage.delete` already handles directories).

**Shared exec-error classification.** The "string errno code = tooling problem, numeric exit code = the tool ran and rejected its input" distinction from the Phase 2 incident (§20) is now a shared helper, `lib/execErrorClassification.ts`, used by ffprobe, ffmpeg, and whisper.cpp's error classifiers alike — one rule, three call sites, not three copies (CLAUDE.md "do not duplicate logic").

---

## 22. Phase 4 Implementation Notes

**Scope boundary vs. this document's own earlier Phase 4 sketch.** DEVELOPMENT_PLAN.md originally listed a caption timeline component and "active-caption highlighting synced to `video.currentTime`" as Phase 4 features. The Phase 4 brief actually received was more specific and explicitly reserved that direction — video time driving which caption is highlighted — for Phase 6 ("synchronized visual caption preview"). Phase 4 only builds the other direction: selecting a caption (click or keyboard) commands the player to seek, one-way. Following the more specific, more recent brief over the earlier speculative planning doc; DEVELOPMENT_PLAN.md's Phase 4 entry has been rewritten to match what was actually built, not left claiming an unbuilt timeline.

**One seek command, not two-way binding.** `usePlaybackStore` gained `seekRequestSeconds`/`requestSeek`/`clearSeekRequest`. `VideoPlayer` is the only place that applies it to the real `<video>` element (via a ref it didn't need before Phase 4) and immediately clears it. Selection → seek is centralized in `CaptionEditor`'s one effect, keyed only on `selectedSegmentId` — deliberately *not* keyed on the caption document itself, otherwise every text/timing edit to the selected caption would re-trigger a seek back to its own start time on every commit, which would be a real, visible bug (the video jumping while you type).

**Re-render cost is controlled by object-identity, not a virtualization library.** Every function in `captionMutations.ts` copies the segments array shallowly and only replaces the object(s) that actually changed; every other segment keeps its exact prior reference. `CaptionItem` selects its own segment by id (`segments.find(s => s.id === id)`); `CaptionList` selects only the array of ids with `zustand/react/shallow`'s `useShallow`. Together: editing one caption's text or timing re-renders exactly that `CaptionItem`, not its siblings, and not `CaptionList` itself (which only re-renders when a segment is added/removed/reordered — split or merge). No virtualization library was added; the component boundary (`CaptionEditor → CaptionList → CaptionItem`) is deliberately where one could be inserted later without touching `CaptionItem`.

**Local edit state, committed on blur/Enter — not per keystroke.** Both the text `<textarea>` and the `MM:SS.ss` timing inputs hold their live value in component-local `useState`, only calling into `useCaptionStore` (and from there, the pure domain functions) when the user blurs the field or presses Enter. Escape reverts to the last committed value. This is what actually satisfies "don't do expensive work on every keystroke" — the object-identity work above controls the *blast radius* of an update, but committing on every keystroke would still mean one full domain-function call + Zustand notification per character typed.

**Real E2E testing surfaced one Phase 3 bug, fixed here.** A real whisper.cpp run against a long (~18s, unsegmented into multiple whisper-level segments) test clip leaked a literal `<|endoftext|>` token into the word list — `parseWhisperCppOutput.ts`'s special-token filter only recognized the older bracket convention (`[_TT_123]`), not this tokenizer's angle-pipe convention. Fixed by broadening the filter; regression test added using the exact observed token/position. The same real run also produced many consecutive words sharing an identical, degenerate timestamp (a known long-segment alignment artifact, not a bug in this codebase) — confirmed `splitCaption` already rejects a split that would land on it cleanly (`InvalidCaptionSplitError`) rather than producing a corrupt zero-duration segment; a regression test captures this real shape too.

**Manual E2E verification was real but partial.** The full backend pipeline (upload → ffmpeg → whisper.cpp → normalize → `CaptionDocument`) was re-verified end to end with real audio after the bug fix above. The client-side editor interactions (clicking a caption, typing an edit, clicking split/merge, arrow-key navigation, confirming the video actually seeks) were not verified by literally operating a browser — no browser-automation tool is available in this environment. See the Phase 4 completion report for the precise boundary between what was tested for real and what was verified only by code review and the automated test suite.

---

## 23. Phase 5 Implementation Notes

**Model.** `CaptionStyle` (`types/style.ts`) is plain serializable data grouped as typography, colors, background, outline, shadow, position, `highlightMode`, `animation`, `maxLines`. It is independent of `CaptionWord`/`CaptionSegment`. Colors are `#RRGGBB`; fonts are ids from a fixed registry (`domain/style-engine/fonts.ts`: self-hosted Inter and system sans/serif/mono stacks — no remote font host); sizes and offsets are pixels in a 1080-line reference frame so a renderer scales them to any resolution or aspect ratio. No raw CSS lives in state.

**Registry vs. project config.** Presets live in `styleRegistry.ts` as deep-frozen data. `createStyleConfig(id)` returns `{ baseStyleId, style: structuredClone(preset) }`; edits go through `patchCaptionStyle`, which shallow-merges per group, validates the result, and throws `InvalidStyleError` instead of storing an invalid style. `resetStyleConfig` re-clones the base preset. The global presets are never mutated. `isStyleModified` drives the "modified" indicator.

**Validation.** `validateCaptionStyle` returns every issue (path + message) and never throws; ranges are in `STYLE_LIMITS` and shared with the UI sliders so the two can't drift.

**Animation and word-highlight configuration.** `AnimationKind` is the closed set `none | fade | pop | slide | wordHighlight` (each has an ASS equivalent, per §8) with a duration. `HighlightMode` is `none | activeWord | emphasis`. These are *declarations of intent*: nothing in Phase 5 plays an animation or decides which word is active. The preview in the picker is static; it marks a fixed sample word only to show the highlight color.

**Fonts and export.** Preview uses `next/font/local` Inter via a CSS variable. Phase 7's libass render cannot see browser fonts; it will need the same Inter file supplied to FFmpeg (`fontsdir`) or an installed font. Licensing: Inter is SIL OFL 1.1.

**Deferred.** Phase 6: overlay renderer, playback sync, active-word tracking, running animations. Phase 7: ASS generation and burn-in, font provisioning. Later: persisted/named user presets, project persistence of the style config.

**UI placement.** Styling lives in a right-hand inspector (Info | Style tabs), not the bottom caption workspace, so the editor keeps its full width.

---

## 24. Phase 6 Implementation Notes

**Data flow.** `video.currentTime` (source of truth) → `usePlaybackStore.currentTime` (read model) → `findActiveSegment` → `findActiveWord` → `resolveCaptionDisplay` → `CaptionOverlay`. Nothing is stored between those steps, so a seek can never leave a stale caption.

**Where this diverges from §9.** §9 sketched `style-engine.resolve()` shared with the exporter and a Zustand `currentTime` fed by `timeupdate` + rAF. As built: there is no `resolve()` yet — `styleToCss` maps a `CaptionStyle` to CSS for the preview, and Phase 7 will need its own ASS mapping from the same fields. Every style field is intended to be expressible in libass (outline, shadow, box background, colors, fade/pop/slide via ASS tags), but preview-vs-export parity is *not yet verified* and is a Phase 7 concern.

**Units.** Seconds throughout. The caption model, Whisper output and the video element all use seconds; a millisecond boundary would add conversions and rounding for no benefit.

**Boundary convention.** `start <= t < end` for segments and words. Adjacent segments hand off exactly at the shared boundary; there is no frame where two show or none shows.

**Synchronization.** One sync effect in `VideoPlayer`: `seeking`/`seeked`/`timeupdate` write the time, `play`/`playing` start a single `requestAnimationFrame` loop and `pause`/`ended` stop it (and write the final time). `timeupdate` alone (~4 Hz) is too coarse for word highlighting; the loop runs only while playing. `setCurrentTime` ignores unchanged values.

**Performance.** The overlay subscribes with selectors that return the active segment/word *objects*, so a per-frame time update re-renders it only when the caption or word changes. Measured in a real browser during Karaoke playback: 0 DOM mutations in the caption editor list, ~25 overlay mutations over ~360 frames. The document is never rewritten by playback. Segment lookup is O(log n); word lookup is a linear scan of one segment's words.

**Word timing and fallbacks.** Word highlighting uses the real Whisper word timestamps only. If a segment has no words, its words are stale (text was edited, per Phase 4's `wordsStale`), or the timing is malformed, the overlay renders the segment's current text without highlighting — it never estimates timing. Consequence: after editing a caption's text, Karaoke/Dynamic show that caption without word highlighting until word timing can be re-derived (not built).

**Renderer architecture.** The brief suggested a renderer component per preset. That contradicts CLAUDE.md ("adding a style must never require a new component") and §8, so a single data-driven `CaptionOverlay` is used: behavior comes from `highlightMode` and `animation.kind`, not from a preset id. The five looks are the five presets' data. `AnimationKind` maps to keyframes in `globals.css` through a closed lookup: `fade`/`pop`/`slide` play once when a caption mounts and finish in the resting state, so nothing lingers after the caption ends; `wordHighlight`/`pop` also transition the active word's color (and scale, for pop). `prefers-reduced-motion` disables them.

**Overlay geometry.** The overlay is `absolute inset-0` inside a box that wraps only the video, with `container-type: size`. Style pixel values (1080-line reference) become `cqh` units, so text and offsets scale with the video's rendered height through window resize, layout changes and fullscreen without any JS measurement. `pointer-events: none` keeps the native controls usable. Native fullscreen only fullscreens the `<video>` element (dropping the overlay), so the native fullscreen button is disabled (`controlsList="nofullscreen"`) and the player provides its own that fullscreens the video+overlay box; in fullscreen the box is sized to the video's aspect ratio so the overlay stays aligned when letterboxed.

**Highlight style.** `highlightMode: "emphasis"` has no keyword data behind it. It emphasizes the segment's last word (same as the style picker sample) — a placeholder, not keyword detection.

**Phase 7 remaining.** ASS generation and burn-in, font provisioning for libass, and a preview-vs-export parity check.

---

## 25. Caption Segmentation & Timing Quality (post-Phase 6 correction)

**Symptom.** In the Phase 6 preview, captions were paragraph-sized and drifted from the speech (up to ~11 s late near the end of a 40 s clip). The overlay was correctly rendering the data it was given; the data was bad.

**Root cause (two defects, both before the caption model).**
1. `WhisperCppTranscriptionProvider` passed `-nt` (`--no-timestamps`). That disables whisper's timestamp tokens: the output collapsed into one segment per 30 s window and word times drifted badly (in the captured clip, "Thanks" was stamped 47.05 s; it is spoken at ~36.2 s; on the earlier 12 s clip every word after "pipeline" was stamped 11.88 s). `-ojf` only writes a JSON file, so nothing needed suppressing. Removed.
2. `normalizeTranscription` copied the provider's segments straight into `CaptionDocument.segments` (`segmentCaptions`, built in Phase 4, was never called in production), so one caption could be an entire 30 s window.

**Also fixed: tokens are not words.** whisper.cpp reports BPE tokens. `parseWhisperCppOutput` now merges a token that doesn't start with a space into the previous word (" tim"+"est"+"amps" → "timestamps") and attaches punctuation ("video" + "." → "video."). Attached punctuation does not extend the word's end time: whisper stamps it with the segment boundary, which would hold the word across the following silence.

**New pipeline.** `whisper words → flatten → segmentCaptions(words, DEFAULT_SEGMENTATION_RULES) → CaptionSegment[]`. Provider segments are transcription structure only. `originalWords` is unchanged and remains the source for "reset".

**Algorithm.** Dynamic programming over the whole word sequence, O(n·maxWords) (60,000 words < 2 s in a unit test). Hard limits: words, characters, duration, and no silence longer than `max(1.5 s, 3 × pauseThreshold)` inside a caption. Within them it minimizes a cost that prefers breaking after sentence-ending punctuation, at a pause (more so for longer pauses), after a comma; avoids ending on a dangling function word ("the", "to", "and", "every"…); prefers starting on a clause word ("and", "but", "which"); penalizes 1- and 2-word captions and sub-minimum durations; and prefers evenly sized captions. A one-word sentence ("Yes.") is folded into a neighbor rather than flashed alone. A global optimum avoids the greedy failure of a full caption followed by an orphan.

**Defaults** (`segmentationRules.ts`): 9 words, 42 characters (1 line), 4.5 s, minimum 0.8 s (soft), pause 0.5 s, hold 0.3 s.

**Timing.** `segment.startTime = words[0].startTime`; `endTime = last word's end`, extended by up to `maxHoldSeconds` but never past the next caption's start. The final caption is not held (it could run past the end of the video). Word timings are never altered, and `text` is always built from the segment's own words.

**What the data looks like now.** On the captured 40 s recording: 19 captions of 2–7 words / 15–34 characters, each starting within −0.15…+0.16 s of the real speech onset measured from the audio's energy envelope (13 captions that follow a silence). Whisper's per-word times inside continuous speech remain rough (tiny.en model): individual word starts can be a few hundred ms off, and a few words are zero-length.

**Known limits.** The heuristics are English-oriented (the function-word lists). `emphasis` highlighting is still a placeholder. A different or larger whisper model (or DTW alignment) may improve word timing; not attempted.

---

## 26. Phase 7 Implementation Notes — Burned-in Export

### Data flow

```text
ExportPanel (client)                       POST /api/export  { videoId, captionDocument.segments, styleConfig }
  current edited captions + style  ───────►  validateExportRequest (allow-list copy, caps, style validation)
                                              createExportJob → 202 { exportId }
                                              runExportJob (in-process, not awaited)
                                                buildCaptionTrack → generateAss → work/captions.ass
                                                copy bundled TTF(s) → work/fonts/
                                                ffmpeg (cwd = work/): scale, ass=…, libx264, AAC  → work/render.mp4
                                                ffprobe + validateExportOutput
                                                rename → exports/<id>/output.mp4 ; job "completed"
poll GET /api/export/<id> (1 s)  ◄──────────  exports/<id>/job.json
Download → GET /api/export/<id>/download  (Range, attachment)
Cancel   → POST /api/export/<id>/cancel
```

The client sends the *current* captions and style because the edited `CaptionDocument` lives only in the browser (there is no project persistence yet, and the server-side document is the untouched transcription). The server validates and copies only known fields, and never reads a path or FFmpeg argument from the request. Nothing is transcribed or segmented again: the segments are the final `CaptionDocument.segments` (integration-tested against real whisper.cpp output).

### Rendering strategy: ASS + libass (as §10 recommended), with one event per visual state

ASS/libass was chosen over `drawtext` (one filter node per word/segment does not scale to thousands of captions and cannot express per-word color cleanly), over SRT/VTT via `subtitles=` (no per-word styling, animation or box), and over browser/canvas capture (needs a server path anyway, unreliable for long files). It gives one compact text file, one filter pass, position/outline/shadow/box/fade/move/scale tags, and streams regardless of video length. The FFmpeg build this project ships (`@ffmpeg-installer/ffmpeg`, a 2018 build with libass, freetype, fontconfig, x264) was verified to have all of it.

Word highlighting is **not** done with ASS karaoke tags (`\k` keeps a word highlighted after it is spoken; the preview highlights a word only while it is being spoken). Instead each caption becomes one *event per state* — "word i highlighted" for the word's real `[start,end)`, "nothing highlighted" for the gaps — so the highlight is on exactly as long as the timestamps say. State events never overlap, and only the first event of a segment plays the entrance animation.

### Preview / export parity model — one source of truth per decision

| Decision | Shared code | Used by |
|---|---|---|
| Which segment is visible, when | `[start,end)`; overlapping segments cut at the next start (= `findActiveSegment`) | preview: `findActiveSegment`; export: `buildCaptionTrack` |
| Plain text vs highlighted words (stale / missing / malformed word timing → plain) | `resolveCaptionDisplay` | both |
| Which word is highlighted when | real word timestamps, start-inclusive / end-exclusive, none between words (= `findActiveWord`) | both |
| Geometry | 1080-line reference px, 6% side padding, `offsetPercent` of height, max width incl. padding | preview: `styleToCss` (cqh units); export: `computeCaptionLayout` (px from actual video size) |

`buildCaptionTrack` is tested against the preview functions at every 13 ms over a synthetic document for all five presets. Geometry is *not* shared code (CSS vs. numbers) and is kept in agreement by measurement, below. **When `styleToCss` changes, `computeCaptionLayout` must change with it.** Preview quirk mirrored deliberately: when a caption is vertically centered the preview frame drops its side padding too.

Everything derives from the actual source frame size (display size after rotation, made even for H.264) — never a viewport. Sizes scale by `height/1080`; ASS font size = CSS px ÷ 0.706 (libass sizes the line box, CSS the em; measured on Inter with this FFmpeg build).

### Measured parity (real videos, through the UI)

For 42 s test videos with real whisper.cpp captions: the browser preview (screenshot of the video element at the export's resolution) and the exported frame at the same timestamp were compared programmatically — ink bounding box (center, size) and the centroid of highlight-colored pixels — at 12 timestamps per style (segment middles, word middles, a gap, after the last caption). 16:9 (all five styles): 60/60 within tolerance, typically center within ±0.5 % and size within ±1–2 % of the frame; text positions verified for bottom/center (default), top-left and bottom-right. 9:16 and 1:1: Classic and Karaoke pass everywhere; the failures are Dynamic and Podcast on multi-line captions (see limitations). Tolerances: center ≤ 2 % (x) / 2.5 % (y), size ≤ 5 % / 3.5 %, highlight centroid ≤ 3.5 %.

### Styles in the export

- **Classic** — plain text, outline (CSS stroke is centered, ASS outline is outward: half width), shadow offset, bottom/8 %, no motion.
- **Karaoke** — per-word states as above, highlight color on the spoken word; the 80 ms `wordHighlight` color *transition* becomes an instant switch.
- **Dynamic** — uppercase (applied to the text: ASS has no text-transform), 900 weight, centered, per-word highlight, `pop` entrance = ASS `\fad` + scale 85 %→100 %. The preview also scales the *active word* by 1.12 (CSS transform, no reflow); that is not exported (ASS scaling would reflow the line).
- **Highlight** — the segment's last word in the highlight color (same placeholder as the preview; no keyword data exists).
- **Podcast** — semi-transparent box (ASS BorderStyle 3 on a separate layer under the text; alpha = background opacity; box padding = the style's padding) + 150 ms fade.

### Known parity limitations (real, measured or inherent)

1. **Box shape.** libass boxes are rectangles with square corners (no `radiusPx`), and multi-line captions get one box *per line* (widths follow each line) instead of one block rectangle. On portrait/square videos with wrapped Podcast captions the box width differed by −7…−29 % of frame width.
2. **Line spacing.** libass cannot set line height; multi-line captions use the font's natural spacing (≈1.4× size) instead of the style's `lineHeight` (1.1–1.35). A 3-line Dynamic caption on a 9:16 video came out 4–8 % of the frame height taller.
3. **Shadow blur** is ignored (only the offset distance is drawn); a blur-only shadow (distance 0) does not export.
4. **Animation.** `pop` scales about the caption's anchor, not the block center; the active-word scale (Dynamic) and the `wordHighlight` color transition are not exported; entrance animations run on the first state event only, so an animation longer than that event is cut short; `slide` uses `\move` (implemented and unit-tested, no preset uses it, not visually verified).
5. **Fonts.** Only Inter, latin glyphs, six weights. The `system-*` preview fonts export as Inter (the panel says so). Non-Latin text falls back to whatever libass finds — not bundled, not verified.
6. **Wrap sensitivity.** Line breaks are computed by two different engines (CSS greedy vs. libass `WrapStyle 1` greedy); a caption within a few percent of the maximum width can break at a different word.
7. **Timing resolution.** ASS is centiseconds (±5 ms); video is frames (40 ms at 25 fps), so a highlight shorter than a frame may be skipped and word boundaries land on the nearest frame.
8. `capitalize` approximates CSS (first letter of each word); square pixels are assumed (non-square SAR untested).

### Fonts

libass cannot read the browser's woff2 variable font. `assets/fonts/Inter-W{400…900}.ttf` are static Inter instances (SIL OFL 1.1) generated from `@fontsource/inter` by `scripts/build-export-fonts.mjs` (unwraps WOFF, rewrites the `name` table so each weight is its own family, "Inter W600"). They are committed, copied into each job's work directory, and passed via `fontsdir` — no network, no system fonts, same on every machine. They are read from `<cwd>/assets/fonts`; a deployment that runs from elsewhere (or a standalone build) must ship that directory. A missing font fails the job with a clear message.

### Jobs, progress, cancellation, cleanup

- **Lifecycle:** `queued → processing → completed | failed | cancelled` (`ExportJob`, its own status vocabulary). One JSON file per job at `exports/<id>/job.json`; in-process, no queue (V1). One export at a time (409 `export_in_progress` otherwise) because re-encoding saturates the machine.
- **Progress** is FFmpeg's real `-progress pipe:1` `out_time` over the source duration, capped at 99 %. 100 % is written only after validation. Verified: 72 distinct monotonic values on a 20-minute export.
- **Validation before completion:** output exists and is non-empty, H.264 in an MP4 container, audio present iff the source had audio, exact frame size, duration within max(1 s, 2 %). Otherwise the job fails and the output is discarded — FFmpeg exiting 0 is not enough.
- **Cancellation:** `POST /api/export/<id>/cancel` kills the FFmpeg process (registry on `globalThis`, so the route that starts a job and the one that cancels it see the same map), the runner records `cancelled` and cleans up. A cancel that arrives before the process starts, or for a stale record after a server restart, is handled. Verified against a real running FFmpeg (test) and from the UI on a 20-minute export (job cancelled, no `output.mp4`, no `work/`, no ffmpeg process).
- **Cleanup:** the job's `work/` directory (ASS, font copies, partial render) is removed in `finally` on success, failure and cancellation; a non-completed job never leaves `output.mp4`. The source video and the caller's data are only read. Finished exports are kept under `exports/<id>/` — no retention/expiry policy yet.
- **Output:** MP4, H.264 (`libx264 -preset veryfast -crf 20 -pix_fmt yuv420p`, +faststart), audio stream-copied when already AAC, else AAC 192 k; the source's audio track is used (never the transcription WAV). Source frame rate preserved; odd sizes are scaled down by ≤1 px.

### Download

`GET /api/export/<id>/download` serves only a `completed` job, from a path derived from the validated UUID, as a stream (no buffering) with `Content-Length`, single-range `206` support, `Content-Disposition: attachment` (ASCII fallback + UTF-8 name derived from the original filename), `X-Content-Type-Options: nosniff`.

### Security

UUID validation on every id; storage keys re-checked against the storage root; request fields copied through an allow-list with size/number caps; style validated by `validateCaptionStyle`; FFmpeg only via `spawn` with an argument array (`buildRenderArgs`), server-generated paths as single argv elements, `-vf` from constants and integers, cwd = job directory so the filter references files by relative name; caption text only ever inside the .ass file, escaped (`{ } \` and newlines — behavior verified against the libass build, including a word-joiner trick for backslashes); client-visible errors carry no paths or stderr (`detail` is stripped from the API response and never contains paths).

### Long-form

FFmpeg reads the source as a file and writes the output as a file; Node never holds video bytes and never renders frames; the caption document is turned into one ASS file (proportional to caption/word count — 60,000 words generate in well under 3 s in a unit test). Actually run: a 19.9-minute 1280×720 video (2,820 words, 564 captions from real whisper.cpp) exported with Karaoke in 76 s (15.8× real time), server memory 567 → 580 MB, output 16.1 MB; captions verified in frames at 25 %, 50 % and 90 % of the file. **A 2-hour / 2 GB export was not run.** The render timeout scales with duration (15 min + 8 s per source second, ≤ 6 h); untested beyond 20 minutes, and progress polling/job state assume a process that stays up (a server restart mid-render loses the render).

---

## 27. Whisper Reliability & Video-Stream Fix (2026-09-29)

### Reported symptom
`whisper.cpp transcription timed out`, the process killed via `SIGKILL`, the transcription job failing with no captions; `GET /api/videos/{id}/stream` logged as taking 57.1 minutes; an uncaught `TypeError: Invalid state: Controller is already closed`; `/api/jobs/{jobId}` still returning 200 while the job ran (expected — polling a still-running job).

### Root cause 1 — the timeout was real code, but genuinely dumb about *why* it fired
`WHISPER_TIMEOUT_MS` defaulted to a flat 4 hours, computed once at module load with no relationship to the video's own duration, the configured model, or measured throughput. The timer itself was correctly started/cleared (verified by reading the code and by new tests) — the actual defect was **classification**: a timeout produced a plain `Error("whisper.cpp transcription timed out")` with no `.code`, which `classifyWhisperExecError`'s `isSpawnFailure` check (string vs. numeric `.code`) then silently miscategorized as `TranscriptionProcessError` ("whisper.cpp exited with an error while transcribing"). The user never learned it was a timeout, and nothing distinguished it from a cancellation or a real audio-decode failure.

**Fixed**: `WhisperTimeoutError`/`WhisperCancelledError` (`services/transcription/errors.ts`) are now distinct classes, thrown directly from `runManagedWhisperProcess.ts` and never passed through the generic classifier; `runTranscriptionJob.ts` maps each to its own clear, actionable message (`toProcessingError`).

### Root cause 2 — the timeout's number was real but not duration-aware
`computeWhisperTimeoutMs(audioDurationSeconds)` (`config/whisper.ts`) replaces the flat constant: `overhead + audioDurationSeconds / minSpeedFactor`, clamped to `[WHISPER_TIMEOUT_MIN_MS, WHISPER_TIMEOUT_MAX_MS]`. `WHISPER_TIMEOUT_MS`, if set, still overrides it outright (a fixed, predictable ceiling for a known deployment). Verified live against the real 19.9-minute benchmark video: computed timeout 2,687,600 ms (~44.8 min) against a video that actually finished transcribing in 150,912 ms (~2.5 min, 7.9x realtime) — generous but bounded, not "4 hours no matter what."

### Performance (measured, tiny.en, this dev machine — Intel i7-10610U, 8 logical CPUs)
278 s real speech sample:

| Configuration | Wall time | Speed |
|---|---|---|
| `-t 4` (whisper.cpp's own default) | 49.96 s | 5.6x realtime |
| `-t 8` | 38.84 s | 7.2x realtime |
| `-t 8 -bs 1 -bo 1` (near-greedy) | 27.55 s | 10.1x realtime |

All three produced a byte-identical transcript on this sample. `WHISPER_THREADS` now defaults to the logical CPU count (was a hardcoded 4) — free parallelism, no accuracy trade-off, so it *is* the new default. `WHISPER_BEAM_SIZE`/`WHISPER_BEST_OF` remain unset by default (whisper.cpp's own 5/5): beam search is a genuine speed/accuracy trade-off and this sample (clean synthesized speech) doesn't stress the case it helps with, so it stays opt-in, not silently changed. Real 19.9-minute video with real speech and the new defaults: 2.4x–7.9x realtime across several runs (machine load–dependent).

### Root cause 3 — the video stream's Node→Web stream bridge
`LocalFilesystemStorage.createReadStream` used a bare `Readable.toWeb(fs.createReadStream(...))` handed straight to `new Response(stream)`. `<video>` elements abort their in-flight Range request on every seek — routine, not exceptional — and that specific combination (`Readable.toWeb` + `fs.ReadStream` + consumer cancellation) is a documented Node.js issue: a late `data`/`error`/`close` event can call `enqueue`/`close`/`error` on an already-closed controller, throwing `Invalid state: Controller is already closed` from inside code the route handler never awaits — i.e. a genuine **uncaught, process-level exception**, not a request-scoped failure. This exactly matches the reported symptom. The `57.1min` GET duration was not itself a bug: a non-Range progressive-download request paced by real playback legitimately stays open for the video's own length; what made it dangerous was the complete absence of backpressure in the old bridge — nothing paused the source when the consumer fell behind, so a slow consumer could make the process buffer an unbounded amount of the file.

**Fixed**: `services/storage/nodeStreamToWebStream.ts` (`nodeReadableToWebStream`) replaces the bare bridge: a `closed` guard makes enqueue/close/error idempotent, `cancel()` destroys the source and releases its fd immediately, a genuine read error is surfaced via `controller.error()` only while still live (logged, not thrown, if it arrives after cancellation — and the `'error'` listener itself is deliberately never removed, since Node throws if `'error'` has zero listeners and a destroyed stream can still emit one asynchronously), and real pull-based backpressure (`pause()`/`resume()` gated on `desiredSize`) replaces the old always-flowing mode.

**Verification honesty**: the exact live crash was not reproduced on this Node 24.14.1 build despite real effort (concurrent aborted Range requests, large files, repeated cancellation) — this specific Node version may have already narrowed the race. The fix targets the documented, well-understood root-cause *class* (not a guess), is unit-tested against every failure mode in that class using a fully-controlled fake stream (enqueue-after-close, error-after-cancel, double-close, backpressure), and is tested against a real file for the concrete, checkable proxy for "the fd was actually released": the file can be renamed immediately after cancellation (would fail with EBUSY/EPERM on Windows if the descriptor leaked). A 180-request live abort-storm against the real dev server produced zero crashes and zero `Invalid state` log lines, before and after the fix — the storm alone was inconclusive for proving the original bug, but confirms the fix introduces no regression under the same load.

### Honest progress (UI)
`CaptionWorkspace` now shows whisper.cpp's own `--print-progress` percentage when it has emitted one (parsed from stderr — see `parseWhisperProgress.ts`), and a live "Xs elapsed" fallback (ticking once a second, `ProcessingState.startedAt`) when it hasn't yet — never a fabricated percentage. Verified live: a fast short clip showed only the elapsed fallback for most of its run then a single real `74%` right before completion; the 19.9-minute video showed real, monotonically increasing percentages throughout (7%, 11%, 20%, … 100%) via `/api/jobs/{id}` polling.

### Files changed
`config/whisper.ts` (thread/beam/timeout config, `computeWhisperTimeoutMs`), `services/transcription/{errors,buildWhisperArgs,runManagedWhisperProcess,parseWhisperProgress,WhisperCppTranscriptionProvider}.ts`, `services/jobs/runTranscriptionJob.ts` (progress wiring, new error branches), `types/transcription.ts` (`durationSeconds`/`jobId`/`onProgress` on `TranscriptionInput`), `services/storage/{LocalFilesystemStorage,nodeStreamToWebStream}.ts`, `features/captions/CaptionWorkspace.tsx` (honest progress/elapsed UI).

### Known limitations
`WHISPER_MIN_SPEED_FACTOR`'s default (0.5x) is a judgment call, not a measurement across hardware/models — only tiny.en on one dev CPU was benchmarked. The video-stream fix's real-world crash was not reproduced live (see above). Backpressure is chunk-count-based (the Web Streams default `CountQueuingStrategy`, hwm 1), not byte-based — correct and safe, but not tuned for throughput.

---

## 28. Long-Form Whisper Chunking (2026-10-04)

### Symptom
A real 56.6-minute video (856 MB, `03.ALEX3.mp4`) timed out after 118 minutes (`whisper.cpp transcription timed out after 7086s`) — §27's duration-aware timeout computed a generous 7086s (~118 min) budget and the transcription still hadn't finished.

### Investigation (all against this exact real video's real audio, same hardware as §27)
Isolated, independent whisper.cpp runs on slices of the identical extracted audio:

| Slice | Duration | Wall time | Speed |
|---|---|---|---|
| start, 3 min | 180s | 26.1s | 6.9x realtime |
| mid-file, 5 min | 300s | 46.5s | 6.5x realtime |
| first 20 min (continuous) | 1200s | 243s | 4.9x realtime |
| first 40 min (continuous) | 2400s | 416s | 5.8x realtime |
| final 16.5 min (isolated) | 993s | 154s | 6.5x realtime |

Every slice, at every tested duration up to 40 real minutes, transcribed fast with no sign of degradation over the course of a run. Yet one single, uninterrupted invocation covering the full 56.6 minutes never finished in a 118-minute budget — over 10x worse than any sub-range of the identical audio, and worse than the already-pessimistic 0.5x-realtime floor §27's timeout formula assumes. This rules out the audio content, the model, thread count, and simple hardware/thermal explanations (a 40-minute continuous run would have shown thermal throttling if that were the cause; it didn't). The slowdown is specific to a single whisper.cpp invocation running uninterrupted past some point between 40 and 56.6 minutes — consistent with (but not conclusively isolated to) internal state that accumulates across a very long single pass (e.g. growing decoder context/prompt carryover). A full, instrumented reproduction of the exact 56.6-minute failure was not run a second time (prohibitively slow by design — that's the bug); the fix was validated by chunking instead.

### Fix: split long audio into independent chunks
`WHISPER_CHUNK_DURATION_SECONDS` (default 600s / 10 min — 4x margin under the 40-minute proven-fast ceiling). Audio at or below this duration is transcribed exactly as a single invocation always has (zero behavior change for short/medium videos — most real videos). Longer audio is split via `planAudioChunks` (pure chunk planner) and `wavSlicing.ts` (a small RIFF/WAVE chunk-walking reader + slicer — handles the `LIST`/`INFO` metadata chunk real ffmpeg output includes, not just a bare 44-byte-header assumption), each chunk transcribed as its own fresh, independent whisper.cpp process, and the results merged back into one continuous `TranscriptionResult` by `mergeChunkedTranscriptionResults` — which adds each chunk's start-time offset to its segments' and words' timestamps. No word timing is estimated or re-derived; every timestamp is whisper's own real output, just translated into the full file's timeline (CLAUDE.md "preserve word-level timestamps"). `WhisperCppTranscriptionProvider.transcribe()` orchestrates this; `buildWhisperArgs`, `runManagedWhisperProcess`, progress parsing, and error classification (§27) are reused unchanged per chunk.

**Timeout, now doubly robust for long videos**: each chunk gets its own duration-aware timeout (the same `computeWhisperTimeoutMs` from §27, applied to that chunk's length), AND an overall deadline derived from the full audio's own timeout bounds the whole job — whichever is tighter wins for the chunk about to start. A single stuck chunk now fails in roughly 20–25 minutes (its own budget), not only after the entire file's budget is exhausted, and failure/cancellation mid-job cleans up every chunk's temp WAV/JSON.

**Progress**: each chunk's own 0–100% is blended into one overall 0–100% proportional to its share of total duration, so the UI's progress bar advances smoothly across chunk boundaries rather than resetting.

### Verified against the real 56.6-minute video (not a synthetic stand-in)
Re-ran transcription on the exact video that originally failed, through the real app (`POST /api/transcribe` → real job → real `CaptionDocument`):

- Split into 6 chunks (5×10min + 1×6.6min, matching `planAudioChunks`).
- Each chunk: 44.3–73.6s wall time, 8.2–10.0x realtime.
- **Total: ~6 minutes 50 seconds**, down from never finishing in 118 minutes.
- Result: 9,840 real words, 1,749 segments, all 9,840 word ids unique (no duplicates), 0 negative-duration words, text reads coherently straight through every one of the 5 internal chunk boundaries (manually inspected), word timestamps span 0.21s–3388.32s of the 3393.0s video (the ~4.7s gap at the very end is trailing silence, confirmed separately via `ffmpeg silencedetect`). `segmentCaptions`'s output (1,749 segments) was perfectly ordered with 0 out-of-order segments — the segmentation system (explicitly untouched by this fix) absorbed the one minor timing artifact below without any visible effect.

### Known limitation
One of the 9,840 words showed a ~0.2s backward timestamp overlap with its neighbor, at exactly one of the 5 internal chunk boundaries (word N ending at 1800.96s, word N+1 starting at 1800.00s) — whisper's own reported end-time for a word whose audio was hard-cut by the chunk boundary extended slightly past the chunk's actual 600s of audio. This is an inherent, minor cost of cutting audio at arbitrary time marks rather than true silence points (the same class of imprecision whisper.cpp's own internal 30-second windows already accept, just at a much coarser, 20x-less-frequent grain here); it is not a lost, duplicated, or fabricated word, did not affect segmentation, and was not observed anywhere else across the 9,840-word real transcript. Not mitigated further (e.g. by snapping chunk boundaries to detected silence) to keep this the smallest appropriate fix; worth revisiting only if it proves visible in practice.

### Files changed
`config/whisper.ts` (`WHISPER_CHUNK_DURATION_SECONDS`), new `services/transcription/{wavSlicing,planAudioChunks,mergeChunkedTranscription}.ts`, `services/transcription/WhisperCppTranscriptionProvider.ts` (chunked orchestration). `runTranscriptionJob.ts`, `types/transcription.ts`, caption segmentation, and export were not touched.

---

## 29. Export Validation: Real Whisper Timestamp Inversion (2026-10-08)

### Symptom
`POST /api/export` returned 422 "A caption has invalid timing" for a video whose transcription had completed successfully (`[whisper.cpp] ... completed in 190486ms (5.3x realtime)`).

### Exact failing check and condition
`domain/export-engine/exportRequest.ts`'s `validateExportRequest`:
```ts
if (!isTime(raw.startTime) || !isTime(raw.endTime) || raw.endTime < raw.startTime) {
  return fail("invalid_captions", "A caption has invalid timing.");
}
```
The failing condition was `raw.endTime < raw.startTime` — a real `CaptionSegment` with a negative duration, found in the persisted `CaptionDocument` itself (not a client-side corruption): 4 of 543 segments, reproduced identically across two independent transcription runs of the same video (e.g. segment `startTime=358.16, endTime=354.18, text="Notice"`).

### Root cause, traced to its source
Real whisper.cpp output (captured, reproduced three times: two full job runs plus an isolated re-run of just that 600 s chunk) contains a token where `offsets.to < offsets.from`, immediately after a ~5 s silence:
```
"Notice" from=358160 to=353880
"the"    from=358160 to=354300
"structural" from=358160 to=355700
"difference" from=358160 to=357100
"between"    from=358160 to=358080
"those"      from=358360 to=358740   ← recovers to normal timing
```
A run of consecutive tokens is anchored to the same (correct) segment-start `from`, each keeping a stale, too-early `to` — apparently left over from an earlier decode attempt that didn't get updated when whisper re-anchored the segment start after the pause. This is a variant of the same class of degenerate-timestamp whisper.cpp output already documented in §22/§25 (identical-timestamp runs around pauses), just inverted rather than merely zero-length.

Nothing between parsing and export ever validated `end >= start` for a word, so this flowed straight through: `parseWhisperCppOutput` → `normalizeTranscription` (copies word timing as-is) → `segmentCaptions`. The DP segmentation engine isn't at fault — it correctly computed `segment.endTime` from its last word's `endTime` (354.18, via the existing bounded hold-time calculation, `maxHoldSeconds` unchanged), and the broken word timing *also* made the preceding gap check (`words[i+1].start - words[i].end`, here `358.16 - 353.88 = 4.28s`) look like a real pause bigger than `maxIntraGap` (1.5s), which is why these words were forced into tiny single-word captions instead of one normal sentence — both effects were downstream consequences of the same bad word timestamps, not independent bugs.

**Verified NOT the cause**: Whisper parsing's token-merging logic (operates correctly on whatever offsets it's given), `normalizeTranscription` (a faithful passthrough by design), `segmentCaptions` (correct given its inputs), the client (didn't edit this document), export payload construction, or export validation (correctly rejected genuinely invalid data — exactly its job).

### Fix — earliest correct layer: whisper.cpp output parsing
`services/transcription/parseWhisperCppOutput.ts`'s `mergeTokensIntoWords` now ends with `sanitizeWordTiming`: any word whose `end < start` is collapsed to a zero-length word at its own `start` and marked `approximate: true` — never a fabricated plausible duration, consistent with CLAUDE.md "preserve word-level timestamps... mark the result as approximate rather than silently dropping it." This is whisper.cpp-specific knowledge, so it belongs in the provider-parsing layer (ARCHITECTURE.md §6's boundary), not in `normalizeTranscription` (provider-agnostic) and certainly not in the export validator, which continues to reject any `CaptionSegment` that is still malformed after normalization — its strictness is unchanged.

### Verified against the real captured data
Re-ran the exact raw whisper.cpp JSON that produced the original failure through the fixed pipeline: 0 of 339 segments have `endTime < startTime` (previously 4), and `validateExportRequest` now accepts the resulting document. As a side effect of the same fix, "Notice the structural difference" / "between those two approaches." are now segmented as two normal multi-word captions instead of four single-word ones — confirming the gap-detection side effect above.

### Known residual limitation
One corrected word landed as the *last* word of its segment, so that segment's own `endTime` also collapsed to equal its `startTime` (a zero-duration caption) — valid per the export validator (`end < start` is false when equal) and per `segmentCaptions` (unchanged), but a zero-duration segment is never "active" for any playback time (`findActiveSegment`'s `t < endTime` never holds), so that one caption would not actually display during preview or be burned into the export. This is a pre-existing characteristic of a zero-duration segment in general (not introduced by this fix — the alternative, before this fix, was an *invalid* segment that failed export entirely) and was left alone as out of scope: the task was fixing the export-blocking invariant violation, not changing `segmentCaptions`'s hold-time behavior. Worth a follow-up if a zero-duration caption is ever observed to matter in practice.

### Files changed
`services/transcription/parseWhisperCppOutput.ts` (`sanitizeWordTiming`), `services/transcription/__tests__/parseWhisperCppOutput.test.ts` (regression test built from the real captured token data). `normalizeTranscription.ts`, `segmentCaptions.ts`, the export validator, the preview/export architecture, and Whisper configuration were not touched.
