import { t } from '../i18n/index.ts';
import type { SettingsApplyTarget } from '../settings-registry.ts';
import { menuActionAt, moveMenuIndex, xrMenuRows, type XrMenuAction } from './menu.ts';
import {
  localeCycleValues,
  outsideCycleValues,
  settingsActionAt,
  xrSettingsRows,
  type XrSettingsRow,
} from './settings-panel.ts';
import { xrQualityStatusLabel } from './settings-policy.ts';
import {
  applyXrDraft,
  cancelXrDraft,
  readXrDraft,
  stepDraftCycle,
  toggleDraftValue,
  type XrSettingsDraft,
} from './settings-session.ts';
import type { XrUiActions } from './ui-input.ts';
import {
  backFromSettings,
  closeUiToWorld,
  initialXrUiMode,
  openSettingsFromMenu,
  type XrUiMode,
} from './ui-mode.ts';

export interface XrUiPaintRow {
  label: string;
  value: string;
  selected: boolean;
  status: boolean;
}

export interface XrUiPaint {
  title: string;
  hint: string;
  rows: XrUiPaintRow[];
}

export interface XrUiHost {
  exitVr(): void;
  getSettingsScene(): SettingsApplyTarget | null;
}

export class XrUiSession {
  mode: XrUiMode = initialXrUiMode();
  menuIndex = 0;
  settingsIndex = 0;
  draft: XrSettingsDraft;
  lastApplied: Record<string, unknown>;
  private readonly host: XrUiHost;
  private readonly resourceProfile: () => string;

  constructor(
    host: XrUiHost,
    resourceProfile: () => string,
  ) {
    this.host = host;
    this.resourceProfile = resourceProfile;
    this.draft = readXrDraft();
    this.lastApplied = { ...this.draft.values };
  }

  openMenu(): void {
    this.mode = 'MENU';
    this.menuIndex = 0;
  }

  closeToWorld(): void {
    this.mode = closeUiToWorld(this.mode);
    this.draft = readXrDraft();
  }

  toggleMenu(): void {
    if (this.mode === 'WORLD') this.openMenu();
    else this.closeToWorld();
  }

  applyActions(actions: XrUiActions): void {
    if (actions.toggleMenu) {
      this.toggleMenu();
      return;
    }
    if (this.mode === 'WORLD') return;
    if (actions.cancel) {
      if (this.mode === 'SETTINGS') {
        this.draft = cancelXrDraft();
        this.mode = backFromSettings(this.mode);
      } else {
        this.closeToWorld();
      }
      return;
    }
    if (actions.nav) {
      if (this.mode === 'MENU') {
        this.menuIndex = moveMenuIndex(this.menuIndex, actions.nav, xrMenuRows().length);
      } else {
        const rows = this.settingsRows();
        this.settingsIndex = moveMenuIndex(this.settingsIndex, actions.nav, rows.length);
      }
    }
    if (this.mode === 'SETTINGS' && actions.value) {
      this.nudgeSettings(actions.value);
    }
    if (actions.activate) this.activate();
  }

  activate(): void {
    if (this.mode === 'MENU') {
      this.runMenuAction(menuActionAt(this.menuIndex));
      return;
    }
    if (this.mode !== 'SETTINGS') return;
    const rows = this.settingsRows();
    const row = rows[this.settingsIndex];
    if (!row) return;
    const action = settingsActionAt(rows, this.settingsIndex);
    if (action === 'apply') {
      this.apply();
      return;
    }
    if (action === 'cancel') {
      this.draft = cancelXrDraft();
      this.mode = backFromSettings(this.mode);
      return;
    }
    if (action === 'back') {
      this.mode = backFromSettings(this.mode);
      return;
    }
    if (row.kind === 'toggle') this.draft = toggleDraftValue(this.draft, row.id);
    if (row.kind === 'cycle') this.nudgeSettings(1);
  }

  apply(): void {
    this.draft = applyXrDraft(this.draft, this.host.getSettingsScene());
    this.lastApplied = { ...this.draft.values };
  }

  cancel(): void {
    this.draft = cancelXrDraft();
    this.mode = backFromSettings(this.mode);
  }

  cycleControl(key: string, dir: -1 | 1 = 1): void {
    if (key === 'bb_locale') {
      this.draft = stepDraftCycle(this.draft, { key: 'bb_locale', values: [...localeCycleValues()] }, dir);
    } else if (key === 'bb_outside') {
      this.draft = stepDraftCycle(this.draft, { key: 'bb_outside', values: [...outsideCycleValues()] }, dir);
    } else if (key === 'bb_fps_meter') {
      this.draft = toggleDraftValue(this.draft, 'bb_fps_meter');
    }
  }

  persistConfirmed(key: string): unknown {
    return this.lastApplied[key];
  }

  paint(): XrUiPaint {
    if (this.mode === 'SETTINGS') {
      const rows = this.settingsRows();
      return {
        title: t('xr.settings.title'),
        hint: t('xr.settings.hint'),
        rows: rows.map((row, i) => ({
          label: row.label,
          value: row.value,
          selected: i === this.settingsIndex,
          status: row.kind === 'status',
        })),
      };
    }
    const rows = xrMenuRows();
    return {
      title: t('xr.menu.title'),
      hint: t('xr.menu.hint'),
      rows: rows.map((row, i) => ({
        label: t(row.labelKey),
        value: '',
        selected: i === this.menuIndex,
        status: false,
      })),
    };
  }

  private settingsRows(): XrSettingsRow[] {
    return xrSettingsRows(this.draft, this.resourceProfile());
  }

  private runMenuAction(action: XrMenuAction): void {
    if (action === 'open-settings') {
      this.draft = readXrDraft();
      this.settingsIndex = 0;
      this.mode = openSettingsFromMenu('MENU');
      return;
    }
    if (action === 'exit-vr') {
      this.closeToWorld();
      this.host.exitVr();
      return;
    }
    this.closeToWorld();
  }

  private nudgeSettings(dir: -1 | 1): void {
    const row = this.settingsRows()[this.settingsIndex];
    if (!row || row.kind === 'status' || row.kind === 'action') return;
    if (row.id === 'bb_locale') {
      this.draft = stepDraftCycle(this.draft, { key: 'bb_locale', values: [...localeCycleValues()] }, dir);
    } else if (row.id === 'bb_outside') {
      this.draft = stepDraftCycle(this.draft, { key: 'bb_outside', values: [...outsideCycleValues()] }, dir);
    } else if (row.id === 'bb_fps_meter') {
      this.draft = toggleDraftValue(this.draft, 'bb_fps_meter');
    }
  }
}

export { xrQualityStatusLabel };
