// Pure XR input policy. Kept off Three.js so node tests can import it.

import {
  emptyXrButtonSnapshot,
  mergeXrButtons,
  readXrButtons,
  type XrButtonSnapshot,
} from './ui-input.ts';

export function ignoreHandTrackingSource(source: { hand?: unknown; targetRayMode?: string } | null | undefined): boolean {
  if (!source) return true;
  if (source.hand) return true;
  return false;
}

export function readXrGamepadStick(gamepad: { axes?: ArrayLike<number> } | null | undefined): { x: number; y: number } {
  const axes = gamepad?.axes;
  if (!axes || axes.length < 2) return { x: 0, y: 0 };
  // Most Quest controllers expose thumbstick as axes[2], axes[3]; some as 0,1.
  if (axes.length >= 4) return { x: axes[2] || 0, y: axes[3] || 0 };
  return { x: axes[0] || 0, y: axes[1] || 0 };
}

export interface XrInputSourceLike {
  handedness?: string;
  hand?: unknown;
  targetRayMode?: string;
  gamepad?: {
    buttons?: ArrayLike<{ pressed?: boolean }>;
    axes?: ArrayLike<number>;
  } | null;
}

function emptyLogicalSide(handedness: 'left' | 'right') {
  return {
    handedness,
    connected: false,
    select: false,
    squeeze: false,
    stickX: 0,
    stickY: 0,
    hasGrip: false,
  };
}

/** Logical LEFT/RIGHT buttons keyed by source.handedness. Does not mark Three.js objects. */
export function snapshotControllersFromInputSources(
  sources: Iterable<XrInputSourceLike>,
): {
  controllers: { left: ReturnType<typeof emptyLogicalSide>; right: ReturnType<typeof emptyLogicalSide> };
  uiButtons: XrButtonSnapshot;
} {
  const snap = {
    left: emptyLogicalSide('left'),
    right: emptyLogicalSide('right'),
  };
  let uiButtons = emptyXrButtonSnapshot();
  for (const source of sources) {
    if (ignoreHandTrackingSource(source)) continue;
    const stick = readXrGamepadStick(source.gamepad);
    const side = source.handedness === 'left' ? snap.left
      : source.handedness === 'right' ? snap.right
      : null;
    if (!side) continue;
    side.connected = true;
    side.hasGrip = source.targetRayMode === 'tracked-pointer';
    side.stickX = stick.x;
    side.stickY = stick.y;
    const mapped = readXrButtons(source.gamepad);
    side.select = mapped.trigger;
    side.squeeze = mapped.squeeze;
    uiButtons = mergeXrButtons(uiButtons, mapped);
  }
  return { controllers: snap, uiButtons };
}
