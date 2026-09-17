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
- Word-level timestamps are treated as first-class, permanent data — never discarded after segmentation. `CaptionSegment.words` always carries the underlying `CaptionWord[]` even after the user edits segment text, so karaoke/highlight styles keep working after manual edits (re-aligning edited word text to nearest available timing rather than deleting timing data).
- Caption **segmentation is a derived, re-runnable transform**, not a one-time destructive step. The segmentation engine takes `(words: CaptionWord[], rules: SegmentationRules) → CaptionSegment[]` as a pure function, so changing "max words per caption" recomputes segments instantly without touching transcription.

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
- **Styles are stored independently from caption documents.** A project references `{ captionDocumentId, styleId, styleOverrides? }`. Switching styles is a reference swap; it never touches the transcript. `styleOverrides` lets a user tweak a preset (e.g. change Classic's color) without forking the whole style — the resolver merges `baseStyle + overrides`.
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

**Recommendation: ASS (Advanced SubStation Alpha) subtitles burned in via FFmpeg's libass filter, generated from `CaptionDocument` + `CaptionStyle` by a pure `subtitle-generator` function.**

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
