# JP-4A Round 5B.2 investigation

## Coordinate-space findings

Current bugs corrected:

- `HardwarePosterDiagnostic.content` is a direct `host.scene` child, therefore
  its transform is in store units. Its old `y=1.15` was treated like meters and
  rendered at about 0.35 m. The new path waits for the first fresh
  `XR_VIEWER_POSE`, converts reference-space XYZ through the rig once, and puts
  the poster center at the resulting world eye height 1.05 m forward.
- PlaneGeometry and the production case front both face local +Z. The old
  `SPAWN_YAW + PI` rotated Mode A away from the viewer. The corrected world yaw
  is the initial viewer horizontal yaw. Mode A also uses DoubleSide so it tests
  direct Basic texture/compositor visibility, not backface behavior.
- MENU placement previously returned `-viewerYaw`; at ±90-degree placement its
  +Z face pointed away from the viewer. It now uses `viewerYaw` and ignores HMD
  pitch as intended.
- `ViewerWorldPose` previously omitted Y. It now carries fully converted store
  XYZ and the source frame id, so eye-height placement does not reintroduce a
  fixed-height seam.

Reviewed and safe as-is:

- `rig.xrOrigin` is scaled by `STORE_UNITS_PER_METER`; its children use meters.
  HMD pose, viewer-relative HUD position, UI shell geometry, controllers, and
  help-panel geometry are correctly expressed in that meter-space parent.
- FPS/mode HUD transforms use reference-space pose as local coordinates under
  `xrOrigin`. Full HMD orientation is appropriate for viewer-relative planes.
- Diagnostic content is reparented to `host.scene`, placed once, and never
  follows later head motion. Only the label and FPS HUD follow the viewer.
- No camera parenting rewrite or second animation loop is introduced.

## Mode A and visual source

The Mode A disappearance is explained by the fixture yaw/backface defect; the
evidence does not justify blaming the WebXR compositor. The new A invariant is:

`local +Z front normal dot(normalized poster-to-viewer) >= 0.999`.

All A–E tiers now receive the same normalized synthetic visual source: large
white, gray, cyan, and amber areas; corner markers; center crosshair; small
black reference patch; and one bounded lower-right high-frequency calibration
zone. C/D/E retain `createClonedCaseGeometry`, `MeshStandardMaterial`,
`compileProductionPosterFront`, `posterShaderChunk`, array/LUT/FOCUS uniforms,
and production bank binding.

## Approximately 20 FPS: ranked hypotheses

The observation remains preliminary. No cause is declared without a new Quest
capture.

### High confidence code findings

- The old diagnostic label embedded the monotonically increasing bank-bind
  count, forcing a CanvasTexture repaint/upload on every C–E frame.
- The old XR FPS HUD called `fpsMeterReadout()` every frame. That sorts up to
  180 samples; changing values also forced a CanvasTexture repaint/upload every
  frame. Both HUDs now update visible text at no more than 2 Hz while their pose
  transforms still update each frame.
- The main XR render already disables N8AO/postprocessing, uses one Three/WebXR
  animation loop, requests 72 Hz, uses framebuffer scale 0.8, and records the
  requested/effective foveation separately. A duplicate loop or XR N8AO is not
  supported by the inspected architecture.

These are real diagnostic overheads, but code inspection alone cannot prove
they account for the entire gap to approximately 20 FPS.

### Medium confidence contributors

- Full store rendering is stereo and includes roughly 2001 poster instances,
  production case geometry, MeshStandardMaterial lighting, multiple poster
  banks, loaded-flag/LUT lookups, and per-batch bank bindings. Instancing limits
  draw calls but does not remove vertex/fragment work.
- Movement/selection can overlap BASE/NEAR/FOCUS uploads and shader/resource
  transitions. Upload scheduling versus actual GL submissions is recorded
  separately, so the next capture can distinguish queue pressure from GPU
  submission.
- Canvas HUD texture upload remains present at 2 Hz. It is intentionally small
  relative to the previous every-frame behavior but should still be compared
  with `fps=0` if the corrected diagnostic remains slow.

### Low confidence

- The 90 ms stationary retry timer may have added CPU churn during sustained
  admission pressure. Actual queue-capacity release is now the primary wake;
  the timer is a coalesced safety net with separate counters.
- Controller/UI ray work and ordinary diagnostic snapshot construction are
  unlikely to explain 20 FPS by themselves; snapshots are pull-based and no
  new rAF is used.

### Requires Quest measurement

- CPU-bound versus GPU/fragment-bound classification.
- Actual projection framebuffer dimensions and compositor cost at scale 0.8.
- Effective fixed foveation on the tested runtime and whether it changes by UI
  mode.
- Real draw calls/triangles/programs, texture memory, bank count, and array-layer
  dimensions for the tested library.
- Normal shelf versus approach versus FOCUS transition versus settled/static
  FPS, mean interval, 1% low, p95/p99, and worst frame.
- Whether live multibank/residency state, rather than the controlled A–E source,
  is required to reproduce the black region.

## Capturable telemetry

`window.__hwPosterDiag()` now returns the shared FPS-meter statistics, target
and supported Hz, framebuffer scale, requested/effective foveation, frame and
composite sample counts, renderer calls/triangles/memory, upload queue/policy/
wake/GL submission metrics, mode, viewer distance, eye/poster height, pose
freshness, and actual production bind observations.

`window.__livePosterDiag()` returns selected live shelf state using only an
opaque hash ID: global/bank/layer indices, loaded flag, BASE terminal state,
NEAR lease/phase/LUT, FOCUS lease/phase/active state, queue state, bank texture
dimensions, and shader-branch booleans. It emits no title or URL.
