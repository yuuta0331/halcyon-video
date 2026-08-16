# JP-3 review evidence

Desktop, emulator, and capability captures live here. Headset-in-HMD stills
require a later Quest 3 acceptance pass on the **corrected** HEAD.

Do not put Jellyfin/Plex URLs, usernames, tokens, or library titles in this folder.

| File | What it shows |
|---|---|
| `README.md` | This index |
| `hardware.md` | Quest smoke log (**FAILED** at `73abd4c` and `ac94d1d`; Round 3 `b480993`, Round 4 `00b3e08`, and Round 5 HEAD pending) |
| `history/round3-b480993-xr-resource.json` | Historical Round 3 resource evidence (includes impossible 462 residents / 128 slots) |
| `history/round4-00b3e08-xr-resource.json` | Historical Round 4 static-window evidence (`resident=128`, `evictionCount=0`) |
| `xr-safe-entrance.png` / `xr-safe-back-section.png` | IWER XR_SAFE store at two distant positions after dynamic walk |
| `emulator.md` | IWER + isolated Chrome DevTools MCP workflow |
| `iwsdk-mcp-decision.md` | Why JP-3 uses standalone IWER + Chrome MCP |
| `desktop-capability.json` | Chrome 151 probe: `immersive-vr` false, Enter VR hidden, `XRWebGLBinding` present, `XRMediaBinding` absent |
| `01-desktop-default.png` | Demo store after textures loaded (desktop / no XR) |
| `02-enter-vr-capability.png` | System Control menu on unsupported desktop: **Enter VR is not listed** |
| `03-controls-help-xr.png` | Controls & Help → Quest / WebXR (English chrome) |
| `07-japanese-xr-panel.png` | 1024×512 high-acuity panel canvas with Japanese copy + BBCjk/Noto CJK (not in-headset) |
| `iwer-*.png` / `*.json` | Emulator harness evidence (IWER_EMULATED, not hardware) |

Evidence classes:

- UNIT: resource-profile + XR policy tests in this round
- DESKTOP_BROWSER: desktop full-quality path must remain unchanged
- IWER_EMULATED: CORE / NO-LAYERS / FULL plus `test:xr-resource` BARE / XR_SAFE
- QUEST_HARDWARE = FAILED — historical at `73abd4c` and again at `ac94d1d` (waiting environment, no world frame). Round 3 HEAD `b480993`, Round 4 HEAD `00b3e08`, and the current Round 5 HEAD remain NOT_EXECUTED / PENDING. Do not treat emulator evidence as hardware. Current `xr-resource.json` is Round 5 dynamic-working-set evidence.
