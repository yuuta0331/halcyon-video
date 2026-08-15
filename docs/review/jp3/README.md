# JP-3 review evidence

Desktop and capability captures live here. Headset-in-HMD stills require a
Quest 3 + Quest Browser session on a secure origin.

Do not put Jellyfin/Plex URLs, usernames, tokens, or library titles in this folder.

| File | What it shows |
|---|---|
| `README.md` | This index |
| `hardware.md` | Quest smoke log (**NOT_EXECUTED** — no headset attached) |
| `desktop-capability.json` | Chrome 151 probe: `immersive-vr` false, Enter VR hidden, `XRWebGLBinding` present, `XRMediaBinding` absent |
| `01-desktop-default.png` | Demo store after textures loaded (desktop / no XR) |
| `02-enter-vr-capability.png` | System Control menu on unsupported desktop: **Enter VR is not listed** |
| `03-controls-help-xr.png` | Controls & Help → Quest / WebXR (English chrome) |
| `07-japanese-xr-panel.png` | 1024×512 high-acuity panel canvas with Japanese copy + BBCjk/Noto CJK (not in-headset) |

Missing on purpose until a Quest is attached:

- in-headset store / controller ray
- compositor-layer vs mesh-fallback as seen in the HMD
- 72 Hz / `maxRenderLayers` from Quest Browser

Hardware claims without retained captures are marked NOT_EXECUTED.
