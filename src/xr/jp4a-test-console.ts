// Short-route DOM console for a single Quest JP-4A diagnostic session.
// Never mounts outside /xr-test/jp4a or ?xrTest=jp4a.
// ENTER VR calls the registered application action; it does not click
// xr-enter-btn / btn-enter-vr.
//
// This is a full-screen opaque overlay, so on desktop it would sit on top of
// the very emulated XR view the operator is trying to inspect. It therefore
// hides itself on CONFIRMED entry only, and comes back on exit/failure.

import { enableFpsMeter } from '../fps-meter.ts';
import { onStoreVisualReadyChange } from '../store-visual-ready.ts';
import {
  clearJp4aConsoleEntryFailure,
  invokeJp4aEnterVr,
  jp4aConsoleEntrySnapshot,
  notifyJp4aConsoleEntry,
  onJp4aConsoleEntryChange,
} from './jp4a-console-entry.ts';
import {
  formatJp4aResult,
  installJp4aTestApis,
  jp4aBuildLabels,
  jp4aResultJson,
  jp4aTestRequested,
  jp4aTestSnapshot,
  onJp4aTestChange,
  resetJp4aTest,
  restoreJp4aTest,
  startJp4aTest,
  type Jp4aSession,
} from './jp4a-test-state.ts';

let root: HTMLDivElement | null = null;
let card: HTMLDivElement | null = null;
let output: HTMLTextAreaElement | null = null;
let compact: HTMLButtonElement | null = null;
let starting = false;
let autoHidden = false;
let lastReadiness: string | null = null;
let unsubTest: (() => void) | null = null;
let unsubEntry: (() => void) | null = null;
let unsubReady: (() => void) | null = null;

type CopyKind = 'result' | 'json';
type CopyState = 'idle' | 'copied' | 'fallback' | 'failed';
let copyUi: { kind: CopyKind; state: CopyState } = { kind: 'result', state: 'idle' };

function button(label: string, action: () => void, primary = false, opts?: {
  actionId?: string;
  disabled?: boolean;
}): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  if (opts?.actionId) b.dataset.jp4aAction = opts.actionId;
  b.disabled = !!opts?.disabled;
  b.style.cssText = [
    'min-height:64px',
    'padding:12px 22px',
    'border:2px solid #9fe8d8',
    'border-radius:10px',
    `background:${primary ? '#9fe8d8' : '#111a22'}`,
    `color:${primary ? '#041016' : '#f4fffc'}`,
    'font:bold 20px ui-monospace,Menlo,Consolas,monospace',
    'cursor:pointer',
  ].join(';');
  b.addEventListener('click', action);
  return b;
}

function copyLabel(kind: CopyKind, state: CopyState): string {
  if (kind === 'result') {
    if (state === 'copied') return 'COPIED RESULT';
    if (state === 'fallback') return 'COPY FALLBACK READY';
    if (state === 'failed') return 'COPY FAILED';
    return 'COPY RESULT';
  }
  if (state === 'copied') return 'COPIED JSON';
  if (state === 'fallback') return 'COPY FALLBACK READY';
  if (state === 'failed') return 'COPY FAILED';
  return 'COPY JSON';
}

async function copyText(text: string): Promise<CopyState> {
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    if (!output) return 'failed';
    output.value = text;
    output.hidden = false;
    output.focus();
    output.select();
    return 'fallback';
  }
}

function updateQueryForTest(): void {
  const u = new URL(location.href);
  u.searchParams.set('fps', '1');
  history.replaceState(history.state, '', `${u.pathname}${u.search}${u.hash}`);
}

// The root carries an inline `display:flex`, which beats the UA stylesheet's
// `[hidden] { display: none }`. Toggling `hidden` alone left a full-screen
// opaque overlay sitting on top of the XR canvas, so display is toggled too.
function hideConsole(): void {
  if (root) {
    root.hidden = true;
    root.style.display = 'none';
  }
  if (compact) {
    compact.hidden = false;
    compact.style.display = '';
  }
}

