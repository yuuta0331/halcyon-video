// Round 5B.3 HF3-HF4: XR support probe truth + emulated entry truth.
//
// Two reproducible field failures on b4ee8e0 drive this file:
//  1. /xr-test/jp4a sat on "Checking XR support..." indefinitely because
//     isSessionSupported() has no bound and the probe was coupled to StoreScene.
//  2. ENTER VR showed "VR ACTIVE" while the copied session still had
//     xrStartedAt=null, samples=[] and no xr_started event.
//
// Nothing here is hardware proof. IWER_EMULATED / UNIT only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JP4A_PRODUCTION_INTERACT_RANGE_FT, JP4A_DIAGNOSTIC_LOCK_RANGE_M } from '../src/xr/jp4a-diagnostic-lock.ts';
import {
  beginStoreVisibleLoading,
  isStoreVisualReady,
  noteStoreVisibleResolved,
  refreshStoreVisualReady,
  resetStoreVisualReady,
} from '../src/store-visual-ready.ts';
import { seedCanonicalWorldReadyForTests } from '../src/xr/content-diagnostics.ts';
import {
  enterXrSession,
  resetXrSessionActionForTests,
  toggleXrSession,
  type XrEntryScene,
} from '../src/xr/boot.ts';
import {
  bindJp4aConsoleStoreScene,
  deriveJp4aConsoleReadiness,
  invokeJp4aEnterVr,
  jp4aConsoleEntrySnapshot,
  jp4aEnterVrButtonLabel,
  jp4aEnterVrStatusText,
  resetJp4aConsoleEntryForTests,
} from '../src/xr/jp4a-console-entry.ts';
import {
  installJp4aTestConsole,
  uninstallJp4aTestConsoleForTests,
} from '../src/xr/jp4a-test-console.ts';
import {
  detectJp4aEnvironment,
  jp4aTestSnapshot,
  jp4aXrEntryConfirmed,
  markJp4aXrEnded,
  markJp4aXrStarted,
  resetJp4aTest,
  startJp4aTest,
} from '../src/xr/jp4a-test-state.ts';
import {
  checkXrSupportTiming,
  xrEntryTimingsFromStartup,
} from '../src/xr/xr-entry-timings.ts';
import {
  ensureXrSupportProbe,
  onXrSupportChange,
  resetXrSupportProbeForTests,
  setXrSupportForTests,
  xrRequestSessionAvailable,
  xrSupportSnapshot,
  xrSupportedOrNull,
  XR_SUPPORT_MAX_SOFT_TIMEOUT_MS,
  XR_SUPPORT_SOFT_TIMEOUT_MS,
  type XrSupportState,
} from '../src/xr/xr-support-probe.ts';

// ─── fake DOM ────────────────────────────────────────────────────────────────

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}

class FakeEl {
  childNodes: FakeEl[] = [];
  parentNode: FakeEl | null = null;
  id = '';
  hidden = false;
  disabled = false;
  textContent = '';
  value = '';
  readOnly = false;
  type = '';
  dataset: Record<string, string> = {};
  style: { cssText: string; opacity: string; display: string } = { cssText: '', opacity: '', display: '' };
  private listeners = new Map<string, Array<() => void>>();
  tag: string;
  constructor(tag: string) { this.tag = tag; }

  append(...nodes: FakeEl[]) { for (const n of nodes) this.appendChild(n); }
  appendChild(node: FakeEl) {
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  replaceChildren(...nodes: FakeEl[]) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    this.append(...nodes);
  }
  removeChild(node: FakeEl) {
    this.childNodes = this.childNodes.filter((child) => child !== node);
    node.parentNode = null;
    return node;
  }
  remove() { this.parentNode?.removeChild(this); }
  addEventListener(type: string, fn: () => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  click() { for (const fn of [...(this.listeners.get('click') ?? [])]) fn(); }
  focus() {}
  select() {}
  setAttribute(name: string, value: string) {
    if (name === 'hidden') this.hidden = true;
    if (name === 'aria-label') this.dataset.ariaLabel = value;
  }
  descendants(): FakeEl[] {
    return this.childNodes.flatMap((child) => [child, ...child.descendants()]);
  }
  querySelectorAll(sel: string): FakeEl[] {
    const all = this.descendants();
    if (sel === 'button') return all.filter((el) => el.tag === 'button');
    if (sel.startsWith('#')) return all.filter((el) => el.id === sel.slice(1));
    if (sel.startsWith('[data-jp4a-action="')) {
      const id = sel.slice('[data-jp4a-action="'.length, -2);
      return all.filter((el) => el.dataset.jp4aAction === id);
    }
    return [];
  }
  querySelector(sel: string): FakeEl | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }
}

const body = new FakeEl('body');

function byId(id: string): FakeEl | null {
  if (body.id === id) return body;
  return body.descendants().find((el) => el.id === id) ?? null;
}

function installFakeDom(search = ''): void {
  body.replaceChildren();
  const doc = {
    body,
    createElement(tag: string) { return new FakeEl(tag); },
    getElementById(id: string) { return byId(id); },
  };
  (globalThis as { document?: unknown }).document = doc;
  (globalThis as { window?: unknown }).window = globalThis;
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    writable: true,
    value: {
      pathname: '/xr-test/jp4a',
      search,
      href: `http://127.0.0.1/xr-test/jp4a${search}`,
      hash: '',
    },
  });
  Object.defineProperty(globalThis, 'history', {
    configurable: true,
    writable: true,
    value: { state: null, replaceState() {} },
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: new MemoryStorage(),
  });
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    writable: true,
    value: { writeText: async () => {} },
  });
}

