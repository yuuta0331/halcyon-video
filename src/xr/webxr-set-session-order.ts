// Three.js r184 WebXRManager.setSession listener order, plus a deterministic
// initial-inputsourceschange race seam. This is not a JP-4A index fallback:
// it models Three.js assigning each added XRInputSource to the first empty
// controller slot, then dispatching `connected` on that actual object.

import {
  bindJp4aControllerObjectEvents,
  pickJp4aControllerByHand,
  readJp4aControllerHand,
  setJp4aControllerHandFromConnection,
  type Jp4aControllerHand,
  type Jp4aControllerObjectHandlers,
  type Jp4aHandTarget,
} from './jp4a-controller-association.ts';

export const THREE_R184_SET_SESSION_ORDER = [
  'assignSession',
  'installInputSourcesChange',
  'optionalMakeXRCompatible',
] as const;

export const APP_XR_CONTROLLER_BIND_ORDER = [
  'installControllers',
  'setSessionEnter',
] as const;

export type StartupRaceTraceEvent =
  | 'installControllers'
  | 'setSession-enter'
  | 'three-session-listeners-installed'
  | 'optional-compatibility-await'
  | 'initial-inputsourceschange'
  | `controller-connected:${Jp4aControllerHand}`;

export interface StartupRaceController extends Jp4aHandTarget {
  addEventListener(type: string, listener: (event: { type: string; target?: Jp4aHandTarget; data?: { handedness?: string } }) => void): void;
  removeEventListener(type: string, listener: (event: { type: string; target?: Jp4aHandTarget; data?: { handedness?: string } }) => void): void;
  dispatchEvent(event: { type: string; data?: { handedness?: string } }): void;
}

export function createStartupRaceController(): StartupRaceController {
  const listeners = new Map<string, Array<(event: { type: string; target?: Jp4aHandTarget; data?: { handedness?: string } }) => void>>();
  const controller: StartupRaceController = {
    userData: {},
    addEventListener(type, listener) {
      const list = listeners.get(type) ?? [];
      list.push(listener);
      listeners.set(type, list);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) ?? []).filter((fn) => fn !== listener));
    },
    dispatchEvent(event) {
      const payload = { ...event, target: controller };
      for (const fn of [...(listeners.get(event.type) ?? [])]) fn(payload);
    },
  };
  return controller;
}

export function defaultStartupRaceHandlers(): Jp4aControllerObjectHandlers {
  return {
    selectstart: () => {},
    connected: (event) => {
      setJp4aControllerHandFromConnection(event.target, event.data?.handedness, event.data);
    },
    disconnected: (event) => {
      if (event.target) {
        event.target.userData.jp4aHand = undefined;
        event.target.userData.jp4aInputSource = undefined;
      }
    },
  };
}

/** First empty Three.js controller slot, matching r184 onInputSourcesChange. */
export function assignAddedSourceToFirstEmptySlot<T>(
  slots: Array<{ source: unknown | null; object: T }>,
  source: unknown,
): T | null {
  const slot = slots.find((entry) => entry.source === null);
  if (!slot) return null;
  slot.source = source;
  return slot.object;
}

export async function simulateThreeR184SetSessionWithInitialSources(input: {
  controllerObjects: StartupRaceController[];
  initialSources: Array<{ handedness: Jp4aControllerHand }>;
  emitDuringCompat?: boolean;
}): Promise<{
  events: StartupRaceTraceEvent[];
  slotHands: Array<Jp4aControllerHand | undefined>;
  listenerInstalledBeforeCompatAwait: boolean;
  capturedInitialEvent: boolean;
}> {
  const events: StartupRaceTraceEvent[] = ['installControllers', 'setSession-enter'];
  const slots = input.controllerObjects.map((object) => ({ source: null as unknown | null, object }));
  const sessionListeners: Array<(event: { added: Array<{ handedness: Jp4aControllerHand }>; removed: unknown[] }) => void> = [];

  sessionListeners.push((event) => {
    events.push('initial-inputsourceschange');
    for (const source of event.added) {
      const object = assignAddedSourceToFirstEmptySlot(slots, source);
      if (!object) continue;
      object.dispatchEvent({ type: 'connected', data: source });
      events.push(`controller-connected:${source.handedness}`);
    }
  });
  events.push('three-session-listeners-installed');

  let releaseCompat: () => void = () => {};
  const compat = new Promise<void>((resolve) => {
    releaseCompat = resolve;
  });
  events.push('optional-compatibility-await');
  if (input.emitDuringCompat !== false) {
    for (const listener of sessionListeners) {
      listener({ added: input.initialSources, removed: [] });
    }
  }
  releaseCompat();
  await compat;

  const listenerInstalled = events.indexOf('three-session-listeners-installed');
  const compatAwait = events.indexOf('optional-compatibility-await');
  return {
    events,
    slotHands: input.controllerObjects.map((object) => readJp4aControllerHand(object)),
    listenerInstalledBeforeCompatAwait: listenerInstalled >= 0 && listenerInstalled < compatAwait,
    capturedInitialEvent: events.includes('initial-inputsourceschange'),
  };
}

export function installStartupRaceControllerListeners(
  controllerObjects: StartupRaceController[],
  handlers = defaultStartupRaceHandlers(),
): void {
  for (const controller of controllerObjects) {
    bindJp4aControllerObjectEvents(controller, handlers);
  }
}

export function awaitedIdentifiersBetween(src: string, startNeedle: string, endNeedle: string): string[] {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle);
  if (start < 0 || end < 0 || end <= start) return ['MISSING_BOUNDARIES'];
  const slice = src.slice(start + startNeedle.length, end)
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
  return [...slice.matchAll(/\bawait\s+([A-Za-z0-9_$.]+)/g)].map((match) => match[1]!);
}

export function runtimeAwaitsEnsureXrCompatibleBeforeSetSession(runtimeSrc: string): boolean {
  const awaits = awaitedIdentifiersBetween(
    runtimeSrc,
    'this.installControllers(xrMgr)',
    'await xrMgr.setSession(session)',
  );
  return awaits.some((id) => id === 'ensureXrCompatible' || id.endsWith('.ensureXrCompatible'));
}

export function pickFailsClosedWhenUnmapped(
  controllerObjects: ReadonlyArray<Jp4aHandTarget>,
  hand: Jp4aControllerHand,
): boolean {
  return pickJp4aControllerByHand(controllerObjects, hand) == null;
}
