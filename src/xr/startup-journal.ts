// Secret-free XR startup journal. sessionStorage survives a Quest waiting-
// environment hang so the last completed stage can be read after the fact.

import { readContextXrAttributes, type GlXrAttributes } from './gl-compat.ts';
import type { XrSessionPhase } from './types.ts';

export type XrJournalMode = 'RAW' | 'THREE_BASELINE' | 'BARE' | 'HALCYON';

export interface XrJournalEvent {
  at: number;
  type: string;
  mode: XrJournalMode;
  phase?: XrSessionPhase;
  documentVisibility?: string | null;
  sessionVisibility?: string | null;
  windowBlurred?: boolean;
  detail?: Record<string, string | number | boolean | null>;
}

export interface XrLastStartup {
  commit: string | null;
  mode: XrJournalMode;
  userAgent: string;
  startedAt: number;
  lastEventAt: number;
  lastType: string;
  phase: XrSessionPhase | null;
  documentVisibility: string | null;
  sessionVisibility: string | null;
  enabledFeatures: string[];
  requestedOptionalFeatures: string[];
  context: GlXrAttributes | null;
  hasXRWebGLBinding: boolean | null;
  hasCreateProjectionLayer: boolean | null;
  compositorBackend: string | null;
  requestSessionError: string | null;
  makeXRCompatibleError: string | null;
  setSessionError: string | null;
  firstXrCallbackAt: number | null;
  firstRenderStart: number | null;
  firstRenderEnd: number | null;
  firstWorldFrameAt: number | null;
  contextLost: boolean;
  contextRestored: boolean;
  sessionEnded: boolean;
  supportedFrameRates: number[] | null;
  targetFrameRate: number | null;
  targetFrameRateRequestedAt: number | null;
  targetFrameRateResolvedAt: number | null;
  targetFrameRateError: string | null;
  frameratechangeCount: number;
  flags: string[];
}

const STORAGE_JOURNAL = 'halcyon.xr.startupJournal';
const STORAGE_LAST = 'halcyon.xr.lastStartup';
const MAX_EVENTS = 240;

let mode: XrJournalMode = 'HALCYON';
let events: XrJournalEvent[] = [];
let last: XrLastStartup = blankLast('HALCYON');
let windowBlurred = false;
let installed = false;
let windowBlurCount = 0;
let windowFocusCount = 0;

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function ua(): string {
  return typeof navigator !== 'undefined' ? navigator.userAgent : '';
}

function visibility(): string | null {
  return typeof document !== 'undefined' ? document.visibilityState : null;
}

function flagList(search: string): string[] {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const out: string[] = [];
  for (const [k, v] of q) {
    if (k.startsWith('xr') || k === 'demo' || k === 'nogate') out.push(`${k}=${v}`);
  }
  return out;
}

function commitId(): string | null {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    return env?.VITE_COMMIT_SHA ?? env?.VITE_GIT_SHA ?? null;
  } catch {
    return null;
  }
}

export function blankLast(m: XrJournalMode): XrLastStartup {
  return {
    commit: commitId(),
    mode: m,
    userAgent: ua(),
    startedAt: nowMs(),
    lastEventAt: nowMs(),
    lastType: 'init',
    phase: 'idle',
    documentVisibility: visibility(),
    sessionVisibility: null,
    enabledFeatures: [],
    requestedOptionalFeatures: [],
    context: null,
    hasXRWebGLBinding: null,
    hasCreateProjectionLayer: null,
    compositorBackend: null,
    requestSessionError: null,
    makeXRCompatibleError: null,
    setSessionError: null,
    firstXrCallbackAt: null,
    firstRenderStart: null,
    firstRenderEnd: null,
    firstWorldFrameAt: null,
    contextLost: false,
    contextRestored: false,
    sessionEnded: false,
    supportedFrameRates: null,
    targetFrameRate: null,
    targetFrameRateRequestedAt: null,
    targetFrameRateResolvedAt: null,
    targetFrameRateError: null,
    frameratechangeCount: 0,
    flags: typeof location !== 'undefined' ? flagList(location.search) : [],
  };
}

function persist(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(STORAGE_JOURNAL, JSON.stringify(events.slice(-MAX_EVENTS)));
    sessionStorage.setItem(STORAGE_LAST, JSON.stringify(last));
  } catch {
    /* quota / private mode */
  }
}

export function appendXrJournal(
  type: string,
  patch: Partial<XrLastStartup> = {},
  detail?: XrJournalEvent['detail'],
): XrLastStartup {
  last = {
    ...last,
    ...patch,
    lastEventAt: nowMs(),
    lastType: type,
    documentVisibility: visibility(),
  };
  events.push({
    at: last.lastEventAt,
    type,
    mode,
    phase: last.phase ?? undefined,
    documentVisibility: last.documentVisibility,
    sessionVisibility: last.sessionVisibility,
    windowBlurred,
    detail,
  });
  if (events.length > MAX_EVENTS) events = events.slice(-MAX_EVENTS);
  persist();
  return last;
}

export function installXrStartupJournal(nextMode: XrJournalMode): void {
  mode = nextMode;
  events = [];
  last = blankLast(nextMode);
  windowBlurred = false;
  windowBlurCount = 0;
  windowFocusCount = 0;
  appendXrJournal('journal-start', { mode: nextMode });
  if (installed || typeof window === 'undefined') {
    publishJournal();
    return;
  }
  installed = true;
  window.addEventListener('blur', () => {
    windowBlurred = true;
    windowBlurCount++;
    appendXrJournal('window-blur', {}, { blurCount: windowBlurCount });
  });
  window.addEventListener('focus', () => {
    windowBlurred = false;
    windowFocusCount++;
    appendXrJournal('window-focus', {}, { focusCount: windowFocusCount });
  });
  document.addEventListener('visibilitychange', () => {
    appendXrJournal('document-visibility', { documentVisibility: visibility() });
  });
  publishJournal();
}

export function noteSessionVisibility(session: XRSession | null | undefined): void {
  const vis = session && 'visibilityState' in session
    ? String((session as XRSession & { visibilityState?: string }).visibilityState ?? '')
    : null;
  if (vis) appendXrJournal('session-visibility', { sessionVisibility: vis });
}

export function noteContextAttributes(
  gl: WebGLRenderingContext | WebGL2RenderingContext | null | undefined,
): GlXrAttributes {
  const context = readContextXrAttributes(gl);
  appendXrJournal('context-attributes', { context });
  return context;
}

export function attachContextJournal(canvas: HTMLCanvasElement): () => void {
  const onLost = () => {
    appendXrJournal('context-lost', { contextLost: true });
  };
  const onRestored = () => {
    appendXrJournal('context-restored', { contextRestored: true, contextLost: false });
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  return () => {
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
  };
}

export function xrStartupJournal(): XrJournalEvent[] {
  return events.map((e) => ({ ...e }));
}

export function lastXrStartup(): XrLastStartup {
  return { ...last };
}

export function publishJournal(): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as {
    __xrStartupJournal?: () => XrJournalEvent[];
    __lastXrStartup?: () => XrLastStartup;
  };
  w.__xrStartupJournal = () => xrStartupJournal();
  w.__lastXrStartup = () => lastXrStartup();
}

export function resetXrStartupJournalForTests(): void {
  installed = false;
  events = [];
  last = blankLast('HALCYON');
  windowBlurred = false;
}

export function journalWindowBlurCount(): number {
  return windowBlurCount;
}
