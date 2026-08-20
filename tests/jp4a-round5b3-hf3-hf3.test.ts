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
  setWiredXrSupportedForTests,
  toggleXrSession,
  type XrEntryScene,
} from '../src/xr/boot.ts';
import {
  bindJp4aConsoleStoreScene,
  invokeJp4aEnterVr,
  jp4aConsoleEntrySnapshot,
  jp4aEnterVrClickStartsAuthoritativeAction,
  jp4aEnterVrUsesProxyClick,
  resetJp4aConsoleEntryForTests,
} from '../src/xr/jp4a-console-entry.ts';
import {
  installJp4aTestConsole,
  uninstallJp4aTestConsoleForTests,
} from '../src/xr/jp4a-test-console.ts';
import {
  jp4aTestSnapshot,
  markJp4aXrStarted,
  resetJp4aTest,
  startJp4aTest,
} from '../src/xr/jp4a-test-state.ts';
import { resetXrSupportProbeForTests } from '../src/xr/xr-support-probe.ts';

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
  style: { cssText: string; opacity: string } = { cssText: '', opacity: '' };
  private listeners = new Map<string, Array<() => void>>();

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

  tag: string;
  constructor(tag: string) { this.tag = tag; }
}

const body = new FakeEl('body');

function byId(id: string): FakeEl | null {
  if (body.id === id) return body;
  return body.descendants().find((el) => el.id === id) ?? null;
}

function installFakeDom() {
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
      search: '',
      href: 'http://127.0.0.1/xr-test/jp4a',
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
  setClipboard(async () => {});
}

function setClipboard(writeText: (text: string) => Promise<void>): void {
  const clipboard = { writeText };
  try {
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      writable: true,
      value: clipboard,
    });
  } catch {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { clipboard },
    });
  }
}

function actionButton(id: string): FakeEl | undefined {
  return body.querySelectorAll(`[data-jp4a-action="${id}"]`)[0];
}

