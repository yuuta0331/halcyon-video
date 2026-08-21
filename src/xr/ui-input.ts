// Named XR gamepad mapping. Do not scatter numeric indices in runtime.ts.
// XR-standard layout (Quest Touch / IWER): 0 trigger, 1 squeeze, 2 touchpad,
// 3 thumbstick click, 4 primary (A/X), 5 secondary (B/Y).
// Secondary is system-adjacent on Quest — never bind it.

import type { XrUiMode } from './ui-mode.ts';
import { locomotionAllowed, uiOwnsInput, worldSelectAllowed } from './ui-mode.ts';

export const XR_STANDARD_BUTTON = {
  trigger: 0,
  squeeze: 1,
  touchpad: 2,
  thumbstick: 3,
  primary: 4,
  secondary: 5,
} as const;

export type XrMappedButton = keyof typeof XR_STANDARD_BUTTON;

export interface XrButtonSnapshot {
  trigger: boolean;
  squeeze: boolean;
  primary: boolean;
  thumbstick: boolean;
}

export function emptyXrButtonSnapshot(): XrButtonSnapshot {
  return { trigger: false, squeeze: false, primary: false, thumbstick: false };
}

export function readXrButtonPressed(
  gamepad: { buttons?: ArrayLike<{ pressed?: boolean }> } | null | undefined,
  button: XrMappedButton,
): boolean {
  const idx = XR_STANDARD_BUTTON[button];
  return !!gamepad?.buttons?.[idx]?.pressed;
}

export function readXrButtons(
  gamepad: { buttons?: ArrayLike<{ pressed?: boolean }> } | null | undefined,
): XrButtonSnapshot {
  return {
    trigger: readXrButtonPressed(gamepad, 'trigger'),
    squeeze: readXrButtonPressed(gamepad, 'squeeze'),
    primary: readXrButtonPressed(gamepad, 'primary'),
    thumbstick: readXrButtonPressed(gamepad, 'thumbstick'),
  };
}

export function mergeXrButtons(left: XrButtonSnapshot, right: XrButtonSnapshot): XrButtonSnapshot {
  return {
    trigger: left.trigger || right.trigger,
    squeeze: left.squeeze || right.squeeze,
    primary: left.primary || right.primary,
    thumbstick: left.thumbstick || right.thumbstick,
  };
}

export interface XrUiActions {
  toggleMenu: boolean;
  activate: boolean;
  cancel: boolean;
  nav: -1 | 0 | 1;
  value: -1 | 0 | 1;
  suppressLocomotion: boolean;
  suppressWorldSelect: boolean;
}

const STICK_NAV = 0.55;

export function xrUiActions(input: {
  mode: XrUiMode;
  buttons: XrButtonSnapshot;
  prevButtons: XrButtonSnapshot;
  stickX: number;
  stickY: number;
  prevStickY: number;
  prevStickX: number;
}): XrUiActions {
  const rising = (now: boolean, prev: boolean) => now && !prev;
  const stickEdge = (now: number, prev: number) => {
    if (Math.abs(now) < STICK_NAV) return 0 as const;
    if (Math.abs(prev) >= STICK_NAV && Math.sign(now) === Math.sign(prev)) return 0 as const;
    return now > 0 ? 1 as const : -1 as const;
  };
  const ui = uiOwnsInput(input.mode);
  const triggerRise = rising(input.buttons.trigger, input.prevButtons.trigger);
  const primaryRise = rising(input.buttons.primary, input.prevButtons.primary);
  return {
    toggleMenu: !ui && primaryRise,
    activate: ui && (triggerRise || primaryRise),
    cancel: ui && rising(input.buttons.squeeze, input.prevButtons.squeeze),
    // WebXR: stickY < 0 is physical UP → previous row; stickY > 0 is DOWN.
    nav: ui ? stickEdge(input.stickY, input.prevStickY) : 0,
    value: ui && input.mode === 'SETTINGS' ? stickEdge(input.stickX, input.prevStickX) : 0,
    suppressLocomotion: !locomotionAllowed(input.mode),
    suppressWorldSelect: !worldSelectAllowed(input.mode),
  };
}

export function worldSelectShouldFire(mode: XrUiMode, triggerRising: boolean): boolean {
  return worldSelectAllowed(mode) && triggerRising;
}
