# JP-4A Round 5B.3 HF3-HF3 — diagnostic console ENTER VR action bridge

Phase: `ROUND5B3_HF3_HF3_JP4A_CONSOLE_ENTRY_UI_CORRECTION`

Final software state: `READY_FOR_SINGLE_QUEST_JP4A_ROUND5B3_DIAGNOSTIC_RETRY`

This slice only makes the JP-4A diagnostic console operable. It does **not** prove black artifact, black membrane, FPS, FOCUS hitch, stereo, menu, Quest PASS, or JP-4A PASS.

## Provenance (OPTION A)

| Role | SHA |
|---|---|
| Previous independently reviewed HF3-HF2 implementation-under-test | `14c9d45f9945a4418695ef8acf1cc95518c52c2e` |
| Previous independently reviewed HF3-HF2 evidence / PR HEAD | `f8b743638233095963b2589e679f94d84dfa4446` |
| Implementation-under-test (unit/tsc/build/IWER executed this source) | `f92ca7554f9360949130e23f6ebf32458a5045ac` |
| Evidence/documentation commit | the commit that added this file (newer than the tested source) |

This evidence file does **not** prove its own commit SHA. IWER, targeted tests, full unit tests, `tsc`, and production build ran against implementation SHA `f92ca7554f9360949130e23f6ebf32458a5045ac`. Historical HF3-HF2 / HF3-HF1 / HF3 evidence files are not overwritten.

## Hardware attempt before this fix (user-supplied)

This is **USER_SUPPLIED_HARDWARE_OBSERVATION**, not model-generated evidence, and not a visual FAIL.

| Field | Value |
|---|---|
| `QUEST_HARDWARE` | `ATTEMPTED_BUT_DIAGNOSTIC_NOT_STARTED` |
| `XR_SESSION` | `NOT_ENTERED` |
| `ROUND5B3_VISUAL_DIAGNOSTIC` | `NOT_EXECUTED` |
| `reason` | `JP4A_TEST_CONSOLE_ENTRY_UI_BLOCKED` |
| `source` | `USER_SUPPLIED_HARDWARE_OBSERVATION` |

Observed Quest 3 facts:

- `/xr-test/jp4a` loaded
- RESET TEST responded
- ENTER VR did not respond
- other console buttons appeared non-responsive / provided no observable feedback
- therefore the Round 5B.3 visual diagnostic did **not** start

Do not reinterpret this as black-artifact FAIL, FPS FAIL, FOCUS FAIL, or JP-4A FAIL.

New hardware run after this fix: `NOT_EXECUTED_AFTER_FIX`.

## Exact old ENTER VR path

JP-4A console `enterVr()` programmatically clicked another DOM button:

`#jp4a-test-console ENTER VR`
→ `document.getElementById('xr-enter-btn').click()` or `#btn-enter-vr.click()`
→ that button's later-registered handler
→ `toggleXrSession(storeScene)`

The console mounts at boot, before StoreScene / XR wiring. `toggleXrSession(null)` and store-not-ready paths returned silently (`console.warn` only). That can look like "button pressed, nothing happened" on Quest.

## Exact new ENTER VR path

`#jp4a-test-console ENTER VR` click
→ `invokeJp4aEnterVr()` in the same click-handler turn (no pre-entry await)
→ `enterXrSession(current storeScene via getter)`
→ same `runXrSessionAction` implementation as production `toggleXrSession`
→ `scene.enterXr()`
→ `navigator.xr.requestSession(...)`

Synthetic `.click()` forwarding is **removed**. Production `#xr-enter-btn` / `#btn-enter-vr` / power-menu / HUD still call `toggleXrSession` on the same underlying action.

Scene replacement uses `bindJp4aConsoleStoreScene(() => storeScene)` so the current scene is resolved at action time. Rebuild/teardown calls `setStoreScene(...)` / `null` and notifies the console.

## Readiness

Console readiness is derived from production truth (`wiredXrSupported()`, current scene getter, `isStoreVisualReady()`, in-flight, presenting):

