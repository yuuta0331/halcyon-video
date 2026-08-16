// Pure XR panel copy. Kept off canvas-font so node tests can import it.

import { t } from '../i18n/index.ts';
import type { XrLayerSpace } from './types';

export interface XrPanelContent {
  title: string;
  lines: string[];
}

export function xrPanelContent(opts: {
  compositor: 'layer' | 'mesh-fallback';
  layersFeature: boolean | 'unknown';
  referenceSpace: string | null;
  targetHz: number | null;
}): XrPanelContent {
  const layerLine = opts.compositor === 'layer'
    ? t('xr.panel.layersOn')
    : t('xr.panel.layersOff');
  return {
    title: t('xr.panel.title'),
    lines: [
      layerLine,
      t('xr.panel.move'),
      t('xr.panel.turn'),
      t('xr.panel.select'),
      t('xr.panel.exit'),
      `${t('xr.panel.space')}: ${opts.referenceSpace ?? '—'}`,
      `${t('xr.panel.hz')}: ${opts.targetHz ?? '—'}`,
    ],
  };
}

export function panelUsesIndependentResolution(width: number, height: number): boolean {
  return width > 0 && height > 0;
}

export function panelIsHeadLocked(space: XrLayerSpace | 'rig'): boolean {
  return space === 'viewer';
}
