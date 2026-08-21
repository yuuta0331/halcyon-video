// JP-4A Three.js controller-object ↔ handedness association.
// Authoritative source: the actual controller object's `connected` event
// (`event.data.handedness`). Never derive this from session.inputSources[i]
// matching renderer.xr.getController(i) — those arrays are not the same table
// after disconnect/reconnect.

export type Jp4aControllerHand = 'left' | 'right';

export interface Jp4aHandTarget {
  userData: Record<string, unknown>;
}

export interface Jp4aControllerEventTarget extends Jp4aHandTarget {
  addEventListener(type: string, listener: Jp4aControllerListener): void;
  removeEventListener(type: string, listener: Jp4aControllerListener): void;
}

export type Jp4aControllerListener = (event: {
  target?: Jp4aHandTarget;
  data?: { handedness?: string };
}) => void;

export interface Jp4aControllerObjectHandlers {
  selectstart: Jp4aControllerListener;
  connected: Jp4aControllerListener;
  disconnected: Jp4aControllerListener;
}

export function isJp4aControllerHand(value: unknown): value is Jp4aControllerHand {
  return value === 'left' || value === 'right';
}

export function readJp4aControllerHand(controller: Jp4aHandTarget | null | undefined): Jp4aControllerHand | undefined {
  const hand = controller?.userData.jp4aHand;
  return isJp4aControllerHand(hand) ? hand : undefined;
}

/** Store the hand of the XRInputSource Three.js actually connected to this object. */
export function setJp4aControllerHandFromConnection(
  controller: Jp4aHandTarget | null | undefined,
  handedness: unknown,
  inputSource?: unknown,
): void {
  if (!controller || !isJp4aControllerHand(handedness)) return;
  controller.userData.jp4aHand = handedness;
  if (inputSource !== undefined) controller.userData.jp4aInputSource = inputSource;
}

export function clearJp4aControllerHand(controller: Jp4aHandTarget | null | undefined): void {
  if (!controller) return;
  controller.userData.jp4aHand = undefined;
  controller.userData.jp4aInputSource = undefined;
}

export function pickJp4aControllerByHand<T extends Jp4aHandTarget>(
  controllerObjects: ReadonlyArray<T>,
  hand: Jp4aControllerHand,
): T | null {
  return controllerObjects.find((controller) => readJp4aControllerHand(controller) === hand) ?? null;
}

export function jp4aControllerIndexForHand(
  controllerObjects: ReadonlyArray<Jp4aHandTarget>,
  hand: Jp4aControllerHand,
): number {
  return controllerObjects.findIndex((controller) => readJp4aControllerHand(controller) === hand);
}

/** Hit belonging to the actual Three.js object marked as `hand`, never the other slot. */
export function jp4aHitFromActualController<T>(
  controllerObjects: ReadonlyArray<Jp4aHandTarget>,
  hand: Jp4aControllerHand,
  hitsByController: ReadonlyArray<T | null>,
): T | null {
  const index = jp4aControllerIndexForHand(controllerObjects, hand);
  if (index < 0) return null;
  return hitsByController[index] ?? null;
}

export function bindJp4aControllerObjectEvents(
  controller: Jp4aControllerEventTarget,
  handlers: Jp4aControllerObjectHandlers,
): void {
  controller.addEventListener('selectstart', handlers.selectstart);
  controller.addEventListener('connected', handlers.connected);
  controller.addEventListener('disconnected', handlers.disconnected);
}

export function unbindJp4aControllerObjectEvents(
  controller: Jp4aControllerEventTarget,
  handlers: Jp4aControllerObjectHandlers,
): void {
  controller.removeEventListener('selectstart', handlers.selectstart);
  controller.removeEventListener('connected', handlers.connected);
  controller.removeEventListener('disconnected', handlers.disconnected);
  clearJp4aControllerHand(controller);
}
