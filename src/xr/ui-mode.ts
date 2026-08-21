export type XrUiMode = 'WORLD' | 'MENU' | 'SETTINGS' | 'INSPECT';

export function initialXrUiMode(): XrUiMode {
  return 'WORLD';
}

export function uiOwnsInput(mode: XrUiMode): boolean {
  return mode === 'MENU' || mode === 'SETTINGS';
}

export function locomotionAllowed(mode: XrUiMode): boolean {
  return mode === 'WORLD';
}

export function worldSelectAllowed(mode: XrUiMode): boolean {
  return mode === 'WORLD';
}

export function closeUiToWorld(_mode: XrUiMode): XrUiMode {
  return 'WORLD';
}

export function openMenuFromWorld(mode: XrUiMode): XrUiMode {
  return mode === 'WORLD' ? 'MENU' : mode;
}

export function openSettingsFromMenu(mode: XrUiMode): XrUiMode {
  return mode === 'MENU' ? 'SETTINGS' : mode;
}

export function backFromSettings(mode: XrUiMode): XrUiMode {
  return mode === 'SETTINGS' ? 'MENU' : mode;
}
