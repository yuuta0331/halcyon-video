# JP-4A Round 4.1 — production bank-switch evidence correction

**Maximum state:** `READY_FOR_INDEPENDENT_REVIEW_AFTER_ROUND4_1`

**QUEST_HARDWARE = NOT_EXECUTED / PENDING**

Do not treat this as Quest-ready. Do not merge PR #5. Do not start JP-4B or JP-5.
Do not output `READY_FOR_SINGLE_QUEST_JP4A_ROUND4_SMOKE`.

## Historical status (must not be rewritten)

| Slice | SHA | Verdict |
|---|---|---|
| JP-3 | `195f695` | QUEST_HARDWARE PASS |
| JP-4A Round 1 | `ec6a058` | QUEST_HARDWARE FAILED; NORMAL_NON_XR FAILED_ON_OBSERVED_BUILD |
| JP-4A Round 2 | `f3a0372` | independent review REQUEST_CHANGES |
| JP-4A Round 3 | `6186441` | independent review REQUEST_CHANGES |
| JP-4A Round 4 | `5f0e866` | independent review REQUEST_CHANGES — preload blocker closed; remaining gap `BLOCKED_PRODUCTION_BANK_SWITCH_EVIDENCE` |

Round 4 closed:

- `BLOCKED_PRELOAD_DRAIN_BEFORE_REVEAL`

Round 4 left open (this correction):

- `BLOCKED_PRODUCTION_BANK_SWITCH_EVIDENCE`

## Classification

Every artifact below is one of: `UNIT` / `SOFTWARE_PLANNING_TEST` / `DESKTOP_BROWSER` / `IWER_EMULATED`.

Nothing here is `QUEST_HARDWARE`.

## Blocker — production onBeforeRender must prove itself

Round 4 production probe called `textureArrayManager.bindDrawBank(expectedBank)` immediately before `renderer.render(...)`. That could produce a correct pixel even if production `mesh.onBeforeRender` was missing.

Round 4 also returned `glFatal: false` as a literal rather than a measured GL result.

### Correction

- Removed probe-side expected-bank pre-bind.
- Probe-side adversarial precondition: `bindDrawBank(wrongBank)` before render (bank 0 when target is 2; bank 1 when target is 0).
- Observer records real `bindDrawBank` calls, then the production implementation runs unchanged. Disabled unless a recording session is active.
- One `renderer.render` of production InstancedMeshes from banks 0/1/2 in the same scene.
- Negative control: temporarily suppress `onBeforeRender` on a test-only object, prove mismatch, restore, prove match.
- Drain `gl.getError()` before the controlled render; collect after; derive `glFatal`.

Evidence: `jp4a-round4.1-production-bank-switch.json` (`DESKTOP_BROWSER`, `PRODUCTION_SHELF_RENDER`).

## STORE_VISIBLE_BASE (preserved)

Reveal still requires canonical world readiness and scoped `STORE_VISIBLE_BASE` drain to terminal `REAL_READY` / `STABLE_FALLBACK`.

Evidence: `jp4a-round4-preload-stability.json`, `jp4a-normal-stable-store.json`.

Demo catalog at STORE_INTERACTIVE:

- expected 2001, REAL_READY 2001, STABLE_FALLBACK 0, missing 0
- pending work/upload/decode = 0
- post-reveal base upload/decode/fallback-replacement/eviction/reacquisition deltas = 0
- resident 2001 → 2001

## IWER_EMULATED

`iwer-jp4a-round4.1.json` — not Quest evidence.

- STORE_VISUAL_READY / worldReady / requiredReady before XR entry
- pending base upload = 0 at entry
- first world frame, menu, settings, stick Y, Trigger/A·X, Grip, FPS HUD
- contextLost false
- framebufferScale 0.8 / WORLD foveation 0.5 preserved

## Tests

- `npm test` — 476 pass / 0 fail
- `npm run build` — pass (file budgets unchanged: 6200 / 4600 / 6000)
- `npm run test:xr-resource` — pass
- `npm run test:xr-emu` — pass
