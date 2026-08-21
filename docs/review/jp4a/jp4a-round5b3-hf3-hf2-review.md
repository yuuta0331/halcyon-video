# JP-4A Round 5B.3 HF3-HF2 — initial controller connection race

Phase: `ROUND5B3_HF3_HF2_INITIAL_CONTROLLER_CONNECTION_RACE_CORRECTION`

Final software state: `READY_FOR_SINGLE_QUEST_JP4A_ROUND5B3_DIAGNOSTIC`

Quest hardware on this new HEAD: **NOT_EXECUTED**. JP-4A final PASS, Quest PASS, black artifact fixed, performance fixed, GPU root cause proven, physical Quest controller reconnect, physical initial `inputsourceschange` timing, and merge permission are not claimed.

## Provenance (OPTION A)

| Role | SHA |
|---|---|
| Previous independently reviewed HF3 evidence HEAD | `c759ed5c45f336cdc3ab441765a3ef7c69ae4c2e` |
| Previous HF3-HF1 implementation-under-test | `60e090fe77b52a0ae3db336451c8a20e093d5c23` |
| Previous HF3-HF1 evidence / PR HEAD | `df4f07f9099ec047c8dc72e998f60783f0b4c838` |
| Implementation-under-test (IWER executed this source) | `14c9d45f9945a4418695ef8acf1cc95518c52c2e` |
| Evidence/documentation commit | the commit that added this file (newer than the tested source) |

This evidence file does **not** prove its own commit SHA. IWER, unit tests, `tsc`, and production build ran against implementation SHA `14c9d45f9945a4418695ef8acf1cc95518c52c2e`. Historical HF3 / HF3-HF1 evidence files are not overwritten.

Quest procedure is unchanged: `jp4a-round5b3-hf3-quest-procedure.md`.

## Exact startup race before this fix

HF3-HF1 correctly made the actual Three.js controller object's `connected` event the authoritative source of `jp4aHand`. That mapping remains intact.

The remaining software race was app-level:

1. `navigator.xr.requestSession()` resolves
2. `installControllers(xrMgr)` binds controller `connected` / `disconnected`
3. **`await ensureXrCompatible(gl)`** — this could call `await gl.makeXRCompatible()` and yield
4. `await renderer.xr.setSession(session)` — Three.js r184 installs session `inputsourceschange` **inside** this call

Three.js r184 (`node_modules/three` **0.184.0**) `WebXRManager.setSession`:

1. assigns `session = value`
2. synchronously `session.addEventListener('inputsourceschange', onInputSourcesChange)` (installed source line 412)
3. **then**, if `attributes.xrCompatible !== true`, `await gl.makeXRCompatible()` (installed source line 416)

If the browser queued the initial `inputsourceschange` after `requestSession()` and the app yielded in `ensureXrCompatible` **before** step 2, Three.js never saw the event, `controller.connect()` never ran, `connected` never dispatched, and `jp4aHand` stayed unset. Logical RIGHT/LEFT Trigger from `session.inputSources` could still work, but `pickJp4aTriggerTarget(hand)` failed closed. No index fallback exists (by HF3-HF1 design).

This evidence does **not** claim the browser always emits that event at a particular microtask. The safety property is: do not leave an avoidable app-level async gap before Three.js attaches its listener.

## Exact new startup ordering

`requestSession` resolves
→ session assigned
→ controller-object `selectstart` / `connected` / `disconnected` listeners installed
→ **no app-level `await`**
→ `renderer.xr.setSession(session)` begins
→ Three.js immediately installs session `inputsourceschange`
→ Three.js may then await `makeXRCompatible` internally
→ initial controller association is race-resistant against the previous app preflight

Synchronous work still sits between `installControllers` and `setSession` (scheduler, animation-loop claim, GL `getContextAttributes` probe, journal). That work cannot yield. Source parser test A asserts **zero** `await` identifiers in that window, including no `await ensureXrCompatible`.

## Compatibility telemetry (truthful)

App-level preflight `ensureXrCompatible` on the Halcyon `XrRuntime` path was **removed**, not moved after `setSession`, and not duplicated.

| Field / event | After HF3-HF2 |
|---|---|
| `contextXrCompatibleBefore` | preserved (sync `noteContextAttributes` / `gl.getContextAttributes()`) |
| `makeXRCompatibleOwner` | `"THREE_WEBXR_MANAGER"` (journal detail) |
| `appPreflightMakeXRCompatible` | `false` |
| `makeXRCompatibleStart` / `End` / `Error` | remain `null` on the Halcyon path — the app did not run it |
| journal | `xr-binding-apis`, then after `setSession` `makeXRCompatible-owned-by-three` |

`ensureXrCompatible()` still exists for diagnostic `raw.ts` / `three-baseline.ts` only. Those are not the JP-4A Halcyon runtime.

## What was not reopened

HF3-HF1: `connected` owns object hand; `disconnected` clears it; `updateControllers()` only builds logical LEFT/RIGHT from `source.handedness`; no `session.inputSources[i]` ↔ `controllerObjects[i]`.

HF3: logical Trigger ownership, AMBIGUOUS simultaneous policy, no opposite-ray fallback, disconnect cancels.

HF2: TAP/HOLD, initial lock on release, FOCUS select exactly once.

Ranges: diagnostic 12 m, production 14 ft. Live-shelf invariant non-empty / truthful. No extra animation loop. No app-level duplicate session `inputsourceschange` listener.

## IWER / browser

Classification: `IWER_EMULATED`. `NOT_HARDWARE_VISUAL_PROOF: true`. `QUEST_HARDWARE: NOT_EXECUTED`.

IWER cannot physically prove Quest startup timing. The harness uses `window.__jp4aLiveControl.startupRace.simulateInitialSourcesDuringCompat(['right','left'])`:

- record `installControllers` → `setSession-enter`
- attach a fake session `inputsourceschange` listener immediately
- enter a fake compatibility await
- emit initial RIGHT+LEFT sources **during** that await
- confirm `connected` on the actual objects and `jp4aHand` RIGHT/LEFT

Observed event order:

`installControllers` → `setSession-enter` → `three-session-listeners-installed` → `optional-compatibility-await` → `initial-inputsourceschange` → `controller-connected:right` → `controller-connected:left`

Reconnect/reorder, RIGHT/LEFT rays, AMBIGUOUS, TAP/HOLD, RESET, second session, live-shelf `checkedSlots=3692` PASS, and normal-URL negative control (no console, no `__jp4aLiveControl`, no association/startup-race seam) also passed.

## Next step after independent approval

STOP SOFTWARE CHANGES. Do not create HF3-HF3. The next action is exactly one fresh Quest 3 Round 5B.3 diagnostic on `/xr-test/jp4a` at the independently verified branch tip, recording the displayed Source HEAD, then following `jp4a-round5b3-hf3-quest-procedure.md`.
