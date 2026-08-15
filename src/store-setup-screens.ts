// NEW STORE SETUP (#41) — the pure state machine behind the opening-day
// counter terminal. Same split as the media-date screen (#42): this module is
// state + reducers + line renderers only (no DOM, no network, no scene), so
// it unit-tests under node and the harness can render any screen verbatim;
// store-setup-flow.ts owns the wiring (camera dock, Jellyfin calls, typed-key
// capture, persistence).
//
// Renderer contract: Latin lines still budget 40 columns (the English CRT
// contract). CJK chrome is translated here and width-fitted again when
// drawTerminal paints. Addresses clip from the LEFT — the end of a URL is
// the part being typed.

import { t, tfill, type MessageKey } from './i18n/index.ts';

export type SetupKey = 'up' | 'down' | 'left' | 'right' | 'ok' | 'back';

export type SetupAction =
  | 'connect'       // home: dial the typed address
  | 'demo'          // stock the demo store instead
  | 'retry'         // notice: retry the saved server now
  | 'change-server' // notice: drop the saved server, back to a blank home
  | 'open-store'    // libraries: choices made, sync + stock
  | 'sign-in'       // manual-auth: authenticate the typed name/password
  | 'back-home';    // manual-auth: abandon sign-in

/** The DISTRIBUTOR row's choices, in registry order. Display names here; the
 *  provider kinds they map to are SETUP_PROVIDER_KINDS below (the terminal is
 *  40 columns of upper-case, the registry is lower-case ids — keeping the two
 *  lists adjacent is what stops them drifting apart). */
export const SETUP_PROVIDERS = ['JELLYFIN', 'PLEX'] as const;
export const SETUP_PROVIDER_KINDS = ['jellyfin', 'plex'] as const;
/** Whether CONNECT needs an address typed first — false for a backend whose
 *  account tells us where its servers are (see the guard in setupScreenKey). */
export const PROVIDER_NEEDS_ADDRESS = [true, false] as const;

export interface SetupLibraryRow {
  id: string;
  name: string;
  carried: boolean;
}

export type SetupHomeScreen = { kind: 'home'; row: number; provider: number; address: string; error?: string };

export type SetupScreen =
  | SetupHomeScreen
  | { kind: 'dialing'; address: string; step: string }
  | { kind: 'members'; count: number }
  | { kind: 'manual-auth'; row: number; username: string; password: string; error?: string }
  // Plex authorizes through plex.tv rather than against the server, so the
  // terminal reads out a code to type somewhere else — the closest thing this
  // store has to phoning the distributor and quoting an account number.
  | { kind: 'plex-link'; code: string; step: string; error?: string }
  | { kind: 'libraries'; rows: SetupLibraryRow[]; row: number; error?: string }
  | { kind: 'sync'; stage: string; pages: number }
  | { kind: 'arriving' }
  | { kind: 'notice'; address: string; detail: string; row: number };

export function initialHomeScreen(savedAddress?: string | null): SetupHomeScreen {
  return { kind: 'home', row: 1, provider: 0, address: savedAddress || 'http://' };
}

// Home rows: 0 DISTRIBUTOR / 1 SERVER ADDRESS / 2 CONNECT / 3 TRY A DEMO STORE
const HOME_ROWS = 4;
// Manual-auth rows: 0 MEMBER NAME / 1 PASSWORD / 2 SIGN IN / 3 BACK
const AUTH_ROWS = 4;
// Notice rows: 0 RETRY NOW / 1 CHANGE SERVER / 2 TRY A DEMO STORE
const NOTICE_ROWS = 3;
// The libraries screen windows its checkbox rows into this many visible lines.
const LIB_WINDOW = 6;

/** A typed printable character lands in whichever field the cursor is on. */
export function setupScreenChar(s: SetupScreen, ch: string): SetupScreen {
  if (ch.length !== 1) return s;
  if (s.kind === 'home' && s.row === 1 && ch !== ' ') {
    return { ...s, address: s.address + ch, error: undefined };
  }
  if (s.kind === 'manual-auth' && s.row === 0) return { ...s, username: s.username + ch, error: undefined };
  if (s.kind === 'manual-auth' && s.row === 1) return { ...s, password: s.password + ch, error: undefined };
  return s;
}

