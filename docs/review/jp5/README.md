# JP-5 — Quest 3 visual quality (backlog)

Status: **design note only**. Do not implement in JP-4A.

JP-3 PASS proved the XR_SAFE resource graph can enter Quest 3 in about
one second. Owner hardware then showed **low apparent resolution /
severe aliasing**. That finding does not reopen JP-3. It is this phase.

## Goal

Maximize Quest 3 visual quality while maintaining stable XR timing,
resource bounds, and acceptable 72 Hz behavior.

Do **not** preselect a render scale of 1.0 / 1.25 / 1.5 without
measurement. Do **not** blindly raise framebuffer scale.

## Current XR_SAFE baseline (do not change in JP-4A)

- `XR_SAFE_FRAMEBUFFER_SCALE = 0.5` (`src/xr/resource-policy.ts`,
  `src/perf/resource-profile.ts`)
- runtime foveation requested at profile `foveation` (currently 1)
- no EffectComposer / N8AO / GTAO while presenting
- no live mirrors / reflection probes
- poster physical slots = 128

## Work to measure before choosing a strategy

1. Quest 3 apparent aliasing at 0.5 framebuffer scale (owner qualitative
   already: jaggies visible).
2. WebXR / projection-layer MSAA availability vs cost.
3. Runtime foveation (`XRWebGLBinding` / `renderer.xr.setFoveation`)
   effective value vs requested.
4. Projection / render scale independent of the 0.5 bootstrap value.
5. Dynamic resolution with hysteresis, not a one-shot bump.
6. 72 Hz performance guardrail: frame time, not just “looks sharper”.
7. GPU / memory: textures, programs, residency high-water, context loss.
8. Reject blind supersampling that reintroduces sampler overflow or
   the waiting-environment hang JP-3 closed.

## Non-goals for JP-5

- Re-enabling desktop composer/AO as the quality fix
- Full-catalog GPU poster churn
- Changing 128-slot residency to buy sharpness
