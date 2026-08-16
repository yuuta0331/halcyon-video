# JP-3 Quest 3 hardware smoke

**Current overall status: NOT_READY_FOR_QUEST_ACCEPTANCE / QUEST_HARDWARE_FAILED**

Do not treat emulator evidence as QUEST_HARDWARE. Do not overwrite either
historical failure as NOT_EXECUTED.

Round 5 software/emulator dynamic-working-set gates must pass, then exact-head
CI, before another headset session is requested. Do not request Quest testing
during Round 5 implementation.

## Historical hardware failure — HEAD 73abd4c

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
- Round 5 HEAD: hardware **NOT_EXECUTED / PENDING**

When those gates are green, request **one** hardware session in this order:

1. `?xrBare=1`
2. If BARE succeeds: `?demo=1&nogate=1&xrSafe=1&xrMinimal=1`
3. If that succeeds: `?demo=1&nogate=1&xrSafe=1`
4. Only then: real Jellyfin with XR_SAFE

If BARE fails, stop. Do not test the full store.

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
