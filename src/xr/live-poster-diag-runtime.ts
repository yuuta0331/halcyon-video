// Injected-deps LIVE poster diagnostic runtime. Kept free of poster-textures
// so unit tests can lock, isolate depth, reset, and separate FOCUS.

import * as THREE from 'three';
import type { MovieSlot } from '../store-layout.ts';
import { STORE_UNITS_PER_METER } from '../platform/index.ts';
import {
  cycleJp4aMode,
  cycleJp4aModeVerdict,
  jp4aTestSnapshot,
  setJp4aBankInvariant,
  setJp4aLockedPoster,
  setJp4aMode,
  setJp4aTestPhase,
  type Jp4aBankInvariant,
  type LivePosterMode,
} from './jp4a-test-state.ts';
import {
  jp4aLockReplacementAllowed,
  type Jp4aTestPhase,
} from './jp4a-test-phase.ts';
import {
  depthIsolatedPosterMatrix,
  LIVE_POSTER_DEPTH_OFFSET_STORE_UNITS,
} from './live-poster-mode-math.ts';

const DEPTH_OFFSET_STORE_UNITS = LIVE_POSTER_DEPTH_OFFSET_STORE_UNITS;

export function opaquePosterId(id: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `opaque-${(h >>> 0).toString(16).padStart(8, '0')}`;
}

export interface LivePosterDiagDeps {
  slots: () => Iterable<MovieSlot>;
  peekIndex: (movieId: string) => number | null;
  bankSize: () => number;
  loadedFlag: (index: number) => number | null;
  setShader: (index: number | null, mode: LivePosterMode) => void;
  inspectInvariant: (slots: Iterable<MovieSlot>) => Jp4aBankInvariant;
  shaderSnapshot?: () => { index: number; mode: LivePosterMode };
}

export class LivePosterDiagRuntime {
  private readonly deps: LivePosterDiagDeps;
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

  constructor(deps: LivePosterDiagDeps) {
    this.deps = deps;
    const session = jp4aTestSnapshot();
    if (session?.mode) this.mode = session.mode;
    this.invariant = this.deps.inspectInvariant(this.deps.slots());
    setJp4aBankInvariant(this.invariant);
  }

  lock(slot: MovieSlot): { changed: boolean; verdict: string } {
    if (this.locked === slot) {
      return { changed: false, verdict: cycleJp4aModeVerdict(this.mode) };
    }
    const phase = this.sessionPhase();
    if (this.locked && !jp4aLockReplacementAllowed(phase)) {
      return { changed: false, verdict: jp4aTestSnapshot()?.modeVerdicts[this.mode] ?? 'UNKNOWN' };
    }
    this.restoreDepthOffset();
    this.locked = slot;
    const globalIndex = this.deps.peekIndex(slot.movie.id);
    if (globalIndex == null) {
      setJp4aLockedPoster(null);
      this.deps.setShader(null, 'LIVE-NORMAL');
      return { changed: true, verdict: 'UNKNOWN' };
    }
    const bankSize = Math.max(1, this.deps.bankSize());
    const expectedBank = Math.floor(globalIndex / bankSize);
    setJp4aLockedPoster({
      opaqueId: opaquePosterId(slot.movie.id),
      globalIndex,
      expectedBank,
      meshBank: Number(slot.frontMesh.userData.posterBank ?? 0),
      expectedLayer: globalIndex - expectedBank * bankSize,
      loadedFlag: this.deps.loadedFlag(globalIndex),
    });
    this.applyMode(this.mode);
    this.invariant = this.deps.inspectInvariant(this.deps.slots());
    setJp4aBankInvariant(this.invariant);
    setJp4aTestPhase('LOCKED_LIVE_DIAG');
    return { changed: true, verdict: 'UNKNOWN' };
  }

  cycle(direction: -1 | 1): LivePosterMode {
    if (this.sessionPhase() !== 'LOCKED_LIVE_DIAG') return this.mode;
    if (direction === 1 && this.mode === 'LIVE-DEPTH-ISOLATED') {
      this.beginApproach();
      return this.mode;
    }
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
  lockedSlot(): MovieSlot | null { return this.locked; }
  depthIsolationActive(): boolean { return this.originalMatrix != null; }
  viewerCache(): { distanceM: number | null; yawDeg: number | null } {
    return { distanceM: this.viewerDistanceM, yawDeg: this.viewerYawToPosterDeg };
  }

  beginApproach(): void {
    this.applyMode('LIVE-NORMAL');
    setJp4aMode('LIVE-NORMAL');
    setJp4aTestPhase('APPROACH');
  }

  beginFocus(): boolean {
    if (!this.locked) return false;
    if (this.sessionPhase() !== 'APPROACH') return false;
    this.applyMode('LIVE-NORMAL');
    setJp4aMode('LIVE-NORMAL');
    setJp4aTestPhase('FOCUS_REQUESTED');
    return true;
  }

  advanceFromHold(): 'BEGIN_APPROACH' | 'BEGIN_FOCUS' | null {
    const phase = this.sessionPhase();
    if (phase === 'LOCKED_LIVE_DIAG') {
      this.beginApproach();
      return 'BEGIN_APPROACH';
    }
    if (phase === 'APPROACH' && this.beginFocus()) return 'BEGIN_FOCUS';
    return null;
  }

  reset(requestRender?: () => void): void {
    this.restoreDepthOffset();
    this.locked = null;
    this.mode = 'LIVE-NORMAL';
    this.deps.setShader(null, 'LIVE-NORMAL');
    this.viewerDistanceM = null;
    this.viewerYawToPosterDeg = null;
    this.invariant = this.deps.inspectInvariant(this.deps.slots());
    setJp4aBankInvariant(this.invariant);
    setJp4aLockedPoster(null);
    setJp4aMode('LIVE-NORMAL');
    setJp4aTestPhase('BASELINE');
    requestRender?.();
  }

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

  runtimeSnapshot(): Record<string, unknown> {
    return {
      mode: this.mode,
      locked: !!this.locked,
      opaqueId: this.locked ? opaquePosterId(this.locked.movie.id) : null,
      shader: this.deps.shaderSnapshot?.() ?? null,
      depthOffsetStoreUnits: this.mode === 'LIVE-DEPTH-ISOLATED' ? DEPTH_OFFSET_STORE_UNITS : 0,
      viewerDistanceM: this.viewerDistanceM,
      viewerYawToPosterDeg: this.viewerYawToPosterDeg,
      bankInvariant: this.invariant,
      testPhase: this.sessionPhase(),
    };
  }

  observation(_includeMipEvidence = false): Record<string, unknown> {
    return this.runtimeSnapshot();
  }

  dispose(): void {
    this.reset();
  }

  sessionPhase(): Jp4aTestPhase {
    return jp4aTestSnapshot()?.testPhase ?? 'BASELINE';
  }

  private applyMode(mode: LivePosterMode): void {
    this.restoreDepthOffset();
    this.mode = mode;
    const globalIndex = this.locked ? this.deps.peekIndex(this.locked.movie.id) : null;
    this.deps.setShader(globalIndex, mode);
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
