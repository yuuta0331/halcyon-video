// Test-only close-range black-artifact A/B diagnostic.
// Enabled only by ?xrPosterHwDiag=1. Normal launch must not create these meshes.

import * as THREE from 'three';
import { MIRROR_SKIP_LAYER } from '../scene-layers.ts';
import { makeHardwarePosterDiagnosticPattern } from '../poster-quality-pattern.ts';
import { POSTER_FOCUS_HEIGHT, POSTER_FOCUS_WIDTH } from '../poster-quality.ts';
import {
  MODE_HUD_SIZE_M,
  MODE_HUD_VIEW_OFFSET,
  placeHudFromViewerPose,
} from './hud-placement.ts';
import type { XrViewerPoseState } from './viewer-pose.ts';
import { latestViewerWorldPose, poseIsCurrent } from './viewer-pose.ts';
import { STORE_UNITS_PER_METER } from '../platform/index.ts';
import { hwDiagObserveSnapshot } from '../perf/hw-diag-observe.ts';
import { placeHardwarePosterFromViewer } from './hardware-poster-placement.ts';

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
  baselineSemantics: string | null;
}

const LABELS: Record<HwPosterDiagMode, string> = {
  A: 'MODE A — FLAT_DIRECT_BASIC',
  B: 'MODE B — PRODUCTION_CASE_GEOMETRY_DIRECT_BASIC',
  C: 'MODE C — PRODUCTION_CASE_BASE_ONLY',
  D: 'MODE D — PRODUCTION_CASE_BASE_PLUS_NEAR',
  E: 'MODE E — FULL_PRODUCTION',
};

