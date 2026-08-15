# Japanese foundation (Phase JP-0 / JP-1A)

This fork keeps the upstream English store as the default. This phase adds a
localization boundary, a bundled Japanese-capable font, mixed-script text
helpers, and a platform seam for a later WebXR/Quest phase. It does **not**
redesign the store as a Japanese rental shop.

## Localization

Application chrome lives in `src/i18n/`:

| File | Role |
|---|---|
| `en.ts` | Default catalog (complete) |
| `ja.ts` | Japanese catalog (`Partial` — missing keys fall back to English) |
| `locale.ts` | `bb_locale` persistence; default **English** |
| `index.ts` | `t()`, `getLocale()`, `setLocale()`, `lookupMessage()` |
| `text.ts` | CJK detection, wrap/truncate, locale-aware compare, canvas family stack |
| `canvas-font.ts` | JP-1B canvas seam (`paintFont` / `crtPaintFont`); do not import from node tests |
| `cjk-font.ts` | Lazy FontFace registration for the bundled JP face |
| `chrome.ts` | HUD / power-menu / settings-index helpers |

**English is the default.** `bb_locale` is read only if it is `en` or `ja`.
Browser language is **not** applied at boot (`detectBrowserLocale()` exists
for a future hint only). Existing users therefore keep the English experience
until they pick 日本語 under Store Look → Language (reload).

### Adding or changing Japanese strings

1. Add the key to `src/i18n/en.ts` (required).
2. Add the Japanese value to `src/i18n/ja.ts`. If you omit it, `t()` shows English.
3. Call `t('the.key')` at the chrome site. Do not put store identity (wordmark,
   wrap address, clerk greeting, receipts) here — that is Brand Packs.

`npm test` covers fallback, locale selection, and mixed-script helpers.

### i18n vs Brand Packs

- **i18n** = UI language (HUD, help, settings, search prompts, walk-mode copy).
- **Brand Packs** (`brandString()`, `public/user-assets/brands/`) = store
  identity. A Japanese-looking shop is a future Brand Pack, not a locale.

Future Japanese Brand Pack location: `public/user-assets/brands/<id>/` (gitignored,
same as every other pack). Do not commit TSUTAYA, GEO, or any real-chain assets.

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
bundled face even when the UI locale is still English. Other canvas painters
are a JP-1B migration (`paintFont` / `crtPaintFont` instead of host families).

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

## Intentionally not in this phase

- Japanese rental-store visual redesign
- A fictional Japanese store Brand Pack
- TSUTAYA / GEO (or any third-party chain) assets or strings
- WebXR, Quest controllers, XR performance tuning
- Translating every English literal in the repo

### Remaining i18n migration surface

Signage and case wraps, clerk dialogue, setup/BIOS screens, device-gate copy,
flat 2.5D UI, rental-clock prose, fixture POP, demo-library titles, and most
per-setting labels still use English literals or `brandString()`. Migrate them
the same way: add keys, call `t()`, leave identity with Brand Packs.

## Validation

PR CI (`.github/workflows/ci.yml`) runs `npm test` and `npm run build`
(file-budget + signage slots + `tsc` + Vite, including demo-mode via `VITE_DEMO=1`).