function setNavigatorXr(xr: unknown): void {
  Object.defineProperty(globalThis.navigator, 'xr', {
    configurable: true,
    writable: true,
    value: xr,
  });
}

function actionButton(id: string): FakeEl | undefined {
  return body.querySelectorAll(`[data-jp4a-action="${id}"]`)[0];
}

function statusEl(): FakeEl | undefined {
  return body.querySelectorAll('#jp4a-entry-status')[0];
}

function fakeScene(opts: {
  enter?: () => Promise<void> | void;
  fail?: string;
  /** enterXr resolves but the runtime never actually presents. */
  neverPresents?: boolean;
  /** Skip the runtime's JP-4A startup confirmation. */
  confirmXrStart?: boolean;
} = {}): XrEntryScene {
  let presenting = false;
  return {
    xrVideoGetter: null,
    probeXr: async () => true,
    get xr() { return { presenting }; },
    async enterXr() {
      if (opts.fail) throw new Error(opts.fail);
      await opts.enter?.();
      if (opts.neverPresents) return;
      presenting = true;
      if (opts.confirmXrStart !== false) markJp4aXrStarted(Date.now(), 'UNIT');
    },
    async exitXr() { presenting = false; },
  };
}

function makeStoreReady(): void {
  resetStoreVisualReady();
  beginStoreVisibleLoading({ posterIds: ['a'] });
  noteStoreVisibleResolved('a', 'uploaded');
  seedCanonicalWorldReadyForTests();
  refreshStoreVisualReady();
  if (!isStoreVisualReady()) throw new Error('makeStoreReady failed');
}

function resetAll(search = ''): void {
  uninstallJp4aTestConsoleForTests();
  resetJp4aConsoleEntryForTests();
  resetXrSessionActionForTests();
  resetXrSupportProbeForTests();
  resetStoreVisualReady();
  installFakeDom(search);
  setNavigatorXr({ isSessionSupported: async () => true, requestSession: async () => ({}) });
  resetJp4aTest();
}

/** Deterministic timer: no test sleeps for a real soft-timeout duration. */
function fakeClock() {
  let now = 0;
  const timers: Array<{ at: number; fn: () => void; cancelled: boolean }> = [];
  return {
    now: () => now,
    schedule: (fn: () => void, ms: number) => {
      const entry = { at: now + ms, fn, cancelled: false };
      timers.push(entry);
      return () => { entry.cancelled = true; };
    },
    advance(ms: number) {
      now += ms;
      for (const entry of [...timers]) {
        if (!entry.cancelled && entry.at <= now) {
          entry.cancelled = true;
          entry.fn();
        }
      }
    },
    pending: () => timers.filter((t) => !t.cancelled).length,
  };
}

const readiness = (over: Partial<Parameters<typeof deriveJp4aConsoleReadiness>[0]> = {}) =>
  deriveJp4aConsoleReadiness({
    hostBound: true,
    supportState: 'SUPPORTED',
    requestSessionAvailable: true,
    scene: fakeScene(),
    storeVisualReady: true,
    entering: false,
    presenting: false,
    xrConfirmed: false,
    lastFailed: false,
    ...over,
  });

// ─── A: the probe starts at boot, right after emulator installation ──────────

