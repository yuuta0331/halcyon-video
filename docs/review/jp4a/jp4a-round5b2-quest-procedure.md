# JP-4A Round 5B.2 — single-session Quest 3 procedure

Implementation status before this run: `QUEST_HARDWARE=NOT_EXECUTED`.
IWER evidence is `IWER_EMULATED` and is not hardware visual proof.

## Procedure — Enter VR once

1. Open `?xrPosterHwDiag=1&fps=1` and wait for `STORE_VISIBLE_READY`.
2. Enter VR once. Do not exit/re-enter between modes.
3. Confirm stereo in both eyes and confirm no whole-world disappearance.
4. Confirm the diagnostic poster center is at actual eye height, about 1.05 m
   ahead, and horizontally square to the initial gaze.
5. Confirm the large FPS value is immediately readable at upper-left and the
   mode card is upper-right with no overlap. Turn the head in three directions;
   both must stay viewer-relative.
6. In Mode A, verify the direct Basic/DoubleSide source is visible. Approach to
   about 0.7 m and record whether any black region appears.
7. Cycle exactly A → B → C → D → E → A with the thumbstick click. Use the same
   distance and record black-region, crop, cover/depth, and calibration-zone
   behavior for every mode.
8. Look away and back. Confirm the poster itself stayed fixed in the world.
9. At the same distance inspect a real shelf poster. Select it, approach it,
   wait through FOCUS transition, then remain still until settled.
10. Capture snapshots for `normal shelf`, `approaching poster`, `FOCUS
    transition`, and `FOCUS settled/static`. Record FPS, mean frame ms, 1% low,
    p95/p99, worst ms, target Hz, draw calls/triangles, and upload state. Use
    `window.__hwPosterDiag()`, `window.__xrPerfDiagnostics()`, and
    `window.__livePosterDiag()` through remote debugging; no title/URL should be
    copied into evidence.
11. While stationary under queue pressure, confirm deferred DETAIL/FOCUS work
    retries and settles without new locomotion.
12. Open the menu while facing three materially different directions and verify
    the front faces the viewer each time.
13. Reconfirm FPS/mode HUD readability and stereo before ending the one session.

## Interpretation ladder

| Result | Interpretation |
|---|---|
| A fails | Diagnostic baseline/basic render failure. Do not blame the compositor until placement, facing, stereo, and visibility invariants pass. |
| A clean, B fails | Production case geometry/depth path. |
| B clean, C fails | Production BASE array/shader/bank path. |
| C clean, D fails | DETAIL LUT / NEAR path. |
| D clean, E fails | FOCUS path. |
| A–E clean, live shelf fails | Live multibank/global index/loaded flags/real LUT/shelf instance/resource lifecycle. |

## Hardware result template

```text
HEAD:
Quest/Oculus Browser version:
Quest display target / supported Hz:

Stereo: PASS / FAIL
Unexpected whole-world disappearance: NONE / OBSERVED
Poster placement eye-level and forward: PASS / FAIL
Poster world-stable after head movement: PASS / FAIL
FPS HUD readable and viewer-relative: PASS / FAIL
Mode/FPS overlap: NONE / OBSERVED

A (direct Basic, DoubleSide): CLEAN / BLACK / INVISIBLE / OTHER
B (production case geometry + Basic): CLEAN / BLACK / OTHER
C (production BASE): CLEAN / BLACK / OTHER
D (BASE + NEAR): CLEAN / BLACK / OTHER
E (full + FOCUS): CLEAN / BLACK / OTHER
A after full cycle: CLEAN / FAIL

Live shelf at same distance: CLEAN / BLACK / OTHER
FOCUS quality improves: PASS / FAIL / INCONCLUSIVE
Stationary retry: PASS / FAIL / INCONCLUSIVE
Menu faces viewer in 3 directions: PASS / FAIL

normal shelf: FPS / mean / 1% low / p95 / p99 / worst
approaching: FPS / mean / 1% low / p95 / p99 / worst
FOCUS transition: FPS / mean / 1% low / p95 / p99 / worst
FOCUS settled: FPS / mean / 1% low / p95 / p99 / worst

Snapshot files:
Overall: PASS / FAIL / INCONCLUSIVE
Notes:
```
