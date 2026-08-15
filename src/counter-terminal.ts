// The clerk's desk terminal rendered as a system-control menu — the diegetic
// twin of the #power-menu-overlay glass card. Both views drive the SAME
// power-button ids and dispatch through main.ts's executePowerMenuAction(), so
// they can't drift apart; only the presentation differs.
//
// This module is the part the 3D harness also needs (it boots StoreScene
// without main.ts's DOM shell), so the row text lives here as pure data +
// a pure formatter rather than inside main.ts.
import { brandString } from './brand-pack';
import { t } from './i18n';

// Short labels for the CRT. drawTerminal() in entrance/index.ts hard-clips each
// line at 40 characters, and the "> " selection prefix eats two of them, so
// every label here must stay within 38.
export const COUNTER_TERMINAL_LABELS: Record<string, string> = {
  get 'btn-settings'() { return t('terminal.settings'); },
  get 'btn-controls'() { return t('terminal.controls'); },
  get 'btn-flat-mode'() { return t('terminal.flatMode'); },
  get 'btn-suspend'() { return t('terminal.suspend'); },
  get 'btn-cec-toggle'() { return t('terminal.cec'); },
  get 'btn-logout'() { return t('terminal.logout'); },
  // Brand Pack override, then i18n fallback — identity stays with the pack.
  get 'btn-exit'() { return brandString('terminal-exit-label', t('power.exit')); },
  get 'btn-enter-vr'() { return t('terminal.enterVr'); },
  get 'btn-service'() { return t('terminal.service'); },
  get 'btn-media-date'() { return t('terminal.mediaDate'); },
  get 'btn-cancel'() { return t('terminal.cancel'); },
};

// Body lines the header sits above (drawTerminal draws its own
// "<BRAND> RENTAL SYSTEM" banner), plus where to park the blinking cursor.
// `ids` is the caller's live button list so demo mode's shorter ring renders
// correctly without this module knowing about demo mode.
export function counterTerminalLines(ids: string[], selectedIndex: number): {
  lines: string[];
  cursorLine: number;
} {
  const lines = [t('terminal.header'), ''];
  ids.forEach((id, idx) => {
    lines.push(`${idx === selectedIndex ? '>' : ' '} ${COUNTER_TERMINAL_LABELS[id] ?? id}`);
  });
  // Two header rows precede the options, so the cursor tracks the selection.
  return { lines, cursorLine: 2 + selectedIndex };
}
