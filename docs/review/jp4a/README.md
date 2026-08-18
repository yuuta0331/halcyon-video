# JP-4A — XR functional parity & interaction UI foundation

Branch: `feat/jp4-xr-functional-parity`

Evidence class for this folder is **IWER_EMULATED** plus UNIT tests.
**QUEST_HARDWARE = NOT_EXECUTED / PENDING.** Do not treat emulator
captures as Quest 3 results.

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
| `jp4a.5-catalog-delta-sync.md` | Deferred persistent catalog / delta sync (not in this PR) |
| `jp4a-round4-preload-stability.json` | DESKTOP_BROWSER STORE_VISIBLE_BASE drain |
| `jp4a-round4-production-multibank.json` | DESKTOP_BROWSER production shelf 3+ bank render |
| `jp4a-round4.1-production-bank-switch.json` | DESKTOP_BROWSER onBeforeRender bank-switch proof |
| `iwer-jp4a-round4.json` | IWER_EMULATED Round 4 XR flow (not Quest) |
| `iwer-jp4a-round4.1.json` | IWER_EMULATED Round 4.1 regression re-run (not Quest) |
| `jp4a-normal-stable-store.json` | Non-XR / desktop walk residency after reveal |

Related: visual quality / aliasing is **JP-5** (`docs/review/jp5/`).
Do not start JP-4B until JP-4A is accepted.
