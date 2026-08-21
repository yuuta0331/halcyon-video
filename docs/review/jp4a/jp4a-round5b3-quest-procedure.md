# Quest 3 — JP-4A Round 5B.3 single-run procedure

Status on the new HEAD: **QUEST_HARDWARE = NOT_EXECUTED**.

## Launch

1. Open the deployed origin plus `/xr-test/jp4a`.
2. Confirm the displayed Build SHA matches the requested remote branch HEAD.
3. Press **START JP-4A TEST**. This resets only the JP-4A test session, enables FPS, persistence, the LIVE ladder, and the guided HUD.
4. Press **ENTER VR** (or the normal Enter VR control now exposed behind the compact JP-4A button).

No extra query parameters or settings toggles are required.

## One guided pass

HF1 changed the controller/test flow. For the next Quest run use
`jp4a-round5b3-hf1-quest-procedure.md`. Historical observations below are not rewritten.

1. Stand still long enough for baseline samples; read the large center-bottom FPS number.
2. Point at an actually affected shelf poster and press Trigger once to lock it. The HUD shows only a privacy-safe `opaque-…` id.
3. Thumbstick click advances the mode. Grip/squeeze returns to the previous mode. Menu behavior is unchanged.
4. For the current mode, subsequent Trigger presses cycle the visual verdict `UNKNOWN → BLACK → CLEAN → UNKNOWN`. Stop on the observed value before changing mode.
5. Record NORMAL, BASE, LOD0, LOD1, LOD2, LOD3, LINEAR, UNLIT, and DEPTH-ISOLATED. Observe both eyes and repeat the problematic yaw.
6. Return to NORMAL, approach the locked poster, then remain completely still until FOCUS is ready or clearly fails. Do not move merely to wake it.
7. Verify menu front/90°/180° and stereo as a regression check, then Exit VR.

## Result handoff

After exit the page must show **TEST COMPLETE**. Press **COPY RESULT** and paste it into the review. Then press **COPY JSON** and attach/paste the detailed telemetry. If Clipboard API is unavailable, the selected fallback textarea appears for manual copy.

Do not include titles, library names, poster URLs, or credentials in free-form notes. The generated result contains only opaque poster identity.

## Required interpretation boundary

IWER evidence is `IWER_EMULATED`, **NOT HARDWARE VISUAL PROOF**, and cannot make a Quest PASS. Use `jp4a-round5b3-root-cause-matrix.md` only with this new-head Quest result.
