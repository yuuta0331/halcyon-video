// CONTROLS & HELP — the discoverable controls reference (UX pass 2026-08).
//
// Before this page, every input beyond arrows/OK/Back was folklore: P, /, F,
// the carry shortcuts, both HOLD gestures, the gamepad map, and the in-store
// moves (▲ past the top row, ▼ past the bottom row, ◀ at the register) were
// taught nowhere in the app. This page is the single reference, reachable from
// the settings index, the power menu, and the counter CRT.
//
// It renders as inert drawer rows — control on the left, what it does as the
// gold value, detail in the footer-bar hint — so the drawer's existing
// selection/paging machinery works untouched. Rows activate to nothing;
// they're a reference card, not knobs. main.ts routes HELP_ROW_PREFIX keys
// to a no-op in activateSetting and builds the page via buildControlsHelpPanel
// (same shape as the Store Brand panel's hooks).

import { t } from './i18n';

export const HELP_ROW_PREFIX = '__help__:';

export interface ControlsHelpHooks {
  /** Add a row to the drawer's flat nav list; returns its selection index. */
  registerRow?: (key: string) => number;
  /** Move the drawer selection to a registered row (pointerenter parity). */
  selectRow?: (index: number) => void;
}

interface HelpRow {
  /** Stable slug for the row's DOM id. */
  id: string;
  /** The control (left column). */
  control: string;
  /** What it does (gold right column). */
  action: string;
  /** One footer-bar line of detail (≤62 chars reaches the bar untruncated). */
  hint: string;
}

interface HelpSection {
  title: string;
  rows: HelpRow[];
}

// Remote-truthful ordering (review §4.5): the remote's whole vocabulary first,
// then the in-store destinations it reaches, then the optional hardware.
function helpSections(): HelpSection[] {
  return [
    {
      title: t('help.remote.title'),
      rows: [
        {
          id: 'arrows', control: '◀ ▶ ▲ ▼', action: t('help.arrows.action'),
          hint: t('help.arrows.hint'),
        },
        {
          id: 'ok', control: 'OK', action: t('help.ok.action'),
          hint: t('help.ok.hint'),
        },
        {
          id: 'back', control: 'BACK', action: t('help.back.action'),
          hint: t('help.back.hint'),
        },
        {
          id: 'subnav', control: '◀ ▶ in the store view', action: t('help.subnav.action'),
          hint: t('help.subnav.hint'),
        },
        {
          id: 'subnavdisplays', control: '▼ in the store view', action: t('help.subnavdisplays.action'),
          hint: t('help.subnavdisplays.hint'),
        },
        {
          id: 'tvpeek', control: '▲ in the store view', action: t('help.tvpeek.action'),
          hint: t('help.tvpeek.hint'),
        },
      ],
    },
    {
      title: t('help.counter.title'),
      rows: [
        {
          id: 'counter', control: 'Store view → CHECKOUT', action: t('help.counter.action'),
          hint: t('help.counter.hint'),
        },
        {
          id: 'terminal', control: '◀ at the register', action: t('help.terminal.action'),
          hint: t('help.terminal.hint'),
        },
        {
          id: 'clerkcounter', control: '▲ at the register', action: t('help.clerkcounter.action'),
          hint: t('help.clerkcounter.hint'),
        },
        {
          id: 'tipjar', control: '▶ at the register', action: t('help.tipjar.action'),
          hint: t('help.tipjar.hint'),
        },
      ],
    },
    {
      title: t('help.keyboard.title'),
      rows: [
        {
          id: 'power', control: 'P', action: t('help.power.action'),
          hint: t('help.power.hint'),
        },
        {
          id: 'search', control: '/', action: t('help.search.action'),
          hint: t('help.search.hint'),
        },
        {
          id: 'walk', control: 'F', action: t('help.walk.action'),
          hint: t('help.walk.hint'),
        },
        {
          id: 'carry', control: 'C · R · X', action: t('help.carry.action'),
          hint: t('help.carry.hint'),
        },
        {
          id: 'holds', control: 'Hold OK / hold ▼', action: t('help.holds.action'),
          hint: t('help.holds.hint'),
        },
      ],
    },
    {
      title: t('help.gamepad.title'),
      rows: [
        {
          id: 'padface', control: 'A · B · Y · Start', action: t('help.padface.action'),
          hint: t('help.padface.hint'),
        },
        {
          id: 'padshoulder', control: 'RB · X · LB', action: t('help.padshoulder.action'),
          hint: t('help.padshoulder.hint'),
        },
      ],
    },
    {
      title: t('help.xr.title'),
      rows: [
        {
          id: 'xenter', control: 'Enter VR', action: t('help.xr.enter.action'),
          hint: t('help.xr.enter.hint'),
        },
        {
          id: 'xrmove', control: 'XR sticks', action: t('help.xr.move.action'),
          hint: t('help.xr.move.hint'),
        },
        {
          id: 'xrselect', control: 'XR trigger', action: t('help.xr.select.action'),
          hint: t('help.xr.select.hint'),
        },
      ],
    },
  ];
}

/**
 * Build the Controls & Help reference into `container` (the page's
 * .settings-group element, after main.ts's Back row). Markup mirrors the
 * drawer's native rows so the page reads as one menu; every row registers
 * into the drawer's flat nav list so Up/Down (and the CRT paging) walk it.
 */
export function buildControlsHelpPanel(container: HTMLElement, hooks: ControlsHelpHooks = {}): void {
  for (const section of helpSections()) {
    const titleEl = document.createElement('div');
    titleEl.className = 'settings-group-title';
    titleEl.textContent = section.title;
    container.appendChild(titleEl);

    for (const def of section.rows) {
      const key = HELP_ROW_PREFIX + def.id;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'settings-row';
      row.id = `setting-row-${key}`;
      row.dataset.hint = def.hint;
      row.innerHTML = `
        <span class="settings-row-main">
          <span class="settings-row-label">${def.control}</span>
        </span>
        <span class="settings-row-leader" aria-hidden="true"></span>
        <span class="settings-row-value">${def.action}</span>
      `;
      const index = hooks.registerRow ? hooks.registerRow(key) : -1;
      row.addEventListener('pointerenter', () => {
        if (index >= 0) hooks.selectRow?.(index);
      });
      container.appendChild(row);
    }
  }
}
