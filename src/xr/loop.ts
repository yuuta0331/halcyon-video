// Authoritative frame-scheduler state machine.
//
// Desktop keeps the existing requestAnimationFrame + render-on-demand loop.
// XR hands the same StoreScene.animate tick to renderer.setAnimationLoop so
// the WebXR session rAF is the only driver. Two loops must never be armed
// together.

export type FrameSchedulerMode = 'stopped' | 'desktop-raf' | 'xr-animation-loop';

export interface FrameSchedulerState {
  mode: FrameSchedulerMode;
  desktopRafArmed: boolean;
  xrLoopArmed: boolean;
}

export type FrameSchedulerEvent =
  | 'start-desktop'
  | 'enter-xr'
  | 'exit-xr'
  | 'stop';

export function initialFrameScheduler(): FrameSchedulerState {
  return { mode: 'stopped', desktopRafArmed: false, xrLoopArmed: false };
}

export function reduceFrameScheduler(
  _state: FrameSchedulerState,
  event: FrameSchedulerEvent,
): FrameSchedulerState {
  switch (event) {
    case 'start-desktop':
      return { mode: 'desktop-raf', desktopRafArmed: true, xrLoopArmed: false };
    case 'enter-xr':
      return { mode: 'xr-animation-loop', desktopRafArmed: false, xrLoopArmed: true };
    case 'exit-xr':
      return { mode: 'desktop-raf', desktopRafArmed: true, xrLoopArmed: false };
    case 'stop':
      return { mode: 'stopped', desktopRafArmed: false, xrLoopArmed: false };
  }
}

export function competingLoops(state: FrameSchedulerState): boolean {
  return state.desktopRafArmed && state.xrLoopArmed;
}

export function shouldSelfScheduleRaf(state: FrameSchedulerState): boolean {
  return state.mode === 'desktop-raf' && state.desktopRafArmed && !state.xrLoopArmed;
}

export function shouldUseSetAnimationLoop(state: FrameSchedulerState): boolean {
  return state.mode === 'xr-animation-loop' && state.xrLoopArmed;
}
