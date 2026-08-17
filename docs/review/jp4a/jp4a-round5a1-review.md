# JP-4A Round 5A.1 — high-res DETAIL activation (implementation)

**Maximum state:** `READY_FOR_INDEPENDENT_REVIEW_BEFORE_QUEST_RETEST`

**QUEST_HARDWARE = NOT_EXECUTED / PENDING**

This HEAD has not been tested on a real Quest. Do not merge PR #5.

## Historical Quest 3 (unchanged)

`a20389e` — **QUEST_HARDWARE FAILED**. See `jp4a-round5-quest-fail.md`. Do not rewrite that SHA as PASS.

Round 5A HEAD `2ffbf4b` implemented the two-tier architecture but independent review found:

**BLOCKED_HIGH_RES_DETAIL_CACHE_MISS_ACTIVATION**

Committed 5A IWER showed `requested=1 leased/resident=1 decoded=0 uploaded=0`. A lease is not DETAIL_READY.

## Root cause

`acquire()` reserved a slot, `posterPixelCache` missed, `promote()` returned, and `reconcile` skipped any id that already had a lease. The title stayed leased forever without decode/upload. BASE remained on screen (correct fallback) but DETAIL never activated.

## Production state machine

`NOT_REQUESTED` → `PENDING_PIXELS` → `PENDING_GPU_UPLOAD` → `DETAIL_READY`

- A reserved slot is **not** DETAIL_READY.
- `resident` / `leased` = physical slot leases.
- `readyResident` = GPU upload succeeded and LUT points at the slot.
- CPU MISS schedules canonical `posterQueue.load` (deduped).
- Stale lease / scene generation / undesired callbacks cannot upload.
- BASE stays visible until atomic LUT promotion; eviction clears LUT immediately.

## LUT

No silent 2048-title ceiling. Capacity is planned from catalog count and `MAX_TEXTURE_SIZE`. Fail-closed if the 2D LUT would exceed the device limit. Tests cover 1 / 2001 / 2048 / 2049 / 4000.

## IWER_EMULATED (`JP4A_ROUND5A1_XR`)

Not Quest hardware. Snapshot: `jp4a-round5a1-iwer.json`.

- decoded 2, uploaded 2, readyResident 1, leased 1
- pendingPixels 0, pendingUpload 0
- DETAIL 320×480, slotLimit 64, lutCapacity 2001, lutOk true
- BASE 96×144
- stereoPass / stereoNegative true
- closeRangeHidden 0, closeRangeDisposed 0
- contextLost false
- framebufferScale 0.8, WORLD foveation 0.5
- QUEST_HARDWARE NOT_EXECUTED

DESKTOP_BROWSER shader proof: `jp4a-round5a1-detail-activation.json`
(BASE cyan → DETAIL red → BASE restored; index 2049 samples DETAIL; miss and hit reach READY).

IWER frame timings are JavaScript inter-composite gaps, not Quest GPU time.

## Catalog delta sync

Not implemented. See `jp4a.5-catalog-delta-sync.md`.
