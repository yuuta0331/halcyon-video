# Japanese foundation (Phase JP-0 / JP-1A / JP-1B)

This fork keeps the upstream English store as the default. JP-0 / JP-1A added
the localization boundary, bundled Japanese font, mixed-script helpers, and a
platform seam. **JP-1B completes application chrome in Japanese and width-aware
CJK Canvas fitting.** It does **not** redesign the store as a Japanese rental
shop.

## Localization

Application chrome lives in `src/i18n/`:

| File | Role |
|---|---|
| `en.ts` | Default catalog (complete) |
| `ja.ts` | Japanese catalog (`Partial` — missing keys fall back to English) |
| `locale.ts` | `bb_locale` persistence; default **English** |
| `index.ts` | `t()`, `tfill()`, `getLocale()`, `setLocale()`, `lookupMessage()` |
| `text.ts` | CJK detection, wrap/truncate, `fitCrtLine`, locale-aware compare, canvas family stack |
| `canvas-font.ts` | Canvas seam (`paintFont` / `crtPaintFont`); do not import from node tests |
| `cjk-font.ts` | Lazy FontFace registration for the bundled JP face |
| `chrome.ts` | HUD / power-menu / settings-index / HTML overlay helpers |

**English is the default.** `bb_locale` is read only if it is `en` or `ja`.
Browser language is **not** applied at boot (`detectBrowserLocale()` exists
for a future hint only). Existing users therefore keep the English experience
until they pick 日本語 under Store Look → Language (reload).

### Adding or changing Japanese strings

1. Add the key to `src/i18n/en.ts` (required).
2. Add the Japanese value to `src/i18n/ja.ts`. If you omit it, `t()` shows English.
3. Call `t('the.key')` (or `tfill` for `{name}` placeholders) at the chrome site.
   Do not put store identity (wordmark, wrap address, clerk greeting, receipts)
   here — that is Brand Packs.

`npm test` covers fallback, locale selection, mixed-script helpers, and CRT fitting.

### i18n vs Brand Packs

- **i18n** = UI language (HUD, help, settings, search prompts, walk-mode copy,
  setup/BIOS, device-gate, 2.5D chrome, clerk menus, membership picker).
- **Brand Packs** (`brandString()`, `public/user-assets/brands/` and
  shipped `public/brand-packs/`) = store identity. Locale never selects a pack.

## JP-1B migrated surfaces

- Settings labels, cycle values, On/Off, hints (including dynamically
  registered Store Libraries / Overhead TVs row hints), pending-status, page chrome
- Setup / BIOS terminal screens (line count and cursor rows unchanged; stored
  English step/error strings are mapped at render)
- Device-gate copy and CTAs
- Flat / 2.5D menu, library list, search empty states, detail chrome
- Clerk prompt, menus, small talk, recommendation templates (greeting stays Brand Pack)
- Membership picker chrome (printed card face stays era/Brand Pack)
- Login overlay (including Plex PIN chrome), candy checkout, walk HUD,
  version picker, player chrome
- CRT idle instructional lines (`PRESS / TO SEARCH…`); store number and
  `PLEASE REWIND` / `REMEMBER TO REWIND` stay in-world English

## Japanese font

- Face: **Noto Sans JP** Regular, Japanese subset, WOFF2 (~1.1MB)
- File: `src/assets/noto-sans-jp-regular.woff2`
- License: SIL OFL 1.1 — canonical notice in `src/assets/licenses/NotoSansJP-OFL.txt`
  (verbatim Google Fonts OFL). Bundling provenance is in
  `src/assets/licenses/NotoSansJP-PROVENANCE.txt`, not in the OFL notice.
- Runtime family: `BBCjk` (same BB-prefix rule as Anton / Archivo Black)

Latin display fonts are unchanged. `canvasFontStack(text, latinFamily)`
appends `BBCjk` **after** the shipped Latin family only when the string
contains CJK (`BBMono, BBCjk`, never `BBCjk, BBMono`). Latin-only strings
keep a Latin-only stack. The desk CRT / search terminal paints through
`src/i18n/canvas-font.ts` (`crtPaintFont`) so Japanese glyphs resolve to the
bundled face even when the UI locale is still English (a Japanese catalog
title can appear on an English UI).