function showConsole(): void {
  if (root) {
    root.hidden = false;
    root.style.display = 'flex';
  }
  if (compact) {
    compact.hidden = true;
    compact.style.display = 'none';
  }
  render(jp4aTestSnapshot());
}

function start(): void {
  const session = jp4aTestSnapshot();
  if (session?.active || starting) return;
  starting = true;
  updateQueryForTest();
  enableFpsMeter(true);
  startJp4aTest();
  starting = false;
  // Stay on the console: readiness updates live and ENTER VR becomes usable
  // right here. Hunting for the reopen button was pure wasted operator time.
  showConsole();
}

function reset(): void {
  starting = false;
  autoHidden = false;
  lastReadiness = null;
  copyUi = { kind: 'result', state: 'idle' };
  clearJp4aConsoleEntryFailure();
  resetJp4aTest();
  render(jp4aTestSnapshot());
}

function enterVr(): void {
  void invokeJp4aEnterVr();
}

/**
 * Hide the overlay only once the diagnostic has CONFIRMED XR startup, so the
 * emulated/immersive canvas is unobstructed. A failed or unconfirmed entry
 * keeps the console (and its failure reason) on screen.
 */
function syncConsoleVisibilityForEntry(): void {
  const readiness = jp4aConsoleEntrySnapshot().readiness;
  if (readiness === lastReadiness) return;
  const wasPresenting = lastReadiness === 'PRESENTING';
  lastReadiness = readiness;
  if (readiness === 'PRESENTING') {
    if (root && !root.hidden) {
      autoHidden = true;
      hideConsole();
    }
    return;
  }
  if (wasPresenting && autoHidden) {
    autoHidden = false;
    showConsole();
  }
}

function render(session: Jp4aSession | null): void {
  if (!card) return;
  const entry = jp4aConsoleEntrySnapshot();
  card.replaceChildren();
  const h = document.createElement('h1');
  h.textContent = session?.completedAt ? 'TEST COMPLETE' : 'JP-4A TEST';
  h.style.cssText = 'margin:0 0 8px;font:900 42px ui-monospace,Menlo,Consolas,monospace;color:#f4fffc';
  const labels = jp4aBuildLabels();
  const source = session?.sourceHead ?? session?.build ?? labels.sourceHead;
  const tested = session?.testedSha ?? labels.testedSha;
  const meta = document.createElement('div');
  meta.style.cssText = 'white-space:pre-wrap;color:#9fe8d8;font:16px/1.5 ui-monospace,Menlo,Consolas,monospace';
  meta.textContent = [
    'Round 5B.3 HF3',
    `Source HEAD: ${source}`,
    `CI checkout: ${tested === source ? 'same as source' : tested}`,
    `Build: ${source}`,
    `Session: ${session?.sessionId ?? 'not started'}`,
  ].join('\n');
  const help = document.createElement('p');
  help.style.cssText = 'max-width:720px;color:#d8e5e2;font:18px/1.5 system-ui,sans-serif';
  help.textContent = session?.completedAt
    ? '結果は端末内に保存されています。そのまま COPY RESULT を ChatGPT へ貼り付けてください。RESET TEST でページを再読み込みせずに次の診断を開始できます。'
    : 'START で FPS・LIVE poster 診断・自動保存を有効化します。この画面のまま ENTER VR が有効になるのを待ってください。VR 開始が確認されるとコンソールは自動的に隠れます。ポスターを指しているコントローラの Trigger TAP は LOCK または BLACK/CLEAN。HOLD は判定を変えず APPROACH と FOCUS です。Menu は通常どおりです。';
  const status = document.createElement('div');
  status.id = 'jp4a-entry-status';
  status.dataset.readiness = entry.readiness;
  status.dataset.reason = entry.lastResult?.reason ?? '';
  status.dataset.enterCalls = String(entry.enterCalls);
  status.dataset.support = entry.supportState;
  status.dataset.supportMs = entry.supportProbeMs == null ? '' : String(entry.supportProbeMs);
  status.dataset.xrConfirmed = entry.xrConfirmed ? '1' : '0';
  status.style.cssText = 'margin-top:12px;color:#ffe08a;font:bold 22px ui-monospace,Menlo,Consolas,monospace';
  status.textContent = session?.active ? entry.status : '';
  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;margin-top:18px';
  if (!session?.active && !session?.completedAt) {
    actions.append(button('START JP-4A TEST', start, true, { actionId: 'start' }));
  }
  if (session?.active) {
    actions.append(button(entry.label, enterVr, true, {
      actionId: 'enter-vr',
      disabled: !entry.enabled,
    }));
    actions.append(button('CONTINUE TO STORE', hideConsole, false, { actionId: 'continue' }));
  }
  if (session) {
    actions.append(button(
      copyLabel('result', copyUi.kind === 'result' ? copyUi.state : 'idle'),
      () => { void runCopy('result'); },
      true,
      { actionId: 'copy-result' },
    ));
    actions.append(button(
      copyLabel('json', copyUi.kind === 'json' ? copyUi.state : 'idle'),
      () => { void runCopy('json'); },
      false,
      { actionId: 'copy-json' },
    ));
    actions.append(button('RESET TEST', reset, false, { actionId: 'reset' }));
  }
  output = document.createElement('textarea');
  output.id = 'jp4a-copy-fallback';
  output.hidden = copyUi.state !== 'fallback';
  output.readOnly = true;
  output.setAttribute('aria-label', 'JP-4A copy fallback');
  output.style.cssText = 'width:100%;height:220px;margin-top:18px;background:#03070a;color:#f4fffc;font:14px monospace';
  if (copyUi.state === 'fallback') {
    output.value = copyUi.kind === 'json' ? jp4aResultJson() : formatJp4aResult();
  }
  card.append(h, meta, help, status, actions, output);
}

