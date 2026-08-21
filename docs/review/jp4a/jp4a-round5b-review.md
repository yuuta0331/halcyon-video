# JP-4A Round 5B — Quest hardware-parity rendering reset (implementation)

**Maximum state:** `READY_FOR_INDEPENDENT_REVIEW_BEFORE_QUEST_HARDWARE_DIAGNOSTIC`

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

Software-independent review of that HEAD passed. The new evidence is that
software/emulator evidence was insufficient to predict hardware behavior.

## What this round changed

### P0-A — Device ≠ presentation

Quest Browser UA no longer implies immersive `XR_SAFE` 96×144 shelf art while
the page is INLINE.

| Device + presentation | Profile | Shelf BASE | Expensive effects |
|---|---|---|---|
| Desktop Chrome + INLINE | `DESKTOP_FULL` | 160×240 | unchanged (AO/bloom/mirrors allowed) |
| Quest UA + INLINE | `QUEST_INLINE` | 160×240 | cheap graph (no AO/bloom/mirrors/probes) |
| Quest UA + IMMERSIVE_XR (select-time) | `XR_SAFE` | 96×144 | cheap graph |
| IWER `?xrEmu=1` | `XR_SAFE` | 96×144 | cheap graph (deterministic) |

Resource-graph policy is allocated once at renderer bind (`presentation: INLINE`).
Entering VR from Quest inline does **not** rebuild the GPU graph (no duplicate
AO/probes/arrays). Quest immersive from a live Quest Browser session therefore
keeps the already-allocated `QUEST_INLINE` banks (160×240 BASE) rather than
tearing them down to 96×144.

Poster quality policy and heavyweight resource-graph policy are split:

- `usesCheapResourceGraph` — no AO/bloom/mirrors/probes (`XR_SAFE` and `QUEST_INLINE`)
- `usesStablePosterBanks` — catalog banks + single shelf sampler
- presentation poster size — 160×240 inline / 96×144 when XR_SAFE is selected at bind

### P0-B — BASE / NEAR / FOCUS

320×480 is NEAR, not the final visual tier.

| Tier | GPU pixels | Bound | Mips | Path |
|---|---|---|---|---|
| BASE | XR 96×144 or inline 160×240 | catalog banks, never evicted | existing BASE array mips | shelf array |
| NEAR | 320×480 | 64 slots | **none** | detail array + LUT |
| FOCUS | 640×960 | **2** dedicated 2D textures | **none** | `posterFocusMap`, sampled before LUT |

FOCUS is decoded from the source image URL, not from the 320×480 CPU cache.
A 320×480 buffer is refused (`upscaledFromNear`), not stretched to 640×960.

Source audit:

- **Jellyfin** shelf `posterUrl`: `Images/Primary` with **no** `maxWidth` (native).
- **Plex** catalog thumbs: transcode `width=400` (400×600). FOCUS fetch rewrites
  that URL to 640×960 with `upscale=0`. It does not invent pixels if the file is smaller.
- IndexedDB `pixels` remain 320×480 for BASE/NEAR. FOCUS does not read that cache.

### P0-C — Motion-aware expensive uploads

During meaningful HMD translation, yaw, locomotion stick, or snap-turn recovery:
NEAR/FOCUS GPU promotions are deferred. BASE stays visible.

- settle: 180 ms still
- fairness: after 900 ms of deferral, at most one expensive promotion
- Quest-class immersive: **1** NEAR/FOCUS promotion per XR frame
- expensive queue cap: 8
- NEAR array: no CPU mip chain
- FOCUS 2D: no mip chain

JavaScript call duration is submission time, **not** Quest GPU execution time.
IWER timings are not a performance gate.

### P0-D — Canonical XR viewer pose

`XRFrame.getViewerPose(referenceSpace)` is the source of truth for:

- MENU / SETTINGS placement
- FPS HUD
- FOCUS priority pose
- motion-aware upload policy

The ordinary application `PerspectiveCamera` world transform is not used as
the HMD pose for interactive XR placement.

MENU / SETTINGS: request → pending → next valid XR frame → place ~0.9 m ahead,
yaw-dominant, upright, then **world-stable**. Reopen recenters.

FPS HUD: viewer-relative every XR frame, upper-left peripheral
(`x: -0.16, y: 0.14, z: -0.52` m in viewer space), faces the viewer, no second rAF,
CanvasTexture repaint only when text changes.

### P0-E — Close-range black artifact diagnostic

Enabled only by `?xrPosterHwDiag=1`. Normal launch creates no fixtures and
installs no extra control interception.

Within **one** immersive session, thumbstick **click** cycles:

| Mode | Meaning |
|---|---|
| A FLAT_DIRECT_BASIC | Plane + MeshBasic + direct 2D, no case, no array shader |
| B CASE_GEOMETRY_DIRECT_BASIC | Case/front geometry + basic direct texture |
| C CASE_BASE_ARRAY | Production-like case + BASE array shader, no NEAR/FOCUS |
| D CASE_DETAIL_SIMPLIFIED | Case + 320×480 array, **no** mip chain |
| E FULL_PRODUCTION | Standard material + depthWrite + mips |

In-headset label shows the active mode name. Both eyes (layer 0 + mirror-skip).
Interpretation (for a later Quest session, not claimed now):

- A black → below case/array (camera/compositor/depth)
- A clean, B black → geometry/depth/case
- B clean, C black → BASE array/custom shader
- C clean, D black → detail path
- D clean, E black → full production material/state

This diagnostic does not identify the root cause by itself.

## Stereo

Signage stereo architecture was not changed. Round 5A.2 hardware: STEREO = PASS.
IWER stereo regression remains required. IWER PASS is not hardware proof.

## Catalog delta sync

Not implemented. Remains JP-4A.5. See `jp4a.5-catalog-delta-sync.md`.

## File budgets (unchanged)

- `src/three-scene.ts` ≤ 6200
- `src/main.ts` ≤ 4600
- `src/video-case.ts` ≤ 6000

## Next Quest session (not this round)

Only independent review may later authorize:

`READY_FOR_SINGLE_QUEST_JP4A_ROUND5B_DIAGNOSTIC`

That one session should answer FOCUS readability, motion-gated hitching,
A→E black-artifact first-failing mode, viewer-pose menu, viewer-relative HUD,
and stereo signage — without five URL reloads.
