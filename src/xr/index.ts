export {
  STORE_UNITS_PER_METER,
} from '../platform';
export {
  immersiveVrRequestOptions,
  diagnosticXrRequestOptions,
  bareXrRequestOptions,
  halcyonInitialXrRequestOptions,
  layersIsOptionalFeature,
  requestsSessionFeature,
  requestsLayersFeature,
  requestsFixedFoveationFeature,
  pickReferenceSpaceType,
  selectReferenceSpaceTypeFromFeatures,
  pickXrTargetHz,
  probeImmersiveVrSupported,
  sessionCanStartWithoutLayers,
  tauriAllowsWebXr,
  XR_FIXED_FOVEATION_FEATURE,
  XR_OPTIONAL_FEATURES,
  XR_REQUIRED_FEATURES,
  XR_TARGET_HZ,
} from './session-policy';
export { trySetRuntimeFoveation } from './runtime-foveation';
export {
  competingLoops,
  initialFrameScheduler,
  reduceFrameScheduler,
  shouldSelfScheduleRaf,
  shouldUseSetAnimationLoop,
} from './loop';
export { restoreDesktopQuality, xrQualityPolicy } from './quality';
export { readXrFlags, xrEmuRequested } from './flags';
export { xrBareRequested } from './bare';
export { xrRawRequested } from './raw';
export { xrThreeBaselineRequested } from './three-baseline';
export { shouldPauseStoreRenderingOnOcclusion } from './occlusion-policy';
export { shouldInstallIwer } from './emu-policy';
export { classifyXrEnvironment } from './classification';
export { desktopComposerForbidden, chooseXrRenderPath, xrOwnsFrames } from './render-invariant';
export {
  bindSessionWithPresentingRace,
  blankStartupTrace,
  canExitPhase,
  markStartupStage,
  sessionReadyForOptionalLayers,
  startupAborted,
} from './session-lifecycle';
export { compositorFailureFallsBack, shouldInitOptionalCompositor, layerConstructionMustNotAbortSession } from './compositor-policy';
export { simulateSetSessionOrdering } from './direct-render-cycle';
export { withRestoredGlTextureState } from './gl-state';
export { isIwerActive } from './emu-state';
export {
  applyRigLocomotion,
  headingForward,
  initialSnapTurnState,
  stepLocomotion,
  xrHeadBobAmount,
  rigDoesNotWriteHmdPose,
  XR_MOVE_SPEED,
  XR_SNAP_RAD,
} from './locomotion';
export {
  composeLayerStack,
  detectLayerCapabilities,
  probeLayerApis,
  XrLayerManager,
} from './layers';
export { XrPlayerRig } from './player-rig';
export { xrEntryShouldShow, applyXrEntryVisibility, XR_ENTER_BUTTON_ID, XR_HUD_BUTTON_ID } from './entry';
export { planMediaLayer, xrMediaLayerFlag } from './media';
export { XrRuntime } from './runtime';
export type { XrRuntimeHost } from './runtime';
export { xrUiActions, XR_STANDARD_BUTTON } from './ui-input';
export { uiOwnsInput, locomotionAllowed, worldSelectAllowed } from './ui-mode';
export { xrContentSnapshot, requiredWorldContentParity } from './content-diagnostics';
export { xrSettingExposure, xrDesktopQualityAffectsXr } from './settings-policy';
