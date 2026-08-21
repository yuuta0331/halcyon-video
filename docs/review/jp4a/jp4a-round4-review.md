# JP-4A Round 4 — independent-review package

**Maximum state:** `READY_FOR_INDEPENDENT_REVIEW_BEFORE_QUEST_RETEST`

**QUEST_HARDWARE = NOT_EXECUTED / PENDING**

Do not treat this as Quest-ready. Do not merge PR #5. Do not start JP-4B or JP-5.

## Historical status (must not be rewritten)

| Slice | SHA | Verdict |
|---|---|---|
| JP-3 | `195f695` | QUEST_HARDWARE PASS |
| JP-4A Round 1 | `ec6a058` | QUEST_HARDWARE FAILED; NORMAL_NON_XR FAILED_ON_OBSERVED_BUILD |
| JP-4A Round 2 | `f3a0372` | independent review REQUEST_CHANGES |
| JP-4A Round 3 | `6186441` | independent review REQUEST_CHANGES |

Round 3 closed:

- `BLOCKED_STABLE_GPU_CAPACITY`
- `BLOCKED_STORE_VISUAL_READY_SCOPE`

Round 3 opened (this round):

- `BLOCKED_PRELOAD_DRAIN_BEFORE_REVEAL`
- `BLOCKED_PRODUCTION_MULTIBANK_RENDER_EVIDENCE`

## Classification

Every artifact below is one of: `UNIT` / `SOFTWARE_PLANNING_TEST` / `DESKTOP_BROWSER` / `IWER_EMULATED`.

Nothing here is `QUEST_HARDWARE`.

## Blocker A — STORE_VISIBLE_BASE drain

Reveal now requires canonical world readiness **and** scoped `STORE_VISIBLE_BASE` fetch/decode/upload to drain to a terminal title state:

- `REAL_READY` — real cover uploaded
- `STABLE_FALLBACK` — fallback committed for this scene generation; later real work cannot mutate the GPU layer

ON_DEMAND pending work does not block reveal. Global `pendingUploads === 0` is not the gate.

Evidence: `jp4a-round4-preload-stability.json` (`DESKTOP_BROWSER`), `jp4a-normal-stable-store.json` (`IWER_EMULATED` / desktop walk).

At STORE_INTERACTIVE on the 2001-title demo catalog:

- expected 2001, realReady 2001, stableFallback 0, missing 0
- pending work/upload/decode = 0
- post-reveal base upload/decode/fallback-replacement/eviction/reacquisition deltas = 0
- resident 2001 unchanged after walking

## Blocker B — production multibank shelf path

Round 3 `JP4A_REAL_GPU_MULTIBANK` remains allocation/sample proof only.

Round 4 adds `jp4a-round4-production-multibank.json` (`DESKTOP_BROWSER`, `PRODUCTION_SHELF_RENDER`):

- test seam `xrMultibank=1&xrPosterLayers=8` (effective 8, hardware still 2048)
- 24 unique synthetic covers through StoreScene stock + `applyPosterBankDrawBatches`
- catalogBankCount 3, layersPerBank 8, samplersPerDraw 1
- source meshes 3 → poster batches 9 (bound 9)
- bank 0/1/2 including layers 7/8 and 15/16 rendered distinguishable production pixels
- no duplicate live source meshes, no GL fatal, no context loss

## IWER_EMULATED

`iwer-jp4a-round4.json` — not Quest evidence.

- STORE_VISUAL_READY before XR entry
- base pending upload = 0 at entry
- first world frame, menu, settings, stick Y, Trigger/A·X, Grip, FPS HUD
- contextLost false
- framebufferScale 0.8 / WORLD foveation 0.5 preserved

## Tests

- `npm test` — 472 pass
- `npm run build` — pass (file budgets unchanged)
- `npm run test:xr-resource` — pass
- `npm run test:xr-emu` — pass
