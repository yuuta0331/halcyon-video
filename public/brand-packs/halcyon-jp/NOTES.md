# ハルシオンビデオ — bundled fictional identity

This directory is a **project-authored fictional Japanese rental-store
identity**. It ships with the app under `public/brand-packs/` so it can be
selected without installing a private pack.

It is **not** affiliated with any real Japanese rental chain. It is not a
recreation of any existing video-rental store. The name, palette,
lettering, POP, and sleeve treatment were designed for this repository.

## Provenance

- Identity: ハルシオンビデオ / HALCYON VIDEO — the project's own Japanese
  branch of the existing Halcyon Video house brand.
- All logos, POP, vector geometry, and wrap prints in this pack are original
  to this repository.
- Reference photos (period Japanese video-rental interiors, fluorescent
  retail, compact POP) were used only for broad historical cues: density of
  signage, practical fluorescent lighting, physical-media sleeve information.
  No real-chain logo, palette, sign system, trade dress, or proprietary
  artwork was copied.
- Wrap PNGs were generated from the project-authored painter in
  `tools/render-halcyon-jp-art.mjs` (canvas + the bundled Noto Sans JP face
  already shipped as `BBCjk`). They contain no movie-poster art.

This file does **not** claim trademark clearance, and it does not claim that
the name is legally guaranteed conflict-free.

## Files

```
brand.json          manifest (palette, logo, strings, wraps)
wraps/vhs.png       VHS sleeve, USER_WRAP_SPECS 1024×762, folds 473 / 589
wraps/dvd.png       DVD sleeve, USER_WRAP_SPECS 1024×683, folds 478 / 558
NOTES.md            this file
```

Sign lettering is data in `brand.json` `strings` (not a locale catalog). The
store paints those strings with the bundled `BBCjk` face.

## Legal boundary

Private / real-brand recreations still belong in git-ignored
`public/user-assets/`. Do not move this pack there, and do not add a
gitignore exception to commit real-chain art.
