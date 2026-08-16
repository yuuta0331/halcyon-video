import { t, type MessageKey } from '../i18n/index.ts';

export type XrMenuAction = 'open-settings' | 'exit-vr' | 'close';

export interface XrMenuRow {
  id: XrMenuAction;
  labelKey: MessageKey;
}

export function xrMenuRows(): XrMenuRow[] {
  return [
    { id: 'open-settings', labelKey: 'xr.menu.settings' },
    { id: 'exit-vr', labelKey: 'xr.menu.exitVr' },
    { id: 'close', labelKey: 'xr.menu.close' },
  ];
}

export function xrMenuTitle(): string {
  return t('xr.menu.title');
}

export function xrMenuRowLabel(row: XrMenuRow): string {
  return t(row.labelKey);
}

export function moveMenuIndex(index: number, dir: -1 | 1, length: number): number {
  if (length <= 0) return 0;
  return (index + dir + length) % length;
}

export function menuActionAt(index: number): XrMenuAction {
  const rows = xrMenuRows();
  return rows[Math.max(0, Math.min(index, rows.length - 1))]!.id;
}
