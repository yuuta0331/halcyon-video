// Test-only diagnostic over a real shelf poster. One selected production slot
// is locked, then mip/material/depth variables are changed independently.

import * as THREE from 'three';
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
import { STORE_UNITS_PER_METER } from '../platform/index.ts';
import {
  cycleJp4aMode,
  cycleJp4aModeVerdict,
  jp4aTestSnapshot,
  setJp4aBankInvariant,
  setJp4aLockedPoster,
  setJp4aMode,
  type Jp4aBankInvariant,
  type LivePosterMode,
} from './jp4a-test-state.ts';
import {
  summarizePosterBankInvariant,
  type PosterBankInvariantRecord,
} from '../poster-bank-invariant.ts';
import {
  depthIsolatedPosterMatrix,
  LIVE_POSTER_DEPTH_OFFSET_STORE_UNITS,
} from './live-poster-mode-math.ts';
export { summarizePosterBankInvariant } from '../poster-bank-invariant.ts';
export { depthIsolatedPosterMatrix } from './live-poster-mode-math.ts';

const DEPTH_OFFSET_STORE_UNITS = LIVE_POSTER_DEPTH_OFFSET_STORE_UNITS; // 7.6mm.

function opaquePosterId(id: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `opaque-${(h >>> 0).toString(16).padStart(8, '0')}`;
}

