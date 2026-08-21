# JP-4A Round 5B.3 HF3-HF1 — controller slot association

Phase: `ROUND5B3_HF3_HF1_CONTROLLER_SLOT_ASSOCIATION_CORRECTION`

Final software state: `READY_FOR_SINGLE_QUEST_JP4A_ROUND5B3_DIAGNOSTIC`

Quest hardware on this new HEAD: **NOT_EXECUTED**. JP-4A final PASS, Quest PASS, black artifact fixed, performance fixed, GPU root cause proven, hardware controller reconnect physically proven, and merge permission are not claimed.

## Provenance (OPTION A)

| Role | SHA |
|---|---|
| Previous independently reviewed HF3 evidence HEAD | `c759ed5c45f336cdc3ab441765a3ef7c69ae4c2e` |
| HF3 implementation-under-test | `d178a0f708c57f4f31f702619f8d3505502fb21d` |
| Implementation-under-test (IWER executed this source) | `60e090fe77b52a0ae3db336451c8a20e093d5c23` |
| Evidence/documentation commit | the commit that added this file (newer than the tested source) |

This evidence file does **not** prove its own commit SHA. IWER ran the implementation commit above. Historical HF3 evidence files are not overwritten.

## Exact fix

Previous unsafe mapping (removed):

`controllerObjects[i].userData.jp4aHand = session.inputSources[i].handedness`

That assumed WebXR's active-source list was a stable Three.js controller-slot table. After disconnect/reconnect those orders can diverge, so RIGHT Trigger could raycast the LEFT object.

New authoritative mapping:

- Three.js controller `connected` → `setJp4aControllerHandFromConnection(event.target, event.data.handedness)`
- `disconnected` → clear that object's `jp4aHand` / `jp4aInputSource`
- `updateControllers()` still keys **logical** LEFT/RIGHT buttons by `source.handedness`
- it does **not** rewrite Three.js object hands from array indexes

Listeners are installed on `getController(i)` **before** `renderer.xr.setSession()`. Three.js r184 only dispatches `connected` from session `inputsourceschange` inside `setSession`, so the current lifecycle does not need an index-based catch-up.

## Disconnect / reconnect

RIGHT disconnect clears the actual RIGHT object's hand marker. If RIGHT owned the active press, existing HF3 source-connected logic cancels with no TAP/HOLD/FOCUS/select. LEFT stays marked left. RIGHT reconnect into any reused Three.js slot sets **that** object's hand to RIGHT via `connected`.

## Reordered `inputSources` regression

Injected (IWER cannot natively prove Quest reconnect):

- slot 0 connected RIGHT, slot 1 connected LEFT
- logical active list `[LEFT, RIGHT]`
- slot 0 remains RIGHT, slot 1 remains LEFT
- RIGHT Trigger still resolves controller object 0
- LEFT Trigger still resolves controller object 1

Classification: `IWER_EMULATED`. `NOT_HARDWARE_VISUAL_PROOF: true`. `QUEST_HARDWARE: NOT_EXECUTED`.

Quest procedure is unchanged: `jp4a-round5b3-hf3-quest-procedure.md`. The user still points with one controller and presses Trigger on that same controller.
