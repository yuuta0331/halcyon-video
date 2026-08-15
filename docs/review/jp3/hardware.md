# JP-3 Quest 3 hardware smoke

**Status: FAILED** (historical, previous implementation)

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

Do not change this verdict until a later real Quest re-test succeeds on a
**corrected** HEAD after:

- unit tests PASS
- desktop browser PASS
- IWER CORE / NO-LAYERS / FULL PASS (as far as IWER supports)
- boot-performance correction validated
- exact-head CI PASS

Emulator evidence lives in this folder separately (`iwer-*.png`,
`xr-diagnostics.json`) and must not be treated as QUEST_HARDWARE.

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

Final acceptance checklist (prepare, do not execute in this round):

- [ ] Open app in Quest Browser
- [ ] Enter VR from the real UI
- [ ] requestSession → first visible world frame
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
