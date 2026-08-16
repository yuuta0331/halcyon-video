# JP-3 Quest 3 hardware smoke

**Current overall status: NOT_READY_FOR_QUEST_ACCEPTANCE / QUEST_HARDWARE_FAILED**

Do not treat emulator evidence as QUEST_HARDWARE. Do not overwrite either
historical failure as NOT_EXECUTED.

Round 6 software/emulator XR-entry gates plus the pre-hardware Medium
cleanup must pass, then exact-head CI. Do not request Quest testing during
that software work.

## Historical hardware failure — HEAD 73abd4c

**Status: FAILED**

A real Meta Quest 3 WAS tested through ADB reverse against HEAD
`73abd4c1e8a50c185ec65cb80020cf3fb13cfc4a`.

Observed:

1. Halcyon loads in Quest Browser.
2. Enter VR button is visible.
3. Selecting Enter VR transfers the headset to the browser/runtime waiting VR
   environment.
4. The application world never appears.
5. It remains waiting indefinitely.

Reason: Enter VR reached the Quest waiting environment but no world frame
appeared. This result is retained. It is **not** NOT_EXECUTED.

## Historical hardware failure — HEAD ac94d1d (correction round 2)

**Status: FAILED** (same externally-visible result)

A real Meta Quest 3 WAS tested against HEAD
`ac94d1d27b66bd044c2366a36bef93ae36427cd9`.

Observed:

- application loads in Quest Browser
- Enter VR button appears normally
- pressing Enter VR transfers into the Quest immersive/waiting environment
- the world never appears
- loading/waiting continues indefinitely

Previous status READY_FOR_FINAL_QUEST_ACCEPTANCE is invalidated.

## Correction round 3

**Status: PENDING hardware** — local software/emulator resource gates:

- `npm test` PASS
- `npm run build` PASS
- `npm run test:xr-emu` PASS (BARE + CORE_XR + locomotion + FULL_XR)
- `npm run test:xr-resource` PASS (BARE + XR_SAFE 200/1000/2000/4000 + store)
- zero sampler-overflow warnings in IWER
- physical poster allocation bounded at 128 slots / ~6.8 MiB CPU

Exact-head CI and independent self-review follow the push. Do not request Quest
hardware until exact-head CI is green.

Round 3 generated `xr-resource.json` is preserved at
`history/round3-b480993-xr-resource.json`. It recorded the impossible
`posterPhysicalSlots=128` / `posterResidentTitles=462` state that Round 4
treats as a blocker. Current `xr-resource.json` is Round 4 evidence.

## Correction round 4

**Status: PENDING hardware on the new HEAD** — Round 3 result was
REQUEST_CHANGES (poster residency ownership). Round 4 software/emulator
gates after the ownership fix:

- `npm test` PASS (includes eviction/free-list regression + 10k stress)
- `npm run build` PASS
- `npm run test:xr-emu` PASS
- `npm run test:xr-resource` PASS with `residentCount <= physicalSlots`
- duplicate physical owners = 0
- free/owned collisions = 0
- XR_SAFE diagnostic quality agrees with GPU diagnostics
- HEAD `b480993` hardware remains NOT_EXECUTED / PENDING

Do not request owner Quest testing until exact-head CI on the Round 5 SHA
is SUCCESS and the result is READY_FOR_RESOURCE_VALIDATED_QUEST_RETEST.

## Correction round 5

**Status: PENDING hardware on the new HEAD** — Round 4 independent review was
REQUEST_CHANGES (`BLOCKED_DYNAMIC_POSTER_RESIDENCY`). Same-rank P1 could not
evict older P1, so the 128-slot window filled with boot P0 plus early P1 and
never rotated. Round 5 separates pin from priority, releases boot P0 pins
after critical-ready, and reconciles a player-relative unique-title working
set. Historical Round 4 JSON is at
`history/round4-00b3e08-xr-resource.json`.

Current `xr-resource.json` must show `evictionCount > 0` after a store walk,
`p1ScheduledAtBoot` bounded (not hundreds of catalog P1 titles), and
`bootPinsActive == false` after critical-ready.

- HEAD `00b3e08`: hardware **NOT_EXECUTED / PENDING**
- HEAD `90aa400`: hardware **FAILED** on retest (waiting environment, no world frame — same historical symptom)
- Round 6 HEAD: hardware **NOT_EXECUTED / PENDING**

## Correction round 6

**Status: PENDING hardware** — Round 5 Quest retest on `90aa400` reproduced the
waiting-environment hang. Round 6 investigates XR entry/lifecycle (page
occlusion during requesting/binding, frame-rate await before setSession,
reference-space probing). Do not request another Quest session during this
correction.

