import type { SettingsStore } from './settings-session.ts';

export function localStorageSettingsStore(): SettingsStore {
  return {
    get(key) {
      if (typeof localStorage === 'undefined') {
        if (key === 'bb_locale') return 'en';
        if (key === 'bb_outside') return 'day';
        if (key === 'bb_fps_meter') return false;
        return undefined;
      }
      const raw = localStorage.getItem(key);
      if (key === 'bb_fps_meter') return raw === '1';
      if (raw == null) {
        if (key === 'bb_locale') return 'en';
        if (key === 'bb_outside') return 'day';
        return undefined;
      }
      return raw;
    },
    set(key, value) {
      if (typeof localStorage === 'undefined') return;
      if (typeof value === 'boolean') localStorage.setItem(key, value ? '1' : '0');
      else localStorage.setItem(key, String(value));
    },
  };
}
