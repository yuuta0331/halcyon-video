# JP-4A — XR functional parity & interaction UI foundation

Branch: `feat/jp4-xr-functional-parity`

Evidence class for this folder is **IWER_EMULATED** plus UNIT tests.
**QUEST_HARDWARE** for the latest HF3-HF3 slice is
`ATTEMPTED_BUT_DIAGNOSTIC_NOT_STARTED` (user-supplied console-entry block;
visual diagnostic was not executed). Do not treat emulator captures as
Quest 3 results. Do not treat that blocked attempt as a visual FAIL.

JP-3 architecture acceptance remains PASS on `195f695` /
merge `351947a`. This slice does not reopen that verdict.

| File | What it shows |
|---|---|
| `README.md` | This index |
| `investigation.md` | Content-class inventory and root cause |
| `quest-smoke-checklist.md` | Prepared Quest 3 smoke (do not run until independent review) |
| `iwer-jp4a-ui.json` | Isolated IWER menu/settings/parity harness (written by `test:xr-emu`) |
| `jp4a-round4-review.md` | Round 4 independent-review package (REQUEST_CHANGES; preload closed) |
| `jp4a-round5-quest-fail.md` | Real Quest 3 FAILED on `a20389e` (historical; not rewritten) |
| `jp4a-round5a-review.md` | Round 5A implementation package (not Quest-ready) |
| `jp4a-round5a-iwer.json` | IWER_EMULATED Round 5A stereo/detail/close-range (not Quest) |
| `jp4a-round5a1-review.md` | Round 5A.1 DETAIL activation correction (not Quest-ready) |
| `jp4a-round5a1-iwer.json` | IWER_EMULATED Round 5A.1 DETAIL ready proof (not Quest) |
| `jp4a-round5a1-detail-activation.json` | DESKTOP_BROWSER production shader/readback DETAIL proof |
| `jp4a-round5a2-review.md` | Round 5A.2 DETAIL load-failure settlement (not Quest-ready) |
| `jp4a-round5a2-iwer.json` | IWER_EMULATED Round 5A.2 stereo/detail regression (not Quest) |
| `jp4a-round5a2-detail-failure.json` | DESKTOP_BROWSER DETAIL failure/retry/pool/stale proof |
| `jp4a-round5b-hardware-fail-history.md` | Real Quest 3 FAILED on `216483fac` (canonical; not rewritten) |
| `jp4a-round5b-review.md` | Round 5B implementation package (not Quest-ready; not hardware proof) |
| `jp4a-round5b-inline-profile.json` | DESKTOP_BROWSER Quest-UA inline vs immersive vs desktop policy |
| `jp4a-round5b-focus-quality.json` | DESKTOP_BROWSER BASE/NEAR/FOCUS ladder (not human readability) |
| `jp4a-round5b-upload-policy.json` | DESKTOP_BROWSER motion-gated upload policy (not Quest GPU time) |
| `jp4a-round5b-hardware-diagnostic.json` | DESKTOP_BROWSER A/B/C/D/E fixture render (does not diagnose Quest black) |
| `jp4a-round5b-iwer.json` | IWER_EMULATED Round 5B pose/menu/diag/stereo logic (not hardware visual proof) |
| `jp4a-round5b2-hardware-history.md` | Quest 3 Round 5B user observation: inconclusive, fixture correction required |
| `jp4a-round5b2-investigation.md` | Coordinate audit and ranked ~20 FPS investigation |
| `jp4a-round5b2-quest-procedure.md` | One-entry Quest 3 procedure, interpretation ladder, and result template |
| `jp4a-round5b2-review.md` | Round 5B.2 implementation/status package (new HEAD not run on Quest) |
| `jp4a-round5b2-iwer.json` | IWER_EMULATED placement/world-stability/HUD/A–E logic (not hardware proof) |
| `jp4a-round5b2-software-validation.json` | Unit/build/browser/IWER result summary; Quest not executed |
| `jp4a-round5b3-review.md` | Round 5B.3 software handoff; new-head Quest not executed |
| `jp4a-round5b3-investigation.md` | Live shelf, mip/bank/geometry/material/upload investigation and hypotheses |
| `jp4a-round5b3-performance-analysis.md` | Confirmed CPU/upload causes and Quest-only performance unknowns |
| `jp4a-round5b3-root-cause-matrix.md` | Falsifiable interpretation table for the next Quest result |
| `jp4a-round5b3-quest-procedure.md` | Short `/xr-test/jp4a` single-run hardware procedure |
| `jp4a-round5b3-hardware-result-template.md` | Privacy-safe result handoff template |
| `jp4a-round5b3-software-validation.json` | Unit/build/browser/IWER summary; Quest not executed |
| `jp4a-round5b3-iwer.json` | IWER-emulated console/session/persistence evidence; not hardware proof |
| `jp4a-round5b3-console.png` | Quick Test Console browser capture |
| `jp4a-round5b3-hf1-review.md` | Round 5B.3 HF1 diagnostic harness correction (not Quest-ready) |
| `jp4a-round5b3-hf1-quest-procedure.md` | HF1 controller/test flow for the next Quest 3 run |
| `jp4a-round5b3-hf1-software-validation.json` | HF1 unit/build/browser/IWER summary; Quest not executed |
| `jp4a-round5b3-hf1-iwer.json` | Same-page RESET/re-run and truthful live-shelf invariant; not hardware proof |
| `jp4a-round5b3-hf1-console.png` | HF1 Quick Test Console capture |
| `jp4a-round5b3-hf2-review.md` | Round 5B.3 HF2 Trigger TAP/HOLD correction (not Quest-ready) |
| `jp4a-round5b3-hf2-quest-procedure.md` | HF2 Trigger semantics for the next Quest 3 run |
| `jp4a-round5b3-hf2-software-validation.json` | HF2 unit/build/browser/IWER summary; Quest not executed |
| `jp4a-round5b3-hf2-iwer.json` | TAP/HOLD controller seam plus truthful live-shelf invariant; not hardware proof |
| `jp4a-round5b3-hf2-console.png` | HF2 Quick Test Console capture |
| `jp4a-round5b3-hf3-review.md` | Round 5B.3 HF3 per-hand Trigger source fidelity (not Quest-ready) |
| `jp4a-round5b3-hf3-quest-procedure.md` | HF3 same-controller ray + Trigger rule for the next Quest 3 run |
| `jp4a-round5b3-hf3-software-validation.json` | HF3 unit/build/browser/IWER summary; Quest not executed |
| `jp4a-round5b3-hf3-iwer.json` | Dual-source TAP/HOLD seam plus truthful live-shelf invariant; not hardware proof |
| `jp4a-round5b3-hf3-console.png` | HF3 Quick Test Console capture |
| `jp4a-round5b3-hf3-hf1-review.md` | Round 5B.3 HF3-HF1 controller-slot association (not Quest-ready) |
| `jp4a-round5b3-hf3-hf1-software-validation.json` | HF3-HF1 unit/build/browser/IWER summary; Quest not executed |
| `jp4a-round5b3-hf3-hf1-iwer.json` | Connected-lifecycle vs reordered `[LEFT,RIGHT]` active list; not hardware proof |
| `jp4a-round5b3-hf3-hf1-console.png` | HF3-HF1 Quick Test Console capture |
| `jp4a-round5b3-hf3-hf2-review.md` | Round 5B.3 HF3-HF2 initial controller connection race (not Quest-ready) |
| `jp4a-round5b3-hf3-hf2-software-validation.json` | HF3-HF2 unit/build/browser/IWER summary; Quest not executed |
| `jp4a-round5b3-hf3-hf2-iwer.json` | Fake setSession captures initial `inputsourceschange` during compat await; not hardware proof |
| `jp4a-round5b3-hf3-hf2-console.png` | HF3-HF2 Quick Test Console capture |
| `jp4a-round5b3-hf3-hf3-review.md` | Round 5B.3 HF3-HF3 JP-4A console ENTER VR action bridge (not Quest visual proof) |
| `jp4a-round5b3-hf3-hf3-quest-procedure.md` | HF3-HF3 launch/UI retry: wait until ENTER VR reports READY |
| `jp4a-round5b3-hf3-hf3-software-validation.json` | HF3-HF3 unit/build/browser/IWER summary; Quest visual diagnostic not executed |
| `jp4a-round5b3-hf3-hf3-iwer.json` | Actual DOM ENTER VR / COPY / RESET / second session; not hardware proof |
| `jp4a-round5b3-hf3-hf3-console.png` | HF3-HF3 Quick Test Console capture |
| `jp4a.5-catalog-delta-sync.md` | Deferred persistent catalog / delta sync (not in this PR) |
| `jp4a-round4-preload-stability.json` | DESKTOP_BROWSER STORE_VISIBLE_BASE drain |
| `jp4a-round4-production-multibank.json` | DESKTOP_BROWSER production shelf 3+ bank render |
| `jp4a-round4.1-production-bank-switch.json` | DESKTOP_BROWSER onBeforeRender bank-switch proof |
| `iwer-jp4a-round4.json` | IWER_EMULATED Round 4 XR flow (not Quest) |
| `iwer-jp4a-round4.1.json` | IWER_EMULATED Round 4.1 regression re-run (not Quest) |
| `jp4a-normal-stable-store.json` | Non-XR / desktop walk residency after reveal |

Related: visual quality / aliasing is **JP-5** (`docs/review/jp5/`).
Do not start JP-4B until JP-4A is accepted.
