# Caption Studio — Design System (Initial Direction)

Status: Phase 0 proposal — visual direction, not implementation. No UI has been built yet.

---

## 1. Design Principles

1. **Feels like a creative tool, not a dashboard.** Dark-leaning, video-editor-adjacent (think Descript/CapCut/Premiere's calm confidence), not a generic SaaS admin panel of cards and tables.
2. **The video and captions are the star.** Chrome (panels, toolbars, controls) recedes; nothing competes visually with the preview.
3. **Progressive disclosure.** Show the primary action for the current step; keep advanced settings one click away, never all-at-once. A first-time user should understand the main workflow without reading anything.
4. **Honesty over polish-through-deception.** Loading/progress/error states are real reflections of system state — never a fake spinner or invented percentage standing in for the truth.
5. **Desktop-first, not desktop-only.** The editor is designed for a real desktop canvas first (per `PRODUCT_REQUIREMENTS.md` §6); mobile gets a deliberately reduced, honest scope (landing/upload/browse/basic preview) rather than a cramped attempt at the full editor.
6. **Duration-agnostic UI.** Components (timeline, caption list) must look and work right whether there are 4 captions or 400 — no layout assumption baked in for "a short clip."

## 2. Typography Direction

- **UI typeface**: a clean, modern system/geometric sans (e.g. Inter or similar) for all interface chrome — labels, buttons, menus, panels. Prioritize legibility at small sizes since the editor is dense with controls.
- **Caption preview typefaces** are a separate concern from UI typography — each `CaptionStyle` carries its own `fontFamily`, and the style customization panel should offer a curated set of caption-appropriate fonts (bold display faces for Dynamic/Karaoke, clean readable faces for Classic/Podcast) distinct from the UI font. Never let the UI font double as the only caption font option.
- **Hierarchy**: rely on weight and size more than color for hierarchy in dense editor panels (helps both visual clarity and accessibility — non-color-only indicators, per `PRODUCT_REQUIREMENTS.md` §6).

## 3. Color Strategy

- **Base theme: dark by default**, matching the video-editor mental model (video previews read best against a dark surround; most competing tools default dark). Provide the surface as a small set of near-black/dark-gray tokens (background, surface, surface-elevated, border) rather than pure black, to keep depth/hierarchy visible.
- **One accent color** used sparingly and consistently for primary actions, active/selected states, and the playhead — not scattered decoratively. This keeps the UI calm and keeps the accent meaningful (e.g., "this caption is currently active" should visually rhyme with "this is the primary export button").
- **Semantic colors** (success/error/warning/info) are distinct from the accent and reserved strictly for system status (job succeeded, job failed, validation warning) — never reused for decoration, so their meaning stays unambiguous.
- **Caption style colors are data, not theme.** A style's `textColor`/`highlightColor`/`backgroundColor` are user/preset-controlled and intentionally independent of the app's own dark theme — the editor chrome's color choices must never leak into or constrain what a caption style can look like.
- Maintain WCAG AA contrast minimums for all UI text against its background; this applies to the app chrome, not to user-chosen caption styles (which are the user's creative choice, though sensible presets should default to readable contrast).

## 4. Spacing

- An 4px/8px-based spacing scale (Tailwind's default scale is sufficient) applied consistently — avoid one-off pixel values.
- Editor panels use generous internal padding at rest but tighten in dense areas (timeline, caption list rows) where information density matters more than breathing room.
- Consistent gutters between major layout regions (preview / timeline / side panel) so the eye has a stable structure to return to regardless of which panel's content changes.

## 5. Border Radius

- A single moderate radius scale (small for inputs/buttons/chips, slightly larger for panels/cards/modals) applied consistently via shared tokens — not ad hoc per component. Avoid heavy rounding that reads as "consumer app" over "creative tool"; keep it crisp.

## 6. Component Principles

- Built on **shadcn/ui primitives**, themed to the above tokens rather than used with default styling — shadcn's value here is accessible, unstyled-enough primitives (dialogs, popovers, sliders, tabs), not its default visual identity.
- **Style-config-driven components stay generic.** The customization panel, style switcher, and caption overlay render off a `CaptionStyle` object's fields — there is one typography control, one color control, one position control, reused across all presets, not bespoke UI per style (mirrors the architectural rule in `ARCHITECTURE.md` §8 at the design layer).
- **Controls favor direct manipulation where practical** (drag a segment boundary on the timeline, drag a caption's vertical position on the preview) over purely numeric form fields, with numeric fields available as the precise/accessible fallback, not the only path.

## 7. Editor Layout Principles

Conceptual structure (exact layout to be validated during implementation, not locked in now):

```text
┌─────────────────────────────────────────────┐
│ Project name              [Style] [Export]   │  ← minimal top bar
├───────────────────────────┬───────────────────┤
│                           │                   │
│      VIDEO PREVIEW        │   Side panel      │
│   (captions overlaid)     │  (contextual:      │
│                           │   transcript /     │
│                           │   style / settings)│
├───────────────────────────┴───────────────────┤
│ Timeline (captions + playhead + duration)      │
└─────────────────────────────────────────────┘
```

- **The relationship "video + timeline + settings = final video" must be visually obvious** — the layout should make clear that the preview is a live composite of the other two panels, not an independent screen.
- **One primary side-panel context at a time** (transcript editing, style customization, export settings) reachable via clear tabs/switches — not everything visible simultaneously, per the progressive-disclosure principle.
- The exact grid/split proportions and whether the side panel is left or right are implementation-phase decisions to validate with real content (a 400-segment long-form transcript will stress this layout very differently than a 4-segment short clip) — this document sets the principle, not the pixel layout.

## 8. Video Preview Principles

- The preview is the visual anchor of the whole editor — it should be the largest, highest-contrast-against-background element on screen.
- Preserve the source aspect ratio by default (per `PRODUCT_REQUIREMENTS.md` §5.11); the preview frame adapts to 16:9/9:16/1:1 rather than forcing one canvas shape.
- Playback controls are minimal and familiar (standard player affordances) — the preview is not the place to introduce novel interaction patterns.
- Caption overlay rendering in preview must be a faithful visual read of what will be exported (per `ARCHITECTURE.md` §9) — the design system should never encourage a preview-only visual flourish (e.g. a UI-only drop shadow or blur) that the style config doesn't actually represent.

## 9. Caption Style Preview Principles

- Style selection (choosing among the 5 presets) should be a **visual gallery**, not a dropdown of names — each preset shown as a small live/animated preview of actual caption text in that style, since the whole point of styles is how they look and move.
- Customization changes reflect in the main preview **immediately** (no "apply" button) — direct, live feedback is core to how a styling tool should feel.
- When word-highlight/karaoke styles are being customized, the customization UI should itself loop a short preview animation so the user can judge timing/highlight behavior without needing to scrub the real video.

## 10. Loading States

- **Stage-based, not fake-percentage**, whenever a real percentage isn't available (per `PRODUCT_REQUIREMENTS.md` §5.14) — e.g. "Extracting audio…" → "Transcribing… (this can take a few minutes for longer videos)" → "Preparing captions…", with a real progress bar only where the underlying process genuinely reports one (upload, FFmpeg render).
- Long operations (transcription, render) show elapsed time and, where estimable from video duration, a rough remaining-time estimate — never silence during a multi-minute wait.
- Skeleton states for editor panels while a project's data is loading, matching the eventual content's shape (not a generic spinner over a blank panel) so the layout doesn't jump on load.

## 11. Error States

- Every error message follows the three-part structure required by `PRODUCT_REQUIREMENTS.md` §5.13: **what happened**, **whether the user's project is safe**, **what to do next**. A raw technical string (an FFmpeg exit code, a stack trace) is never the only thing shown to the user, though it may be available behind a "details" disclosure for debugging.
- Errors are visually distinct from neutral/info states via the semantic error color plus an icon and label — never color alone.
- Recoverable errors (a failed render that didn't touch the transcript) offer a direct retry action in the error state itself, not just a dead end.

## 12. Empty States

- First-open (no project yet): a clear, single primary action (upload a video) with minimal explanatory copy — the product should be usable without reading documentation.
- Empty transcript/caption list (e.g. before transcription completes, or a video with no detected speech): explained plainly ("No captions yet — transcription runs automatically after upload" / "No speech detected in this video"), never a blank confusing panel.
- Empty project list (once multi-project support exists): same single-clear-action pattern as first-open.
