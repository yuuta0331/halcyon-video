// Stable STORE_VISIBLE_BASE layout. Distance may soften sampling (mips).
// Distance must never change which title owns which bank/layer.

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
/** Matches the XR_SAFE shelf sampler count in poster-shader.ts. */
export const MAX_POSTER_BANKS = 4;
export const QUEST_SAFE_POSTER_GPU_BUDGET = 192 * 1024 * 1024;
export const DESKTOP_POSTER_GPU_BUDGET = 512 * 1024 * 1024;

export interface PosterBankLayout {
  uniqueTitles: number;
  width: number;
  height: number;
  layersPerBank: number;
  bankCount: number;
  totalLayers: number;
  cpuBytesEstimated: number;
  gpuBytesEstimated: number;
  gpuBudgetBytes: number;
  qualityDropped: boolean;
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
  return Math.max(1, Math.min(MAX_POSTER_BANKS, Math.ceil(titles / per)));
}

export function choosePosterBankLayout(input: {
  uniqueTitles: number;
  maxArrayTextureLayers: number;
  gpuBudgetBytes?: number;
}): PosterBankLayout {
  const uniqueTitles = Math.max(0, Math.floor(input.uniqueTitles));
  const layersPerBank = layersPerBankFromCaps(input.maxArrayTextureLayers);
  const gpuBudgetBytes = input.gpuBudgetBytes ?? QUEST_SAFE_POSTER_GPU_BUDGET;
  const bankCount = bankCountForTitles(uniqueTitles, layersPerBank);
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
  const bytes = estimatePosterBankBytes(chosen.w, chosen.h, totalLayers);
  if (bytes.gpu > gpuBudgetBytes) qualityDropped = true;

  return {
    uniqueTitles,
    width: chosen.w,
    height: chosen.h,
    layersPerBank: uniqueTitles <= layersPerBank ? Math.max(1, uniqueTitles) : layersPerBank,
    bankCount,
    totalLayers,
    cpuBytesEstimated: bytes.cpu,
    gpuBytesEstimated: bytes.gpu,
    gpuBudgetBytes,
    qualityDropped,
    evictionWindow: false,
  };
}

export function stablePosterMapping(
  movieIds: Iterable<string>,
  layersPerBank: number,
): Map<string, { bank: number; layer: number; globalIndex: number }> {
  const unique = [...new Set(movieIds)].sort();
  const per = Math.max(1, layersPerBank);
  const out = new Map<string, { bank: number; layer: number; globalIndex: number }>();
  unique.forEach((id, i) => {
    out.set(id, {
      bank: Math.floor(i / per),
      layer: i % per,
      globalIndex: i,
    });
  });
  return out;
}
