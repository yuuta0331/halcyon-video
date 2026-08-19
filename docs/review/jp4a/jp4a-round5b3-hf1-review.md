# JP-4A Round 5B.3 HF1 — diagnostic harness correction

Phase: `ROUND5B3_HF1_DIAGNOSTIC_HARNESS_CORRECTION`

Final software state: `READY_FOR_SINGLE_QUEST_JP4A_ROUND5B3_DIAGNOSTIC`

Quest hardware on this new HEAD: **NOT_EXECUTED**. JP-4A final PASS, Quest PASS, black artifact fixed, performance fixed, and merge permission are not claimed.

Independent review findings closed in this HF:

1. RESET TEST now resets the live `LivePosterDiagnostic` runtime (DEPTH-ISOLATED matrix restore, lock clear, LIVE-NORMAL shader, viewer cache, truthful invariant), not only session localStorage.
2. Diagnostic lock is separated from production selection/FOCUS. Explicit Hold Trigger during APPROACH selects the locked production poster once.
3. Telemetry phases are an explicit test-state marker (`BASELINE` → `LOCKED_LIVE_DIAG` → `APPROACH` → `FOCUS_REQUESTED`/`FOCUS_TRANSITION` → `FOCUS_SETTLED`). FOCUS residency cannot steal Approach FPS before that explicit request. Empty phases report `NOT_RECORDED`.
4. JP-4A-only lock ray is 12 m. `WALK_INTERACT_RANGE` remains 14 ft.
5. Bank invariant `pass` requires `checkedSlots > 0`. Zero records are `NOT_EXERCISED`. IWER exercised 3692 real shelf slots (`PASS`).
6. Build identity exposes Source HEAD vs CI checkout/merge-ref SHA. `HALCYON_SOURCE_HEAD_SHA` is passed from the pull_request workflow; CI still checks out and tests the merge ref.

FOCUS stationary retry remains OPTION A: the FOCUS-local ~80 ms timer retains decoded pixels. Queue capacity notifications still assist DETAIL/FOCUS reconcile; they are not claimed as the primary FOCUS retry.

## Evidence boundary

The HF1 browser harness enters IWER, locks a real shelf slot, cycles nine LIVE modes, RESET on the same page, START again, enters a second IWER session, and checks copy targets plus normal-URL gating. It is explicitly `IWER_EMULATED`, `NOT_HARDWARE_VISUAL_PROOF`, `QUEST_HARDWARE=NOT_EXECUTED`.

Controller mapping (Quest):

| Input | JP-4A action |
|---|---|
| Trigger (unlocked) | Lock diagnostic target only |
| Short Trigger (locked) | UNKNOWN → BLACK → CLEAN |
| Thumbstick click | Next LIVE mode (LIVE ladder only) |
| Grip | Previous LIVE mode |
| Hold Trigger ~0.7 s | LIVE ladder → APPROACH, then APPROACH → BEGIN FOCUS |
| Menu A/X | Unchanged |
| B/Y | Unbound |

See `jp4a-round5b3-hf1-quest-procedure.md` for the hardware run. Do not treat this package as a Quest result.
