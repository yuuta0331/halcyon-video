# JP-4A Round 5A — visual correctness (implementation)

**Maximum state:** `READY_FOR_INDEPENDENT_REVIEW_BEFORE_QUEST_RETEST`

**QUEST_HARDWARE = NOT_EXECUTED / PENDING**

This HEAD has not been tested on a real Quest. Do not merge PR #5.

## Historical Quest 3 (unchanged)

`a20389e` — **QUEST_HARDWARE FAILED**. See `jp4a-round5-quest-fail.md`. Do not rewrite that SHA as PASS.

## P0-A Poster two-tier

- BASE remains STORE_VISIBLE_BASE (budget-chosen shelf size; profile default 96×144). Not evicted by pose.
- DETAIL: 320×480, hard limit **64** physical slots, ON_DEMAND uploads from existing CPU 320×480 cache.
- Shader LUT 0 → BASE; LUT slot+1 → detail. Never BASE→blank→HIGH_RES.
- Stale leases after eviction cannot upload.

## P0-B Close-range black

Investigation: WebXR copies `camera.near` into `depthNear` (meters). Desktop near 0.1 store-feet was passed through as 0.1 m (~10 cm), clipping posters when leaning in (head-linked).

Fix: while presenting, `camera.near = 0.03` m, restored on exit.

IWER close-range probe checks both-eyes-capable meshes stay visible with no disposed materials. **Does not claim the Quest artifact is fixed until hardware retest.**

## P0-C Left-eye-only signage

Root cause: Three.js WebXRManager maps **layer 1 = left eye, layer 2 = right eye**. Signage used `layers.set(1)` for mirror-skip.

Fix: mirror-skip moved to **layer 3**. Desktop camera enables layer 3. Negative control: layer 1 is still left-eye-only.

## P0-D XR menu

On MENU/SETTINGS open: place ~0.9 m in front of current HMD **yaw** (pitch ignored), then world-stable. Re-open recenters.

XR UI mesh: `depthTest/depthWrite = false`, `renderOrder = 1000`. Ray hit test unchanged (plane math).

## IWER_EMULATED (`JP4A_ROUND5A_XR`)

Not Quest hardware. Snapshot: `jp4a-round5a-iwer.json`.

- stereoPass true, stereoNegative true, stereoSampleCount 24
- closeRangeHidden 0, closeRangeDisposed 0
- detail 320×480, slotLimit 64, resident 1, promoted 1
- BASE 96×144
- contextLost false
- framebufferScale 0.8 (unchanged)
- QUEST_HARDWARE NOT_EXECUTED

IWER frame timings are JavaScript inter-composite gaps, not Quest GPU time.

## Catalog delta sync

Not implemented. See `jp4a.5-catalog-delta-sync.md`.
