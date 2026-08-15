// Localized chrome helpers. Kept out of main.ts so the HUD/power-menu copy
// can grow without feeding the file-budget ceiling.

import { brandString } from '../brand-pack';
import { t } from './index';
import { getLocale } from './locale';

export function groupLabel(group: string): string {
  switch (group) {
    case 'Store Look': return t('group.storeLook');
    case 'Store Brand': return t('group.storeBrand');
    case 'Playback': return t('group.playback');
    case 'Video Games': return t('group.videoGames');
    case 'Performance': return t('group.performance');
    case 'Connection': return t('group.connection');
    default: return group;
  }
}

export function groupHint(group: string): string {
  switch (group) {
    case 'Store Look': return t('hint.storeLook');
    case 'Store Brand': return t('hint.storeBrand');
    case 'Playback': return t('hint.playback');
    case 'Video Games': return t('hint.videoGames');
    case 'Performance': return t('hint.performance');
    case 'Connection': return t('hint.connection');
    default: return '';
  }
}

export function subpageLabel(name: string): string {
  switch (name) {
    case 'Building & Storefront': return t('subpage.building');
    case 'Platforms': return t('subpage.platforms');
    case 'Store Libraries': return t('subpage.libraries');
    case 'Overhead TVs': return t('subpage.tvs');
    default: return name;
  }
}

export function subpageHint(name: string): string {
  switch (name) {
    case 'Building & Storefront': return t('hint.building');
    case 'Platforms': return t('hint.platforms');
    case 'Store Libraries': return t('hint.libraries');
    case 'Overhead TVs': return t('hint.tvs');
    default: return '';
  }
}

export interface HudModeOpts {
  carryMode: boolean;
  canHoldToCheckout: boolean;
}

export function hudHintForMode(mode: string, opts: HudModeOpts): string {
  switch (mode) {
    case 'library-select': return t('hud.librarySelect');
    case 'overview': return t('hud.overview');
    case 'genre-select': return '';
    case 'browse':
      return opts.canHoldToCheckout ? t('hud.browseCarry') : t('hud.browse');
    case 'inspect':
      if (opts.carryMode) {
        return opts.canHoldToCheckout ? t('hud.inspectTakeCheckout') : t('hud.inspectTake');
      }
      return t('hud.inspect');
    case 'checkout': return t('hud.checkout');
    case 'backroom': return t('hud.backroom');
    case 'person-endcap': return t('hud.personEndcap');
    case 'walk-around': return t('hud.walkAround');
    default: return '';
  }
}

export type InspectHintKind =
  | 'game'
  | 'discovery'
  | 'discoveryRequested'
  | 'gap'
  | 'gapRequested'
  | 'comingSoon'
  | 'stock'
  | 'browse';

export function inspectCaseHint(kind: InspectHintKind): string {
  switch (kind) {
    case 'game': return t('hud.inspectGame');
    case 'discoveryRequested': return t('hud.inspectDiscoveryRequested');
    case 'discovery':
    case 'gap': return t('hud.inspectDiscovery');
    case 'gapRequested': return t('hud.inspectGapRequested');
    case 'comingSoon': return t('hud.inspectComingSoon');
    case 'stock': return t('hud.inspectStock');
    case 'browse': return t('hud.browse');
  }
}

/**
 * Overlay the localized chrome onto the static English HTML. English t()
 * values match the markup, so the default look is unchanged. Brand wordmarks
 * in the CRT titlebars stay with Brand Packs.
 */
