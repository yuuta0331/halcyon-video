// Tiny flag so production XR diagnostics can report IWER_EMULATED without
// importing the emulator package.

let iwerActive = false;

export function setIwerActive(on: boolean): void {
  iwerActive = on;
}

export function isIwerActive(): boolean {
  return iwerActive;
}