export function setupScreenBackspace(s: SetupScreen): SetupScreen {
  if (s.kind === 'home' && s.row === 1) return { ...s, address: s.address.slice(0, -1), error: undefined };
  if (s.kind === 'manual-auth' && s.row === 0) return { ...s, username: s.username.slice(0, -1), error: undefined };
  if (s.kind === 'manual-auth' && s.row === 1) return { ...s, password: s.password.slice(0, -1), error: undefined };
  return s;
}

export function setupScreenKey(s: SetupScreen, key: SetupKey): { state: SetupScreen; action?: SetupAction } {
  switch (s.kind) {
    case 'home': {
      if (key === 'up' || key === 'down') {
        const row = (s.row + (key === 'up' ? -1 : 1) + HOME_ROWS) % HOME_ROWS;
        return { state: { ...s, row } };
      }
      if (key === 'ok') {
        if (s.row === 0 || s.row === 1) return { state: { ...s, row: s.row + 1 } }; // BIOS-style: OK advances
        if (s.row === 2) {
          const addr = s.address.trim();
          const blank = !addr || addr === 'http://' || addr === 'https://';
          // A blank address is fatal for a distributor you sign into directly,
          // and fine for one that hands you a server list after you sign in to
          // the ACCOUNT — Plex discovers its own address, so demanding one up
          // front would ask for something the person may genuinely not know.
          if (blank && PROVIDER_NEEDS_ADDRESS[s.provider] !== false) {
            return { state: { ...s, row: 1, error: 'TYPE THE SERVER ADDRESS FIRST.' } };
          }
          return { state: s, action: 'connect' };
        }
        return { state: s, action: 'demo' };
      }
      // left/right on the DISTRIBUTOR row cycle providers (one today).
      if ((key === 'left' || key === 'right') && s.row === 0) {
        const n = SETUP_PROVIDERS.length;
        return { state: { ...s, provider: (s.provider + (key === 'left' ? -1 : 1) + n) % n } };
      }
      return { state: s };
    }
    case 'dialing':
    case 'members':
    case 'sync':
    case 'arriving':
    case 'plex-link':
      return { state: s }; // in-flight screens take no menu input
    case 'manual-auth': {
      if (key === 'up' || key === 'down') {
        const row = (s.row + (key === 'up' ? -1 : 1) + AUTH_ROWS) % AUTH_ROWS;
        return { state: { ...s, row } };
      }
      if (key === 'ok') {
        if (s.row === 0 || s.row === 1) return { state: { ...s, row: s.row + 1 } };
        if (s.row === 2) {
          if (!s.username.trim()) return { state: { ...s, row: 0, error: 'TYPE A MEMBER NAME FIRST.' } };
          return { state: s, action: 'sign-in' };
        }
        return { state: s, action: 'back-home' };
      }
      if (key === 'back') return { state: s, action: 'back-home' };
      return { state: s };
    }
    case 'libraries': {
      const total = s.rows.length + 1; // + OPEN THE STORE
      if (key === 'up' || key === 'down') {
        const row = (s.row + (key === 'up' ? -1 : 1) + total) % total;
        return { state: { ...s, row } };
      }
      if (key === 'ok') {
        if (s.row < s.rows.length) {
          const rows = s.rows.map((r, i) => (i === s.row ? { ...r, carried: !r.carried } : r));
          return { state: { ...s, rows, error: undefined } };
        }
        if (!s.rows.some((r) => r.carried)) {
          return { state: { ...s, error: 'CARRY AT LEAST ONE LIBRARY.' } };
        }
        return { state: s, action: 'open-store' };
      }
      return { state: s };
    }
    case 'notice': {
      if (key === 'up' || key === 'down') {
        const row = (s.row + (key === 'up' ? -1 : 1) + NOTICE_ROWS) % NOTICE_ROWS;
        return { state: { ...s, row } };
      }
      if (key === 'ok') {
        if (s.row === 0) return { state: s, action: 'retry' };
        if (s.row === 1) return { state: s, action: 'change-server' };
        return { state: s, action: 'demo' };
      }
      return { state: s };
    }
  }
}

