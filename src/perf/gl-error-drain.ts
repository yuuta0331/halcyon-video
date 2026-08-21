// Bounded WebGL getError drain for evidence. Not a production runtime path.

export interface GlErrorRecord {
  code: number;
  name: string;
}

const GL_NO_ERROR = 0;

export function glErrorName(code: number): string {
  switch (code >>> 0) {
    case 0: return 'NO_ERROR';
    case 0x0500: return 'INVALID_ENUM';
    case 0x0501: return 'INVALID_VALUE';
    case 0x0502: return 'INVALID_OPERATION';
    case 0x0503: return 'STACK_OVERFLOW';
    case 0x0504: return 'STACK_UNDERFLOW';
    case 0x0505: return 'OUT_OF_MEMORY';
    case 0x0506: return 'INVALID_FRAMEBUFFER_OPERATION';
    case 0x9242: return 'CONTEXT_LOST_WEBGL';
    default: return `0x${(code >>> 0).toString(16)}`;
  }
}

export function drainGlErrors(
  gl: { getError(): number } | null | undefined,
  limit = 16,
): GlErrorRecord[] {
  if (!gl || typeof gl.getError !== 'function') return [];
  const out: GlErrorRecord[] = [];
  for (let i = 0; i < Math.max(1, limit); i++) {
    const code = gl.getError();
    if (code === GL_NO_ERROR) break;
    out.push({ code, name: glErrorName(code) });
  }
  return out;
}

export function glFatalFrom(errors: readonly GlErrorRecord[]): boolean {
  return errors.some((e) =>
    e.name === 'OUT_OF_MEMORY'
    || e.name === 'CONTEXT_LOST_WEBGL'
    || e.name === 'INVALID_FRAMEBUFFER_OPERATION'
    || e.name === 'INVALID_OPERATION'
    || e.name === 'INVALID_ENUM'
    || e.name === 'INVALID_VALUE'
  );
}
