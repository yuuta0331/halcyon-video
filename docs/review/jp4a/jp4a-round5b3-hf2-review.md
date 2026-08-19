# JP-4A Round 5B.3 HF2 — controller input and evidence correction

Phase: `ROUND5B3_HF2_CONTROLLER_INPUT_AND_EVIDENCE_CORRECTION`

Final software state: `READY_FOR_SINGLE_QUEST_JP4A_ROUND5B3_DIAGNOSTIC`

Quest hardware on this new HEAD: **NOT_EXECUTED**. JP-4A final PASS, Quest PASS, black artifact fixed, performance fixed, GPU root cause proven, and merge permission are not claimed.

## Provenance (OPTION A)

| Role | SHA |
|---|---|
| Independent-reviewed HF1 head | `1a3042d7beabd6e6b7462fdb2b5c7a337711b75d` |
| Implementation-under-test (IWER executed this source) | `8dba63243a130860a6db76b433346763536db200` |
| Evidence/documentation commit | the commit that added this file and `jp4a-round5b3-hf2-iwer.json` (newer than the tested source) |

This evidence file does **not** prove its own commit SHA. IWER ran the implementation commit above.

Historical HF1 IWER JSON still records `cab25d09…` because that run happened before the HF1 commit. That file is not overwritten.

## Controller semantics

Trigger is modeled as DOWN → maybe HOLD → UP.

| Press | Action |
|---|---|
| TAP on unlocked valid poster | LOCK ONLY. Verdict stays UNKNOWN. No production select. No FOCUS. |
| Same lock press held ≥ 700 ms | Still LOCK ONLY on release. Does not BEGIN APPROACH. |
| TAP while locked in LOCKED_LIVE_DIAG | UNKNOWN → BLACK → CLEAN → UNKNOWN exactly once per release |
| HOLD ≥ 700 ms in LOCKED_LIVE_DIAG | BEGIN APPROACH. Verdict frozen. |
| HOLD ≥ 700 ms in APPROACH | BEGIN FOCUS / `xrSelectSlot` exactly once. Verdict frozen. |
| TAP or HOLD in FOCUS_* | No LIVE verdict change. No second production select. |
| No-hit TAP | No verdict mutation. |
| No-hit HOLD from BASELINE | No FOCUS. |

`LivePosterDiagRuntime.lock()` locks only. `cycleVerdict()` is the only Trigger path that marks BLACK/CLEAN, and only in LOCKED_LIVE_DIAG.

XR `selectstart` still serves Menu UI. JP-4A WORLD Trigger commits on the polled state machine, not on selectstart.

Hold actions do not change BLACK/CLEAN verdicts.

## HF1 closures preserved

RESET TEST, lock≠FOCUS, explicit phases, 12 m diagnostic lock, production 14 ft, truthful zero-slot invariant, Source HEAD vs CI checkout, 3692-slot IWER invariant, production FOCUS 5B.3 upload path (640×960, 64-row chunks, queue-owned `texSubImage2D`, worker decode, active after final chunk, local ~80 ms retry OPTION A, no extra animation loop).

## IWER boundary

Classification: `IWER_EMULATED`. `NOT_HARDWARE_VISUAL_PROOF: true`. `QUEST_HARDWARE: NOT_EXECUTED`.

Headless IWER controller pose is not a faithful Quest 12 m ray. Critical TAP/HOLD proof uses `stepJp4aTrigger`, the same runtime state machine the XR poll path uses, with the first visible real shelf slot as the captured hit. IWER ` __xrTest.trigger` was also pressed during FOCUS and did not mutate CLEAN.

Quest procedure: `jp4a-round5b3-hf2-quest-procedure.md`.
