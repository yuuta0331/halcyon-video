// Test-only close-range black-artifact A/B diagnostic.
// Enabled only by ?xrPosterHwDiag=1. Normal launch must not create these meshes.

import * as THREE from 'three';
import { MIRROR_SKIP_LAYER } from '../scene-layers.ts';
import { makePosterQualityPattern } from '../poster-quality-pattern.ts';
import { POSTER_FOCUS_HEIGHT, POSTER_FOCUS_WIDTH } from '../poster-quality.ts';
import { placeHudFromViewerPose } from './hud-placement.ts';
import type { XrViewerPoseState } from './viewer-pose.ts';
import { latestViewerWorldPose } from './viewer-pose.ts';
import { STORE_UNITS_PER_METER } from '../platform/index.ts';
import { hwDiagObserveSnapshot } from '../perf/hw-diag-observe.ts';

export const HW_DIAG_QUERY = 'xrPosterHwDiag';
export const HW_DIAG_MEDIA_ID = 'hwdiag-opaque-0';

export type HwPosterDiagMode = 'A' | 'B' | 'C' | 'D' | 'E';

export const HW_POSTER_DIAG_MODES: readonly HwPosterDiagMode[] = ['A', 'B', 'C', 'D', 'E'];

export interface HwDiagProductionHandle {
  mesh: THREE.Object3D;
  setMode(mode: 'C' | 'D' | 'E'): void;
  snapshot(): {
    geometryPath: string;
    materialPath: string;
    shaderPath: string;
    productionPathClass: string;
    baseEnabled: boolean;
    detailLutEnabled: boolean;
    focusEnabled: boolean;
    mipPolicy: 'none' | 'base-mips-near-none';
  };
  dispose(): void;
}

export interface HwDiagCaseDeps {
  createCaseGeometry(count: number): THREE.BufferGeometry;
  caseWidth: number;
  caseHeight: number;
  production: HwDiagProductionHandle;
}

export interface HwPosterDiagMeta {
  mode: HwPosterDiagMode;
  label: string;
  materialType: string;
  textureType: string;
  array: boolean;
  mipPolicy: 'none' | 'mips' | 'base-array';
  depthTest: boolean;
  depthWrite: boolean;
  side: string;
  transparent: boolean;
  near: number;
  far: number;
  viewerDistance: number;
  stereoBothEyes: boolean;
  cycleHint: string;
  productionPath: boolean;
  geometryPath: string;
  shaderPath: string;
  baseEnabled: boolean;
  detailLutEnabled: boolean;
  focusEnabled: boolean;
  worldStable: boolean;
}

const LABELS: Record<HwPosterDiagMode, string> = {
  A: 'MODE A — FLAT_DIRECT_BASIC',
  B: 'MODE B — PRODUCTION_CASE_GEOMETRY_DIRECT_BASIC',
  C: 'MODE C — PRODUCTION_CASE_BASE_ONLY',
  D: 'MODE D — PRODUCTION_CASE_BASE_PLUS_NEAR',
  E: 'MODE E — FULL_PRODUCTION',
};

const SPAWN_X = 13.0;
const SPAWN_Z = 12.5;
const SPAWN_YAW = Math.atan2(-2, 12.5);
const FALLBACK_CASE_W = 0.365;
const FALLBACK_CASE_H = 0.667;

export function hardwarePosterDiagRequested(
  search: string = typeof location !== 'undefined' ? location.search : '',
): boolean {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return q.get(HW_DIAG_QUERY) === '1';
}

export function nextHwPosterDiagMode(mode: HwPosterDiagMode): HwPosterDiagMode {
  const i = HW_POSTER_DIAG_MODES.indexOf(mode);
  return HW_POSTER_DIAG_MODES[(i + 1) % HW_POSTER_DIAG_MODES.length]!;
}

