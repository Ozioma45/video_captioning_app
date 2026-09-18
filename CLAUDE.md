# Caption Studio — Engineering Rules

These rules are permanent and apply to all future work on this project, across all phases.

## Before major work

- **Read `PROJECT.md` first.** It is the product specification and the source of intent. When a request conflicts with it, flag the conflict instead of silently picking one interpretation.
- **Read `ARCHITECTURE.md`, `PRODUCT_REQUIREMENTS.md`, and `DEVELOPMENT_PLAN.md` before implementing a new subsystem.** They exist precisely so implementation doesn't have to re-derive architectural decisions from scratch.
- **Follow `DEVELOPMENT_PLAN.md`'s phase order.** Don't build editor UI against mocked transcription data for long, don't build export before the style-resolution contract exists, etc. — see the plan's sequencing notes.
- **Explain architectural changes before major rewrites.** If an implementation reveals that an architecture decision in `ARCHITECTURE.md` is wrong, say so and propose the change — don't silently diverge from the documented architecture.

## Scope discipline

- **Do not over-engineer.** Prefer simple + modular + replaceable over complex + distributed + premature. No microservices, no Kubernetes, no message brokers, no Redis, no second database, unless a concrete, current requirement demands it.
- **Do not implement unrequested features.** A bug fix doesn't need surrounding cleanup; a caption-editing task doesn't need to also start on export. Stay inside the current phase/task.
- **Do not fake functionality.** If something isn't implemented, say so with a TODO, a disabled state, or a clear placeholder — never a UI or response that pretends a feature works when it doesn't.
- **Do not duplicate logic.** Caption timing, style definitions, validation, and video-metadata logic each have exactly one source of truth (the `domain/` layer) — don't reimplement segmentation math or style resolution in a component.

## Duration and scale

- **Do not assume short videos.** Never hard-code `duration < 60s`, `aspect ratio = 9:16`, `captions fit in 2 lines`, or similar — unless a specific feature explicitly and legitimately requires that assumption (e.g. a future Shorts-specific export mode).
- **Test long-form scenarios.** Any change touching upload, transcription, segmentation, timeline, or export should be checked against a genuinely long (tens of minutes+) video, not just a short test clip.
- **Never put huge video blobs in React/Zustand state.** State holds metadata, transcript, and style data — video bytes live on disk and are referenced by id/path/URL only.

## Data integrity

- **Preserve word-level timestamps.** Never discard word-level timing during segmentation, editing, or styling — see `ARCHITECTURE.md` §7. If a transformation can't preserve exact word timing, it must mark the result as approximate rather than silently dropping it.
- **Protect the user's project.** A failed transcription, render, or export must never corrupt or discard the source video, transcript, or style configuration — see Rule 8 in `PROJECT.md` and `ARCHITECTURE.md` §10.

## Processing and security

- **Never construct unsafe shell commands.** All FFmpeg/Whisper invocations use `execFile`/`spawn` with argument arrays — never string concatenation or a shell. This is non-negotiable; it's the primary defense against command injection from filenames or transcript content.
- **Validate user-uploaded files** by real content inspection (`ffprobe`, magic bytes), not just filename extension or client-reported MIME type.
- **Clean up temporary files** — every job's working files live in their own temp directory and are removed on completion (success or failure).
- **Keep processing logic separate from UI.** FFmpeg/Whisper calls live in `services/`, never in a React component or route handler's inline logic beyond calling the service.
- **Keep caption styles modular.** A style is a `CaptionStyle` data object; adding one must never require a new component or a new FFmpeg command template — see `ARCHITECTURE.md` §8.

## Testing

- **Test real video files**, not only mocked data — short video, long video, landscape, vertical, no-audio, poor-audio, multi-speaker, and a large file, per `PROJECT.md` Rule 7.
- After each major subsystem: run tests, verify the implementation manually, check for regressions in adjacent features, and report what changed and what remains — don't silently bundle unrelated changes into the same piece of work.
- **Restart the dev server after any `npm install`/`npm uninstall`**, especially for native-binary-backed packages (ffprobe, future FFmpeg/Whisper bindings). A long-running `next dev` process can end up with a stale resolved path to a native binary after `node_modules` changes underneath it, and every exec failure that isn't a plain "binary not found" was silently misreported as "invalid video" until a 2026-09-17 debugging session fixed the error classification — see `classifyFfprobeExecError` in `services/video-processing/errors.ts`. If a processing step that worked before starts failing for no code reason, restart the dev server before debugging further.

## Documentation

- **Keep documentation updated.** When an implementation decision meaningfully diverges from `ARCHITECTURE.md`/`PRODUCT_REQUIREMENTS.md`/`DEVELOPMENT_PLAN.md`, update the relevant doc in the same body of work — don't let the docs go stale.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
