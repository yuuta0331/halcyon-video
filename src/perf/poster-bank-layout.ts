// Stable STORE_VISIBLE_BASE layout. Distance may soften sampling (mips).
// Distance must never change which title owns which bank/layer.
//
// Catalog bank count is independent of simultaneous shader samplers.
// Each draw binds one sampler2DArray (one catalog bank).

export interface PosterResolution {
  w: number;
  h: number;
}

/** Candidates, highest readable first. Chosen once per store session. */
export const BASE_SHELF_RESOLUTION_CANDIDATES: readonly PosterResolution[] = [
  { w: 160, h: 240 },
  { w: 128, h: 192 },
  { w: 96, h: 144 },
  { w: 64, h: 96 },
];

const MIP_FACTOR = 4 / 3;
/** Safety ceiling so a pathological catalog fails closed instead of allocating unbounded arrays. */
export const MAX_CATALOG_BANKS = 64;
/** One sampler2DArray per shelf draw. Catalog banks do not add samplers. */
export const POSTER_SAMPLERS_PER_DRAW = 1;
export const QUEST_SAFE_POSTER_GPU_BUDGET = 192 * 1024 * 1024;
export const DESKTOP_POSTER_GPU_BUDGET = 512 * 1024 * 1024;

export interface PosterBankLayout {
  uniqueTitles: number;
  width: number;
  height: number;
  layersPerBank: number;
  bankCount: number;
  renderBatchCount: number;
  samplersPerDraw: typeof POSTER_SAMPLERS_PER_DRAW;
  totalLayers: number;
  activeTitles: number;
  cpuBytesActive: number;
  cpuBytesAllocated: number;
  /** Alias of cpuBytesAllocated (physical storage, including padding). */
  cpuBytesEstimated: number;
  gpuBytesEstimated: number;
  gpuBudgetBytes: number;
  qualityDropped: boolean;
  capacityOk: boolean;
  evictionWindow: false;
}

export function layersPerBankFromCaps(maxArrayTextureLayers: number): number {
  return Math.max(1, Math.min(2048, Math.floor(maxArrayTextureLayers) || 1));
}

export function estimatePosterBankBytes(
  w: number,
  h: number,
  layers: number,
): { cpu: number; gpu: number } {
  const cpu = Math.max(0, w) * Math.max(0, h) * 4 * Math.max(0, layers);
  return { cpu, gpu: Math.round(cpu * MIP_FACTOR) };
}

export function bankCountForTitles(uniqueTitles: number, layersPerBank: number): number {
  const titles = Math.max(0, uniqueTitles);
  const per = Math.max(1, layersPerBank);
  if (titles <= 0) return 1;
  return Math.max(1, Math.ceil(titles / per));
}

export function choosePosterBankLayout(input: {
  uniqueTitles: number;
  maxArrayTextureLayers: number;
  gpuBudgetBytes?: number;
}): PosterBankLayout {
  const uniqueTitles = Math.max(0, Math.floor(input.uniqueTitles));
  const layersPerBank = layersPerBankFromCaps(input.maxArrayTextureLayers);
  const gpuBudgetBytes = input.gpuBudgetBytes ?? QUEST_SAFE_POSTER_GPU_BUDGET;
  const uncappedBanks = bankCountForTitles(uniqueTitles, layersPerBank);
  const bankCount = Math.min(MAX_CATALOG_BANKS, uncappedBanks);
  const capacityOk = uniqueTitles <= bankCount * layersPerBank;
  const activeTitles = capacityOk ? uniqueTitles : bankCount * layersPerBank;
  const totalLayers = uniqueTitles <= layersPerBank
    ? Math.max(1, uniqueTitles)
    : bankCount * layersPerBank;

  let chosen = BASE_SHELF_RESOLUTION_CANDIDATES[BASE_SHELF_RESOLUTION_CANDIDATES.length - 1]!;
  let qualityDropped = false;
  for (const candidate of BASE_SHELF_RESOLUTION_CANDIDATES) {
    const est = estimatePosterBankBytes(candidate.w, candidate.h, totalLayers);
    if (est.gpu <= gpuBudgetBytes) {
      chosen = candidate;
      break;
    }
    qualityDropped = true;
  }
  const allocated = estimatePosterBankBytes(chosen.w, chosen.h, totalLayers);
  const active = estimatePosterBankBytes(chosen.w, chosen.h, Math.max(1, activeTitles));
  if (allocated.gpu > gpuBudgetBytes) qualityDropped = true;

  return {
    uniqueTitles,
    width: chosen.w,
    height: chosen.h,
    layersPerBank: uniqueTitles <= layersPerBank ? Math.max(1, uniqueTitles) : layersPerBank,
    bankCount,
    renderBatchCount: bankCount,
    samplersPerDraw: POSTER_SAMPLERS_PER_DRAW,
    totalLayers,
    activeTitles,
    cpuBytesActive: uniqueTitles <= layersPerBank ? allocated.cpu : active.cpu,
    cpuBytesAllocated: allocated.cpu,
    cpuBytesEstimated: allocated.cpu,
    gpuBytesEstimated: allocated.gpu,
    gpuBudgetBytes,
    qualityDropped,
    capacityOk,
    evictionWindow: false,
  };
}

export function stablePosterMapping(
  movieIds: Iterable<string>,
  layout: Pick<PosterBankLayout, 'layersPerBank' | 'bankCount'>,
): Map<string, { bank: number; layer: number; globalIndex: number }> {
  const unique = [...new Set(movieIds)].sort();
  const per = Math.max(1, layout.layersPerBank);
  const maxBanks = Math.max(1, layout.bankCount);
  const out = new Map<string, { bank: number; layer: number; globalIndex: number }>();
  unique.forEach((id, i) => {
    const bank = Math.floor(i / per);
    if (bank >= maxBanks) return;
    out.set(id, {
      bank,
      layer: i % per,
      globalIndex: i,
    });
  });
  return out;
}