## Canvas width-aware strategy

The old CRT clipped with `line.slice(0, 40)` and search used
`displayTitle(maxChars)`. That matches a 40-column ASCII terminal and is
**kept for Latin-only lines**.

CJK / mixed-script lines use `fitCrtLine(text, maxWidth, measure)` in
`src/i18n/text.ts`:

- Latin-only → `Array.from(text).slice(0, 40)` (no ellipsis, same 40-column
  contract as before).
- CJK / mixed → `truncateText()` against an injected `measure()` so node tests
  work; the painter measures with the same `crtPaintFont` stack it fills with.
  The result always satisfies `measure(result) <= maxWidth` (empty if even
  the ellipsis cannot fit).
- Truncation is code-point based (no lone UTF-16 surrogates).
- After `BBCjk` loads, `ensureCjkForTexts` triggers one redraw so widths are
  not permanently measured against a host fallback face.

English 40-column appearance is unchanged (no ellipsis, no numeric reflow).
`displayTitle()` still uppercases Latin titles; Japanese titles are left
intact for the painter to width-fit.

## Text handling

`wrapText` / `truncateText` take an injected `measure()` so they test without
Canvas. Latin wrap is the existing greedy word wrap; CJK may break between
characters with a small kinsoku rule. Shelf order uses `compareText()`: English
keeps pre-i18n `String.localeCompare()` semantics; Japanese uses
`Intl.Collator('ja')`. Search matching is unchanged (no engine rewrite).

## Platform / future XR

`src/platform/index.ts` distinguishes `browser` / `tauri` and records whether
WebXR *appears* present. **No session is started.** `isXrSession` and
`requiresAnimationLoop` are always false.

Documented for the later phase (also in the module header):

- WebXR units are meters; the store uses feet-like units
- `1 meter ≈ 3.28084` store units (`STORE_UNITS_PER_METER`)
- XR head pose comes from the headset; disable desktop head bob
- Locomotion should move a player rig, not overwrite XR camera tracking
- XR will need `renderer.setAnimationLoop()`; today's rAF + render-on-demand
  loop in `three-scene.ts` is left replaceable and **untouched**

## Intentionally not in JP-0 / JP-1B

- Japanese rental-store visual redesign (that is JP-2)
- TSUTAYA / GEO (or any third-party chain) assets or strings
- WebXR, Quest controllers, XR performance tuning

### Remaining surfaces (not JP-1B)

- Signage, case wraps, aisle bands, fixture POP — Brand Pack / in-world English
- Clerk greeting default — Brand Pack
- Theme names (`Halcyon 1990`), wall-paint color names, Store Brand editor
  (emblem shapes, Megahit/Reel Time presets, Theme Font)
- Demo-library / user media titles
- Developer console / `[System]` / `[Clerk]` logs
- CRT footer `PLEASE REWIND` / `REMEMBER TO REWIND` / store number
- Rental-clock diegetic stamps (`MON 8:00 AM`, register receipt dates)
- Remote companion / tip-jar overlays (secondary surfaces)

## JP-2 — bundled fictional identity

JP-2 ships **ハルシオンビデオ / HALCYON VIDEO** as a bundled Brand Pack
(`halcyon-jp`). It is the project's own fictional Japanese branch of Halcyon,
not a TSUTAYA or GEO recreation.

### Bundled vs private packs

| Tree | Role |
|---|---|
| `public/brand-packs/<id>/` | Committed, distributable **fictional** identities. Validated by `npm run build`. |
| `public/user-assets/brands/<id>/` | Git-ignored **private** packs (real-brand recreations, scans). Unchanged. |
| `public/user-assets/brand/` | Simple drop. Unchanged. |

Resolution of `bb_brand_pack=<id>`:

1. `user-assets/brands/<id>/` if that local pack is installed (may override a bundled id)
2. `brand-packs/<id>/` only if `<id>` is a registered bundled id
3. no pack — the English/default Halcyon store

Unknown ids never probe the bundled tree. `bb_brand_pack` absent/empty keeps
the original Halcyon look. **Locale is independent:** `bb_locale=ja` does not
select `halcyon-jp`, and selecting the pack does not set `bb_locale`.

