# Quest 3 — JP-4A Round 5B.3 HF3-HF3 diagnostic retry procedure

Status on the new HEAD: **QUEST_HARDWARE = ATTEMPTED_BUT_DIAGNOSTIC_NOT_STARTED** for the previous attempt. **New hardware run after this fix: NOT_EXECUTED.**

This updates the **launch / console UI** steps only. Controller TAP/HOLD, LEFT/RIGHT source rules, ranges, and LIVE-mode procedure remain those of `jp4a-round5b3-hf3-quest-procedure.md`. Historical Quest observations are not rewritten.

Do not reuse the blocked previous attempt as visual evidence.

## Previous blocked attempt (not visual evidence)

User-supplied Quest 3 observation on the previous software HEAD:

- `/xr-test/jp4a` loaded
- RESET TEST responded
- ENTER VR did not respond
- other console buttons appeared non-responsive
- XR session was not entered
- Round 5B.3 visual diagnostic was not executed

Reason: `JP4A_TEST_CONSOLE_ENTRY_UI_BLOCKED`.

That is **not** a black-artifact FAIL, FPS FAIL, FOCUS FAIL, or JP-4A FAIL.

## Launch

1. Open the deployed origin plus `/xr-test/jp4a`.
2. Confirm **Source HEAD** matches the independently verified remote branch HEAD. If **CI checkout** is a different SHA, that is the PR merge-ref that CI tested; it is not the source HEAD.
3. Press **START JP-4A TEST**.
4. If the overlay hides, press the small **JP-4A TEST** reopen button at the lower right.
5. Wait until **ENTER VR** is enabled and the status reads **ENTER VR** (not WAITING FOR STORE… / Store is still loading… / Checking XR support… / Immersive VR unavailable).
6. Press **ENTER VR**.

Do not press ENTER VR while it is disabled. A pending or failed attempt should show a short reason next to the button (ENTERING VR… / VR ENTRY FAILED / WAITING FOR STORE…).

No extra query parameters or settings toggles are required. Menu (A/X) behavior is unchanged. B/Y is not bound.

START does **not** auto-enter XR.

## Copy / reset

After Exit VR:

- **COPY RESULT** should change to **COPIED RESULT**, or show **COPY FALLBACK READY** with a selectable textarea if clipboard permission is denied.
- **COPY JSON** should change to **COPIED JSON**, or the same fallback.
- **RESET TEST** clears the session so START can run again without a page reload.

## Controller / visual procedure

After VR is active, follow the established Round 5B.3 HF3 one-pass procedure in `jp4a-round5b3-hf3-quest-procedure.md`:

- same-controller ray + Trigger
- TAP = LOCK ONLY / BLACK / CLEAN
- HOLD = APPROACH then FOCUS (FOCUS production-selects exactly once)
- diagnostic lock reach 12 m in JP-4A test mode only
- ordinary production interaction remains 14 ft
- nine LIVE modes, stereo, menu/HUD, then Exit VR

## Required interpretation boundary

IWER evidence is `IWER_EMULATED`, **NOT HARDWARE VISUAL PROOF**, and cannot prove Quest Browser user-activation. Zero-slot bank invariants are **NOT_EXERCISED**, never PASS.

Only this fresh Quest run may supply visual/hardware evidence for LIVE mode BLACK/CLEAN, affected distance, yaw dependence, stereo, approach hitch, FOCUS hitch, FPS, and menu/HUD behavior.
