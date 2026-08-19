// JP-4A Round 5B.3 diagnostic session: privacy-safe persistence, telemetry,
// result formatting, and one shared source of truth for DOM/XR/API consumers.

export const JP4A_TEST_PATH = '/xr-test/jp4a';
export const JP4A_STORAGE_KEY = 'halcyon.jp4a.round5b3.session.v1';
export const JP4A_ROUND = 'JP-4A Round 5B.3';

declare const __HALCYON_BUILD_SHA__: string;

export type LivePosterMode =
  | 'LIVE-NORMAL'
  | 'LIVE-BASE'
  | 'LIVE-LOD0'
  | 'LIVE-LOD1'
  | 'LIVE-LOD2'
  | 'LIVE-LOD3'
  | 'LIVE-LINEAR'
  | 'LIVE-UNLIT'
  | 'LIVE-DEPTH-ISOLATED';

export const LIVE_POSTER_MODES: readonly LivePosterMode[] = [
  'LIVE-NORMAL',
  'LIVE-BASE',
  'LIVE-LOD0',
  'LIVE-LOD1',
  'LIVE-LOD2',
  'LIVE-LOD3',
  'LIVE-LINEAR',
  'LIVE-UNLIT',
  'LIVE-DEPTH-ISOLATED',
];

export interface LivePosterModeMeta {
  mode: LivePosterMode;
  textureTier: 'production' | 'base';
  mip: 'automatic' | 0 | 1 | 2 | 3 | 'linear-lod0';
  lighting: 'production' | 'unlit';
  depthOffsetStoreUnits: number;
}

export function livePosterModeMeta(mode: LivePosterMode): LivePosterModeMeta {
  const fixed = mode.match(/^LIVE-LOD([0-3])$/)?.[1];
  return {
    mode,
    textureTier: mode === 'LIVE-BASE' || fixed != null || mode === 'LIVE-LINEAR' ? 'base' : 'production',
    mip: fixed != null ? Number(fixed) as 0 | 1 | 2 | 3
      : mode === 'LIVE-LINEAR' ? 'linear-lod0' : 'automatic',
    lighting: mode === 'LIVE-UNLIT' ? 'unlit' : 'production',
    depthOffsetStoreUnits: mode === 'LIVE-DEPTH-ISOLATED' ? 0.025 : 0,
  };
}

export type LiveVerdict = 'UNKNOWN' | 'BLACK' | 'CLEAN';
export type Jp4aPhase = 'baseline' | 'approach' | 'focus_transition' | 'focus_settled' | 'live_mode';

export interface Jp4aTelemetrySample {
  timestamp: string;
  elapsedMs: number;
  phase: Jp4aPhase;
  mode: LivePosterMode;
  fps: number | null;
  meanMs: number | null;
  onePercentLowFps: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  worstMs: number | null;
  frameCount: number;
  targetHz: number | null;
  supportedHz: number[] | null;
  framebufferWidth: number | null;
  framebufferHeight: number | null;
  framebufferScale: number | null;
  foveation: number | null;
  drawCalls: number;
  triangles: number;
  textures: number;
  programs: number;
  posterBankCount: number | null;
  renderBatchCount: number | null;
  lockedPosterOpaqueId: string | null;
  globalIndex: number | null;
  expectedBank: number | null;
  meshBank: number | null;
  expectedLayer: number | null;
  loadedFlag: number | null;
  detailPhase: string | null;
  focusPhase: string | null;
  focusUploadProgress: number | null;
  pendingBase: number;
  pendingNear: number;
  pendingFocus: number;
  gpuUploadBytes: number;
  gpuUploadSubmitMs: number;
  decodeMs: number;
  viewerDistanceM: number | null;
  viewerYawToPosterDeg: number | null;
}

export interface Jp4aLockedPoster {
  opaqueId: string;
  globalIndex: number;
  expectedBank: number;
  meshBank: number | null;
  expectedLayer: number;
  loadedFlag: number | null;
}

export interface Jp4aBankInvariant {
  checkedSlots: number;
  bankMismatchCount: number;
  layerOutOfRangeCount: number;
  missingIndexCount: number;
  invalidLoadedFlagCount: number;
  pass: boolean;
}

