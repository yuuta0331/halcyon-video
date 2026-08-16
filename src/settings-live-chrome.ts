// Locale / environment / FPS — the live chrome settings XR and desktop share.
// Kept off settings.ts so Node tests can register the canonical defs without
// the font/asset graph.

import { enableFpsMeter, FPS_METER_KEY } from './fps-meter.ts';
import { activateLocale, isLocale, LOCALE_KEY, t as tUi } from './i18n/index.ts';
import { registerSetting } from './settings-registry.ts';

export function registerLocaleSetting(): void {
  registerSetting({
    key: LOCALE_KEY,
    label: tUi('locale.label'),
    kind: 'cycle',
    group: 'Store Look',
    values: [
      { id: 'en', label: tUi('locale.en') },
      { id: 'ja', label: tUi('locale.ja') },
    ],
    default: 'en',
    applyMode: 'reload',
    apply: (value) => {
      if (isLocale(value)) activateLocale(value);
    },
    hint: tUi('locale.hint'),
  });
}

export function registerOutsideSetting(): void {
  registerSetting({
    key: 'bb_outside',
    label: tUi('setting.environment.label'),
    kind: 'cycle',
    group: 'Store Look',
    values: [
      { id: 'day', label: tUi('setting.environment.day') },
      { id: 'night', label: tUi('setting.environment.night') },
      { id: 'sunset', label: tUi('setting.environment.sunset') },
    ],
    default: 'day',
    applyMode: 'live',
    apply: (value, scene) => {
      if (value === 'day' || value === 'night' || value === 'sunset') {
        scene?.setOutsideMode?.(value);
      }
    },
    hint: tUi('setting.environment.hint'),
  });
}

export function registerFpsMeterSetting(): void {
  registerSetting({
    key: FPS_METER_KEY,
    label: tUi('setting.fpsMeter.label'),
    kind: 'toggle',
    group: 'Performance',
    default: false,
    applyMode: 'live',
    apply: (value) => enableFpsMeter(!!value),
    hint: tUi('setting.fpsMeter.hint'),
  });
}

/** Test and XR boot helper. Production registerCoreSettings calls the same functions in drawer order. */
export function registerLiveChromeSettings(): void {
  registerLocaleSetting();
  registerOutsideSetting();
  registerFpsMeterSetting();
}
