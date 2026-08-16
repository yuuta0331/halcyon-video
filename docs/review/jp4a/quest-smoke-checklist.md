# JP-4A Quest 3 smoke — PREPARED, NOT EXECUTED

Do not ask the owner to run this until independent review declares
`READY_FOR_SINGLE_QUEST_JP4A_SMOKE`.

QUEST_HARDWARE for JP-4A is **NOT_EXECUTED / PENDING**.

Anti-aliasing / resolution is **not** an acceptance item. That is JP-5.

## Checklist

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
