# Quest 3 — JP-4A Round 5B.3 HF3 diagnostic procedure

Status on the new HEAD: **QUEST_HARDWARE = NOT_EXECUTED**.

This supersedes the Trigger **source** sentence of `jp4a-round5b3-hf2-quest-procedure.md`. TAP/HOLD timing and production FOCUS behavior are unchanged. Historical Quest observations are not rewritten.

## Launch

1. Open the deployed origin plus `/xr-test/jp4a`.
2. Confirm **Source HEAD** matches the requested remote branch HEAD. If **CI checkout** is a different SHA, that is the PR merge-ref that CI tested; it is not the source HEAD.
3. Press **START JP-4A TEST**.
4. Press **ENTER VR**.

No extra query parameters or settings toggles are required. Menu (A/X) behavior is unchanged. B/Y is not bound.

## Controller source rule (HF3)

Use the Trigger on the **same controller whose ray is pointing at the affected poster**.

- RIGHT Trigger uses the RIGHT controller ray only.
- LEFT Trigger uses the LEFT controller ray only.
- The opposite controller’s ray is never used as a fallback.
- HUD still shows only a privacy-safe `opaque-…` id. Do not expect a title.

If both Triggers are pressed in the same instant, the harness treats that as ambiguous and does nothing. Release both, then press one.

A press that **creates the lock** is LOCK ONLY. Release, then hold again to begin APPROACH.

**Hold actions do not change BLACK/CLEAN verdicts.**

## One guided pass

**STEP 1.** Stand still. Collect baseline FPS.

**STEP 2.** Stay at the problematic distance/yaw (about 8 m is in range). Point at the affected production shelf poster with one controller. **Trigger TAP = LOCK ONLY** on that same controller.

Diagnostic lock reach is 12 m in JP-4A test mode only. Ordinary production interaction remains 14 ft.

**STEP 3.** Evaluate all nine LIVE modes with stick/grip. **Trigger TAP** = UNKNOWN → BLACK → CLEAN. **Hold Trigger (~0.7 s)** = BEGIN APPROACH.

**STEP 4.** Walk toward the poster. **Hold Trigger = BEGIN FOCUS.** Production selection happens exactly once.

**STEP 5.** Remain still. FOCUS-local ~80 ms retry remains OPTION A.

**STEP 6.** Menu front / 90° / 180°, stereo, HUD readability.

**STEP 7.** Exit VR. COPY RESULT and COPY JSON.

**RESET TEST** restores live diagnostic runtime without a page reload.

## Required interpretation boundary

IWER evidence is `IWER_EMULATED`, **NOT HARDWARE VISUAL PROOF**, and cannot make a Quest PASS. Zero-slot bank invariants are **NOT_EXERCISED**, never PASS.