function enableStereo(obj: THREE.Object3D): void {
  obj.layers.enable(0);
  obj.layers.enable(MIRROR_SKIP_LAYER);
  obj.traverse((child) => {
    child.layers.enable(0);
    child.layers.enable(MIRROR_SKIP_LAYER);
  });
}

function makeDirectTex(w: number, h: number, seed: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(makePosterQualityPattern(w, h, seed), w, h);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export function hwPosterDiagModeMeta(mode: HwPosterDiagMode): Pick<
  HwPosterDiagMeta,
  | 'mode'
  | 'label'
  | 'materialType'
  | 'textureType'
  | 'array'
  | 'mipPolicy'
  | 'depthTest'
  | 'depthWrite'
  | 'stereoBothEyes'
  | 'cycleHint'
  | 'geometryPath'
  | 'shaderPath'
  | 'baseEnabled'
  | 'detailLutEnabled'
  | 'focusEnabled'
  | 'worldStable'
> {
  const production = mode === 'C' || mode === 'D' || mode === 'E';
  return {
    mode,
    label: LABELS[mode],
    materialType: production
      ? 'MeshStandardMaterial+compileProductionPosterFront'
      : 'MeshBasicMaterial',
    textureType: mode === 'A' || mode === 'B' ? 'DataTexture' : 'DataArrayTexture',
    array: production,
    mipPolicy: 'none',
    depthTest: mode !== 'A',
    depthWrite: production,
    stereoBothEyes: true,
    cycleHint: 'thumbstick click: cycle A→B→C→D→E',
    geometryPath: mode === 'A' ? 'PlaneGeometry' : 'createClonedCaseGeometry',
    shaderPath: production ? 'posterShaderChunk' : 'MeshBasicMaterial',
    baseEnabled: production,
    detailLutEnabled: mode === 'D' || mode === 'E',
    focusEnabled: mode === 'E',
    worldStable: true,
  };
}

export class HardwarePosterDiagnostic {
  readonly content = new THREE.Group();
  readonly labelMesh: THREE.Mesh;
  private mode: HwPosterDiagMode = 'A';
  private readonly meshA: THREE.Mesh;
  private readonly meshB: THREE.Object3D;
  private readonly production: HwDiagProductionHandle | null;
  private readonly textures: THREE.Texture[] = [];
  private readonly labelCanvas: HTMLCanvasElement;
  private readonly labelTex: THREE.CanvasTexture;
  private lastLabel = '';
  private thumbPrev = false;
  private viewerDistance = 0;
  private readonly worldAnchor: 'spawn' | 'origin';
  private readonly _contentWorld = new THREE.Vector3();
  private readonly _labelWorld = new THREE.Vector3();

  constructor(opts: { worldAnchor?: 'spawn' | 'origin'; deps?: HwDiagCaseDeps } = {}) {
    this.worldAnchor = opts.worldAnchor ?? 'spawn';
    this.content.name = 'xr-hw-poster-diag';
    this.placeContent();
    const w = opts.deps?.caseWidth ?? FALLBACK_CASE_W;
    const h = opts.deps?.caseHeight ?? FALLBACK_CASE_H;
    this.meshA = this.makeA(w, h);
    this.meshB = opts.deps
      ? this.makeBProduction(opts.deps)
      : this.makeBFallback(w, h);
    this.production = opts.deps?.production ?? null;
    this.content.add(this.meshA, this.meshB);
    if (this.production) this.content.add(this.production.mesh);
    enableStereo(this.content);

    this.labelCanvas = (typeof document !== 'undefined'
      ? document.createElement('canvas')
      : { width: 768, height: 128, getContext: () => null }) as unknown as HTMLCanvasElement;
    this.labelCanvas.width = 768;
    this.labelCanvas.height = 128;
    this.labelTex = new THREE.CanvasTexture(this.labelCanvas);
    this.labelTex.minFilter = THREE.LinearFilter;
    this.labelTex.magFilter = THREE.LinearFilter;
    const labelMat = new THREE.MeshBasicMaterial({
      map: this.labelTex,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    this.labelMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.08), labelMat);
    this.labelMesh.name = 'xr-hw-poster-diag-label';
    this.labelMesh.renderOrder = 20;
    enableStereo(this.labelMesh);
    this.applyMode();
  }

  /** Content is world/store stable. Label may be parented to the viewer rig. */
  attach(worldParent: THREE.Object3D, labelParent: THREE.Object3D = worldParent): void {
    if (this.content.parent !== worldParent) worldParent.add(this.content);
    if (this.labelMesh.parent !== labelParent) labelParent.add(this.labelMesh);
  }

  detach(): void {
    this.content.removeFromParent();
    this.labelMesh.removeFromParent();
  }

  cycle(): HwPosterDiagMode {
    this.mode = nextHwPosterDiagMode(this.mode);
    this.applyMode();
    return this.mode;
  }

  setMode(mode: HwPosterDiagMode): void {
    this.mode = mode;
    this.applyMode();
  }

  currentMode(): HwPosterDiagMode {
    return this.mode;
  }

  noteButtons(thumbstick: boolean): void {
    if (thumbstick && !this.thumbPrev) this.cycle();
    this.thumbPrev = thumbstick;
  }

  tick(pose: XrViewerPoseState | null, cameraNear: number, cameraFar: number): HwPosterDiagMeta {
    const world = latestViewerWorldPose();
    this.content.getWorldPosition(this._contentWorld);
    if (world) {
      this.viewerDistance = Math.hypot(world.x - this._contentWorld.x, world.z - this._contentWorld.z);
    } else if (pose?.valid) {
      this.viewerDistance = Math.hypot(pose.x - this.content.position.x, pose.z - this.content.position.z);
    }
    if (pose?.valid) {
      const hud = placeHudFromViewerPose(pose, { x: 0, y: 0.18, z: -0.62 });
      if (hud) {
        this.labelMesh.position.set(hud.x, hud.y, hud.z);
        this.labelMesh.quaternion.set(hud.qx, hud.qy, hud.qz, hud.qw);
      }
    }
    this.paintLabel();
    return this.meta(cameraNear, cameraFar);
  }

  meta(cameraNear = 0.05, cameraFar = 80): HwPosterDiagMeta {
    const observed = hwDiagObserveSnapshot();
    const declared = hwPosterDiagModeMeta(this.mode);
    const intendedProduction = this.mode === 'C' || this.mode === 'D' || this.mode === 'E';
    const productionObserved = intendedProduction
      && this.production != null
      && observed.compileCount > 0
      && observed.diagBankBindCount > 0
      && !observed.suppressBind;
    return {
      ...declared,
      productionPath: productionObserved,
      side: 'FrontSide',
      transparent: false,
      near: cameraNear,
      far: cameraFar,
      viewerDistance: this.viewerDistance,
    };
  }

  contentWorldPosition(): THREE.Vector3 {
    return this.content.getWorldPosition(this._contentWorld).clone();
  }

  labelWorldPosition(): THREE.Vector3 {
    return this.labelMesh.getWorldPosition(this._labelWorld).clone();
  }

  snapshot(glError: number | null = null, contextLost = false) {
    const observed = hwDiagObserveSnapshot();
    const prod = this.mode === 'C' || this.mode === 'D' || this.mode === 'E'
      ? this.production?.snapshot() ?? null
      : null;
    return {
      enabled: true,
      mediaId: HW_DIAG_MEDIA_ID,
      ...this.meta(),
      glError,
      contextLost,
      observed,
      production: prod,
      classification: 'IWER_EMULATED' as const,
      QUEST_HARDWARE: 'NOT_EXECUTED',
    };
  }

  dispose(): void {
    this.detach();
    this.meshA.geometry.dispose();
    (this.meshA.material as THREE.Material).dispose();
    this.meshB.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.production?.dispose();
    for (const t of this.textures) t.dispose();
    this.labelTex.dispose();
    (this.labelMesh.material as THREE.Material).dispose();
    this.labelMesh.geometry.dispose();
  }

  private placeContent(): void {
    if (this.worldAnchor === 'origin') {
      this.content.position.set(0, 1.15, -1.4);
      return;
    }
    const dist = 1.15 * STORE_UNITS_PER_METER;
    const lookX = -Math.sin(SPAWN_YAW);
    const lookZ = -Math.cos(SPAWN_YAW);
    this.content.position.set(
      SPAWN_X + lookX * dist,
      1.15,
      SPAWN_Z + lookZ * dist,
    );
    this.content.rotation.y = SPAWN_YAW + Math.PI;
  }

  private applyMode(): void {
    this.meshA.visible = this.mode === 'A';
    this.meshB.visible = this.mode === 'B';
    if (this.production) {
      this.production.mesh.visible = this.mode === 'C' || this.mode === 'D' || this.mode === 'E';
      if (this.mode === 'C' || this.mode === 'D' || this.mode === 'E') {
        this.production.setMode(this.mode);
      }
    }
    this.lastLabel = '';
  }

  private paintLabel(): void {
    const declared = hwPosterDiagModeMeta(this.mode);
    const obs = hwDiagObserveSnapshot();
    const line1 = LABELS[this.mode];
    const line2 = `BASE ${declared.baseEnabled ? 'on' : 'off'}  NEAR ${declared.detailLutEnabled ? 'on' : 'off'}  FOCUS ${declared.focusEnabled ? 'on' : 'off'}  prodPath ${declared.shaderPath === 'posterShaderChunk' ? 'yes' : 'no'}  bind ${obs.diagBankBindCount}`;
    const text = `${line1}\n${line2}`;
    if (text === this.lastLabel) return;
    this.lastLabel = text;
    const ctx = this.labelCanvas.getContext('2d');
    if (!ctx) return;
    const w = this.labelCanvas.width;
    const h = this.labelCanvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(8,12,20,0.78)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#9fe8d8';
    ctx.strokeRect(1, 1, w - 2, h - 2);
    ctx.fillStyle = '#e8fff8';
    ctx.font = '22px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText(line1, 12, 36);
    ctx.fillStyle = '#9fe8d8';
    ctx.font = '16px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText(line2, 12, 68);
    ctx.fillText(`id ${HW_DIAG_MEDIA_ID}  ·  thumbstick click cycles`, 12, 96);
    this.labelTex.needsUpdate = true;
  }

  private track(tex: THREE.Texture): THREE.Texture {
    this.textures.push(tex);
    return tex;
  }

  private makeA(w: number, h: number): THREE.Mesh {
    const mat = new THREE.MeshBasicMaterial({
      map: this.track(makeDirectTex(POSTER_FOCUS_WIDTH, POSTER_FOCUS_HEIGHT, 3)),
      depthTest: false,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.name = 'hw-diag-A';
    return mesh;
  }

  private makeBProduction(deps: HwDiagCaseDeps): THREE.InstancedMesh {
    const geo = deps.createCaseGeometry(1);
    const mat = new THREE.MeshBasicMaterial({
      map: this.track(makeDirectTex(POSTER_FOCUS_WIDTH, POSTER_FOCUS_HEIGHT, 3)),
      depthTest: true,
      depthWrite: false,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, 1);
    mesh.name = 'hw-diag-B';
    mesh.setMatrixAt(0, new THREE.Matrix4());
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    return mesh;
  }

  private makeBFallback(w: number, h: number): THREE.Mesh {
    const mat = new THREE.MeshBasicMaterial({
      map: this.track(makeDirectTex(POSTER_FOCUS_WIDTH, POSTER_FOCUS_HEIGHT, 3)),
      depthTest: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.024), mat);
    mesh.name = 'hw-diag-B-fallback';
    return mesh;
  }
}
