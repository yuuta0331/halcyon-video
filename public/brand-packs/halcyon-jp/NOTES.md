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
  `tools/render-halcyon-jp-art.mjs` (canvas + bundled `BBCjk` / Noto Sans JP
  and bundled `BBArchivoBlack` / Archivo Black). They contain no movie-poster
  art. The renderer registers those repository faces; it does not copy font
  files into this pack.

## Color system

Directions considered (all original; none copied from a real chain):

1. **Night navy + ivory + warm gold** (chosen) — `#1b2a4a` field, `#f4efe4`
   cream walls, `#c9a227` wayfinding gold. Calm retail contrast, late-80s /
   90s fluorescent-store mood, Latin + CJK both stay readable.
2. Clean mid-blue + cream + amber — closer to a generic electronics aisle;
   less “rental shop after dark.”
3. Indigo + off-white + restrained copper — too muted on overhead signs.

Navy is not Halcyon’s house blue (`#1a49c2`). Gold is a warm retail metal,
not a high-chroma chain yellow. Walls stay cream rather than competing
accent fields, so storefront, fascia, counter POP, and sleeves share one
system.

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
