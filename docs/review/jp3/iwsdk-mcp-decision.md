# IWSDK MCP decision (JP-3)

**Decision: STANDALONE_IWER_PLUS_CHROME_MCP**

Official IWSDK AI/MCP (`iwsdk mcp stdio`, `iwsdk adapter sync --tools cursor`, `World.create()`, `vite-plugin-iwer`, ECS debug tools, `window.FRAMEWORK_MCP_RUNTIME`) requires an IWSDK/ECS project lifecycle.

Halcyon production is a Three.js `StoreScene` + `renderer.xr` architecture. Using the IWSDK runtime MCP as more than an isolated sidecar would mean migrating production to ECS — explicitly out of JP-3 scope.

Standalone IWER 2.3.0 already exposes `XRDevice.remote` (programmatic headset/controller/session control). Combined with an isolated Chrome DevTools MCP (`halcyon-xr-browser`) and `window.__xrTest`, that is sufficient for emulator-first automation.

`@iwsdk/reference` and `@meta-quest/hzdb` were not added: they do not unblock the first-frame or boot-gate bugs, and Quest device management is not part of the normal test loop.
