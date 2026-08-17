# JP-4A Round 5A.2 — DETAIL load-failure settlement (implementation)

**Maximum state:** `READY_FOR_INDEPENDENT_REVIEW_BEFORE_QUEST_RETEST`

**QUEST_HARDWARE = NOT_EXECUTED / PENDING**

This HEAD has not been tested on a real Quest. Do not merge PR #5.

## Historical Quest 3 (unchanged)

`a20389e` — **QUEST_HARDWARE FAILED**. See `jp4a-round5-quest-fail.md`. Do not rewrite that SHA as PASS.

## Round 5A.1 independent review

HEAD `a282488` closed the SUCCESS path:

- CPU cache MISS → canonical `posterQueue.load` → 320×480 decode → GPU upload → LUT → shader DETAIL
- lease ≠ ready; dynamic LUT (no silent 2048 cliff)

Independent review: **REQUEST_CHANGES**

Closed:

- `BLOCKED_HIGH_RES_DETAIL_CACHE_MISS_ACTIVATION` (success path)
- 2048 DETAIL LUT ceiling

New blocker:

- **BLOCKED_HIGH_RES_LOAD_FAILURE_DEAD_LEASE**

## Root cause

`loadPoster` only forwarded the success pixel callback. Canonical `posterQueue` already invokes `onSettled` on fetch/decode failure without calling the pixel callback. DETAIL left:

- `loadInFlight = true`
- `phase = pendingPixels`
- physical lease held
- `ready = false`

forever. Later `activate` hit `if (existing?.loadInFlight || existing?.uploadInFlight) return`. The 64-slot pool could be starved.

## Fix

Loader contract:

```
loadPoster(movie, priority, onPixels, onSettled?)
```

Production adapter connects both callbacks to `posterQueue.load`.

Request-local `gotUsablePixels` / `failed` so `onPixels` then `onSettled` is not treated as failure.

Terminal load / malformed pixels / `uploadLayer` false / `setLut` false:

- `loadInFlight` / `uploadInFlight` cleared
- pendingPixels / pendingUpload cleared
- LUT cleared (BASE stays visible)
- physical lease released
- bounded retry recorded

Stale settlement validates the original lease generation and scene generation before mutating residency. A's failure after B reused the slot cannot release or demote B.

Retry (`src/poster-detail-retry.ts`): 3 attempts, delays 250ms then 1500ms, then BASE-only for this scene generation. Scene rebuild / `bindPosterDetailTier` resets the book. Track cap 128; not a catalog-sized map.

## DESKTOP_BROWSER (`JP4A_DETAIL_FAILURE`)

Snapshot: `jp4a-round5a2-detail-failure.json`

- success: decoded 1, uploaded 1, readyResident 1, shader DETAIL `[255, 2, 2, 255]`
- failure: loadFailed 1, pendingPixelsAfter 0, pendingUploadAfter 0, readyResidentAfter 0, leasedAfter 0, BASE stayed visible
- retry: suppressed during backoff, eventualSuccess true
- pool: 64 failed titles, leakedLeases 0, healthy title acquired afterward
- stale: old lease rejected, new owner preserved, old generation rejected
- GPU: upload and LUT failures settled
- canonical `posterQueue`: live decode success + live load failure with lease released
- classification DESKTOP_BROWSER; QUEST_HARDWARE NOT_EXECUTED

## IWER_EMULATED (`JP4A_ROUND5A2_XR`)

Not Quest hardware. Snapshot: `jp4a-round5a2-iwer.json`

- stereoPass / stereoNegative true
- contextLost false
- closeRangeHidden 0, closeRangeDisposed 0
- decoded 2, uploaded 2, readyResident 1
- pendingPixels 0, pendingUpload 0
- BASE 96×144, DETAIL 320×480, slotLimit 64
- framebufferScale 0.8, WORLD foveation 0.5
- QUEST_HARDWARE NOT_EXECUTED

IWER frame timings are JavaScript inter-composite gaps, not Quest GPU time.

## Catalog delta sync

Not implemented. See `jp4a.5-catalog-delta-sync.md`.
