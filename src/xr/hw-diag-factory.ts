// Browser/runtime factory. Imports production case geometry. Do not import
// from Node unit tests that only need mode metadata.

import { CASE_HEIGHT, CASE_WIDTH, createClonedCaseGeometry } from '../video-case.ts';
import { HardwarePosterDiagnostic } from './hardware-poster-diagnostic.ts';
import { HwDiagProductionPoster } from './hw-diag-production-path.ts';

export function createHardwarePosterDiagnostic(
  opts: { worldAnchor?: 'spawn' | 'origin' } = {},
): HardwarePosterDiagnostic {
  return new HardwarePosterDiagnostic({
    worldAnchor: opts.worldAnchor,
    deps: {
      createCaseGeometry: createClonedCaseGeometry,
      caseWidth: CASE_WIDTH,
      caseHeight: CASE_HEIGHT,
      production: new HwDiagProductionPoster(),
    },
  });
}