test('HF3-HF4 A: support probe starts immediately after emulator installation', () => {
  const src = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const main = src.slice(src.indexOf('async function main() {'));
  assert.ok(main.length > 0, 'main() not found');
  const emu = main.indexOf('await installXrEmulatorIfRequested();');
  const probe = main.indexOf('void ensureXrSupportProbe({ isTauri })');
  assert.ok(emu >= 0, 'emulator install call not found');
  assert.ok(probe > emu, 'probe must start after IWER can inject navigator.xr');
  // ...and before any expensive boot work inside main().
  for (const later of ['initBootFlow(', 'applyDocumentChrome()', 'registerCoreSettings()']) {
    const at = main.indexOf(later);
    assert.ok(at > 0, `${later} not found in main()`);
    assert.ok(probe < at, `probe must start before ${later}`);
  }
  // StoreScene construction is far later still, and must not own the probe.
  const scene = readFileSync(new URL('../src/store-xr.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(scene, /new XrSupportProbe|startXrSupportProbe\(/);
});

test('HF3-HF4 A2: probe module is independent of StoreScene', () => {
  const src = readFileSync(new URL('../src/xr/xr-support-probe.ts', import.meta.url), 'utf8');
  const imports = src.split(/\r?\n/).filter((line) => /^import\b/.test(line));
  assert.deepEqual(imports, [], 'the probe must not depend on any scene module');
  assert.doesNotMatch(src, /isStoreVisualReady|scene\.xr|storeScene/);
  const entry = readFileSync(new URL('../src/xr/jp4a-console-entry.ts', import.meta.url), 'utf8');
  assert.match(entry, /xr-support-probe/);
});

test('HF3-HF4 A3: probe is single-flight and survives scene rebuilds', async () => {
  resetXrSupportProbeForTests();
  let calls = 0;
  const xr = { isSessionSupported: async () => { calls += 1; return true; } };
  const first = ensureXrSupportProbe({ getXr: () => xr });
  const second = ensureXrSupportProbe({ getXr: () => xr });
  assert.equal(first, second, 'second caller must join the same flight');
  await first;
  // A StoreScene rebuild calls again; it must read the cache, not re-probe.
  await ensureXrSupportProbe({ getXr: () => xr });
  await ensureXrSupportProbe({ getXr: () => xr });
  assert.equal(calls, 1);
  assert.equal(xrSupportSnapshot().state, 'SUPPORTED');
});

// ─── B/C/D: bounded probing, and the wording that depends on it ─────────────

test('HF3-HF4 B: Checking XR support is shown only while the API call is pending', () => {
  assert.equal(jp4aEnterVrStatusText(readiness({ supportState: 'NOT_STARTED' })), 'Preparing XR runtime…');
  assert.equal(jp4aEnterVrStatusText(readiness({ supportState: 'PROBING' })), 'Checking XR support…');
  for (const state of ['SUPPORTED', 'UNSUPPORTED', 'TIMED_OUT', 'ERROR'] as XrSupportState[]) {
    const text = jp4aEnterVrStatusText(readiness({ supportState: state }));
    assert.doesNotMatch(text, /Checking XR support/i, `${state} must not claim to be probing`);
  }
  assert.equal(readiness({ supportState: 'NOT_STARTED' }), 'BOOTING');
  assert.equal(readiness({ supportState: 'PROBING' }), 'CHECKING_XR_SUPPORT');
});

test('HF3-HF4 C: a never-resolving isSessionSupported leaves PROBING at the soft bound', async () => {
  resetXrSupportProbeForTests();
  const clock = fakeClock();
  const never = new Promise<boolean>(() => { /* never settles */ });
  const flight = ensureXrSupportProbe({
    getXr: () => ({ isSessionSupported: () => never }),
    now: clock.now,
    schedule: clock.schedule,
  });
  assert.equal(xrSupportSnapshot().state, 'PROBING');
  assert.equal(xrSupportSnapshot().invoked, true);

  clock.advance(XR_SUPPORT_SOFT_TIMEOUT_MS - 1);
  assert.equal(xrSupportSnapshot().state, 'PROBING', 'must not give up early');

  clock.advance(2);
  const settled = await flight;
  assert.equal(settled.state, 'TIMED_OUT');
  assert.equal(settled.reason, 'SOFT_TIMEOUT');
  assert.ok(settled.elapsedMs != null && settled.elapsedMs <= XR_SUPPORT_MAX_SOFT_TIMEOUT_MS,
    `support wait ${settled.elapsedMs}ms exceeded the ${XR_SUPPORT_MAX_SOFT_TIMEOUT_MS}ms bound`);
  assert.notEqual(jp4aEnterVrStatusText(readiness({ supportState: 'TIMED_OUT' })), 'Checking XR support…');
});

test('HF3-HF4 C2: the configured soft timeout can never exceed the diagnostic bound', async () => {
  assert.ok(XR_SUPPORT_SOFT_TIMEOUT_MS <= XR_SUPPORT_MAX_SOFT_TIMEOUT_MS);
  assert.ok(XR_SUPPORT_MAX_SOFT_TIMEOUT_MS <= 2000);
  resetXrSupportProbeForTests();
  const clock = fakeClock();
  const flight = ensureXrSupportProbe({
    // A caller asking for a 240s support deadline must be clamped, not obeyed.
    softTimeoutMs: 240_000,
    getXr: () => ({ isSessionSupported: () => new Promise<boolean>(() => {}) }),
    now: clock.now,
    schedule: clock.schedule,
  });
  clock.advance(XR_SUPPORT_MAX_SOFT_TIMEOUT_MS);
  const settled = await flight;
  assert.equal(settled.state, 'TIMED_OUT');
  assert.equal(settled.softTimeoutMs, XR_SUPPORT_MAX_SOFT_TIMEOUT_MS);
});

test('HF3-HF4 D: TIMED_OUT is not UNSUPPORTED', () => {
  setXrSupportForTests(null, 'TIMED_OUT');
  assert.equal(xrSupportSnapshot().state, 'TIMED_OUT');
  assert.equal(xrSupportSnapshot().supported, null);
  assert.equal(xrSupportedOrNull(), null, 'timeout must never read as false');
  assert.notEqual(readiness({ supportState: 'TIMED_OUT' }), 'XR_UNSUPPORTED');
  resetXrSupportProbeForTests();
});

test('HF3-HF4 D2/G7: ERROR is not UNSUPPORTED', () => {
  setXrSupportForTests(null, 'ERROR');
  assert.equal(xrSupportedOrNull(), null);
  assert.notEqual(readiness({ supportState: 'ERROR' }), 'XR_UNSUPPORTED');
  resetXrSupportProbeForTests();
});

// ─── E: diagnostic fast path after timeout ──────────────────────────────────

test('HF3-HF4 E: timeout + store ready + requestSession offers TRY ENTER VR', async () => {
  resetAll();
  makeStoreReady();
  setXrSupportForTests(null, 'TIMED_OUT');
  const scene = fakeScene();
  bindJp4aConsoleStoreScene(() => scene);
  installJp4aTestConsole();
  startJp4aTest();
  const snap = jp4aConsoleEntrySnapshot();
  assert.equal(snap.readiness, 'XR_CHECK_SLOW_READY_TO_TRY');
  assert.equal(snap.enabled, true);
  assert.equal(snap.label, 'TRY ENTER VR');
  assert.match(snap.status, /XR CHECK SLOW/);
  assert.equal(actionButton('enter-vr')?.textContent, 'TRY ENTER VR');
  assert.equal(actionButton('enter-vr')?.disabled, false);
  const result = await invokeJp4aEnterVr();
  assert.equal(result.ok, true, 'requestSession is the authoritative attempt');
  assert.equal(jp4aConsoleEntrySnapshot().readiness, 'PRESENTING');
});

test('HF3-HF4 E2: timeout without requestSession stays honest about unavailability', () => {
  assert.equal(
    readiness({ supportState: 'TIMED_OUT', requestSessionAvailable: false }),
    'XR_UNSUPPORTED',
  );
  // A timeout must not jump the store queue either: readiness still reports
  // the truthful store state first.
  assert.equal(readiness({ supportState: 'TIMED_OUT', scene: null }), 'WAITING_FOR_STORE');
  assert.equal(readiness({ supportState: 'TIMED_OUT', storeVisualReady: false }), 'STORE_LOADING');
  assert.equal(readiness({ supportState: 'ERROR' }), 'XR_CHECK_SLOW_READY_TO_TRY');
  assert.equal(jp4aEnterVrButtonLabel('XR_CHECK_SLOW_READY_TO_TRY'), 'TRY ENTER VR');
  assert.equal(jp4aEnterVrButtonLabel('READY_TO_ENTER_VR'), 'ENTER VR');
  setNavigatorXr({ isSessionSupported: async () => true });
  assert.equal(xrRequestSessionAvailable(), false);
  setNavigatorXr({ isSessionSupported: async () => true, requestSession: async () => ({}) });
  assert.equal(xrRequestSessionAvailable(), true);
});

test('HF3-HF4 E3: the diagnostic fast path never claims support === true', async () => {
  resetXrSupportProbeForTests();
  const clock = fakeClock();
  const flight = ensureXrSupportProbe({
    getXr: () => ({ isSessionSupported: () => new Promise<boolean>(() => {}) }),
    now: clock.now,
    schedule: clock.schedule,
  });
  clock.advance(XR_SUPPORT_SOFT_TIMEOUT_MS);
  await flight;
  assert.equal(xrSupportSnapshot().supported, null);
  const runtime = readFileSync(new URL('../src/xr/runtime.ts', import.meta.url), 'utf8');
  assert.match(runtime, /canEnter\(allowUnverifiedSupport = false\)/);
  assert.match(runtime, /this\.immersiveVrSupported = support\.state === 'SUPPORTED'/);
});

// ─── F: late results ────────────────────────────────────────────────────────

test('HF3-HF4 F: a late true result after timeout is recorded and promoted safely', async () => {
  resetXrSupportProbeForTests();
  const clock = fakeClock();
  let resolveLate!: (value: boolean) => void;
  const late = new Promise<boolean>((resolve) => { resolveLate = resolve; });
  const seen: XrSupportState[] = [];
  onXrSupportChange((s) => seen.push(s.state));
  const flight = ensureXrSupportProbe({
    getXr: () => ({ isSessionSupported: () => late }),
    now: clock.now,
    schedule: clock.schedule,
  });
  clock.advance(XR_SUPPORT_SOFT_TIMEOUT_MS);
  assert.equal((await flight).state, 'TIMED_OUT');

  clock.advance(5_000);
  resolveLate(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const snap = xrSupportSnapshot();
  assert.equal(snap.lateResult, true);
  assert.equal(snap.lateElapsedMs, 6_500);
  assert.equal(snap.state, 'SUPPORTED');
  assert.ok(seen.includes('TIMED_OUT') && seen.includes('SUPPORTED'));
  resetXrSupportProbeForTests();
});

test('HF3-HF4 F2: a late rejection after timeout raises no unhandled rejection', async () => {
  resetXrSupportProbeForTests();
  const clock = fakeClock();
  let rejectLate!: (err: Error) => void;
  const late = new Promise<boolean>((_resolve, reject) => { rejectLate = reject; });
  const flight = ensureXrSupportProbe({
    getXr: () => ({ isSessionSupported: () => late }),
    now: clock.now,
    schedule: clock.schedule,
  });
  clock.advance(XR_SUPPORT_SOFT_TIMEOUT_MS);
  await flight;
  rejectLate(new Error('runtime went away'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const snap = xrSupportSnapshot();
  assert.equal(snap.state, 'TIMED_OUT', 'a late rejection is not evidence of absent support');
  assert.equal(snap.error, 'runtime went away');
  resetXrSupportProbeForTests();
});

// ─── G/H/I: honest terminal states ──────────────────────────────────────────

test('HF3-HF4 G: isSessionSupported false is XR_UNSUPPORTED', async () => {
  resetXrSupportProbeForTests();
  const settled = await ensureXrSupportProbe({ getXr: () => ({ isSessionSupported: async () => false }) });
  assert.equal(settled.state, 'UNSUPPORTED');
  assert.equal(settled.reason, 'API_FALSE');
  assert.equal(xrSupportedOrNull(), false);
  assert.equal(readiness({ supportState: 'UNSUPPORTED' }), 'XR_UNSUPPORTED');
  resetXrSupportProbeForTests();
});

test('HF3-HF4 H: an isSessionSupported rejection settles as ERROR, not endless checking', async () => {
  resetXrSupportProbeForTests();
  const settled = await ensureXrSupportProbe({
    getXr: () => ({ isSessionSupported: async () => { throw new Error('nope'); } }),
  });
  assert.equal(settled.state, 'ERROR');
  assert.equal(settled.reason, 'API_ERROR');
  assert.equal(settled.error, 'nope');
  assert.notEqual(settled.state, 'PROBING');
  resetXrSupportProbeForTests();
});

test('HF3-HF4 I: missing navigator.xr is immediately unsupported', async () => {
  resetXrSupportProbeForTests();
  const settled = await ensureXrSupportProbe({ getXr: () => null });
  assert.equal(settled.state, 'UNSUPPORTED');
  assert.equal(settled.reason, 'NO_NAVIGATOR_XR');
  assert.equal(settled.elapsedMs, 0);
  resetXrSupportProbeForTests();
  const noFn = await ensureXrSupportProbe({ getXr: () => ({}) });
  assert.equal(noFn.reason, 'NO_IS_SESSION_SUPPORTED');
  resetXrSupportProbeForTests();
  const tauri = await ensureXrSupportProbe({ isTauri: true, getXr: () => ({ isSessionSupported: async () => true }) });
  assert.equal(tauri.reason, 'TAURI');
  assert.equal(tauri.state, 'UNSUPPORTED');
  resetXrSupportProbeForTests();
});

// ─── J/K: store readiness is a separate wait with separate wording ──────────

test('HF3-HF4 J: absent StoreScene is WAITING FOR STORE, not an XR support state', () => {
  resetAll();
  makeStoreReady();
  setXrSupportForTests(true);
  bindJp4aConsoleStoreScene(() => null);
  installJp4aTestConsole();
  startJp4aTest();
  assert.equal(jp4aConsoleEntrySnapshot().readiness, 'WAITING_FOR_STORE');
  assert.match(statusEl()?.textContent ?? '', /WAITING FOR STORE/);
  assert.doesNotMatch(statusEl()?.textContent ?? '', /Checking XR support/i);
});

test('HF3-HF4 K: store loading says so instead of blaming XR support', () => {
  resetAll();
  resetStoreVisualReady();
  beginStoreVisibleLoading({ posterIds: ['pending'] });
  setXrSupportForTests(true);
  const scene = fakeScene();
  bindJp4aConsoleStoreScene(() => scene);
  installJp4aTestConsole();
  startJp4aTest();
  assert.equal(jp4aConsoleEntrySnapshot().readiness, 'STORE_LOADING');
  assert.match(statusEl()?.textContent ?? '', /still loading/i);
  assert.doesNotMatch(statusEl()?.textContent ?? '', /Checking XR support/i);
});

// ─── L/M: the START flow ────────────────────────────────────────────────────

test('HF3-HF4 L/M: START keeps the console up; no reopen step before ENTER VR', () => {
  resetAll();
  makeStoreReady();
  setXrSupportForTests(true);
  const scene = fakeScene();
  bindJp4aConsoleStoreScene(() => scene);
  installJp4aTestConsole();
  actionButton('start')!.click();
  assert.equal(jp4aTestSnapshot()?.active, true);
  assert.equal(byId('jp4a-test-console')?.hidden, false, 'START must not hide the console');
  assert.equal(byId('jp4a-test-reopen')?.hidden, true);
  const enter = actionButton('enter-vr');
  assert.ok(enter, 'ENTER VR must be reachable straight after START');
  assert.equal(enter!.disabled, false);
});

test('HF3-HF4 M2: CONTINUE TO STORE stays available as an optional operator action', () => {
  resetAll();
  makeStoreReady();
  setXrSupportForTests(true);
  const scene = fakeScene();
  bindJp4aConsoleStoreScene(() => scene);
  installJp4aTestConsole();
  actionButton('start')!.click();
  assert.ok(actionButton('continue'));
  actionButton('continue')!.click();
  assert.equal(byId('jp4a-test-console')?.hidden, true);
  assert.equal(byId('jp4a-test-reopen')?.hidden, false);
  byId('jp4a-test-reopen')!.click();
  assert.equal(byId('jp4a-test-console')?.hidden, false);
});

// ─── O/P: entry can no longer succeed vacuously ─────────────────────────────

test('HF3-HF4 O: an absent scene.xr is an explicit XR_RUNTIME_NOT_READY failure', async () => {
  const src = readFileSync(new URL('../src/store-xr.ts', import.meta.url), 'utf8');
  assert.match(src, /if \(!xr\) throw new Error\('XR_RUNTIME_NOT_READY'\)/);
  assert.doesNotMatch(src, /await scene\.xr\?\.enter\(/);

  resetAll();
  makeStoreReady();
  const result = await enterXrSession(fakeScene({ fail: 'XR_RUNTIME_NOT_READY' }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'XR_RUNTIME_NOT_READY');
  assert.equal(result.presenting, false);
});

test('HF3-HF4 P: enterXr resolving without presenting is not a successful entry', async () => {
  resetAll();
  makeStoreReady();
  const scene = fakeScene({ neverPresents: true });
  const result = await enterXrSession(scene);
  assert.equal(result.ok, false);
  assert.equal(result.action, 'none');
  assert.equal(result.reason, 'SESSION_NOT_PRESENTING');
  assert.equal(result.presenting, false);
});

// ─── Q: the regression fixture from the user's copied session ───────────────

test('HF3-HF4 Q: presenting with xrStartedAt=null is never VR ACTIVE', () => {
  resetAll();
  makeStoreReady();
  setXrSupportForTests(true);
  // Exactly the invalid state in the copied desktop result: active session,
  // runtime looks presenting, but no xr_started transition was ever recorded.
  const scene = fakeScene({ confirmXrStart: false });
  bindJp4aConsoleStoreScene(() => scene);
  installJp4aTestConsole();
  startJp4aTest();
  return invokeJp4aEnterVr().then(() => {
    const session = jp4aTestSnapshot();
    assert.equal(session?.active, true);
    assert.equal(session?.xrStartedAt, null);
    assert.equal(session?.events.some((e) => e.type === 'xr_started'), false);
    assert.equal(jp4aXrEntryConfirmed(session), false);
    assert.equal(scene.xr?.presenting, true);

    const snap = jp4aConsoleEntrySnapshot();
    assert.equal(snap.readiness, 'VR_ENTRY_NOT_CONFIRMED');
    assert.notEqual(snap.status, 'VR ACTIVE');
    assert.equal(snap.status, 'VR ENTRY NOT CONFIRMED');
    assert.equal(statusEl()?.dataset.xrConfirmed, '0');
    assert.notEqual(statusEl()?.textContent, 'VR ACTIVE');
  });
});

test('HF3-HF4 Q2: VR ACTIVE requires both presenting and a recorded xr_started', () => {
  assert.equal(readiness({ presenting: true, xrConfirmed: true }), 'PRESENTING');
  assert.equal(readiness({ presenting: true, xrConfirmed: false }), 'VR_ENTRY_NOT_CONFIRMED');
  assert.equal(jp4aEnterVrStatusText('PRESENTING'), 'VR ACTIVE');
  assert.notEqual(jp4aEnterVrStatusText('VR_ENTRY_NOT_CONFIRMED'), 'VR ACTIVE');

  resetJp4aTest();
  startJp4aTest();
  assert.equal(jp4aXrEntryConfirmed(jp4aTestSnapshot()), false);
  markJp4aXrStarted(Date.now(), 'UNIT');
  const session = jp4aTestSnapshot();
  assert.ok(session?.xrStartedAt);
  assert.ok(session?.events.some((e) => e.type === 'xr_started'));
  assert.equal(jp4aXrEntryConfirmed(session), true);
});

test('HF3-HF4 Q3: the console derives VR ACTIVE from the session, not a raw flag', () => {
  const entry = readFileSync(new URL('../src/xr/jp4a-console-entry.ts', import.meta.url), 'utf8');
  assert.match(entry, /jp4aXrEntryConfirmed/);
  assert.match(entry, /input\.xrConfirmed \? 'PRESENTING' : 'VR_ENTRY_NOT_CONFIRMED'/);
  const state = readFileSync(new URL('../src/xr/jp4a-test-state.ts', import.meta.url), 'utf8');
  assert.match(state, /events\.some\(\(e\) => e\.type === 'xr_started'\)/);
});

// ─── W/X/Y/Z/AA: console visibility around entry ────────────────────────────

test('HF3-HF4 W: confirmed entry auto-hides the console and shows the reopen control', async () => {
  resetAll();
  makeStoreReady();
  setXrSupportForTests(true);
  const scene = fakeScene();
  bindJp4aConsoleStoreScene(() => scene);
  installJp4aTestConsole();
  actionButton('start')!.click();
  assert.equal(byId('jp4a-test-console')?.hidden, false);
  actionButton('enter-vr')!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(jp4aConsoleEntrySnapshot().readiness, 'PRESENTING');
  assert.equal(byId('jp4a-test-console')?.hidden, true, 'overlay must not cover the XR canvas');
  assert.equal(byId('jp4a-test-reopen')?.hidden, false);
});

test('HF3-HF4 W2: hiding really hides - display is toggled, not just [hidden]', async () => {
  resetAll();
  makeStoreReady();
  setXrSupportForTests(true);
  const scene = fakeScene();
  bindJp4aConsoleStoreScene(() => scene);
  installJp4aTestConsole();
  actionButton('start')!.click();
  const consoleEl = byId('jp4a-test-console')!;
  // Inline display:flex beats the UA [hidden] rule, so the attribute alone
  // would leave an opaque full-screen overlay on top of the XR canvas.
  assert.match(consoleEl.style.cssText, /display:flex/);
  actionButton('enter-vr')!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(consoleEl.hidden, true);
  assert.equal((consoleEl.style as { display?: string }).display, 'none');
  byId('jp4a-test-reopen')!.click();
  assert.equal(consoleEl.hidden, false);
  assert.equal((consoleEl.style as { display?: string }).display, 'flex');
});

test('HF3-HF4 X: a failed entry leaves the console and its reason visible', async () => {
  resetAll();
  makeStoreReady();
  setXrSupportForTests(true);
  const scene = fakeScene({ fail: 'requestSession rejected: NotSupportedError' });
  bindJp4aConsoleStoreScene(() => scene);
  installJp4aTestConsole();
  actionButton('start')!.click();
  actionButton('enter-vr')!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(byId('jp4a-test-console')?.hidden, false);
  assert.equal(byId('jp4a-test-reopen')?.hidden, true);
  assert.match(statusEl()?.textContent ?? '', /VR ENTRY FAILED/);
  assert.equal(statusEl()?.dataset.reason, 'ENTRY_FAILED');
  assert.equal(jp4aConsoleEntrySnapshot().lastResult?.error, 'requestSession rejected: NotSupportedError');
});

test('HF3-HF4 X2: an unconfirmed entry also keeps the console visible', async () => {
  resetAll();
  makeStoreReady();
  setXrSupportForTests(true);
  const scene = fakeScene({ confirmXrStart: false });
  bindJp4aConsoleStoreScene(() => scene);
  installJp4aTestConsole();
  actionButton('start')!.click();
  actionButton('enter-vr')!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(byId('jp4a-test-console')?.hidden, false);
  assert.equal(statusEl()?.textContent, 'VR ENTRY NOT CONFIRMED');
});

test('HF3-HF4 Y: XR exit and completion bring the console back', async () => {
  resetAll();
  makeStoreReady();
  setXrSupportForTests(true);
  const scene = fakeScene();
  bindJp4aConsoleStoreScene(() => scene);
  installJp4aTestConsole();
  actionButton('start')!.click();
  actionButton('enter-vr')!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(byId('jp4a-test-console')?.hidden, true);
  await scene.exitXr();
  markJp4aXrEnded();
  assert.equal(byId('jp4a-test-console')?.hidden, false);
  assert.equal(byId('jp4a-test-reopen')?.hidden, true);
});

test('HF3-HF4 Z: COPY RESULT / COPY JSON stay usable after a session', async () => {
  resetAll();
  installJp4aTestConsole();
  actionButton('start')!.click();
  actionButton('copy-result')!.click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(actionButton('copy-result')?.textContent, 'COPIED RESULT');
  actionButton('copy-json')!.click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(actionButton('copy-json')?.textContent, 'COPIED JSON');
});

test('HF3-HF4 AA: RESET then a second confirmed entry works', async () => {
  resetAll();
  makeStoreReady();
  setXrSupportForTests(true);
  let enters = 0;
  const scene = fakeScene({ enter: () => { enters += 1; } });
  bindJp4aConsoleStoreScene(() => scene);
  installJp4aTestConsole();
  actionButton('start')!.click();
  actionButton('enter-vr')!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await scene.exitXr();
  byId('jp4a-test-reopen')!.click();
  const firstSession = jp4aTestSnapshot()?.sessionId;
  actionButton('reset')!.click();
  assert.equal(jp4aTestSnapshot()?.active, false);
  actionButton('start')!.click();
  assert.notEqual(jp4aTestSnapshot()?.sessionId, firstSession);
  actionButton('enter-vr')!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(enters, 2);
  assert.equal(jp4aConsoleEntrySnapshot().readiness, 'PRESENTING');
  assert.ok(jp4aTestSnapshot()?.xrStartedAt);
});

// ─── AB/AC/AD: truthful environment classification ──────────────────────────

test('HF3-HF4 AB: ordinary desktop is never classified as Quest hardware', () => {
  const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36';
  assert.equal(detectJp4aEnvironment({ search: '', userAgent: chrome }), 'DESKTOP_BROWSER');
  // An external Immersive Web Emulator extension is indistinguishable from a
  // desktop browser; DESKTOP_BROWSER is the safe answer, never Quest.
  assert.equal(detectJp4aEnvironment({ search: '?demo=1', userAgent: chrome }), 'DESKTOP_BROWSER');
  resetAll();
  startJp4aTest();
  assert.notEqual(jp4aTestSnapshot()?.environment, 'QUEST_HARDWARE_PENDING');
});

test('HF3-HF4 AC: built-in IWER classifies as IWER_EMULATED', () => {
  assert.equal(detectJp4aEnvironment({ search: '?demo=1&xrEmu=1&nogate=1', userAgent: 'x' }), 'IWER_EMULATED');
  assert.equal(detectJp4aEnvironment({ search: '', userAgent: 'x', iwerActive: true }), 'IWER_EMULATED');
  resetAll('?demo=1&xrEmu=1&nogate=1');
  startJp4aTest();
  assert.equal(jp4aTestSnapshot()?.environment, 'IWER_EMULATED');
  assert.equal(jp4aTestSnapshot()?.questHardware, 'NOT_EXECUTED');
});

test('HF3-HF4 AC2: a real Quest UA is the only pre-entry Quest classification', () => {
  const quest = 'Mozilla/5.0 (X11; Linux x86_64; Quest 3) OculusBrowser/34.0 Chrome/136';
  assert.equal(detectJp4aEnvironment({ search: '', userAgent: quest }), 'QUEST_HARDWARE_PENDING');
  // The runtime's own evidence class still overrides it after entry.
  resetAll();
  startJp4aTest();
  markJp4aXrStarted(Date.now(), 'IWER_EMULATED');
  assert.equal(jp4aTestSnapshot()?.environment, 'IWER_EMULATED');
});

test('HF3-HF4 AD: the normal URL installs no diagnostic console', () => {
  resetAll();
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    writable: true,
    value: { pathname: '/', search: '', href: 'http://127.0.0.1/', hash: '' },
  });
  assert.equal(installJp4aTestConsole(), false);
  assert.equal(byId('jp4a-test-console'), null);
  assert.equal(byId('jp4a-test-reopen'), null);
});

// ─── AE: production path keeps using the same shared action ─────────────────

test('HF3-HF4 AE: production Enter VR still routes through the shared action', async () => {
  resetAll();
  makeStoreReady();
  const scene = fakeScene();
  const entered = await toggleXrSession(scene);
  assert.equal(entered.ok, true);
  assert.equal(entered.action, 'entered');
  const exited = await toggleXrSession(scene);
  assert.equal(exited.action, 'exited');
  const none = await toggleXrSession(null);
  assert.equal(none.reason, 'STORE_SCENE_NOT_READY');

  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.match(main, /toggleXrSession\(storeScene\)/);
  // Production must not silently inherit the diagnostic fast path.
  assert.doesNotMatch(main, /allowUnverifiedSupport/);
  const entry = readFileSync(new URL('../src/xr/jp4a-console-entry.ts', import.meta.url), 'utf8');
  assert.match(entry, /allowUnverifiedSupport/);
});

// ─── AF–AM: previously corrected behaviour must stay corrected ──────────────

test('HF3-HF4 AF: HF3-HF2 startup ordering is preserved', () => {
  const runtime = readFileSync(new URL('../src/xr/runtime.ts', import.meta.url), 'utf8');
  assert.match(runtime, /makeXRCompatibleOwner: 'THREE_WEBXR_MANAGER'/);
  assert.match(runtime, /appPreflightMakeXRCompatible: false/);
  assert.doesNotMatch(runtime, /await\s+[^\n]*makeXRCompatible\(\)/);
});

test('HF3-HF4 AG/AH: connected-event handedness, no inputSources index association', () => {
  const runtime = readFileSync(new URL('../src/xr/runtime.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(runtime, /jp4aHand[\s\S]{0,80}inputSources\[i\]/);
  assert.doesNotMatch(runtime, /controllerObjects\[i\][\s\S]{0,40}inputSources\[i\]/);
  assert.match(runtime, /'connected'/);
  assert.match(runtime, /'disconnected'/);
});

test('HF3-HF4 AI/AJ/AK: source fidelity, TAP/HOLD and one production select survive', async () => {
  const { stepJp4aHandedTrigger, emptyJp4aTriggerPressState, emptyJp4aTriggerSourceState } =
    await import('../src/xr/jp4a-trigger-input.ts');
  // Ambiguous simultaneous press must fail closed rather than pick a hand.
  const both = stepJp4aHandedTrigger({
    press: emptyJp4aTriggerPressState(),
    source: emptyJp4aTriggerSourceState(),
    leftTrigger: true,
    rightTrigger: true,
    prevLeftTrigger: false,
    prevRightTrigger: false,
    leftConnected: true,
    rightConnected: true,
    leftHit: null,
    rightHit: null,
    now: 0,
    phase: 'BASELINE',
    hasLock: false,
  });
  assert.equal(both.source.ambiguous, true);
  assert.equal(both.source.source, null);
});

test('HF3-HF4 AL/AM: diagnostic 12m and production 14ft reach are unchanged', () => {
  assert.equal(JP4A_DIAGNOSTIC_LOCK_RANGE_M, 12);
  assert.equal(JP4A_PRODUCTION_INTERACT_RANGE_FT, 14);
});

// ─── timing separation and the no-240s rule ─────────────────────────────────

test('HF3-HF4 timings: support, store and entry are measured independently', () => {
  const timings = xrEntryTimingsFromStartup({
    requestSessionStart: 100,
    requestSessionEnd: 260,
    rendererSetSessionStart: 260,
    rendererSetSessionEnd: 420,
    firstWorldRenderCompletedAt: 900,
  });
  assert.equal(timings.requestSessionMs, 160);
  assert.equal(timings.setSessionMs, 160);
  assert.equal(timings.firstWorldRenderMs, 800);
  assert.deepEqual(xrEntryTimingsFromStartup(null), {
    requestSessionMs: null, setSessionMs: null, firstWorldRenderMs: null,
  });
});

test('HF3-HF4 timings: the support gate fails a pending or over-bound probe', () => {
  assert.equal(checkXrSupportTiming({ supportProbeMs: null, stillProbing: true, boundMs: 2000 }).reason, 'STILL_PENDING');
  assert.equal(checkXrSupportTiming({ supportProbeMs: null, stillProbing: false, boundMs: 2000 }).reason, 'NOT_MEASURED');
  assert.equal(checkXrSupportTiming({ supportProbeMs: 2400, stillProbing: false, boundMs: 2000 }).reason, 'OVER_BOUND');
  assert.equal(checkXrSupportTiming({ supportProbeMs: 12, stillProbing: false, boundMs: 2000 }).pass, true);
});

test('HF3-HF4 timings: no 240s deadline may gate XR support anywhere', () => {
  const harness = readFileSync(new URL('../tools/jp4a-round5b3-hf3-hf4-harness.mjs', import.meta.url), 'utf8');
  const supportBlock = harness.slice(0, harness.indexOf('STORE READINESS'));
  assert.doesNotMatch(supportBlock, /240_000|240000/);
  assert.match(harness, /SUPPORT_BOUND_MS/);
  const probe = readFileSync(new URL('../src/xr/xr-support-probe.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(probe, /240_000|240000|60_000|60000/);
});

test('HF3-HF4 timings: a JP-4A session carries the separated buckets', async () => {
  resetAll();
  makeStoreReady();
  setXrSupportForTests(true);
  const scene = fakeScene();
  bindJp4aConsoleStoreScene(() => scene);
  installJp4aTestConsole();
  actionButton('start')!.click();
  await invokeJp4aEnterVr();
  const timings = jp4aTestSnapshot()?.timings;
  assert.ok(timings, 'session must carry timings');
  assert.ok(timings!.enterActionMs != null && timings!.enterActionMs >= 0);
  assert.ok('supportProbeMs' in timings!);
  assert.ok('storeReadyMs' in timings!);
  assert.ok('requestSessionMs' in timings!);
  assert.ok('setSessionMs' in timings!);
  assert.ok('firstWorldRenderMs' in timings!);
});

test('HF3-HF4: the HF3-HF3 corrections are still in place', () => {
  const consoleSrc = readFileSync(new URL('../src/xr/jp4a-test-console.ts', import.meta.url), 'utf8');
  assert.match(consoleSrc, /void invokeJp4aEnterVr\(\)/);
  assert.doesNotMatch(consoleSrc, /getElementById\('xr-enter-btn'\)/);
  assert.doesNotMatch(consoleSrc, /getElementById\('btn-enter-vr'\)/);
  const fn = consoleSrc.match(/function enterVr\(\): void \{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.equal(fn.includes('await'), false);
  resetJp4aTest();
});
