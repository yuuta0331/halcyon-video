# JP-4A Round 5B.1 — Upload admission + production diagnostic ladder (implementation)

**Maximum state:** `READY_FOR_INDEPENDENT_REVIEW_BEFORE_SINGLE_QUEST_HARDWARE_DIAGNOSTIC`

**This HEAD: QUEST_HARDWARE = NOT_EXECUTED / PENDING**

Do not merge PR #5. Do not declare JP-4A PASS, QUEST PASS, or READY TO MERGE.
IWER is logic/emulation evidence only. It is not hardware visual proof.

## Historical real Quest 3 (unchanged)

HEAD `216483fac1e77654e005bfc1be6de143c0599318` — **QUEST_HARDWARE = FAILED**.

See `jp4a-round5b-hardware-fail-history.md`. Do not rewrite that SHA.

| Item | Result |
|---|---|
| Poster quality | FAILED |
| Close-range black artifact | FAILED |
| Stability / performance | FAILED |
| Stereo signage | PASS |
| Menu placement | FAILED |
| FPS HUD placement | FAILED |

Software-independent review of that HEAD passed. This round does not claim those
hardware failures are fixed.

Round 5B HEAD `8ab3b01a6a5966c7847299e63bc9f75c049bf8ab` remains
QUEST_HARDWARE = NOT_EXECUTED / PENDING.

## What this round changed

### P0-A/B — Explicit upload admission, no dead leases

`queueTextureUpload()` no longer silently returns when the expensive cap is full.
It returns:

```
{ accepted: true } | { accepted: false; reason: 'expensive-queue-cap' }
```

DETAIL and FOCUS activation set `uploadInFlight` / `pendingUpload` only after
attempting enqueue. A rejection:

- clears `uploadInFlight`
- returns the record to `pendingPixels`
- does **not** burn a retry failure
- keeps BASE (and existing NEAR) visible
- keeps the lease so a later wake can retry

A queue-cap rejection is backpressure, not a content/network failure.

### P0-C — Deferred work retries without locomotion

A coalesced 90ms wake (`requestPosterDetailWake`) force-reconciles after:

- expensive work is promoted (capacity freed)
- a NEAR item is preempted
- an admission rejection

`shouldReconcile()` pose hysteresis is bypassed on that wake. It is not a
busy loop.

### P0-D — Selected FOCUS priority, cap remains 8

Ordinary NEAR may occupy at most 7 expensive slots when no FOCUS is queued
(one slot reserved). Selected FOCUS is unshifted to the front of the priority
lane. If the cap is already full, FOCUS may drop one queued NEAR (onEvict
returns that title to `pendingPixels` for later retry). The cap is not removed.

### P0-E/F/G — Production-path diagnostic ladder

`?xrPosterHwDiag=1` is unchanged as the enable flag. Normal launch still
creates no diagnostic meshes.

| Mode | Path |
|---|---|
| A | Synthetic flat `MeshBasicMaterial` + direct texture |
| B | Production `createClonedCaseGeometry` + Basic/direct texture |
| C | Same production front compile (`posterShaderChunk` + `posterArrayUniforms`); BASE array only; NEAR/FOCUS off |
| D | Same object as C; real DETAIL array + LUT branch; FOCUS off; NEAR mip policy none |
| E | Same object as C/D; FOCUS branch enabled |

C/D/E differ by feature toggles on one production-equivalent mesh, not three
unrelated shaders. Evidence `productionPath` is derived from observed compile
and bank-bind counters, not a hard-coded `true`. A negative control suppresses
bank bind; the assertion fails; restore passes.

Diagnostic **content** is parented to the store scene (world-stable). The
**label** is viewer-relative. Thumbstick click still cycles A→B→C→D→E.

### P1 — Upload metrics

FOCUS `DataTexture.needsUpdate` records `texturesScheduledForUpload` /
`bytesScheduledForUpload` / `uploadPreparationMs`. It does **not** increment
`texSubImageCalls`. Real `gl.texSubImage3D` from array layer uploads still
uses `noteGpuSubmit`.

### P1 — Jellyfin FOCUS fetch

`rewritePosterUrlForFocus` now adds documented Jellyfin `maxWidth=640` and
`maxHeight=960` on `/Items/{id}/Images/Primary` when those params are absent.
Authentication query params are preserved. The URL is not logged. Plex
transcode rewrite is unchanged. No upscale parameter is invented for Jellyfin.

## Software evidence classifications

UNIT/CI · DESKTOP_BROWSER · IWER_EMULATED

QUEST_HARDWARE = NOT_EXECUTED for this HEAD.

This implementation does not claim:

- poster readability on Quest
- black artifact fixed
- Quest menu/HUD placement fixed
- Quest GPU upload time
- 72Hz achieved