IWER now includes `RAW_WEBXR`, `THREE_BASELINE`, and `BLUR_DURING_ENTRY`.
Those are emulator evidence, not QUEST_HARDWARE.

`BLUR_DURING_ENTRY` evidence provenance:

- Unit tests reproduce the old presenting-only pause decision
  (`legacyPresentingOnlyPauseWouldFire`) against that historical stall
  condition. That is not a claim that the current E2E harness was executed
  against SHA `73abd4c`.
- Current-head IWER `BLUR_DURING_ENTRY` verifies the corrected occlusion
  policy: blur during `requestSession` still yields a first world frame,
  `isRendering === true`, and advancing frames. It fail-closes if that
  regression returns.

When those gates are green **and independent review asks for hardware**, one
later session should use this order:

1. `?xrRaw=1`
2. If RAW succeeds: `?xrThreeBaseline=1`
3. If that succeeds: `?xrBare=1`
4. If BARE succeeds: `?demo=1&nogate=1&xrSafe=1&xrMinimal=1`
5. If that succeeds: `?demo=1&nogate=1&xrSafe=1`
6. Only then: real Jellyfin with XR_SAFE

Stop on first failure:

1. RAW (`?xrRaw=1`) — if fail, stop: browser / raw WebXR / XRWebGLLayer /
   context/session path. Do not test Three or Halcyon.
2. THREE_BASELINE (`?xrThreeBaseline=1`) — only if RAW passes. If fail, stop:
   Three WebXRManager / session binding / compositor integration.
3. BARE (`?xrBare=1`) — only if THREE passes. If fail, stop: Halcyon bare
   wrapper/resource-policy/integration. Do not test full StoreScene.
4. XR_SAFE minimal (`?demo=1&nogate=1&xrSafe=1&xrMinimal=1`) — only if BARE
   passes.
5. XR_SAFE full demo (`?demo=1&nogate=1&xrSafe=1`) — only if minimal passes.
6. Real Jellyfin XR_SAFE — only after all synthetic/demo layers pass.

At every failure collect `window.__lastXrStartup()`,
`window.__xrStartupJournal()`, `window.__xrDiagnostics?.()`, and
`window.__gpuDiagnostics?.()` where available. Never include credentials
or tokens in committed evidence.

## Pre-hardware Medium — diagnostic foveation request contamination

**Status: PENDING hardware on the new HEAD** — independent review of Round 6
was `APPROVE_WITH_ONE_PRE_HARDWARE_MEDIUM`. BARE (and Halcyon initial
`requestSession`) could still request `high-fixed-foveation-level`, so a
future RAW PASS / THREE PASS / BARE FAIL sequence would not be a clean
comparison.

This cleanup makes RAW, THREE_BASELINE, BARE, and Halcyon `xrMinimal`
initial session requests omit layers and fixed-foveation as entry
dependencies. Runtime `setFoveation` remains post-session and best-effort.
This does **not** claim the Quest hang is fixed and is not QUEST_HARDWARE
evidence.

- HEAD `12b3ad7`: hardware **NOT_EXECUTED / PENDING**
- Historical FAIL results above are unchanged.

Emulator evidence lives in this folder separately (`iwer-*.png`,
`xr-diagnostics.json`, `xr-resource.json`) and must not be treated as
QUEST_HARDWARE.

When that later acceptance pass happens, record:

- Meta Quest model / OS
- Meta Quest Browser version / UA
- `immersive-vr` support
- `layers` optional-feature result
- compositor layer types actually constructed
- `maxRenderLayers` if exposed
- active / requested refresh rate
- screenshots: Enter VR UI, in-headset store, controller ray, Japanese panel,
  compositor diagnostic, fallback diagnostic, end-VR desktop restore

Final acceptance checklist (prepare, do not execute until software gates pass):

- [ ] Open app in Quest Browser
- [ ] `?xrBare=1` first world frame
- [ ] XR_SAFE demo store world frame
- [ ] Store scale believable
- [ ] Head motion is HMD pose (no desktop head bob)
- [ ] Both controllers appear / ray select works
- [ ] Analog locomotion + snap turn + collision
- [ ] Real WebXR Layers capability (honest compositor vs mesh fallback)
- [ ] Japanese text has no tofu
- [ ] Exit VR, desktop restores, second Enter VR works
- [ ] No uncaught XR console errors
- [ ] System-menu pause/resume once
- [ ] Real Jellyfin content after core demo succeeds
