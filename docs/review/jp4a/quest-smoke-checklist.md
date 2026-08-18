# JP-4A Quest 3 smoke — PREPARED, NOT EXECUTED

Do not ask the owner to run this until independent review declares
`READY_FOR_SINGLE_QUEST_JP4A_SMOKE` or
`READY_FOR_SINGLE_QUEST_JP4A_ROUND5B_DIAGNOSTIC`.

For the corrected Round 5B.2 fixture use `jp4a-round5b2-quest-procedure.md` and
require `READY_FOR_SINGLE_QUEST_JP4A_ROUND5B2_DIAGNOSTIC`.

Historical hardware:

- `a20389e` — QUEST_HARDWARE FAILED (`jp4a-round5-quest-fail.md`)
- `216483fac` — QUEST_HARDWARE FAILED (`jp4a-round5b-hardware-fail-history.md`)

Current implementation HEAD: **QUEST_HARDWARE = NOT_EXECUTED / PENDING**.

Anti-aliasing / framebuffer scale bump is **not** an acceptance item. That is JP-5.
Do not treat IWER as hardware rendering evidence.

## Round 5B diagnostic session (one enter-VR)

Only after independent review. Use `?xrPosterHwDiag=1`.

1. Enter XR once. Do not reload five URLs.
2. Confirm stereo signage still visible in both eyes.
3. Open menu at several head orientations — should appear ~0.9 m ahead, facing viewer, then stay world-stable.
4. Confirm FPS HUD stays upper-left / readable and follows head orientation.
5. Approach a shelf. BASE should remain visible. Detail should not freeze the headset while walking; waiting still should promote.
6. Inspect a selected title — is FOCUS 640×960 materially clearer than 320×480 NEAR? Can title/logo be recognized?
7. Thumbstick **click** cycles MODE A → B → C → D → E. Record the first mode where the close-range black artifact appears.
8. Exit XR. No context loss.

## Historical smoke checklist (still valid later)

1. Enter XR
2. Store world appears
3. Required non-poster store content visible (signage / fascia / canvas store surfaces)
4. Posters visible
5. Open XR menu (A / X, not B / Y)
6. Open XR settings
7. Navigate settings with controller
8. Modify one safe setting (Language or Environment)
9. Apply / save
10. Close settings
11. World interaction resumes
12. Locomotion / snap remains correct
13. Japanese panel text renders (no tofu)
14. Exit / re-enter XR works
15. No context loss / sampler overflow / uncaught XR errors

## Fail closed

- Required world content missing → `BLOCKED_XR_CONTENT_PARITY`
- Settings cannot be used reliably → `BLOCKED_XR_UI_INTERACTION`