function attrValue(mesh: THREE.InstancedMesh, instanceIdx: number): number | null {
  const attr = mesh.geometry.getAttribute('aTextureIndex') as THREE.InstancedBufferAttribute | undefined;
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

export class LivePosterDiagnostic {
  private readonly slots: () => Iterable<MovieSlot>;
  private locked: MovieSlot | null = null;
  private mode: LivePosterMode = 'LIVE-NORMAL';
  private originalMatrix: THREE.Matrix4 | null = null;
  private viewerDistanceM: number | null = null;
  private viewerYawToPosterDeg: number | null = null;
  private invariant: Jp4aBankInvariant;
  private readonly instanceMatrix = new THREE.Matrix4();
  private readonly worldMatrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly toViewer = new THREE.Vector3();

  constructor(slots: () => Iterable<MovieSlot>) {
    this.slots = slots;
    const session = jp4aTestSnapshot();
    if (session?.mode) this.mode = session.mode;
    this.invariant = inspectPosterBankInvariant(this.slots());
    setJp4aBankInvariant(this.invariant);
  }

  lock(slot: MovieSlot): { changed: boolean; verdict: string } {
    if (this.locked === slot) {
      return { changed: false, verdict: cycleJp4aModeVerdict(this.mode) };
    }
    this.restoreDepthOffset();
    this.locked = slot;
    const globalIndex = textureArrayManager.peekIndex(slot.movie.id);
    if (globalIndex == null) {
      setJp4aLockedPoster(null);
      setLivePosterShaderDiagnostic(null, 'LIVE-NORMAL');
      return { changed: true, verdict: 'UNKNOWN' };
    }
    const bankSize = Math.max(1, textureArrayManager.bankSize);
    const expectedBank = Math.floor(globalIndex / bankSize);
    setJp4aLockedPoster({
      opaqueId: opaquePosterId(slot.movie.id),
      globalIndex,
      expectedBank,
      meshBank: Number(slot.frontMesh.userData.posterBank ?? 0),
      expectedLayer: globalIndex - expectedBank * bankSize,
      loadedFlag: textureArrayManager.loadedFlags?.[globalIndex] ?? null,
    });
    this.applyMode(this.mode);
    this.invariant = inspectPosterBankInvariant(this.slots());
    setJp4aBankInvariant(this.invariant);
    return { changed: true, verdict: 'UNKNOWN' };
  }

  cycle(direction: -1 | 1): LivePosterMode {
    const mode = cycleJp4aMode(direction);
    this.applyMode(mode);
    return mode;
  }

  setMode(mode: LivePosterMode): void {
    setJp4aMode(mode);
    this.applyMode(mode);
  }

  currentMode(): LivePosterMode { return this.mode; }
  hasLock(): boolean { return this.locked != null; }

  tickViewer(viewer: { x: number; y: number; z: number } | null): void {
    if (!this.locked || !viewer) {
      this.viewerDistanceM = null;
      this.viewerYawToPosterDeg = null;
      return;
    }
    const slot = this.locked;
    slot.frontMesh.getMatrixAt(slot.instanceIdx, this.instanceMatrix);
    slot.frontMesh.updateMatrixWorld(true);
    this.worldMatrix.multiplyMatrices(slot.frontMesh.matrixWorld, this.instanceMatrix);
    this.position.setFromMatrixPosition(this.worldMatrix);
    this.normal.set(0, 0, 1).transformDirection(this.worldMatrix).normalize();
    this.toViewer.set(viewer.x, viewer.y, viewer.z).sub(this.position);
    this.viewerDistanceM = this.toViewer.length() / STORE_UNITS_PER_METER;
    this.toViewer.y = 0;
    if (this.toViewer.lengthSq() > 1e-8) {
      this.toViewer.normalize();
      this.normal.y = 0;
      this.normal.normalize();
      this.viewerYawToPosterDeg = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(
        this.normal.dot(this.toViewer), -1, 1,
      )));
    }
  }

  observation(includeMipEvidence = true): Record<string, unknown> {
    const slot = this.locked;
    const globalIndex = slot ? textureArrayManager.peekIndex(slot.movie.id) : null;
    const bankSize = Math.max(1, textureArrayManager.bankSize);
    const expectedBank = globalIndex == null ? null : Math.floor(globalIndex / bankSize);
    const expectedLayer = globalIndex == null || expectedBank == null ? null : globalIndex - expectedBank * bankSize;
    const detail = slot ? posterDetailResidency.peekRecord(slot.movie.id) : null;
    const focus = slot ? posterFocusResidency.peekRecord(slot.movie.id) : null;
    // Full shelf traversal is explicit evidence collection only. The 4 Hz
    // performance sampler uses the cached invariant so it cannot distort FPS.
    if (includeMipEvidence) {
      this.invariant = inspectPosterBankInvariant(this.slots());
      setJp4aBankInvariant(this.invariant);
    }
    return {
      enabled: true,
      mode: this.mode,
      verdict: jp4aTestSnapshot()?.modeVerdicts[this.mode] ?? 'UNKNOWN',
      locked: !!slot,
      opaqueId: slot ? opaquePosterId(slot.movie.id) : null,
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
      viewerDistanceM: this.viewerDistanceM,
      viewerYawToPosterDeg: this.viewerYawToPosterDeg,
      depthOffsetStoreUnits: this.mode === 'LIVE-DEPTH-ISOLATED' ? DEPTH_OFFSET_STORE_UNITS : 0,
      shader: livePosterShaderDiagnosticSnapshot(),
      bankInvariant: this.invariant,
      privacy: 'OPAQUE_ID_NO_TITLE_NO_URL_NO_TOKEN',
    };
  }

  dispose(): void {
    this.restoreDepthOffset();
    this.locked = null;
    setLivePosterShaderDiagnostic(null, 'LIVE-NORMAL');
  }

  private applyMode(mode: LivePosterMode): void {
    this.restoreDepthOffset();
    this.mode = mode;
    const globalIndex = this.locked ? textureArrayManager.peekIndex(this.locked.movie.id) : null;
    setLivePosterShaderDiagnostic(globalIndex, mode);
    if (mode === 'LIVE-DEPTH-ISOLATED') this.applyDepthOffset();
  }

  private applyDepthOffset(): void {
    if (!this.locked || this.originalMatrix) return;
    const mesh = this.locked.frontMesh;
    mesh.getMatrixAt(this.locked.instanceIdx, this.instanceMatrix);
    this.originalMatrix = this.instanceMatrix.clone();
    this.instanceMatrix.copy(depthIsolatedPosterMatrix(this.originalMatrix));
    mesh.setMatrixAt(this.locked.instanceIdx, this.instanceMatrix);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.boundingSphere = null;
  }

  private restoreDepthOffset(): void {
    if (!this.locked || !this.originalMatrix) return;
    const mesh = this.locked.frontMesh;
    mesh.setMatrixAt(this.locked.instanceIdx, this.originalMatrix);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.boundingSphere = null;
    this.originalMatrix = null;
  }
}
