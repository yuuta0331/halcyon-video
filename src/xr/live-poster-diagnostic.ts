// Test-only diagnostic over a real shelf poster. One selected production slot
// is locked, then mip/material/depth variables are changed independently.

import type { MovieSlot } from '../store-layout.ts';
import { textureArrayManager } from '../poster-textures.ts';
import { readPosterDetailLut } from '../poster-detail-gpu.ts';
import { posterDetailResidency } from '../poster-detail-residency.ts';
import { posterFocusResidency } from '../poster-focus-residency.ts';
import { posterFocusResourceSnapshot } from '../poster-focus-texture.ts';
import {
  livePosterShaderDiagnosticSnapshot,
  setLivePosterShaderDiagnostic,
} from '../poster-shader.ts';
import {
  jp4aTestSnapshot,
  setJp4aBankInvariant,
  type Jp4aBankInvariant,
} from './jp4a-test-state.ts';
import {
  summarizePosterBankInvariant,
  type PosterBankInvariantRecord,
} from '../poster-bank-invariant.ts';
import { LIVE_POSTER_DEPTH_OFFSET_STORE_UNITS } from './live-poster-mode-math.ts';
import { LivePosterDiagRuntime } from './live-poster-diag-runtime.ts';
export { summarizePosterBankInvariant } from '../poster-bank-invariant.ts';
export { depthIsolatedPosterMatrix } from './live-poster-mode-math.ts';
export { LivePosterDiagRuntime } from './live-poster-diag-runtime.ts';

function attrValue(mesh: MovieSlot['frontMesh'], instanceIdx: number): number | null {
  const attr = mesh.geometry.getAttribute('aTextureIndex') as { count: number; getX: (i: number) => number } | undefined;
  if (!attr || instanceIdx < 0 || instanceIdx >= attr.count) return null;
  return attr.getX(instanceIdx);
}

export function inspectPosterBankInvariant(slots: Iterable<MovieSlot>): Jp4aBankInvariant {
  const records: PosterBankInvariantRecord[] = [];
  const bankSize = Math.max(1, textureArrayManager.bankSize);
  const bankCount = Math.max(1, textureArrayManager.bankCount);
  for (const slot of slots) {
    const globalIndex = textureArrayManager.peekIndex(slot.movie.id);
    if (globalIndex == null) {
      records.push({ globalIndex: null, expectedBank: null, expectedLayer: null,
        frontBank: null, backBank: null, frontIndex: null, backIndex: null,
        bankCount, arrayDepth: 0, loadedFlag: null });
      continue;
    }
    const expectedBank = Math.floor(globalIndex / bankSize);
    const expectedLayer = globalIndex - expectedBank * bankSize;
    const frontBank = Number(slot.frontMesh.userData.posterBank ?? 0);
    const backBank = Number(slot.backMesh.userData.posterBank ?? 0);
    const frontIndex = attrValue(slot.frontMesh, slot.instanceIdx);
    const backIndex = attrValue(slot.backMesh, slot.instanceIdx);
    const depth = (textureArrayManager.bankTexture(expectedBank)?.image as { depth?: number } | undefined)?.depth ?? 0;
    const loaded = textureArrayManager.loadedFlags?.[globalIndex];
    records.push({ globalIndex, expectedBank, expectedLayer, frontBank, backBank,
      frontIndex, backIndex, bankCount, arrayDepth: depth, loadedFlag: loaded ?? null });
  }
  return summarizePosterBankInvariant(records);
}

export class LivePosterDiagnostic extends LivePosterDiagRuntime {
  private readonly slotSource: () => Iterable<MovieSlot>;

  constructor(slots: () => Iterable<MovieSlot>) {
    super({
      slots,
      peekIndex: (id) => textureArrayManager.peekIndex(id),
      bankSize: () => textureArrayManager.bankSize,
      loadedFlag: (index) => textureArrayManager.loadedFlags?.[index] ?? null,
      setShader: (index, mode) => setLivePosterShaderDiagnostic(index, mode),
      inspectInvariant: inspectPosterBankInvariant,
      shaderSnapshot: () => livePosterShaderDiagnosticSnapshot(),
    });
    this.slotSource = slots;
  }

  observation(includeMipEvidence = true): Record<string, unknown> {
    const slot = this.lockedSlot();
    const globalIndex = slot ? textureArrayManager.peekIndex(slot.movie.id) : null;
    const bankSize = Math.max(1, textureArrayManager.bankSize);
    const expectedBank = globalIndex == null ? null : Math.floor(globalIndex / bankSize);
    const expectedLayer = globalIndex == null || expectedBank == null ? null : globalIndex - expectedBank * bankSize;
    const detail = slot ? posterDetailResidency.peekRecord(slot.movie.id) : null;
    const focus = slot ? posterFocusResidency.peekRecord(slot.movie.id) : null;
    let invariant = this.runtimeSnapshot().bankInvariant as ReturnType<typeof inspectPosterBankInvariant>;
    if (includeMipEvidence) {
      invariant = inspectPosterBankInvariant(this.slotSource());
      setJp4aBankInvariant(invariant);
    }
    const cached = this.runtimeSnapshot();
    return {
      enabled: true,
      ...cached,
      bankInvariant: invariant,
      verdict: jp4aTestSnapshot()?.modeVerdicts[this.currentMode()] ?? 'UNKNOWN',
      globalIndex,
      expectedBank,
      meshBank: slot ? Number(slot.frontMesh.userData.posterBank ?? 0) : null,
      backMeshBank: slot ? Number(slot.backMesh.userData.posterBank ?? 0) : null,
      expectedLayer,
      posterBankCount: textureArrayManager.bankCount,
      renderBatchCount: textureArrayManager.renderBatchCount,
      aTextureIndex: slot ? attrValue(slot.frontMesh, slot.instanceIdx) : null,
      loadedFlag: globalIndex == null ? null : textureArrayManager.loadedFlags?.[globalIndex] ?? null,
      arrayDepth: expectedBank == null ? null
        : (textureArrayManager.bankTexture(expectedBank)?.image as { depth?: number } | undefined)?.depth ?? null,
      mipEvidence: includeMipEvidence && expectedBank != null && expectedLayer != null
        ? textureArrayManager.debugMipChain(expectedBank, expectedLayer)
        : undefined,
      detailPhase: detail?.phase ?? null,
      detailLut: detail ? readPosterDetailLut(detail.globalIndex) : null,
      focusPhase: focus?.phase ?? null,
      focusUpload: posterFocusResourceSnapshot().upload,
      depthOffsetStoreUnits: this.currentMode() === 'LIVE-DEPTH-ISOLATED'
        ? LIVE_POSTER_DEPTH_OFFSET_STORE_UNITS : 0,
      privacy: 'OPAQUE_ID_NO_TITLE_NO_URL_NO_TOKEN',
    };
  }
}
