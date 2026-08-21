# JP-4A Round 5B.2 — diagnostic correction and investigation

Maximum software state: `READY_FOR_SINGLE_QUEST_JP4A_ROUND5B2_DIAGNOSTIC`.

This is not JP-4A final acceptance, merge approval, or Quest PASS. The new HEAD
remains `QUEST_HARDWARE=NOT_EXECUTED` until the documented Quest 3 session is
performed. PR #5 must remain Draft and unmerged.

## Implemented

- Fresh-pose eye-height/world-stable poster placement with explicit
  reference-meter → store-unit conversion.
- Correct local +Z front-facing yaw; Mode A DoubleSide baseline semantics.
- Low-frequency, artifact-readable source shared across all A–E tiers.
- Production-equivalent C/D/E geometry/material/compile/array/LUT/FOCUS paths.
- Bank observer increments only after an available production bind succeeds.
- Large, high-contrast, 2 Hz FPS HUD and compact mode/distance HUD with
  deterministic projected-space non-overlap.
- Correct viewer-relative HUD transform audit and corrected world-stable MENU
  yaw sign.
- Pull-based performance/runtime snapshot and privacy-safe live shelf hook.
- Queue-capacity-primary stationary wake with 90 ms fallback counters.
- Evidence semantic rename `lutHasDead` → `lutEntryCount`.
- Jellyfin FOCUS 640×960 URL behavior remains unchanged; Plex remains
  unaffected and URLs are not emitted by the new evidence hooks.

## Evidence classification

- Unit/CI: software behavior only.
- Desktop browser production probe: shader/bind/GL logic only.
- IWER: `IWER_EMULATED`, `NOT HARDWARE VISUAL PROOF`.
- New implementation HEAD: `QUEST_HARDWARE=NOT_EXECUTED`.

See the hardware history, investigation, and single-session procedure in this
directory.