1. `BOOTING` — probe pending: ENTER VR disabled, "Checking XR support…"
2. `WAITING_FOR_STORE` — no StoreScene: disabled, "WAITING FOR STORE…"
3. `XR_UNSUPPORTED` — probe false: disabled, "Immersive VR unavailable"
4. `STORE_LOADING` — visual readiness false: disabled, "Store is still loading…"
5. `READY_TO_ENTER_VR` — enabled, "ENTER VR"
6. `ENTERING_VR` — disabled, "ENTERING VR…"
7. `PRESENTING` — "VR ACTIVE"
8. `ENTRY_FAILED` — retry enabled, "VR ENTRY FAILED: \<reason\>"

Silent no-op is gone on the JP-4A path:

- `storeScene === null` → `{ ok: false, reason: 'STORE_SCENE_NOT_READY' }`
- store loading → `{ ok: false, reason: 'STORE_LOADING' }` (no `requestSession`)
- XR unsupported → `{ ok: false, reason: 'XR_UNSUPPORTED' }` (no `requestSession`)
- `enterXr` reject → `{ ok: false, reason: 'ENTRY_FAILED', error }`
- second tap while in-flight → `{ ok: false, reason: 'ENTERING' }`

Production `toggleXrSession` still uses the same implementation and still does not bypass store visual readiness.

## Console actions (actual DOM)

START, ENTER VR, CONTINUE TO STORE, reopen (`#jp4a-test-reopen`), COPY RESULT, COPY JSON, and RESET TEST are standard `<button type="button">` with `click` listeners.

COPY RESULT / COPY JSON:

- clipboard success → `COPIED RESULT` / `COPIED JSON`
- clipboard rejection → visible selectable textarea + `COPY FALLBACK READY`
- complete failure → `COPY FAILED`

START still does not auto-enter XR. RESET clears pending entry-failure state without duplicating the action getter.

## IWER / browser

Classification: `IWER_EMULATED`. `NOT_HARDWARE_VISUAL_PROOF: true`.

IWER **cannot** prove Quest Browser trusted-input / transient user-activation semantics.

It **does** prove the user-facing button route is no longer bypassed:

- load `/xr-test/jp4a`
- actual START button
- wait for app XR / store readiness
- actual ENTER VR button (`usedXrTestEnter: false`)
- emulated world render starts
- CONTINUE / reopen
- COPY RESULT / COPY JSON visible copied feedback
- RESET then second START + ENTER
- normal URL: no console, no reopen, HUD/menu Enter VR present
- live-shelf invariant `checkedSlots=3692` PASS

Architectural assertion (software, not Quest hardware): the JP-4A ENTER VR handler calls `invokeJp4aEnterVr()` in the same click turn, with no other-button `.click()` and no `async function enterVr`.

## What was not reopened

HF3-HF2: no app-level `await ensureXrCompatible` before Three `setSession`; Three owns compatibility.

HF3-HF1: actual controller `connected` owns `jp4aHand`; `disconnected` clears it; no `session.inputSources[i]` ↔ `controllerObjects[i]`.

HF3: LEFT/RIGHT source ownership, AMBIGUOUS, no opposite fallback.

HF2: TAP/HOLD, initial LOCK ONLY, HOLD APPROACH/FOCUS, FOCUS production select once.

Round 5B.3: diagnostic 12 m, production 14 ft, LIVE modes, live shelf invariant, FOCUS upload architecture.

## Next step after independent approval

STOP SOFTWARE CHANGES. Do not create HF3-HF4.

Deploy the independently verified final branch tip. Then perform exactly **one** fresh Quest 3 Round 5B.3 diagnostic retry on `/xr-test/jp4a` using `jp4a-round5b3-hf3-hf3-quest-procedure.md`.

First confirm the device-displayed Source HEAD is the independently verified final HEAD.

Then: START → wait until ENTER VR reports READY → ENTER VR → established Round 5B.3 procedure → Exit VR → COPY RESULT → COPY JSON.

Do not reuse the blocked hardware attempt as visual evidence.
