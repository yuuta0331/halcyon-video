# XR architecture (Phase JP-3)

JP-3 adds a standards-based WebXR path for Meta Quest-class headsets without
changing desktop, browser, or Tauri behavior. Detection never starts a session.
Enter VR requires an explicit user gesture.

## Scene graph

```
Projection scene  (store units: 1 m ≈ 3.28084)
     ↓
WebXR / Three.js  (renderer.xr + setAnimationLoop while presenting)
     ↓
Player Rig        (locomotion position + yaw)
     ↓
HMD + controllers (headset-local pose in meters, scaled at xr-origin)
```

```
XrLayerManager  (the only caller of session.updateRenderState({ layers }))
├─ high-acuity UI composition layer   (XRQuadLayer, local-floor / body-oriented)
├─ mesh fallback                      (same canvas, world-occluded Three.js plane)
└─ future XRMediaBinding video layer  (?xrMedia=1 / bb_xr_media_layer)
```

Ordinary store geometry — shelves, tapes, walls, floor, counter, clerk, and
in-world signage — stays in the projection scene so real 3D occlusion is
preserved. Compositor layers are not used as a sharpness cheat for aisle signs.

## Store units ↔ meters

`STORE_UNITS_PER_METER = 3.28084` in `src/platform/index.ts`. The XR origin
group is scaled by that constant so 1 m of HMD motion is 3.28084 store units.
Locomotion writes the rig in store units and reuses `constrainWalkPosition()`.

## Reference space

Preferred `local-floor`, then `local`, then `viewer`. `local-floor` is optional,
never required. The runtime probes with `requestReferenceSpace` and then tells
Three.js the type before `setSession`.

## Layer space

- `viewer` — only a tiny head-locked element (reticle). Not used for the help panel.
- `local` / `local-floor` — body/world-oriented panels.
- The JP-3 help/status quad is parented to the player rig (body-oriented), not
  glued to the HMD.

## Fallback contract

`optionalFeatures: ['local-floor', 'layers']`. A runtime without Layers still
enters VR. If `createQuadLayer` or `maxRenderLayers < 2` is missing, the same
canvas is shown on a mesh. Functionality is not dropped.

## Quality policy (Quest-safe baseline)

While presenting:

- no N8AO / EffectComposer / bokeh (direct `renderer.render`)
- conservative projection `framebufferScaleFactor` 0.7
- target 72 Hz when `supportedFrameRates` exists; missing API is not a failure
- desktop quality is unchanged after exit

Projection resolution and the 1024×512 compositor-UI canvas are independent.

## Lifecycle

1. Probe `isSessionSupported('immersive-vr')` after the 3D scene exists.
2. Show Enter VR only when supported and not Tauri.
3. `requestSession` from the click (user activation).
4. `renderer.setAnimationLoop(animate)` for the session; desktop rAF is disarmed.
5. Session `end` (UI or headset) restores the camera parent, quality path, and rAF.
6. Enter → exit → enter is supported. The page is not reloaded.

## Locale / Brand Pack

XR consumes `t()` and the BBCjk/Noto CJK seam. It does not write `bb_locale`
or `bb_brand_pack`.

## Deferred (not JP-3)

Physical VHS grabbing, two-handed manipulation, hand tracking, passthrough,
native OpenXR APK, 90/120 Hz tuning, foveated rendering, HTML UI migration,
and default XRMediaBinding movie viewing (the adapter exists; bind is opt-in).
