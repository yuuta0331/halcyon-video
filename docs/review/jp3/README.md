# JP-3 review evidence

Desktop, emulator, and capability captures live here. Headset-in-HMD stills
require a later Quest 3 acceptance pass on the **corrected** HEAD.

Do not put Jellyfin/Plex URLs, usernames, tokens, or library titles in this folder.

| File | What it shows |
|---|---|
| `README.md` | This index |
| `hardware.md` | Quest smoke log (**FAILED** — waiting environment, no world frame) |
| `emulator.md` | IWER + isolated Chrome DevTools MCP workflow |
| `iwsdk-mcp-decision.md` | Why JP-3 uses standalone IWER + Chrome MCP |
| `desktop-capability.json` | Chrome 151 probe: `immersive-vr` false, Enter VR hidden, `XRWebGLBinding` present, `XRMediaBinding` absent |
| `01-desktop-default.png` | Demo store after textures loaded (desktop / no XR) |
| `02-enter-vr-capability.png` | System Control menu on unsupported desktop: **Enter VR is not listed** |
| `03-controls-help-xr.png` | Controls & Help → Quest / WebXR (English chrome) |
| `07-japanese-xr-panel.png` | 1024×512 high-acuity panel canvas with Japanese copy + BBCjk/Noto CJK (not in-headset) |
| `iwer-*.png` / `*.json` | Emulator harness evidence (IWER_EMULATED, not hardware) |

Evidence classes:

- UNIT: PASS (347 tests)
- DESKTOP_BROWSER: PASS (progressive boot + constructor sub-stages + full-texture wait)
- IWER_EMULATED: PASS after correction round 2 (`npm run test:xr-emu` CORE / NO-LAYERS / FULL / BOOT; unexpectedSeriousErrors = 0)
- QUEST_HARDWARE = FAILED — historical at `73abd4c` (waiting environment, no world frame). Corrected-head Quest acceptance still pending. Do not treat emulator evidence as hardware.