### How to select ハルシオンビデオ

Store Brand → **Store Identity** → ハルシオンビデオ, then Apply & Close
(reload). SERVICE MODE still accepts an arbitrary `bb_brand_pack` directory
name for private packs. Opening Store Brand does not overwrite an unknown
private id.

### Assets

- Manifest / strings / palette: `public/brand-packs/halcyon-jp/brand.json`
- VHS/DVD sleeves: `public/brand-packs/halcyon-jp/wraps/`
- Provenance: `public/brand-packs/halcyon-jp/NOTES.md`
- Visual review stills: `docs/review/jp2/`
  - `01-default-interior.jpg` / `02-default-storefront.jpg` — no pack
  - `03-halcyon-jp-interior.jpg` — 映画 / おすすめ / ゲーム
  - `04-halcyon-jp-storefront.jpg` — teal/coral house on the facade
  - `05-halcyon-jp-counter-pop.jpg` — 返却はこちら, ハルシオン レンタルシステム, 新作
  - `06-halcyon-jp-wrap.jpg` — VHS レンタル専用 sleeve
  - `07-switchback-original.jpg` — original Halcyon after UI switchback
  - `08-original-ja-ui.jpg` — original identity with 日本語 chrome
  - `09-halcyon-jp-ja-ui.jpg` — bundled identity with 日本語 chrome

In-world wording lives in the pack `strings` (and `brandGenreLabel()`), not
in `src/i18n/`. Japanese wordmarks paint through `BBCjk` (the JP-1 Noto Sans
JP seam) — logo-renderer and sign painters append it when the copy contains
CJK. No second CJK loader, no extra font file.

### Legal boundary

Fictional project-authored identity. No affiliation with real Japanese rental
chains. Pack sources are guarded against TSUTAYA / ツタヤ / GEO / ゲオ /
BLOCKBUSTER tokens. This is not a trademark-clearance claim.

### What remains deferred

- WebXR / Quest / `setAnimationLoop` (JP-3)
- Translating media titles or rewriting search
- Real-chain recreations (still private `user-assets/` only)
- Automatically pairing 日本語 chrome with this identity

## Next phase

**JP-3 — XR Architecture & WebXR Entry**

JP-2 does not start a WebXR session.

## Validation

PR CI (`.github/workflows/ci.yml`) runs `npm test` and `npm run build`
(file-budget + signage slots + `tsc` + Vite, including demo-mode via `VITE_DEMO=1`).

### Browser smoke (JP-1B)

1. `npm run dev` (Vite). Isolated browser profile, not a daily Chrome profile.
2. English: omit `bb_locale`. Confirm HUD/settings English, idle CRT 40-col,
   no Noto request on all-English idle if Network is visible.
3. Store Look → Language → 日本語, reload. Confirm HUD/settings/help/setup
   Japanese, CRT CJK via BBCjk, long title clipped to the tube.
4. Reload: Japanese persists. Switch back to English: English returns.

JP-1B smoke (isolated Cursor browser tab, Vite `npm run dev` on
`http://127.0.0.1:1420/?demo=1&nogate=1`, not a daily Chrome profile):

- English default: `bb_locale` unset, HUD `PICK A SECTION`, settings
  `STORE SETTINGS` / `LANGUAGE` = `ENGLISH`. BBCjk was **not** in
  `document.fonts`; Noto WOFF2 transferred only as Vite's tiny `?import`
  URL module (~300–758 B), not the 1.1MB face.
- Japanese: Store Look → Language → 日本語, Apply & Close (reload). HUD
  `コーナー選択`, settings `ストア設定`, power menu `マネージャ端末`,
  3D search CRT `検索>` / `入力待ち...`. BBCjk `loaded`; Noto WOFF2
  transferred 1,131,884 bytes.
- Long CJK on the desk CRT truncated with an ellipsis inside the tube;
  footer stayed `PLEASE REWIND` / `REMEMBER TO REWIND`.
- Reload kept `bb_locale=ja`. Switching Language back to English restored
  the English HUD and did not register BBCjk.

Setup/BIOS and device-gate were not walked in this demo boot (`?demo=1`,
`?nogate=1`); they are covered by unit tests and remain localized.