const HUD_TIER: Record<HwPosterDiagMode, string> = {
  A: 'DIRECT BASIC',
  B: 'CASE + BASIC',
  C: 'BASE ONLY',
  D: 'BASE + NEAR',
  E: 'FULL + FOCUS',
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

function makeDirectTex(w: number, h: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(makeHardwarePosterDiagnosticPattern(w, h), w, h);
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
  | 'baselineSemantics'
  | 'side'
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
    side: mode === 'A' ? 'DoubleSide' : 'FrontSide',
    baselineSemantics: mode === 'A'
      ? 'Basic direct texture/compositor baseline; DoubleSide intentionally excludes backface culling.'
      : null,
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
  private viewerEyeHeightM: number | null = null;
  private viewerEyeWorldHeightStoreUnits: number | null = null;
  private placedFromFreshViewerPose = false;
  private readonly worldAnchor: 'spawn' | 'origin';
  private readonly _contentWorld = new THREE.Vector3();
  private readonly _labelWorld = new THREE.Vector3();

  constructor(opts: { worldAnchor?: 'spawn' | 'origin'; deps?: HwDiagCaseDeps } = {}) {
    this.worldAnchor = opts.worldAnchor ?? 'spawn';
    this.content.name = 'xr-hw-poster-diag';
    this.placeFallbackContent();
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
      : { width: 768, height: 320, getContext: () => null }) as unknown as HTMLCanvasElement;
    this.labelCanvas.width = 768;
    this.labelCanvas.height = 320;
    this.labelTex = new THREE.CanvasTexture(this.labelCanvas);
    this.labelTex.minFilter = THREE.LinearFilter;
    this.labelTex.magFilter = THREE.LinearFilter;
    const labelMat = new THREE.MeshBasicMaterial({
      map: this.labelTex,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    this.labelMesh = new THREE.Mesh(new THREE.PlaneGeometry(MODE_HUD_SIZE_M.width, MODE_HUD_SIZE_M.height), labelMat);
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
    if (!this.placedFromFreshViewerPose && pose && poseIsCurrent(pose) && world) {
      const placed = placeHardwarePosterFromViewer({
        viewerX: world.x,
        viewerY: world.y,
        viewerZ: world.z,
        viewerYaw: world.yaw,
        storeUnitsPerMeter: STORE_UNITS_PER_METER,
      });
      this.content.position.set(placed.x, placed.y, placed.z);
      this.content.rotation.set(0, placed.yaw, 0);
      this.content.visible = true;
      this.placedFromFreshViewerPose = true;
      this.viewerEyeHeightM = pose.y;
      this.viewerEyeWorldHeightStoreUnits = world.y;
    }
    this.content.getWorldPosition(this._contentWorld);
    if (world) {
      this.viewerDistance = Math.hypot(
        world.x - this._contentWorld.x,
        world.z - this._contentWorld.z,
      ) / STORE_UNITS_PER_METER;
    } else {
      // Do not compare reference-space meters with scene/store coordinates.
      this.viewerDistance = 0;
    }
    if (pose?.valid) {
      const hud = placeHudFromViewerPose(pose, MODE_HUD_VIEW_OFFSET);
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

  snapshot(
    glError: number | null = null,
    contextLost = false,
    runtime: Record<string, unknown> = {},
    classification: 'UNIT' | 'DESKTOP_BROWSER' | 'IWER_EMULATED' | 'QUEST_HARDWARE' = 'DESKTOP_BROWSER',
  ) {
    const observed = hwDiagObserveSnapshot();
    const runtimePose = runtime.viewerPose as XrViewerPoseState | undefined;
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
      placement: {
        source: this.placedFromFreshViewerPose ? 'INITIAL_FRESH_XR_VIEWER_POSE' : 'FALLBACK_PENDING_POSE',
        posterWorldHeightStoreUnits: this._contentWorld.y,
        posterWorldHeightM: this._contentWorld.y / STORE_UNITS_PER_METER,
        viewerEyeHeightM: this.viewerEyeHeightM,
        viewerEyeWorldHeightStoreUnits: this.viewerEyeWorldHeightStoreUnits,
        viewerDistanceM: this.viewerDistance,
        position: { x: this._contentWorld.x, y: this._contentWorld.y, z: this._contentWorld.z },
        horizontalYaw: this.content.rotation.y,
        worldStableAfterPlacement: true,
      },
      modeHud: {
        viewerOffsetM: MODE_HUD_VIEW_OFFSET,
        sizeM: MODE_HUD_SIZE_M,
        position: { x: this.labelMesh.position.x, y: this.labelMesh.position.y, z: this.labelMesh.position.z },
        quaternion: {
          x: this.labelMesh.quaternion.x,
          y: this.labelMesh.quaternion.y,
          z: this.labelMesh.quaternion.z,
          w: this.labelMesh.quaternion.w,
        },
      },
      hudPoseFresh: runtimePose ? poseIsCurrent(runtimePose) : false,
      runtime,
      classification,
      QUEST_HARDWARE: classification === 'QUEST_HARDWARE'
        ? 'EXECUTED_RESULT_PENDING'
        : 'NOT_EXECUTED',
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

  private placeFallbackContent(): void {
    if (this.worldAnchor === 'origin') {
      this.content.position.set(0, 1.15, -1.4);
      this.content.rotation.set(0, 0, 0);
      this.content.visible = true;
      return;
    }
    const dist = 1.15 * STORE_UNITS_PER_METER;
    const lookX = -Math.sin(SPAWN_YAW);
    const lookZ = -Math.cos(SPAWN_YAW);
    this.content.position.set(
      SPAWN_X + lookX * dist,
      1.6 * STORE_UNITS_PER_METER,
      SPAWN_Z + lookZ * dist,
    );
    this.content.rotation.y = SPAWN_YAW;
    // Avoid a foot-level/incorrect fallback flash. The real fixture becomes
    // visible only after the first fresh XR_VIEWER_POSE has placed it.
    this.content.visible = false;
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
    const line1 = `MODE ${this.mode}`;
    const line2 = HUD_TIER[this.mode];
    const line3 = `distance ${this.viewerDistance.toFixed(1)}m`;
    const text = `${line1}\n${line2}\n${line3}`;
    if (text === this.lastLabel) return;
    this.lastLabel = text;
    const ctx = this.labelCanvas.getContext('2d');
    if (!ctx) return;
    const w = this.labelCanvas.width;
    const h = this.labelCanvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(2,5,10,0.92)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#9fe8d8';
    ctx.lineWidth = 8;
    ctx.strokeRect(5, 5, w - 10, h - 10);
    ctx.fillStyle = '#f4fffc';
    ctx.font = 'bold 92px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText(line1, 34, 112);
    ctx.fillStyle = '#9fe8d8';
    ctx.font = '52px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText(line2, 36, 202);
    ctx.fillStyle = '#d8e5e2';
    ctx.font = '42px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText(line3, 36, 274);
    this.labelTex.needsUpdate = true;
  }

  private track(tex: THREE.Texture): THREE.Texture {
    this.textures.push(tex);
    return tex;
  }

  private makeA(w: number, h: number): THREE.Mesh {
    const mat = new THREE.MeshBasicMaterial({
      map: this.track(makeDirectTex(POSTER_FOCUS_WIDTH, POSTER_FOCUS_HEIGHT)),
      depthTest: false,
      depthWrite: false,
      // Baseline tests direct texturing/compositor visibility. Backface
      // culling is intentionally removed as a variable after the Round 5B
      // fixture was proven to have the wrong yaw.
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.name = 'hw-diag-A';
    return mesh;
  }

  private makeBProduction(deps: HwDiagCaseDeps): THREE.InstancedMesh {
    const geo = deps.createCaseGeometry(1);
    const mat = new THREE.MeshBasicMaterial({
      map: this.track(makeDirectTex(POSTER_FOCUS_WIDTH, POSTER_FOCUS_HEIGHT)),
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
      map: this.track(makeDirectTex(POSTER_FOCUS_WIDTH, POSTER_FOCUS_HEIGHT)),
      depthTest: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.024), mat);
    mesh.name = 'hw-diag-B-fallback';
    return mesh;
  }
}
