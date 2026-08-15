# JP-3 Quest 3 hardware smoke

**Status: NOT_EXECUTED**

No Meta Quest device was connected to this workstation during JP-3
implementation. Rechecked 2026-08-15: `hzdb device_list` returned
`count: 0`. Do not treat desktop Chrome WebXR emulation as a headset PASS.

When a Quest 3 is available, record:

- Meta Quest model / OS
- Meta Quest Browser version / UA
- `immersive-vr` support
- `layers` optional-feature result
- compositor layer types actually constructed
- `maxRenderLayers` if exposed
- active / requested refresh rate
- screenshots: Enter VR UI, in-headset store, controller ray, Japanese panel,
  compositor diagnostic, fallback diagnostic, end-VR desktop restore

Checklist (from the JP-3 brief):

- [ ] Open app in Quest Browser
- [ ] Enter VR from the real UI
- [ ] Store scale believable
- [ ] Head motion is HMD pose (no desktop head bob)
- [ ] Controllers appear / ray select works
- [ ] Analog locomotion + snap turn + collision
- [ ] Compositor layer diagnostic is honest
- [ ] Japanese text has no tofu
- [ ] Exit VR, desktop restores, second Enter VR works
- [ ] No uncaught XR console errors
- [ ] System-menu pause/resume once
