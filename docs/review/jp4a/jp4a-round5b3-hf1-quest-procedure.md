# Quest 3 — JP-4A Round 5B.3 HF1 diagnostic procedure

Status on the new HEAD: **QUEST_HARDWARE = NOT_EXECUTED**.

This supersedes the controller/test-flow portion of `jp4a-round5b3-quest-procedure.md` for the HF1 harness. Historical Quest observations are not rewritten.

## Launch

1. Open the deployed origin plus `/xr-test/jp4a`.
2. Confirm **Source HEAD** matches the requested remote branch HEAD. If **CI checkout** is a different SHA, that is the PR merge-ref that CI tested; it is not the source HEAD.
3. Press **START JP-4A TEST**.
4. Press **ENTER VR**.

No extra query parameters or settings toggles are required. Menu (A/X) behavior is unchanged. B/Y is not bound.

## One guided pass

**STEP 1.** Stand still. Collect baseline FPS.

**STEP 2.** Stay at the problematic distance/yaw (about 8 m is in range). Point at the affected production shelf poster. **Trigger = LOCK ONLY.** This does not select the poster in production and does not start FOCUS. The HUD shows only a privacy-safe `opaque-…` id.

Diagnostic lock reach is 12 m in JP-4A test mode only. Ordinary production interaction remains 14 ft.

**STEP 3.** Evaluate all nine LIVE modes:

LIVE-NORMAL, LIVE-BASE, LIVE-LOD0, LIVE-LOD1, LIVE-LOD2, LIVE-LOD3, LIVE-LINEAR, LIVE-UNLIT, LIVE-DEPTH-ISOLATED.

- Thumbstick click = next mode
- Grip = previous mode
- Short Trigger after lock = UNKNOWN → BLACK → CLEAN → UNKNOWN

After LIVE-DEPTH-ISOLATED, one more thumbstick click returns to LIVE-NORMAL and starts APPROACH. **Hold Trigger (~0.7 s)** also skips remaining modes and begins APPROACH. The lock press itself does not count as a hold.

**STEP 4.** Walk toward the poster. The test records **Approach FPS** while this phase is active, before production FOCUS is requested.

**STEP 5.** **Hold Trigger** = BEGIN FOCUS / SELECT LOCKED POSTER. Only now does production selection run. Remain still. FOCUS may finish without more movement (FOCUS-local ~80 ms retry retains decoded pixels; this is not a capacity-wake redesign).

**STEP 6.** Regression: Menu front / 90° / 180°, stereo, HUD readability.

**STEP 7.** Exit VR. Page must show **TEST COMPLETE**. COPY RESULT and COPY JSON.

**RESET TEST** restores live diagnostic runtime (matrix, shader, lock, LIVE-NORMAL) without a page reload. START again for a second run in the same page lifetime.

## Required interpretation boundary

IWER evidence is `IWER_EMULATED`, **NOT HARDWARE VISUAL PROOF**, and cannot make a Quest PASS. Use `jp4a-round5b3-root-cause-matrix.md` only with this new-head Quest result.

Zero-slot bank invariants are **NOT_EXERCISED**, never PASS.
