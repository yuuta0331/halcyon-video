// Submission-path timings. Not Quest GPU execution time.

export interface XrUploadMetrics {
  decodeMs: number;
  resizeMs: number;
  cpuMipMs: number;
  uploadCallMs: number;
  texSubImageCalls: number;
  bytesUploaded: number;
  texturesScheduledForUpload: number;
  bytesScheduledForUpload: number;
  uploadPreparationMs: number;
  pendingBase: number;
  pendingNear: number;
  pendingFocus: number;
  deferredForMotion: number;
  promotedWhileStable: number;
  fairnessForced: number;
  frameDeltaMs: number;
  framesOver13: number;
  framesOver20: number;
  framesOver33: number;
  worstFrameMs: number;
  frameCount: number;
}

const blank = (): XrUploadMetrics => ({
  decodeMs: 0,
  resizeMs: 0,
  cpuMipMs: 0,
  uploadCallMs: 0,
  texSubImageCalls: 0,
  bytesUploaded: 0,
  texturesScheduledForUpload: 0,
  bytesScheduledForUpload: 0,
  uploadPreparationMs: 0,
  pendingBase: 0,
  pendingNear: 0,
  pendingFocus: 0,
  deferredForMotion: 0,
  promotedWhileStable: 0,
  fairnessForced: 0,
  frameDeltaMs: 0,
  framesOver13: 0,
  framesOver20: 0,
  framesOver33: 0,
  worstFrameMs: 0,
  frameCount: 0,
});

let metrics = blank();

export function noteCpuWork(kind: 'decode' | 'resize' | 'mip', ms: number): void {
  if (kind === 'decode') metrics.decodeMs += ms;
  else if (kind === 'resize') metrics.resizeMs += ms;
  else metrics.cpuMipMs += ms;
}

export function noteGpuSubmit(input: { durationMs: number; texSubImageCalls: number; bytes: number }): void {
  metrics.uploadCallMs += input.durationMs;
  metrics.texSubImageCalls += input.texSubImageCalls;
  metrics.bytesUploaded += input.bytes;
}

/** JS scheduled Three.js upload (needsUpdate). Not a measured gl.texSubImage* call. */
export function noteScheduledUpload(input: {
  textures: number;
  bytes: number;
  preparationMs: number;
}): void {
  metrics.texturesScheduledForUpload += input.textures;
  metrics.bytesScheduledForUpload += input.bytes;
  metrics.uploadPreparationMs += input.preparationMs;
}

export function noteUploadQueue(pending: { base: number; near: number; focus: number }): void {
  metrics.pendingBase = pending.base;
  metrics.pendingNear = pending.near;
  metrics.pendingFocus = pending.focus;
}

export function noteMotionPolicy(input: {
  deferredForMotion: number;
  promotedWhileStable: number;
  fairnessForced: number;
}): void {
  metrics.deferredForMotion = input.deferredForMotion;
  metrics.promotedWhileStable = input.promotedWhileStable;
  metrics.fairnessForced = input.fairnessForced;
}

export function noteXrFrameDelta(dtMs: number): void {
  metrics.frameCount++;
  metrics.frameDeltaMs = dtMs;
  if (dtMs > metrics.worstFrameMs) metrics.worstFrameMs = dtMs;
  if (dtMs > 13.89) metrics.framesOver13++;
  if (dtMs > 20) metrics.framesOver20++;
  if (dtMs > 33.3) metrics.framesOver33++;
}

export function xrUploadMetricsSnapshot(): XrUploadMetrics {
  return { ...metrics };
}

export function resetXrUploadMetricsForTests(): void {
  metrics = blank();
}
