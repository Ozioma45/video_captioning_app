# Self-hosted Inter font

`Inter-Variable.woff2` — the Inter variable font's `latin` subset (weights
100–900 in one file), extracted from Google Fonts'
`https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap`
response on 2026-09-19. Licensed under the SIL Open Font License 1.1
(same license Google Fonts serves it under — free to embed/redistribute).

## Why this is here instead of `next/font/google`

`layout.tsx` previously used `next/font/google`'s `Inter(...)`, which
fetches this exact file live from `fonts.gstatic.com` on every cold
`next dev`/`next build`. In this environment that fetch occasionally hits
a network timeout on the *first* outbound connection of a fresh process,
which Turbopack (and Webpack — confirmed by testing both directly) then
caches as a hard "Module not found" build error until the dev server is
restarted.

Self-hosting via `next/font/local` removes the live-fetch dependency
entirely — same font, same weights, same `next/font` optimizations
(self-hosted `@font-face`, zero layout shift, CSS variable), just sourced
from this file instead of a network request. See `layout.tsx`.
