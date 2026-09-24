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
- **In a long list backed by Zustand (captions, and future timelines/style lists), preserve object identity for anything that didn't change.** Domain mutation functions should shallow-copy the array and replace only the changed element(s); list items should select their own entry by id (`array.find(x => x.id === id)`), not subscribe to the whole array — this is what makes editing one item not re-render every sibling, without reaching for a virtualization library. See `domain/caption-engine/captionMutations.ts` and `components/captions/CaptionItem.tsx`.

## Data integrity

- **Preserve word-level timestamps.** Never discard word-level timing during segmentation, editing, or styling — see `ARCHITECTURE.md` §7. If a transformation can't preserve exact word timing, it must mark the result as approximate rather than silently dropping it. If a text edit means word timing can no longer be trusted, flag it (`wordsStale`) rather than deleting the words or trying to re-align them — see `ARCHITECTURE.md` §7's Phase 4 note.
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

- **Style state is structured data, never CSS.** Colors are `#RRGGBB`, fonts come from the registry in `domain/style-engine/fonts.ts`, and there is no runtime dependency on a remote font host. Presets are frozen; always go through `createStyleConfig` / `patchCaptionStyle` so a preset is never mutated and every change is validated.

- **Playback-derived state is derived, not stored.** The active caption/word are computed from `(currentTime, segments)` by the pure functions in `domain/caption-engine/captionLookup.ts` — never kept in a store where seeking could leave them stale. Components subscribe with selectors that return the derived object (so a per-frame time update re-renders them only when it changes), and `currentTime` is written to the playback store from one place only (`VideoPlayer`'s sync effect). Caption times are seconds everywhere.

- **Provider segments are not display captions.** `CaptionDocument.segments` is always produced by `segmentCaptions` from the provider's words; a caption's timing comes from its own words. Never pass `-nt` to whisper.cpp (it destroys timestamps). When a caption looks wrong in the preview, inspect the real transcription data (words + timestamps) before touching the renderer — the overlay only shows what it is given.

## Editor UI patterns

- **Commit editable-field changes on blur/Enter, not per keystroke.** Keep the live value in local component state; only call into the store (and from there, a pure domain function) when the user finishes editing. Escape reverts to the last committed value. Dispatching on every keystroke means a full store update + re-render sweep per character — for a caption list, a style panel, or anything else with many editable items, that adds up.
- **To re-sync local editing state from an external/store value (e.g. after an edit is committed elsewhere, or a future undo), don't use `useEffect` + `setState`.** That trips `react-hooks/set-state-in-effect` and causes an extra render pass. Use React's sanctioned "adjust state during render" pattern instead: track the last-seen external value in its own `useState`, and if it changed, call `setState` for both that tracker and the local field directly in the render body (before any early return). See `components/captions/CaptionItem.tsx` and `CaptionTiming.tsx`.
- **Centralize cross-store side effects in one place, keyed narrowly.** When one store's state change should trigger an action on another store (e.g. selecting a caption seeks the video player), do it in one effect keyed only on the specific value that should trigger it (`selectedSegmentId`), not on a broad object that changes for unrelated reasons (the whole document) — otherwise unrelated updates (an edit to that same item's text) re-trigger the side effect too.

## Documentation

- **Keep documentation updated.** When an implementation decision meaningfully diverges from `ARCHITECTURE.md`/`PRODUCT_REQUIREMENTS.md`/`DEVELOPMENT_PLAN.md`, update the relevant doc in the same body of work — don't let the docs go stale.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
