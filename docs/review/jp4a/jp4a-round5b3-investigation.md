# JP-4A Round 5B.3 investigation

Phase: `ROUND5B.3_LIVE_SHELF_BLACK_AND_FRAME_HITCH_FIX`

Software state: `READY_FOR_SINGLE_QUEST_JP4A_ROUND5B3_DIAGNOSTIC` after the validation recorded separately. New-head Quest status is **NOT_EXECUTED**. This document does not claim the remaining black artifact is fixed.

## Hardware source of truth retained from Round 5B.2

Tested HEAD was `8750cb4ea1b21a3098e8b83eb20af6df1a9ff53a`. Diagnostic height passed; A–E were all clean; menu front/90°/180° and stereo passed. A subset of real shelf posters developed a bilateral black veil at the user-observed distance of roughly 8 m, worsening at oblique head yaw. FPS was approximately 25 baseline, 20 while approaching, 10 during the FOCUS transition, and 20 after settling. Approach judder and transition freeze were strong; stationary high-resolution completion was not observed; the FPS HUD remained hard to read.

This is history, not a result for the new HEAD.

## Confirmed source-level causes

1. FOCUS upload ownership escaped the queue. `poster-focus-texture.ts` copied 640×960 RGBA into a `DataTexture` and set `needsUpdate`; that scheduled Three.js work but did not perform the GPU transfer. The next render could therefore own the full upload outside the expensive-upload budget. FOCUS now preallocates slots, transfers 64 rows per queued `texSubImage2D` chunk, restores GL/Three state, and activates only after the last actual submission.
2. FOCUS decode/resize/RGBA extraction ran on the main thread. The URL path now uses a lazy worker for fetch, `createImageBitmap`, `OffscreenCanvas`, `drawImage`, and `getImageData`, transfers the buffer without a second copy, and retains a compatibility fallback.
3. Baseline XR performed duplicate full-scene work. `onLocomotionTick` called both poster working-set reconciliation and `publishXrContent`; the latter traverses the entire scene and was executed every XR frame. It now runs only on structural/selection publication paths. No quality setting was reduced.
4. A rejected FOCUS upload could wait on a later external reconciliation. The decoded pixels and lease now remain owned by the upload state machine, which retries through capacity wake plus an 80 ms fallback timer and requests a render after final completion; no new animation loop was added.

These explain concrete hitch/baseline/stationary risks. They do **not** prove the visual black artifact's cause.

## BASE mip and array findings

- Stable XR banks are 160×240 BASE arrays (overflow bank 64×96), `LinearMipmapLinearFilter`, linear magnification, and anisotropy capped at `min(8, device maximum)`.
- Each layer is uploaded by raw `texSubImage3D` at level 0. Every lower level is generated on CPU and uploaded explicitly; whole-array `generateMipmap` is intentionally avoided.
- The loaded flag changes only after the layer's complete mip chain returns. Valid states are 0, 128, 200 (stable same-texture fallback), and 255.
- The old half-filter omitted a trailing row/column for odd dimensions. The shared mip generator now includes the final edge. Unit evidence covers every dimension/byte count down to 1×1, odd sizes, representative pixels, and first/middle/last layer fixtures.
- A privacy-safe runtime evidence call reports dimensions, byte lengths, and first/middle/last pixels for the locked layer. It contains no title, URL, or token.

Mips remain a high-priority hypothesis because the symptom starts at distance and worsens at grazing angles. They are not yet established as the Quest cause.

## Bank and stable mapping findings

For every live slot the diagnostic compares global index, expected bank/layer, front and back mesh bank, both `aTextureIndex` values, array depth, and loaded flag. Software positive/negative fixtures verify all four zero-required counters. A frozen index notification that would cross a mesh bank boundary is now rejected instead of changing only the attributes and making the draw-bank binding inconsistent. Same-bank late notifications remain valid.

The invariant is computed at diagnostic creation and lock/evidence capture, not on every telemetry sample, so it cannot become a 4 Hz whole-shelf performance tax.

## Geometry, material, depth, and view-dependent search

- A shelf slot is a retail front `InstancedMesh` plus a separate rental-shell/back `InstancedMesh`; the rental clamshell is intentionally larger and behind the retail case. The selected LIVE diagnostic changes the actual front instance, not a nearby A–E fixture.
- The production front is `MeshPhysicalMaterial`, metalness 0, finish-dependent roughness/clearcoat, with standard depth test/write and default face behavior. It can therefore have glancing-angle lighting behavior; `LIVE-UNLIT` isolates that single dependency while keeping the selected texture and geometry.
- No poster-specific overlay, second poster plane, polygon offset, or comfort/tunneling mask was found in the XR shelf path. CRT-local vignettes exist but do not cover shelf posters.
- Desktop uses an `EffectComposer` photo-grade pass with vignette/grain. Immersive XR explicitly calls direct `renderer.render` and skips the composer, so that vignette is absent from the XR path.
- `LIVE-DEPTH-ISOLATED` moves only the selected production front instance 0.025 store units (about 7.6 mm) toward local front and restores the exact matrix on mode change/disposal. It tests depth interference without replacing the texture/material path.
- Foveation and compositor behavior remain device/runtime variables and require Quest evidence.

## What remains a hypothesis

- automatic LOD or one corrupt lower mip for the affected layer;
- bank/layer mismatch on the user's catalog (software invariant is available but their live result is pending);
- physical material lighting at grazing angles;
- front/rental depth interference;
- Quest foveation, driver, bandwidth, or compositor behavior;
- an incomplete diagnostic-path equivalence if all locked modes are clean while an unlocked copy remains black.

The interpretation rules are in `jp4a-round5b3-root-cause-matrix.md`.
