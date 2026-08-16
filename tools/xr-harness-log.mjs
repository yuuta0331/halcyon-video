// Shared IWER harness log classification. Keep sampler/GL gates fatal.
// Optional demo sidecar 500s are allowlisted only when tied to /dev-proxy.

export function isSamplerOrGlFatal(entry) {
  const text = String(entry?.text ?? '');
  return /Trying to use .*texture units? while (?:this GPU|GPU) supports only/i.test(text)
    || /too many texture image units/i.test(text)
    || /texture image units count exceeds/i.test(text)
    || /CONTEXT_LOST_WEBGL/i.test(text)
    || /webglcontextlost/i.test(text)
    || /Could not compile (?:vertex|fragment) shader/i.test(text)
    || /Error linking/i.test(text)
    || (/INVALID_OPERATION/i.test(text) && /texture/i.test(text));
}

export function isDevProxyHttpError(text) {
  return /HTTP 5\d\d\s+\S*\/dev-proxy(?:[/?#\s"]|$)/i.test(text);
}

export function isAllowlisted(entry, log = []) {
  const text = String(entry?.text ?? '');
  if (isDevProxyHttpError(text)) return true;
  if (
    entry?.type === 'error' &&
    /Failed to load resource: the server responded with a status of 500/i.test(text)
    && log.some((e) => isDevProxyHttpError(String(e?.text ?? '')))
  ) {
    return true;
  }
  return false;
}

export function residencyImpossible(gpu) {
  if (!gpu || typeof gpu !== 'object') return false;
  const slots = gpu.posterPhysicalSlots;
  const residents = gpu.posterResidentTitles;
  if (typeof slots === 'number' && typeof residents === 'number') {
    if (residents > slots) return true;
    if (residents < 0 || slots < 0) return true;
  }
  if (gpu.posterDuplicatePhysicalOwners > 0) return true;
  if (gpu.posterFreeOwnedCollisions > 0) return true;
  if (gpu.posterResidencyInvariantOk === false) return true;
  return false;
}

export function populatedWindowImpossible(snap) {
  if (!snap || typeof snap !== 'object') return true;
  const slots = snap.physicalSlots;
  const residents = snap.residentCount;
  if (typeof slots !== 'number' || typeof residents !== 'number') return true;
  if (residents > slots || residents < 0 || slots <= 0) return true;
  if ((snap.uniqueOwners ?? residents) !== residents) return true;
  if (typeof snap.freeCount === 'number' && snap.freeCount + residents !== slots) return true;
  if (snap.residencyInvariantOk === false) return true;
  if ((snap.duplicatePhysicalOwners ?? 0) > 0) return true;
  if ((snap.freeOwnedCollisions ?? 0) > 0) return true;
  return false;
}
