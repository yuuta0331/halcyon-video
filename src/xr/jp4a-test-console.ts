// Short-route DOM console for a single Quest JP-4A diagnostic session.
// Never mounts outside /xr-test/jp4a or ?xrTest=jp4a.

import { enableFpsMeter } from '../fps-meter.ts';
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

function button(label: string, action: () => void, primary = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
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

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (!output) return false;
    output.value = text;
    output.hidden = false;
    output.focus();
    output.select();
    try { return document.execCommand('copy'); } catch { return false; }
  }
}

function updateQueryForTest(): void {
  const u = new URL(location.href);
  u.searchParams.set('fps', '1');
  history.replaceState(history.state, '', `${u.pathname}${u.search}${u.hash}`);
}

function hideConsole(): void {
  if (root) root.hidden = true;
  if (compact) compact.hidden = false;
}

function showConsole(): void {
  if (root) root.hidden = false;
  if (compact) compact.hidden = true;
  render(jp4aTestSnapshot());
}

function start(): void {
  updateQueryForTest();
  enableFpsMeter(true);
  startJp4aTest();
  hideConsole();
  const enter = document.getElementById('xr-enter-btn') as HTMLButtonElement | null;
  if (enter && !enter.hidden) enter.focus();
}

function reset(): void {
  resetJp4aTest();
  render(jp4aTestSnapshot());
}

function enterVr(): void {
  const enter = document.getElementById('xr-enter-btn') as HTMLButtonElement | null;
  const menuEnter = document.getElementById('btn-enter-vr') as HTMLButtonElement | null;
  if (enter && !enter.hidden) enter.click();
  else if (menuEnter && !menuEnter.hidden) menuEnter.click();
}

function render(session: Jp4aSession | null): void {
  if (!card) return;
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
    'Round 5B.3 HF2',
    `Source HEAD: ${source}`,
    `CI checkout: ${tested === source ? 'same as source' : tested}`,
    `Build: ${source}`,
    `Session: ${session?.sessionId ?? 'not started'}`,
  ].join('\n');
  const help = document.createElement('p');
  help.style.cssText = 'max-width:720px;color:#d8e5e2;font:18px/1.5 system-ui,sans-serif';
  help.textContent = session?.completedAt
    ? '結果は端末内に保存されています。そのまま COPY RESULT を ChatGPT へ貼り付けてください。RESET TEST でページを再読み込みせずに次の診断を開始できます。'
    : 'START で FPS・LIVE poster 診断・自動保存を有効化します。Trigger TAP は LOCK または BLACK/CLEAN。HOLD は判定を変えず APPROACH と FOCUS です。Menu は通常どおりです。';
  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;margin-top:18px';
  if (!session?.active && !session?.completedAt) actions.append(button('START JP-4A TEST', start, true));
  if (session?.active) {
    actions.append(button('ENTER VR', enterVr, true));
    actions.append(button('CONTINUE TO STORE', hideConsole));
  }
  if (session) {
    actions.append(button('COPY RESULT', () => { void copyText(formatJp4aResult()); }, true));
    actions.append(button('COPY JSON', () => { void copyText(jp4aResultJson()); }));
    actions.append(button('RESET TEST', reset));
  }
  output = document.createElement('textarea');
  output.hidden = true;
  output.readOnly = true;
  output.setAttribute('aria-label', 'JP-4A copy fallback');
  output.style.cssText = 'width:100%;height:220px;margin-top:18px;background:#03070a;color:#f4fffc;font:14px monospace';
  card.append(h, meta, help, actions, output);
}

export function installJp4aTestConsole(): boolean {
  if (!jp4aTestRequested() || typeof document === 'undefined') return false;
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
  compact.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:9999;padding:12px 16px;border:2px solid #9fe8d8;background:#071018;color:#f4fffc;font:bold 15px monospace';
  compact.addEventListener('click', showConsole);
  document.body.append(root, compact);
  onJp4aTestChange((session) => {
    render(session);
    if (session?.completedAt) showConsole();
  });
  render(restored);
  return true;
}