// ─── Renderers ────────────────────────────────────────────────────────────────

/** Clip from the LEFT so the character being typed stays on screen. */
function clipTail(text: string, max: number): string {
  return text.length <= max ? text : '…' + text.slice(-(max - 1));
}

function clipCols(text: string, max = 40): string {
  return Array.from(text).slice(0, max).join('');
}

function sel(active: boolean, label: string): string {
  return `${active ? '>' : ' '} ${label}`;
}

const SETUP_STATUS: Record<string, MessageKey> = {
  'LOOKING UP MEMBERSHIP CARDS...': 'setup.step.cards',
  'WAITING FOR AUTHORIZATION...': 'setup.step.authWait',
  'LOOKING UP YOUR SERVERS...': 'setup.step.servers',
  'PULLING THE CATALOG LIST...': 'setup.step.catalog',
  'CONTACTING DISTRIBUTOR...': 'setup.step.contact',
  'RETRYING NOW...': 'setup.step.retry',
  'TYPE THE SERVER ADDRESS FIRST.': 'setup.err.typeAddress',
  'TYPE A MEMBER NAME FIRST.': 'setup.err.typeName',
  'CARRY AT LEAST ONE LIBRARY.': 'setup.err.oneLibrary',
  'NO CARD LIST HERE. SIGN IN BY NAME.': 'setup.err.noCards',
  'NO ANSWER. CHECK THE ADDRESS + CORS.': 'setup.err.noAnswer',
  'THAT CODE EXPIRED. TRY AGAIN.': 'setup.err.codeExpired',
  'NO SERVERS ON THAT ACCOUNT. TYPE ONE.': 'setup.err.noServers',
  'THE DISTRIBUTOR LISTS NO LIBRARIES.': 'setup.err.noLibraries',
  'COULD NOT LIST LIBRARIES. RETRY.': 'setup.err.listFailed',
  'CATALOG SYNC FAILED. TRY AGAIN.': 'setup.err.syncFailed',
  'SIGN-IN REFUSED. CHECK NAME + PASSWORD.': 'setup.err.signInRefused',
  'SIGN-IN FAILED. SERVER UNREACHABLE.': 'setup.err.signInFailed',
};

function setupStatus(raw: string): string {
  const known = SETUP_STATUS[raw];
  if (known) return t(known);
  if (raw.startsWith('SIGNING IN ') && raw.endsWith('...')) {
    return tfill('setup.step.signIn', { name: raw.slice(11, -3) });
  }
  return raw;
}

