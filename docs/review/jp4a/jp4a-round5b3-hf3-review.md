# JP-4A Round 5B.3 HF3 — controller source fidelity

Phase: `ROUND5B3_HF3_CONTROLLER_SOURCE_FIDELITY_CORRECTION`

Final software state: `READY_FOR_SINGLE_QUEST_JP4A_ROUND5B3_DIAGNOSTIC`

Quest hardware on this new HEAD: **NOT_EXECUTED**. JP-4A final PASS, Quest PASS, black artifact fixed, performance fixed, GPU root cause proven, and merge permission are not claimed.

## Provenance (OPTION A)

| Role | SHA |
|---|---|
| Independent-reviewed HF2 evidence HEAD | `3bee8609fce74f678646244ce4ed4bfdf8f2fd7c` |
| HF2 implementation-under-test | `8dba63243a130860a6db76b433346763536db200` |
| Implementation-under-test (IWER executed this source) | `d178a0f708c57f4f31f702619f8d3505502fb21d` |
| Evidence/documentation commit | the commit that added this file (newer than the tested source) |

This evidence file does **not** prove its own commit SHA.

## Source semantics

| Press | Ray used |
|---|---|
| RIGHT Trigger only | RIGHT controller ray only |
| LEFT Trigger only | LEFT controller ray only |
| Opposite ray | never a fallback |
| Both Triggers rising in the same poll | **AMBIGUOUS** — no lock, no TAP, no HOLD until both are released |
| Second Trigger during an active press | cannot steal source, target, or lifecycle |
| Active controller disconnect | cancel; no TAP/HOLD/FOCUS/select |

HF2 DOWN → HOLD → UP timing is unchanged. `stepJp4aTrigger()` is preserved. Runtime chooses the hand, raycasts that controller only, then feeds the captured hit into the existing state machine.

## HF1/HF2 closures preserved

RESET TEST, lock≠FOCUS, explicit phases, 12 m diagnostic lock, production 14 ft, truthful zero-slot invariant, TAP/HOLD verdict rules, FOCUS select-once, production FOCUS 5B.3 upload path.

## IWER boundary

Classification: `IWER_EMULATED`. `NOT_HARDWARE_VISUAL_PROOF: true`. `QUEST_HARDWARE: NOT_EXECUTED`.

Headless IWER pose is not faithful Quest dual-controller geometry. Source fidelity uses the same `chooseJp4aTriggerSource` + `stepJp4aHandedTrigger` routing as XR runtime, with two distinct real shelf slots as left/right logical hits.

Quest procedure: `jp4a-round5b3-hf3-quest-procedure.md`.
