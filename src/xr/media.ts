// XRMediaBinding adapter. JP-3 does not rewire Jellyfin/Plex playback.
// A real HTMLVideoElement can be bound behind an explicit flag; otherwise
// the interface stays ready and reports the exact blocker.

export function xrMediaLayerFlag(search: string, storage?: { getItem(key: string): string | null } | null): boolean {
  const q = search.startsWith('?') ? search.slice(1) : search;
  if (new URLSearchParams(q).get('xrMedia') === '1') return true;
  return storage?.getItem('bb_xr_media_layer') === '1';
}

export interface MediaLayerRequest {
  video: { readyState?: number; videoWidth?: number; paused?: boolean } | null;
  flagOn: boolean;
  hasMediaBinding: boolean;
  compositorUi: boolean;
  droppedByBudget: boolean;
}

export interface MediaLayerPlan {
  bind: boolean;
  blocker: string | null;
}

export function planMediaLayer(req: MediaLayerRequest): MediaLayerPlan {
  if (!req.flagOn) {
    return {
      bind: false,
      blocker: 'XRMediaBinding is behind ?xrMedia=1 / bb_xr_media_layer (default off so Jellyfin/Plex stay untouched).',
    };
  }
  if (!req.hasMediaBinding) {
    return { bind: false, blocker: 'XRMediaBinding is not exposed by this runtime.' };
  }
  if (!req.compositorUi) {
    return { bind: false, blocker: 'Compositor layers unavailable; media layer needs the same path as the UI quad.' };
  }
  if (req.droppedByBudget) {
    return { bind: false, blocker: 'session.maxRenderLayers has no remaining slot for a media layer.' };
  }
  if (!req.video) {
    return { bind: false, blocker: 'No HTMLVideoElement is wired (video-player.videoElement).' };
  }
  if ((req.video.readyState ?? 0) < 2) {
    return { bind: false, blocker: 'HTMLVideoElement is not yet ready (HAVE_CURRENT_DATA).' };
  }
  return { bind: true, blocker: null };
}

export interface XrMediaBindingLike {
  createQuadLayer: (video: HTMLVideoElement, init: Record<string, unknown>) => object;
  createCylinderLayer?: (video: HTMLVideoElement, init: Record<string, unknown>) => object;
}

export function createMediaQuadLayer(
  binding: XrMediaBindingLike,
  video: HTMLVideoElement,
  space: unknown,
): object {
  return binding.createQuadLayer(video, {
    space,
    layout: 'mono',
    invertStereo: false,
    width: 1.6,
    height: 0.9,
  });
}
