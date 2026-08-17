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
| `jp4a.5-catalog-delta-sync.md` | Deferred persistent catalog / delta sync (not in this PR) |
| `jp4a-round4-preload-stability.json` | DESKTOP_BROWSER STORE_VISIBLE_BASE drain |
| `jp4a-round4-production-multibank.json` | DESKTOP_BROWSER production shelf 3+ bank render |
| `jp4a-round4.1-production-bank-switch.json` | DESKTOP_BROWSER onBeforeRender bank-switch proof |
| `iwer-jp4a-round4.json` | IWER_EMULATED Round 4 XR flow (not Quest) |
| `iwer-jp4a-round4.1.json` | IWER_EMULATED Round 4.1 regression re-run (not Quest) |
| `jp4a-normal-stable-store.json` | Non-XR / desktop walk residency after reveal |

Related: visual quality / aliasing is **JP-5** (`docs/review/jp5/`).
Do not start JP-4B until JP-4A is accepted.