export function applyDocumentChrome(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = getLocale() === 'ja' ? 'ja' : 'en';

  setText('.power-title', t('terminal.header'));
  setText('#btn-settings', t('power.settings'));
  setText('#btn-controls', t('power.controls'));
  setText('#btn-flat-mode', t('power.flatMode'));
  setText('#btn-suspend', t('power.suspend'));
  setText('#btn-cec-toggle', t('power.cec'));
  setText('#btn-logout', t('power.logout'));
  setText('#btn-exit', brandString('terminal-exit-label', t('power.exit')));
  setText('#btn-enter-vr', t('power.enterVr'));
  setText('#xr-enter-btn', t('xr.enter'));
  setText('#btn-cancel', t('power.cancel'));
  setText('.power-desc', t('terminal.ready'));
  const rewind = document.querySelector('#power-menu-overlay .crt-footer-hint');
  if (rewind) rewind.textContent = t('terminal.rewind');

  setText('.settings-title', t('settings.title'));
  setText('#settings-status', t('settings.status'));
  setText('#btn-settings-close', t('settings.applyClose'));

  setText('.exit-title', t('exit.title'));
  setText('.exit-desc', t('exit.desc'));
  setText('#btn-confirm-exit', t('exit.yes'));
  setText('#btn-confirm-cancel', t('exit.no'));
  setText('.exit-subdesc', t('exit.hint'));

  setText('.login-title', t('login.title'));
  setText('.login-subtitle', t('login.subtitle'));
  setText('#login-backend-title', t('login.backend'));
  setText('label[for="login-backend"]', t('login.serverType'));
  setText('label[for="login-url"]', t('login.serverAddress'));
  setText('label[for="login-user"]', t('login.user'));
  setText('label[for="login-pass"]', t('login.pass'));
  setText('#btn-plex-pin', t('login.plexPin'));
  setText('#plex-pin-panel .input-group label', t('login.plexEnter'));
  setText('#plex-pin-status', t('login.plexWait'));
  setText('label[for="plex-server"]', t('login.plexServers'));
  setText('#login-plex-signin > .column-desc', t('login.plexDesc'));
  setAttr('#plex-pin-qr', 'alt', t('login.plexQr'));
  setText('#btn-login-submit', t('login.connect'));
  setText('#btn-demo-submit', t('login.demo'));
  setText('.login-desc', t('login.desc'));
  const loginCols = document.querySelectorAll('#login-overlay .login-columns > .login-column');
  const loginDescKeys = ['login.backendDesc', 'login.seerrDesc', 'login.rommDesc'] as const;
  const loginTitleKeys = ['login.backend', 'login.seerr', 'login.romm'] as const;
  loginCols.forEach((col, i) => {
    const descKey = loginDescKeys[i];
    const titleKey = loginTitleKeys[i];
    const desc = col.querySelector(':scope > .column-desc');
    const title = col.querySelector('.column-title');
    if (desc && descKey) desc.textContent = t(descKey);
    if (title && titleKey) title.textContent = t(titleKey);
  });
  setText('label[for="login-jellyseerr-url"]', t('login.seerrUrl'));
  setText('label[for="login-jellyseerr-key"]', t('login.seerrKey'));
  setText('label[for="login-romm-url"]', t('login.rommUrl'));
  setText('label[for="login-romm-key"]', t('login.rommKey'));

  setText('.genre-ticket-sub', t('genre.select'));
  setText('#version-picker-label', t('version.choose'));
  setText('#candy-checkout-overlay .episode-card-label', t('candy.checkout'));
  setText('.candy-title', t('candy.title'));
  setText('.candy-desc', t('candy.desc'));
  setText('label[for="candy-zip-input"]', t('candy.zip'));
  setText('#btn-candy-order', t('candy.order'));
  setText('#btn-candy-skip', t('candy.skip'));
  setText('.walk-hud-title', t('walk.hudTitle'));
  setText('.vp-exit-title', t('player.stopTitle'));
  setText('.vp-exit-desc', t('player.stopDesc'));
  setText('#vp-exit-yes', t('player.stopYes'));
  setText('#vp-exit-no', t('player.keep'));
  setAttr('#vp-back', 'aria-label', t('player.backStore'));
  setAttr('#vp-back10', 'aria-label', t('player.back10'));
  setAttr('#vp-playpause', 'aria-label', t('player.play'));
  setAttr('#vp-fwd10', 'aria-label', t('player.fwd10'));
  setAttr('#vp-mute', 'aria-label', t('player.mute'));
  setAttr('#vp-volume-slider', 'aria-label', t('player.volume'));
  setAttr('#vp-tracks', 'aria-label', t('player.tracks'));
  setAttr('#vp-subtitles', 'aria-label', t('player.subs'));
  setAttr('#vp-fullscreen', 'aria-label', t('player.fullscreen'));

  const walkDescs = document.querySelectorAll('.walk-hud-desc');
  const walkKeys: Array<'walk.hudWalk' | 'walk.hudLook' | 'walk.hudMouse' | 'walk.hudClick' | 'walk.hudExit'> = [
    'walk.hudWalk', 'walk.hudLook', 'walk.hudMouse', 'walk.hudClick', 'walk.hudExit',
  ];
  walkDescs.forEach((el, i) => {
    const key = walkKeys[i];
    if (key) el.textContent = t(key);
  });

  const candyHint = document.querySelector('#candy-checkout-overlay .episode-card-hint');
  if (candyHint) candyHint.textContent = t('candy.hint');
  const versionHint = document.querySelector('#version-picker-overlay .episode-card-hint');
  if (versionHint) versionHint.textContent = t('version.hint');
}

function setAttr(selector: string, attr: string, value: string): void {
  const el = document.querySelector(selector);
  if (el) el.setAttribute(attr, value);
}

function setText(selector: string, value: string): void {
  const el = document.querySelector(selector);
  if (el) el.textContent = value;
}