async function runCopy(kind: CopyKind): Promise<void> {
  const text = kind === 'json' ? jp4aResultJson() : formatJp4aResult();
  const state = await copyText(text);
  copyUi = { kind, state };
  render(jp4aTestSnapshot());
}

export function installJp4aTestConsole(): boolean {
  if (!jp4aTestRequested() || typeof document === 'undefined') return false;
  if (root) return true;
  installJp4aTestApis();
  const restored = restoreJp4aTest();
  root = document.createElement('div');
  root.id = 'jp4a-test-console';
  root.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:10000',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'padding:24px',
    'background:rgba(0,4,8,.96)',
  ].join(';');
  card = document.createElement('div');
  card.style.cssText = 'width:min(860px,100%);padding:28px;border:3px solid #9fe8d8;border-radius:14px;background:#071018;box-shadow:0 20px 80px #000';
  root.append(card);
  compact = document.createElement('button');
  compact.id = 'jp4a-test-reopen';
  compact.type = 'button';
  compact.textContent = 'JP-4A TEST';
  compact.hidden = true;
  compact.dataset.jp4aAction = 'reopen';
  compact.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:9999;padding:12px 16px;border:2px solid #9fe8d8;background:#071018;color:#f4fffc;font:bold 15px monospace';
  compact.addEventListener('click', showConsole);
  document.body.append(root, compact);
  unsubTest = onJp4aTestChange((session) => {
    render(session);
    syncConsoleVisibilityForEntry();
    if (session?.completedAt) {
      autoHidden = false;
      showConsole();
    }
  });
  unsubEntry = onJp4aConsoleEntryChange(() => {
    if (root && !root.hidden) render(jp4aTestSnapshot());
    syncConsoleVisibilityForEntry();
  });
  unsubReady = onStoreVisualReadyChange(() => notifyJp4aConsoleEntry());
  render(restored);
  return true;
}

export function uninstallJp4aTestConsoleForTests(): void {
  unsubTest?.();
  unsubEntry?.();
  unsubReady?.();
  unsubTest = null;
  unsubEntry = null;
  unsubReady = null;
  root?.remove();
  compact?.remove();
  root = null;
  card = null;
  output = null;
  compact = null;
  starting = false;
  autoHidden = false;
  lastReadiness = null;
  copyUi = { kind: 'result', state: 'idle' };
}
