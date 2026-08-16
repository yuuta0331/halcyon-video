// Observable XR presenting-frame cycle. Used by unit tests to prove BOTH
// setSession / first-callback orderings without a GPU.

import { chooseXrRenderPath } from './render-invariant.ts';
import { shouldInitOptionalCompositor } from './compositor-policy.ts';

export type SetSessionOrder = 'callback-before-resolve' | 'resolve-before-callback';

export interface PresentingCycleLog {
  order: SetSessionOrder;
  events: string[];
  composerDuringPresenting: boolean;
  firstRendererRenderCompleted: boolean;
  compositorAfterFirstRender: boolean;
}

/**
 * Drive a fake renderer.xr.setSession + animation callback in a given order
 * and record the exact call sequence Halcyon must follow.
 */
export async function simulateSetSessionOrdering(
  order: SetSessionOrder,
): Promise<PresentingCycleLog> {
  const events: string[] = [];
  let presenting = false;
  let setSessionResolved = false;
  let worldRenderCompleted = false;

  const runXrCallback = (): void => {
    events.push('xr-animation-callback');
    const path = chooseXrRenderPath({ rendererPresenting: presenting, hasComposer: true });
    events.push(`path:${path}`);
    if (path === 'direct') {
      events.push('beforeDirectRender');
      events.push('renderer.render');
      events.push('afterDirectRender');
      worldRenderCompleted = true;
    } else {
      events.push('composer.render');
    }
    maybeCompositor();
  };

  const maybeCompositor = (): void => {
    if (shouldInitOptionalCompositor({
      worldRenderCompleted,
      setSessionResolved,
      minimal: false,
      layersRequested: true,
    })) {
      if (!events.includes('optional-compositor')) events.push('optional-compositor');
    }
  };

  await new Promise<void>((resolve) => {
    if (order === 'callback-before-resolve') {
      presenting = true;
      runXrCallback();
      queueMicrotask(() => {
        setSessionResolved = true;
        events.push('setSession-resolved');
        maybeCompositor();
        resolve();
      });
    } else {
      queueMicrotask(() => {
        setSessionResolved = true;
        events.push('setSession-resolved');
        maybeCompositor();
        presenting = true;
        runXrCallback();
        resolve();
      });
    }
  });

  const renderAt = events.indexOf('renderer.render');
  const afterAt = events.indexOf('afterDirectRender');
  const compAt = events.indexOf('optional-compositor');
  return {
    order,
    events,
    composerDuringPresenting: events.includes('composer.render'),
    firstRendererRenderCompleted: renderAt >= 0 && afterAt === renderAt + 1,
    compositorAfterFirstRender: compAt > afterAt && afterAt >= 0,
  };
}
