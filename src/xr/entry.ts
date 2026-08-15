// DOM / power-menu visibility for Enter VR. Detection never starts a session.

export function xrEntryShouldShow(opts: {
  isTauri: boolean;
  immersiveVrSupported: boolean;
}): boolean {
  return !opts.isTauri && opts.immersiveVrSupported;
}

export const XR_ENTER_BUTTON_ID = 'btn-enter-vr';
export const XR_HUD_BUTTON_ID = 'xr-enter-btn';

export function applyXrEntryVisibility(
  visible: boolean,
  presenting: boolean,
  ids: string[] = [XR_ENTER_BUTTON_ID, XR_HUD_BUTTON_ID],
): void {
  if (typeof document === 'undefined') return;
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (!visible && !presenting) {
      el.setAttribute('hidden', '');
    } else {
      el.removeAttribute('hidden');
    }
  }
}
