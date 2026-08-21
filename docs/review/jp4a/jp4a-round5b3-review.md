# JP-4A Round 5B.3 review package

Phase: `ROUND5B.3_LIVE_SHELF_BLACK_AND_FRAME_HITCH_FIX`

Final software state: `READY_FOR_SINGLE_QUEST_JP4A_ROUND5B3_DIAGNOSTIC`

Quest hardware on this new HEAD: **NOT_EXECUTED**. JP-4A final PASS, Quest PASS, and merge permission are not claimed.

## Delivered

- Short diagnostic URL `/xr-test/jp4a`, one-click session start, build SHA, persistence, TEST COMPLETE, Copy Result/JSON, and reset.
- Real-shelf poster lock plus NORMAL/BASE/fixed LOD0–3/LINEAR/UNLIT/DEPTH-ISOLATED ladder.
- Runtime bank/layer/flag invariant and privacy-safe CPU mip evidence.
- 640×960 FOCUS preallocation and actual row-chunk GPU transfer under the existing queue; active only after the final chunk.
- Worker URL decode/resize/RGBA extraction with fallback.
- Stationary queue rejection retry and final render wake.
- Removal of a confirmed per-frame duplicate full-scene traversal.
- Center-bottom FPS HUD and center-top guide/mode HUD using the existing XR loop.
- Automatic bounded telemetry and phase markers for baseline, approach, transition, settled, and live modes.

## Evidence boundary

The browser harness enters an IWER-emulated session, observes a first world render and test telemetry, cycles all modes through the diagnostic API, exits, reloads, and verifies persistence/copy output and normal-URL gating. It is explicitly `IWER_EMULATED`, `NOT HARDWARE VISUAL PROOF`, `QUEST_HARDWARE=NOT_EXECUTED`.

See the investigation, performance analysis, root-cause matrix, Quest procedure, hardware template, software validation JSON, IWER JSON, and console screenshot in this directory.