export interface Jp4aSession {
  schema: 1;
  round: typeof JP4A_ROUND;
  build: string;
  sessionId: string;
  startedAt: string;
  xrStartedAt: string | null;
  completedAt: string | null;
  active: boolean;
  mode: LivePosterMode;
  step: number;
  lockedPoster: Jp4aLockedPoster | null;
  modeVerdicts: Record<LivePosterMode, LiveVerdict>;
  bankInvariant: Jp4aBankInvariant | null;
  samples: Jp4aTelemetrySample[];
  events: Array<{ timestamp: string; type: string; value?: string }>;
  environment: 'QUEST_HARDWARE_PENDING' | 'IWER_EMULATED' | 'DESKTOP_BROWSER';
  questHardware: 'NOT_EXECUTED' | 'EXECUTED_RESULT_PENDING';
}

type Listener = (session: Jp4aSession | null) => void;

const listeners = new Set<Listener>();
let current: Jp4aSession | null = null;
let lastPersistAt = -Infinity;

export function jp4aTestRequested(
  pathname = typeof location !== 'undefined' ? location.pathname : '',
  search = typeof location !== 'undefined' ? location.search : '',
): boolean {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return pathname.replace(/\/$/, '') === JP4A_TEST_PATH || q.get('xrTest') === 'jp4a';
}

export function jp4aBuildId(): string {
  try {
    return typeof __HALCYON_BUILD_SHA__ === 'string' && __HALCYON_BUILD_SHA__
      ? __HALCYON_BUILD_SHA__
      : 'unknown';
  } catch {
    return 'unknown';
  }
}

function makeSessionId(now = Date.now()): string {
  const random = typeof crypto !== 'undefined' && 'getRandomValues' in crypto
    ? crypto.getRandomValues(new Uint32Array(1))[0]!.toString(16).padStart(8, '0')
    : Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  return `jp4a-${now.toString(36)}-${random}`;
}

function blankVerdicts(): Record<LivePosterMode, LiveVerdict> {
  return Object.fromEntries(LIVE_POSTER_MODES.map((m) => [m, 'UNKNOWN'])) as Record<LivePosterMode, LiveVerdict>;
}

function detectedEnvironment(): Jp4aSession['environment'] {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  if (q?.get('xrEmu') === '1') return 'IWER_EMULATED';
  return 'QUEST_HARDWARE_PENDING';
}

export function resetJp4aTest(now = Date.now()): Jp4aSession {
  current = {
    schema: 1,
    round: JP4A_ROUND,
    build: jp4aBuildId(),
    sessionId: makeSessionId(now),
    startedAt: new Date(now).toISOString(),
    xrStartedAt: null,
    completedAt: null,
    active: false,
    mode: 'LIVE-NORMAL',
    step: 1,
    lockedPoster: null,
    modeVerdicts: blankVerdicts(),
    bankInvariant: null,
    samples: [],
    events: [{ timestamp: new Date(now).toISOString(), type: 'session_reset' }],
    environment: detectedEnvironment(),
    questHardware: 'NOT_EXECUTED',
  };
  persist(true);
  emit();
  return snapshot()!;
}

export function startJp4aTest(now = Date.now()): Jp4aSession {
  const s = resetJp4aTest(now);
  current = { ...s, active: true };
  event('test_started');
  persist(true);
  emit();
  return snapshot()!;
}

export function markJp4aXrStarted(
  now = Date.now(),
  classification?: 'UNIT' | 'DESKTOP_BROWSER' | 'IWER_EMULATED' | 'QUEST_HARDWARE',
): void {
  if (!current?.active) return;
  if (classification === 'IWER_EMULATED') {
    current.environment = 'IWER_EMULATED';
    current.questHardware = 'NOT_EXECUTED';
  } else if (classification === 'QUEST_HARDWARE') {
    current.environment = 'QUEST_HARDWARE_PENDING';
    current.questHardware = 'EXECUTED_RESULT_PENDING';
  } else if (classification === 'DESKTOP_BROWSER') {
    current.environment = 'DESKTOP_BROWSER';
    current.questHardware = 'NOT_EXECUTED';
  }
  current.xrStartedAt = new Date(now).toISOString();
  current.step = Math.max(current.step, 1);
  event('xr_started');
  persist(true);
  emit();
}

export function markJp4aXrEnded(now = Date.now()): void {
  if (!current?.active) return;
  current.completedAt = new Date(now).toISOString();
  current.active = false;
  current.step = 5;
  event('xr_ended');
  persist(true);
  emit();
}

export function setJp4aLockedPoster(poster: Jp4aLockedPoster | null): void {
  if (!current?.active) return;
  current.lockedPoster = poster ? { ...poster } : null;
  if (poster) current.step = Math.max(current.step, 3);
  event(poster ? 'poster_locked' : 'poster_unlocked', poster?.opaqueId);
  persist(true);
  emit();
}

