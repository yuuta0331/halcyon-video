# JP-4A architecture

## XR menu

Head-locked canvas panel (`src/xr/ui-shell.ts`) parented to the existing
`XrPlayerRig` origin. No DOM Overlay. The desktop HTML settings drawer
is unchanged.

Modes (`src/xr/ui-mode.ts`): `WORLD | MENU | SETTINGS | INSPECT`.
INSPECT is reserved for JP-4B and is unused.

## Settings

One persistence path: existing `localStorage` keys (`bb_locale`,
`bb_outside`, `bb_fps_meter`, …). `src/xr/settings-session.ts` drafts
against that store. There is no second settings database.

XR-exposed **controls**: Language, Environment, FPS meter.

XR **status only** (not presented as live XR graphics knobs):
desktop `bb_quality`, AO, render mode, FPS cap. While the resource
profile is `XR_SAFE`, the panel says so.

Apply writes the store and runs live hooks (`setLocale`,
`setOutsideMode`, `enableFpsMeter`). Cancel reloads the draft from the
store. Desktop Settings behavior is unchanged.

## Input

Named XR-standard buttons (`src/xr/ui-input.ts`): trigger 0, squeeze 1,
primary (A/X) 4. Secondary (B/Y) is never bound.

MENU / SETTINGS own input: locomotion and snap sticks are zeroed, world
slot select is ignored, the controller ray targets the panel. Closing
returns `WORLD`.
