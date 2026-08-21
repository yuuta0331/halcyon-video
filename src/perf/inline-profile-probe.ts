// DESKTOP_BROWSER evidence of inline vs immersive poster policy. Not Quest hardware.

import {
  blankGpuCapabilities,
  desktopFullProfile,
  questInlineProfile,
  readResourceFlags,
  selectResourceProfile,
  xrSafeProfile,
} from './resource-profile.ts';

export function runInlineProfileProbe() {
  const caps = blankGpuCapabilities({ maxTextures: 16, maxArrayTextureLayers: 256 });
  const questUa = 'Mozilla/5.0 (Linux; Android 12; Quest 3) OculusBrowser/35.0';
  const chromeUa = 'Mozilla/5.0 Chrome/120';
  const questInline = selectResourceProfile({
    caps, flags: readResourceFlags(''), userAgent: questUa, presentation: 'INLINE',
  });
  const questXr = selectResourceProfile({
    caps, flags: readResourceFlags(''), userAgent: questUa, presentation: 'IMMERSIVE_XR',
  });
  const desktop = selectResourceProfile({
    caps, flags: readResourceFlags(''), userAgent: chromeUa, presentation: 'INLINE',
  });
  const emu = selectResourceProfile({
    caps, flags: readResourceFlags('?xrEmu=1'), userAgent: chromeUa,
  });
  const pass = questInline.name === 'QUEST_INLINE'
    && questInline.poster.shelfWidth === 160
    && questInline.poster.shelfHeight === 240
    && questInline.n8ao === false
    && questInline.bloom === false
    && questXr.name === 'XR_SAFE'
    && questXr.poster.shelfWidth === 96
    && desktop.name === 'DESKTOP_FULL'
    && desktop.poster.shelfWidth === 160
    && emu.name === 'XR_SAFE';
  return {
    classification: 'DESKTOP_BROWSER' as const,
    QUEST_HARDWARE: 'NOT_EXECUTED',
    pass,
    questInline: {
      profile: questInline.name,
      posterBase: `${questInline.poster.shelfWidth}x${questInline.poster.shelfHeight}`,
      n8ao: questInline.n8ao,
      bloom: questInline.bloom,
      liveMirrors: questInline.liveMirrors,
    },
    questImmersive: {
      profile: questXr.name,
      posterBase: `${questXr.poster.shelfWidth}x${questXr.poster.shelfHeight}`,
    },
    desktopInline: {
      profile: desktop.name,
      posterBase: `${desktop.poster.shelfWidth}x${desktop.poster.shelfHeight}`,
    },
    iwer: { profile: emu.name, posterBase: `${emu.poster.shelfWidth}x${emu.poster.shelfHeight}` },
    near: '320x480',
    focus: '640x960',
    desktopFullEffects: desktopFullProfile().n8ao,
    xrSafeBase: `${xrSafeProfile(caps).poster.shelfWidth}x${xrSafeProfile(caps).poster.shelfHeight}`,
    questInlineCheap: questInlineProfile(caps).n8ao === false,
  };
}