export function setJp4aBankInvariant(value: Jp4aBankInvariant): void {
  if (!current) return;
  current.bankInvariant = { ...value };
  persist(true);
}

export function setJp4aMode(mode: LivePosterMode): void {
  if (!current?.active || !LIVE_POSTER_MODES.includes(mode)) return;
  current.mode = mode;
  if (current.lockedPoster) current.step = Math.max(current.step, 3);
  event('mode_changed', mode);
  persist(true);
  emit();
}

export function cycleJp4aMode(direction: -1 | 1): LivePosterMode {
  const now = current?.mode ?? 'LIVE-NORMAL';
  const i = LIVE_POSTER_MODES.indexOf(now);
  const mode = LIVE_POSTER_MODES[(i + direction + LIVE_POSTER_MODES.length) % LIVE_POSTER_MODES.length]!;
  setJp4aMode(mode);
  return mode;
}

export function cycleJp4aModeVerdict(mode = current?.mode): LiveVerdict {
  if (!current?.active || !mode) return 'UNKNOWN';
  const prev = current.modeVerdicts[mode];
  const next: LiveVerdict = prev === 'UNKNOWN' ? 'BLACK' : prev === 'BLACK' ? 'CLEAN' : 'UNKNOWN';
  current.modeVerdicts[mode] = next;
  event('mode_verdict', `${mode}:${next}`);
  persist(true);
  emit();
  return next;
}

export function noteJp4aFocusState(phase: string | null): void {
  if (!current?.active) return;
  if (phase === 'pendingUpload' || phase === 'pendingPixels') current.step = Math.max(current.step, 4);
  if (phase === 'ready') current.step = Math.max(current.step, 4);
}

export function recordJp4aSample(sample: Jp4aTelemetrySample, nowMs = Date.now()): void {
  if (!current?.active) return;
  current.samples.push({ ...sample, supportedHz: sample.supportedHz ? [...sample.supportedHz] : null });
  if (current.samples.length > 1200) current.samples.splice(0, current.samples.length - 1200);
  if (sample.phase === 'baseline'
      && current.samples.filter((x) => x.phase === 'baseline').length >= 8) {
    current.step = Math.max(current.step, 2);
  }
  if (nowMs - lastPersistAt >= 500) persist(false, nowMs);
}

export function jp4aTestSnapshot(): Jp4aSession | null {
  return snapshot();
}

function snapshot(): Jp4aSession | null {
  if (!current) return null;
  return JSON.parse(JSON.stringify(current)) as Jp4aSession;
}

export function restoreJp4aTest(): Jp4aSession | null {
  if (current) return snapshot();
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(JP4A_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Jp4aSession;
    if (parsed?.schema !== 1 || parsed.round !== JP4A_ROUND) return null;
    current = parsed;
    return snapshot();
  } catch {
    return null;
  }
}

function event(type: string, value?: string): void {
  if (!current) return;
  current.events.push({ timestamp: new Date().toISOString(), type, ...(value ? { value } : {}) });
  if (current.events.length > 300) current.events.splice(0, current.events.length - 300);
}

function persist(force: boolean, now = Date.now()): void {
  if (!current || typeof localStorage === 'undefined') return;
  if (!force && now - lastPersistAt < 500) return;
  lastPersistAt = now;
  try { localStorage.setItem(JP4A_STORAGE_KEY, JSON.stringify(current)); } catch { /* private/quota */ }
}

function emit(): void {
  const value = snapshot();
  for (const fn of listeners) fn(value);
}

export function onJp4aTestChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function phaseSummary(s: Jp4aSession, phase: Jp4aPhase): string {
  const xs = s.samples.filter((x) => x.phase === phase && x.fps != null);
  if (!xs.length) return '--';
  const mean = xs.reduce((n, x) => n + (x.fps ?? 0), 0) / xs.length;
  return `${mean.toFixed(1)} FPS (${xs.length} samples)`;
}

