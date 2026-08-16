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
| `jp4a-round4-review.md` | Round 4 independent-review package (not Quest-ready) |
| `jp4a-round4-preload-stability.json` | DESKTOP_BROWSER STORE_VISIBLE_BASE drain |
| `jp4a-round4-production-multibank.json` | DESKTOP_BROWSER production shelf 3+ bank render |
| `iwer-jp4a-round4.json` | IWER_EMULATED Round 4 XR flow (not Quest) |
| `jp4a-normal-stable-store.json` | Non-XR / desktop walk residency after reveal |

Related: visual quality / aliasing is **JP-5** (`docs/review/jp5/`).
Do not start JP-4B until JP-4A is accepted.
