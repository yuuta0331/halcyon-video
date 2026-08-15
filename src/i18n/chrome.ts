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
}

function setText(selector: string, value: string): void {
  const el = document.querySelector(selector);
  if (el) el.textContent = value;
}