function fakeScene(opts: {
  presenting?: boolean;
  enter?: () => Promise<void> | void;
  fail?: string;
  confirmXrStart?: boolean;
}): XrEntryScene {
  let presenting = !!opts.presenting;
  return {
    xrVideoGetter: null,
    probeXr: async () => true,
    get xr() { return { presenting }; },
    async enterXr() {
      if (opts.fail) throw new Error(opts.fail);
      await opts.enter?.();
      presenting = true;
      // XrRuntime.enter() records this after Three's setSession resolved.
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

function resetAll(): void {
  uninstallJp4aTestConsoleForTests();
  resetJp4aConsoleEntryForTests();
  resetXrSessionActionForTests();
  resetXrSupportProbeForTests();
  resetStoreVisualReady();
  installFakeDom();
  resetJp4aTest();
}

test('HF3-HF3 D: JP-4A enterVr does not proxy-click production Enter VR buttons', () => {
  const src = readFileSync(new URL('../src/xr/jp4a-test-console.ts', import.meta.url), 'utf8');
  assert.equal(jp4aEnterVrUsesProxyClick(src), false);
  assert.equal(jp4aEnterVrClickStartsAuthoritativeAction(src), true);
  assert.match(src, /void invokeJp4aEnterVr\(\)/);
  assert.doesNotMatch(src, /getElementById\('xr-enter-btn'\)/);
  assert.doesNotMatch(src, /getElementById\('btn-enter-vr'\)/);
});

test('HF3-HF3 activation boundary: click handler has no pre-entry await', () => {
  const src = readFileSync(new URL('../src/xr/jp4a-test-console.ts', import.meta.url), 'utf8');
  const fn = src.match(/function enterVr\(\): void \{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(fn, /void invokeJp4aEnterVr\(\)/);
  assert.equal(fn.includes('await'), false);
  const boot = readFileSync(new URL('../src/xr/boot.ts', import.meta.url), 'utf8');
  const enter = boot.indexOf('await scene.enterXr(enterOpts)');
  const ready = boot.indexOf('if (!isStoreVisualReady())');
  assert.ok(enter > 0 && ready > 0 && ready < enter);
});

test('HF3-HF3 A: console mounts before action registration', () => {
  resetAll();
  assert.equal(installJp4aTestConsole(), true);
  startJp4aTest();
  const enter = actionButton('enter-vr');
  const status = body.querySelectorAll('#jp4a-entry-status')[0];
  assert.ok(enter);
  assert.equal(enter!.disabled, true);
  assert.equal(jp4aConsoleEntrySnapshot().readiness, 'BOOTING');
  // HF3-HF4: app boot time is no longer labelled as XR support checking.
  assert.match(status?.textContent ?? '', /Preparing XR runtime/i);
  assert.doesNotMatch(status?.textContent ?? '', /Checking XR support/i);
});

test('HF3-HF3 B: action registration enables ENTER VR', () => {
  resetAll();
  makeStoreReady();
  const scene = fakeScene({});
  bindJp4aConsoleStoreScene(() => scene);
  setWiredXrSupportedForTests(true);
  installJp4aTestConsole();
  startJp4aTest();
  const snap = jp4aConsoleEntrySnapshot();
  assert.equal(snap.readiness, 'READY_TO_ENTER_VR');
  assert.equal(snap.enabled, true);
  assert.equal(actionButton('enter-vr')?.disabled, false);
  assert.equal(actionButton('enter-vr')?.textContent, 'ENTER VR');
  assert.equal(body.querySelectorAll('#jp4a-entry-status')[0]?.textContent, 'ENTER VR');
});

test('HF3-HF3 C/H: real ENTER VR button calls authoritative action once', async () => {
  resetAll();
  makeStoreReady();
  let enters = 0;
  const scene = fakeScene({ enter: () => { enters += 1; } });
  bindJp4aConsoleStoreScene(() => scene);
  setWiredXrSupportedForTests(true);
  installJp4aTestConsole();
  startJp4aTest();
  actionButton('enter-vr')!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(enters, 1);
  assert.equal(jp4aConsoleEntrySnapshot().enterCalls, 1);
  assert.equal(jp4aConsoleEntrySnapshot().readiness, 'PRESENTING');
  assert.equal(body.querySelectorAll('#jp4a-entry-status')[0]?.textContent, 'VR ACTIVE');
});

test('HF3-HF3 E: storeScene not ready is not a silent no-op', async () => {
  resetAll();
  makeStoreReady();
  bindJp4aConsoleStoreScene(() => null);
  setWiredXrSupportedForTests(true);
  installJp4aTestConsole();
  startJp4aTest();
  assert.equal(actionButton('enter-vr')?.disabled, true);
  assert.match(body.querySelectorAll('#jp4a-entry-status')[0]?.textContent ?? '', /WAITING FOR STORE/);
  const result = await invokeJp4aEnterVr();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'STORE_SCENE_NOT_READY');
});

test('HF3-HF3 F: store loading does not request a session', async () => {
  resetAll();
  resetStoreVisualReady();
  beginStoreVisibleLoading({ posterIds: ['pending'] });
  assert.equal(isStoreVisualReady(), false);
  let enters = 0;
  const scene = fakeScene({ enter: () => { enters += 1; } });
  bindJp4aConsoleStoreScene(() => scene);
  setWiredXrSupportedForTests(true);
  installJp4aTestConsole();
  startJp4aTest();
  assert.equal(actionButton('enter-vr')?.disabled, true);
  assert.match(body.querySelectorAll('#jp4a-entry-status')[0]?.textContent ?? '', /still loading/i);
  const result = await enterXrSession(scene);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'STORE_LOADING');
  assert.equal(enters, 0);
});

test('HF3-HF3 G: XR unsupported disables ENTER VR and does not requestSession', async () => {
  resetAll();
  makeStoreReady();
  let enters = 0;
  const scene = fakeScene({ enter: () => { enters += 1; } });
  bindJp4aConsoleStoreScene(() => scene);
  setWiredXrSupportedForTests(false);
  installJp4aTestConsole();
  startJp4aTest();
  assert.equal(actionButton('enter-vr')?.disabled, true);
  assert.match(body.querySelectorAll('#jp4a-entry-status')[0]?.textContent ?? '', /unavailable/i);
  const result = await invokeJp4aEnterVr();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'XR_UNSUPPORTED');
  assert.equal(enters, 0);
});

test('HF3-HF3 I: entry failure is visible and retryable', async () => {
  resetAll();
  makeStoreReady();
  const scene = fakeScene({ fail: 'requestSession failed' });
  bindJp4aConsoleStoreScene(() => scene);
  setWiredXrSupportedForTests(true);
  installJp4aTestConsole();
  startJp4aTest();
  const result = await invokeJp4aEnterVr();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'ENTRY_FAILED');
  const status = body.querySelectorAll('#jp4a-entry-status')[0];
  assert.match(status?.textContent ?? '', /VR ENTRY FAILED/);
  assert.equal(status?.dataset.reason, 'ENTRY_FAILED');
  assert.equal(jp4aConsoleEntrySnapshot().enabled, true);
});

test('HF3-HF3 J: double tap does not start two sessions', async () => {
  resetAll();
  makeStoreReady();
  let enters = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const scene = fakeScene({ enter: () => gate.then(() => { enters += 1; }) });
  bindJp4aConsoleStoreScene(() => scene);
  setWiredXrSupportedForTests(true);
  installJp4aTestConsole();
  startJp4aTest();
  const first = invokeJp4aEnterVr();
  const second = invokeJp4aEnterVr();
  const secondResult = await second;
  assert.equal(secondResult.reason, 'ENTERING');
  release();
  await first;
  assert.equal(enters, 1);
  assert.equal(jp4aConsoleEntrySnapshot().enterCalls, 1);
});

test('HF3-HF3 K: CONTINUE TO STORE hides console and reopen restores it', () => {
  resetAll();
  makeStoreReady();
  bindJp4aConsoleStoreScene(() => fakeScene({}));
  setWiredXrSupportedForTests(true);
  installJp4aTestConsole();
  startJp4aTest();
  const sessionId = jp4aTestSnapshot()?.sessionId;
  actionButton('continue')!.click();
  const consoleEl = byId('jp4a-test-console');
  const reopen = byId('jp4a-test-reopen');
  assert.equal(consoleEl?.hidden, true);
  assert.equal(reopen?.hidden, false);
  reopen!.click();
  assert.equal(consoleEl?.hidden, false);
  assert.equal(reopen?.hidden, true);
  assert.equal(jp4aTestSnapshot()?.sessionId, sessionId);
  assert.equal(jp4aTestSnapshot()?.active, true);
});

test('HF3-HF3 L: COPY RESULT success and clipboard fallback', async () => {
  resetAll();
  installJp4aTestConsole();
  startJp4aTest();
  actionButton('copy-result')!.click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(actionButton('copy-result')?.textContent, 'COPIED RESULT');

  setClipboard(async () => { throw new Error('denied'); });
  actionButton('copy-result')!.click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(actionButton('copy-result')?.textContent, 'COPY FALLBACK READY');
  const area = byId('jp4a-copy-fallback');
  assert.equal(area?.hidden, false);
  assert.match(area?.value ?? '', /JP-4A Round 5B\.3/);
  assert.doesNotMatch(area?.value ?? '', /SECRET_TITLE/);
});

test('HF3-HF3 M: COPY JSON success and fallback', async () => {
  resetAll();
  installJp4aTestConsole();
  startJp4aTest();
  actionButton('copy-json')!.click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(actionButton('copy-json')?.textContent, 'COPIED JSON');
  setClipboard(async () => { throw new Error('denied'); });
  actionButton('copy-json')!.click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(actionButton('copy-json')?.textContent, 'COPY FALLBACK READY');
  assert.equal(byId('jp4a-copy-fallback')?.hidden, false);
});

test('HF3-HF3 N: actual START button starts one session', () => {
  resetAll();
  installJp4aTestConsole();
  assert.equal(actionButton('start')?.textContent, 'START JP-4A TEST');
  actionButton('start')!.click();
  actionButton('start')?.click();
  assert.equal(jp4aTestSnapshot()?.active, true);
  assert.ok(jp4aTestSnapshot()?.sessionId);
  // HF3-HF4: START keeps the operator on the console; no reopen hunt.
  assert.equal(byId('jp4a-test-console')?.hidden, false);
  assert.equal(byId('jp4a-test-reopen')?.hidden, true);
});

test('HF3-HF3 O/P: RESET then second START+ENTER keeps a single callback', async () => {
  resetAll();
  makeStoreReady();
  let enters = 0;
  const scene = fakeScene({ enter: () => { enters += 1; } });
  bindJp4aConsoleStoreScene(() => scene);
  setWiredXrSupportedForTests(true);
  installJp4aTestConsole();
  actionButton('start')!.click();
  actionButton('enter-vr')!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await scene.exitXr();
  byId('jp4a-test-reopen')!.click();
  actionButton('reset')!.click();
  assert.equal(jp4aTestSnapshot()?.active, false);
  actionButton('start')!.click();
  actionButton('enter-vr')!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(enters, 2);
  assert.equal(jp4aConsoleEntrySnapshot().enterCalls, 2);
});

test('HF3-HF3 Q: normal URL does not install the console', () => {
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

test('HF3-HF3 production toggle still uses the same action implementation', async () => {
  resetAll();
  makeStoreReady();
  const scene = fakeScene({});
  const entered = await toggleXrSession(scene);
  assert.equal(entered.ok, true);
  assert.equal(entered.action, 'entered');
  const nullScene = await toggleXrSession(null);
  assert.equal(nullScene.ok, false);
  assert.equal(nullScene.reason, 'STORE_SCENE_NOT_READY');
});

test('HF3-HF3 ranges and no inputSources index fallback remain', () => {
  assert.equal(JP4A_PRODUCTION_INTERACT_RANGE_FT, 14);
  assert.equal(JP4A_DIAGNOSTIC_LOCK_RANGE_M, 12);
  const runtime = readFileSync(new URL('../src/xr/runtime.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(runtime, /jp4aHand[\s\S]{0,80}inputSources\[i\]/);
  resetJp4aTest();
});
