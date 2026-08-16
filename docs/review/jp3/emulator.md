# JP-3 emulator + MCP workflow

Development loop (do not put on a Quest until this is green):

1. `npm test`
2. Desktop browser (`?demo=1&nogate=1`)
3. IWER (`?demo=1&nogate=1&xrEmu=1`) via `npm run test:xr-emu`
4. Quest hardware only at final acceptance

## IWER (development only)

`iwer` and `@iwer/devui` are **devDependencies**. They are dynamically imported behind `import.meta.env.DEV` and `?xrEmu=1`. Native `immersive-vr` (Quest Browser) is never replaced. Desktop Chrome often exposes `navigator.xr` without immersive-vr; in that case IWER uses `forceInstall` so the emulator is actually usable.

| URL | Meaning |
|---|---|
| `?xrEmu=1` | Install IWER Meta Quest 3 runtime |
| `?xrEmuUi=1` | Also load `@iwer/devui` overlay |
| `?xrMinimal=1` | Projection XR only (no compositor UI / layers / media) |
| `?xrLayers=0` | Do not request the `layers` optional feature |

`window.__xrTest` exists only in development. `window.__xrDiagnostics()` and `window.__bootDiagnostics()` have no secrets.

IWER 2.3.0 Quest 3 `supportedFeatures` does **not** include `layers`. Compositor UI is mesh-fallback in emulation; do not treat that as a Quest Layers result.

## Isolated browser MCP

Workspace MCP server name: **`halcyon-xr-browser`**

Config: `.cursor/mcp.json` → `node tools/halcyon-xr-browser-mcp.mjs`

That launcher runs `npx chrome-devtools-mcp@latest --isolated` with a repo-local `--user-data-dir` under `.cache/halcyon-xr-chrome`. It does **not** attach to the owner's everyday Chrome profile.

If Cursor does not pick up a newly added workspace MCP server, reload the window once:

`Cursor: Developer: Reload Window`

## Repeatable scenarios

```
npm run test:xr-emu
```

- CORE: `?demo=1&nogate=1&xrEmu=1&xrMinimal=1`
- NO-LAYERS: `?demo=1&nogate=1&xrEmu=1&xrLayers=0`
- FULL: `?demo=1&nogate=1&xrEmu=1`
- BOOT: `?demo=1&nogate=1`

JP-3 correction harness result (isolated Puppeteer, not the owner's Chrome profile):

| Scenario | Result |
|---|---|
| CORE XR | PASS — IWER_EMULATED, presenting, first visible frame, exit, second enter |
| NO-LAYERS | PASS — locomotion moved the rig, snap-turn changed yaw, exit/re-entry |
| FULL XR | PASS — session + Japanese UI path; compositor is mesh-fallback (IWER has no `layers`) |
| BOOT | PASS — `timeToInteractive` set at critical-ready, not all-cover settlement |
