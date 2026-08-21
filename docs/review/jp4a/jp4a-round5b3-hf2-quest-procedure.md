# Quest 3 — JP-4A Round 5B.3 HF2 diagnostic procedure

Status on the new HEAD: **QUEST_HARDWARE = NOT_EXECUTED**.

This supersedes **only the Trigger semantics** of `jp4a-round5b3-hf1-quest-procedure.md`. Historical Quest observations are not rewritten. Production FOCUS/upload behavior is unchanged.

## Launch

1. Open the deployed origin plus `/xr-test/jp4a`.
2. Confirm **Source HEAD** matches the requested remote branch HEAD. If **CI checkout** is a different SHA, that is the PR merge-ref that CI tested; it is not the source HEAD.
3. Press **START JP-4A TEST**.
4. Press **ENTER VR**.

No extra query parameters or settings toggles are required. Menu (A/X) behavior is unchanged. B/Y is not bound.

## Trigger rules (HF2)

Physical Trigger has three stages: **DOWN**, **maybe HOLD**, **UP**.

- **Hold actions do not change BLACK/CLEAN verdicts.**
- A press that **creates the lock** is LOCK ONLY. Release, then hold again to begin APPROACH. Holding the lock press too long does not skip into APPROACH.

## One guided pass

**STEP 1.** Stand still. Collect baseline FPS.

**STEP 2.** Stay at the problematic distance/yaw (about 8 m is in range). Point at the affected production shelf poster. **Trigger TAP = LOCK ONLY.** This does not change any LIVE verdict, does not select the poster in production, and does not start FOCUS. The HUD shows only a privacy-safe `opaque-…` id.

Diagnostic lock reach is 12 m in JP-4A test mode only. Ordinary production interaction remains 14 ft.

**STEP 3.** Evaluate all nine LIVE modes:

LIVE-NORMAL, LIVE-BASE, LIVE-LOD0, LIVE-LOD1, LIVE-LOD2, LIVE-LOD3, LIVE-LINEAR, LIVE-UNLIT, LIVE-DEPTH-ISOLATED.

- Thumbstick click = next mode
- Grip = previous mode
- **Trigger TAP** = UNKNOWN → BLACK → CLEAN → UNKNOWN for the current LIVE mode
- **Hold Trigger (~0.7 s)** = BEGIN APPROACH. Verdicts stay frozen.

After LIVE-DEPTH-ISOLATED, one more thumbstick click still returns to LIVE-NORMAL and starts APPROACH.

**STEP 4.** Walk toward the poster. The test records **Approach FPS** while this phase is active, before production FOCUS is requested. **Hold Trigger = BEGIN FOCUS.** This still does not change BLACK/CLEAN verdicts. Production selection of the locked poster happens exactly once.

**STEP 5.** Remain still. FOCUS may finish without more movement (FOCUS-local ~80 ms retry retains decoded pixels; this is not a capacity-wake redesign). Trigger tap or hold during FOCUS must not change LIVE verdicts and must not select again.

**STEP 6.** Regression: Menu front / 90° / 180°, stereo, HUD readability.

**STEP 7.** Exit VR. Page must show **TEST COMPLETE**. COPY RESULT and COPY JSON.

**RESET TEST** restores live diagnostic runtime (matrix, shader, lock, LIVE-NORMAL) without a page reload. START again for a second run in the same page lifetime.

## Required interpretation boundary

IWER evidence is `IWER_EMULATED`, **NOT HARDWARE VISUAL PROOF**, and cannot make a Quest PASS. Use `jp4a-round5b3-root-cause-matrix.md` only with this new-head Quest result.

Zero-slot bank invariants are **NOT_EXERCISED**, never PASS.