export function setupScreenLines(s: SetupScreen): { lines: string[]; cursorLine: number } {
  switch (s.kind) {
    case 'home': {
      const provider = SETUP_PROVIDERS[s.provider];
      // Short labels on purpose: the value column gets 25 of the 40 chars, so
      // a typical http://<lan-ip>:8096 shows whole instead of clipped.
      const addr = clipTail(s.address, s.row === 1 ? 24 : 25) + (s.row === 1 ? '_' : '');
      const lines = [
        t('setup.title'),
        '',
        t('setup.bare1'),
        t('setup.bare2'),
        '',
        sel(s.row === 0, `${t('setup.distributor')}  ${provider}`),
        sel(s.row === 1, `${t('setup.address')}      ${addr}`),
        sel(s.row === 2, t('setup.connect')),
        sel(s.row === 3, t('setup.demo')),
      ].map((line) => clipCols(line));
      if (s.error) lines.push(clipCols(setupStatus(s.error)));
      return { lines, cursorLine: 5 + s.row };
    }
    case 'plex-link': {
      const lines = [
        t('setup.title'),
        '',
        t('setup.plex.want'),
        t('setup.plex.code'),
        t('setup.plex.quote'),
        '',
        `      ${s.code.toUpperCase()}`,
        '',
        setupStatus(s.step),
      ].map((line) => clipCols(line));
      if (s.error) lines.push(clipCols(setupStatus(s.error)));
      return { lines, cursorLine: 6 };
    }
    case 'dialing':
      return {
        lines: [
          clipCols(t('setup.title')),
          '',
          clipCols(t('setup.dialing')),
          clipTail(s.address, 40),
          '',
          clipCols(setupStatus(s.step)),
        ],
        cursorLine: 5,
      };
    case 'members':
      return {
        lines: [
          clipCols(t('setup.members.title')),
          '',
          clipCols(tfill('setup.members.count', { n: s.count })),
          clipCols(t('setup.members.pick')),
        ],
        cursorLine: 3,
      };
    case 'manual-auth': {
      const user = clipTail(s.username, 20) + (s.row === 0 ? '_' : '');
      const pass = '*'.repeat(Math.min(s.password.length, 20)) + (s.row === 1 ? '_' : '');
      const lines = [
        t('setup.auth.title'),
        '',
        t('setup.auth.none'),
        t('setup.auth.byName'),
        '',
        sel(s.row === 0, `${t('setup.auth.member')}   ${user}`),
        sel(s.row === 1, `${t('setup.auth.password')}      ${pass}`),
        sel(s.row === 2, t('setup.auth.signIn')),
        sel(s.row === 3, t('setup.auth.back')),
      ].map((line) => clipCols(line));
      if (s.error) lines.push(clipCols(setupStatus(s.error)));
      return { lines, cursorLine: 5 + s.row };
    }
    case 'libraries': {
      // Window the checkbox rows around the cursor; OPEN THE STORE stays last.
      const onOpen = s.row >= s.rows.length;
      const cursorRow = onOpen ? Math.max(0, s.rows.length - 1) : s.row;
      let start = Math.max(0, Math.min(cursorRow - (LIB_WINDOW - 1), s.rows.length - LIB_WINDOW));
      if (s.rows.length <= LIB_WINDOW) start = 0;
      // Keep the cursor inside the window when it walks upward too.
      if (cursorRow < start) start = cursorRow;
      const visible = s.rows.slice(start, start + LIB_WINDOW);
      const carriedCount = s.rows.filter((r) => r.carried).length;
      const lines = [
        t('setup.libs.title'),
        t('setup.libs.ok'),
        tfill('setup.libs.every', { carried: carriedCount, total: s.rows.length }),
      ].map((line) => clipCols(line));
      visible.forEach((r, i) => {
        const idx = start + i;
        lines.push(sel(!onOpen && idx === s.row, `[${r.carried ? 'X' : ' '}] ${r.name.toUpperCase().slice(0, 32)}`));
      });
      const openLineIdx = lines.length;
      lines.push(sel(onOpen, s.error ? clipCols(setupStatus(s.error)) : t('setup.libs.open')));
      const cursorLine = onOpen ? openLineIdx : 3 + (s.row - start);
      return { lines, cursorLine };
    }
    case 'sync':
      return {
        lines: [
          clipCols(t('setup.sync.title')),
          '',
          clipCols(setupStatus(s.stage)),
          s.pages > 0 ? clipCols(tfill('setup.sync.pages', { n: s.pages })) : '',
          '',
          clipCols(t('setup.sync.wait1')),
          clipCols(t('setup.sync.wait2')),
        ],
        cursorLine: 2,
      };
    case 'arriving':
      return {
        lines: [clipCols(t('setup.arriving.title')), '', clipCols(t('setup.arriving.stock'))],
        cursorLine: 2,
      };
    case 'notice': {
      const lines = [
        clipCols(t('setup.notice.title')),
        clipTail(s.address, 40),
        clipCols(setupStatus(s.detail)),
        '',
        clipCols(sel(s.row === 0, t('setup.notice.retry'))),
        clipCols(sel(s.row === 1, t('setup.notice.change'))),
        clipCols(sel(s.row === 2, t('setup.demo'))),
        '',
        clipCols(t('setup.notice.quiet')),
      ];
      return { lines, cursorLine: 4 + s.row };
    }
  }
}