export function formatJp4aResult(session = current): string {
  if (!session) return `${JP4A_ROUND}\nNO SESSION`;
  const focus = [...session.samples].reverse().find((x) => x.focusPhase === 'ready')
    ?? [...session.samples].reverse().find((x) => x.focusPhase);
  const lines = [
    JP4A_ROUND,
    `Build: ${session.build}`,
    `Session: ${session.sessionId}`,
    `Environment: ${session.environment}`,
    `QUEST_HARDWARE: ${session.questHardware}`,
    '',
    `Baseline FPS: ${phaseSummary(session, 'baseline')}`,
    `Approach FPS: ${phaseSummary(session, 'approach')}`,
    `Focus transition FPS: ${phaseSummary(session, 'focus_transition')}`,
    `Focus settled FPS: ${phaseSummary(session, 'focus_settled')}`,
    '',
    `Locked poster: ${session.lockedPoster?.opaqueId ?? '--'}`,
    ...LIVE_POSTER_MODES.map((mode) => `${mode}: ${session.modeVerdicts[mode]}`),
    '',
    `Bank invariant: ${session.bankInvariant?.pass ? 'PASS' : session.bankInvariant ? 'FAIL' : 'NOT_RECORDED'}`,
    `Bank mismatches: ${session.bankInvariant?.bankMismatchCount ?? '--'}`,
    `Layer out of range: ${session.bankInvariant?.layerOutOfRangeCount ?? '--'}`,
    `Missing indices: ${session.bankInvariant?.missingIndexCount ?? '--'}`,
    `Invalid loaded flags: ${session.bankInvariant?.invalidLoadedFlagCount ?? '--'}`,
    '',
    `Focus: phase=${focus?.focusPhase ?? '--'} decode=${focus?.decodeMs?.toFixed(2) ?? '--'}ms ` +
      `gpu-submit=${focus?.gpuUploadSubmitMs?.toFixed(2) ?? '--'}ms bytes=${focus?.gpuUploadBytes ?? '--'} ` +
      `progress=${focus?.focusUploadProgress == null ? '--' : `${Math.round(focus.focusUploadProgress * 100)}%`}`,
    '',
    'IWER_EMULATED is NOT HARDWARE VISUAL PROOF.',
    'Notes: paste any visual observations below this line.',
  ];
  return lines.join('\n');
}

export function jp4aResultJson(session = current): string {
  return JSON.stringify(session ?? { round: JP4A_ROUND, error: 'NO_SESSION' }, null, 2);
}

export function installJp4aTestApis(): void {
  if (typeof window === 'undefined') return;
  restoreJp4aTest();
  const w = window as unknown as Record<string, unknown>;
  w.__jp4aTestSnapshot = () => jp4aTestSnapshot();
  w.__jp4aTestResult = () => formatJp4aResult();
  w.__jp4aTestJson = () => jp4aResultJson();
  w.__jp4aTestReset = () => resetJp4aTest();
  if (jp4aTestRequested()) {
    // Browser-harness seam on the diagnostic route only. Uses the same state
    // mutations as controller/runtime code; accepts no title or URL fields.
    w.__jp4aTestHarness = {
      lockOpaque: (opaqueId = 'opaque-synthetic') => setJp4aLockedPoster({
        opaqueId: String(opaqueId).slice(0, 64), globalIndex: 5,
        expectedBank: 0, meshBank: 0, expectedLayer: 5, loadedFlag: 255,
      }),
      cycleMode: (direction: -1 | 1 = 1) => cycleJp4aMode(direction),
      markVerdict: () => cycleJp4aModeVerdict(),
      recordSyntheticSample: () => recordJp4aSample({
        timestamp: new Date().toISOString(), elapsedMs: 1000, phase: 'approach', mode: current?.mode ?? 'LIVE-NORMAL',
        fps: 60, meanMs: 16.67, onePercentLowFps: 55, p95Ms: 18, p99Ms: 20, worstMs: 24,
        frameCount: 60, targetHz: 72, supportedHz: [72, 90], framebufferWidth: 1832,
        framebufferHeight: 1920, framebufferScale: 1, foveation: 0.5, drawCalls: 10,
        triangles: 100, textures: 4, programs: 2, posterBankCount: 1, renderBatchCount: 2,
        lockedPosterOpaqueId: current?.lockedPoster?.opaqueId ?? null, globalIndex: current?.lockedPoster?.globalIndex ?? null,
        expectedBank: current?.lockedPoster?.expectedBank ?? null, meshBank: current?.lockedPoster?.meshBank ?? null,
        expectedLayer: current?.lockedPoster?.expectedLayer ?? null, loadedFlag: current?.lockedPoster?.loadedFlag ?? null,
        detailPhase: 'ready', focusPhase: 'pendingUpload', focusUploadProgress: 0.5,
        pendingBase: 0, pendingNear: 0, pendingFocus: 1, gpuUploadBytes: 1228800,
        gpuUploadSubmitMs: 1.2, decodeMs: 4.5, viewerDistanceM: 3, viewerYawToPosterDeg: 35,
      }),
      complete: () => markJp4aXrEnded(),
    };
  }
}
