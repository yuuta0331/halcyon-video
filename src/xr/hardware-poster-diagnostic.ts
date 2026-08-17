// Test-only close-range black-artifact A/B diagnostic.
// Enabled only by ?xrPosterHwDiag=1. Normal launch must not create these meshes.

import * as THREE from 'three';
import { MIRROR_SKIP_LAYER } from '../scene-layers.ts';
import { makePosterQualityPattern } from '../poster-quality-pattern.ts';
import { POSTER_BASE_XR_HEIGHT, POSTER_BASE_XR_WIDTH, POSTER_FOCUS_HEIGHT, POSTER_FOCUS_WIDTH, POSTER_NEAR_HEIGHT, POSTER_NEAR_WIDTH } from '../poster-quality.ts';
import { placeHudFromViewerPose } from './hud-placement.ts';
import type { XrViewerPoseState } from './viewer-pose.ts';

export const HW_DIAG_QUERY = 'xrPosterHwDiag';
export const HW_DIAG_MEDIA_ID = 'hwdiag-opaque-0';

export type HwPosterDiagMode = 'A' | 'B' | 'C' | 'D' | 'E';

export const HW_POSTER_DIAG_MODES: readonly HwPosterDiagMode[] = ['A', 'B', 'C', 'D', 'E'];

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
}

const LABELS: Record<HwPosterDiagMode, string> = {
  A: 'MODE A — FLAT_DIRECT_BASIC',
  B: 'MODE B — CASE_GEOMETRY_DIRECT_BASIC',
  C: 'MODE C — CASE_BASE_ARRAY',
  D: 'MODE D — CASE_DETAIL_SIMPLIFIED',
  E: 'MODE E — FULL_PRODUCTION',
};

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

function makeArrayTex(w: number, h: number, mips: boolean, seed: number): THREE.DataArrayTexture {
  const tex = new THREE.DataArrayTexture(makePosterQualityPattern(w, h, seed), w, h, 1);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = mips;
  tex.needsUpdate = true;
  return tex;
}

const CASE_W = 0.365;
const CASE_H = 0.667;
const CASE_D = 0.024;

export function hwPosterDiagModeMeta(mode: HwPosterDiagMode): Pick<HwPosterDiagMeta, 'mode' | 'label' | 'materialType' | 'textureType' | 'array' | 'mipPolicy' | 'depthTest' | 'depthWrite' | 'stereoBothEyes' | 'cycleHint'> {
  return {
    mode,
    label: LABELS[mode],
    materialType: mode === 'E'
      ? 'MeshStandardMaterial'
      : mode === 'C' || mode === 'D'
        ? 'ShaderMaterial-array'
        : 'MeshBasicMaterial',
    textureType: mode === 'A' || mode === 'B' || mode === 'E' ? 'DataTexture' : 'DataArrayTexture',
    array: mode === 'C' || mode === 'D',
    mipPolicy: mode === 'C' || mode === 'E' ? 'mips' : 'none',
    depthTest: mode !== 'A',
    depthWrite: mode === 'E',
    stereoBothEyes: true,
    cycleHint: 'thumbstick click: cycle A→B→C→D→E',
  };
}

export class HardwarePosterDiagnostic {
  readonly group = new THREE.Group();
  private mode: HwPosterDiagMode = 'A';
  private readonly meshes = new Map<HwPosterDiagMode, THREE.Object3D>();
  private readonly textures: THREE.Texture[] = [];
  private readonly labelMesh: THREE.Mesh;
  private readonly labelCanvas: HTMLCanvasElement;
  private readonly labelTex: THREE.CanvasTexture;
  private lastLabel = '';
  private thumbPrev = false;
  private viewerDistance = 0;

  constructor() {
    this.group.name = 'xr-hw-poster-diag';
    this.group.position.set(0.35, 1.25, -1.15);
    this.meshes.set('A', this.makeA());
    this.meshes.set('B', this.makeB());
    this.meshes.set('C', this.makeC());
    this.meshes.set('D', this.makeD());
    this.meshes.set('E', this.makeE());
    for (const mesh of this.meshes.values()) {
      this.group.add(mesh);
      enableStereo(mesh);
    }
    this.labelCanvas = document.createElement('canvas');
    this.labelCanvas.width = 512;
    this.labelCanvas.height = 96;
    this.labelTex = new THREE.CanvasTexture(this.labelCanvas);
    this.labelTex.minFilter = THREE.LinearFilter;
    this.labelTex.magFilter = THREE.LinearFilter;
    const labelMat = new THREE.MeshBasicMaterial({
      map: this.labelTex,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    this.labelMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.08), labelMat);
    this.labelMesh.name = 'xr-hw-poster-diag-label';
    this.labelMesh.renderOrder = 20;
    enableStereo(this.labelMesh);
    enableStereo(this.group);
    this.applyMode();
  }

  attach(parent: THREE.Object3D): void {
    if (this.group.parent !== parent) parent.add(this.group);
    if (this.labelMesh.parent !== parent) parent.add(this.labelMesh);
  }

  detach(): void {
    this.group.removeFromParent();
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

  /** Thumbstick click cycles. Must not run unless diagnostic is attached. */
  noteButtons(thumbstick: boolean): void {
    if (thumbstick && !this.thumbPrev) this.cycle();
    this.thumbPrev = thumbstick;
  }

  tick(pose: XrViewerPoseState | null, cameraNear: number, cameraFar: number): HwPosterDiagMeta {
    if (pose?.valid) {
      this.viewerDistance = Math.hypot(pose.x - this.group.position.x, pose.z - this.group.position.z);
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
    const mode = this.mode;
    return {
      ...hwPosterDiagModeMeta(mode),
      side: 'FrontSide',
      transparent: false,
      near: cameraNear,
      far: cameraFar,
      viewerDistance: this.viewerDistance,
    };
  }

  snapshot(glError: number | null = null, contextLost = false) {
    return {
      enabled: true,
      mediaId: HW_DIAG_MEDIA_ID,
      ...this.meta(),
      glError,
      contextLost,
      classification: 'IWER_EMULATED' as const,
      QUEST_HARDWARE: 'NOT_EXECUTED',
    };
  }

  dispose(): void {
    this.detach();
    for (const mesh of this.meshes.values()) {
      mesh.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
    }
    for (const t of this.textures) t.dispose();
    this.labelTex.dispose();
    (this.labelMesh.material as THREE.Material).dispose();
    this.labelMesh.geometry.dispose();
    this.meshes.clear();
  }

  private applyMode(): void {
    for (const [key, mesh] of this.meshes) mesh.visible = key === this.mode;
    this.lastLabel = '';
  }

  private paintLabel(): void {
    const text = `${LABELS[this.mode]}  ·  thumbstick click cycles`;
    if (text === this.lastLabel) return;
    this.lastLabel = text;
    const ctx = this.labelCanvas.getContext('2d');
    if (!ctx) return;
    const w = this.labelCanvas.width;
    const h = this.labelCanvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(8,12,20,0.72)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#9fe8d8';
    ctx.strokeRect(1, 1, w - 2, h - 2);
    ctx.fillStyle = '#e8fff8';
    ctx.font = '22px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText(text, 12, 38);
    ctx.fillStyle = '#9fe8d8';
    ctx.font = '16px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText(`id ${HW_DIAG_MEDIA_ID}`, 12, 68);
    this.labelTex.needsUpdate = true;
  }

  private track(tex: THREE.Texture): THREE.Texture {
    this.textures.push(tex);
    return tex;
  }

  private makeA(): THREE.Mesh {
    const mat = new THREE.MeshBasicMaterial({
      map: this.track(makeDirectTex(POSTER_FOCUS_WIDTH, POSTER_FOCUS_HEIGHT, 3)),
      depthTest: false,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(CASE_W, CASE_H), mat);
    mesh.name = 'hw-diag-A';
    return mesh;
  }

  private makeB(): THREE.Group {
    const g = new THREE.Group();
    g.name = 'hw-diag-B';
    const shell = new THREE.Mesh(
      new THREE.BoxGeometry(CASE_W, CASE_H, CASE_D),
      new THREE.MeshBasicMaterial({ color: 0x1a1a1a, depthTest: true, depthWrite: false }),
    );
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(CASE_W * 0.96, CASE_H * 0.96),
      new THREE.MeshBasicMaterial({
        map: this.track(makeDirectTex(POSTER_FOCUS_WIDTH, POSTER_FOCUS_HEIGHT, 3)),
        depthTest: true,
        depthWrite: false,
      }),
    );
    face.position.z = CASE_D * 0.52;
    g.add(shell);
    g.add(face);
    return g;
  }

  private makeC(): THREE.Group {
    return this.makeArrayCase('hw-diag-C', POSTER_BASE_XR_WIDTH, POSTER_BASE_XR_HEIGHT, true, 1);
  }

  private makeD(): THREE.Group {
    return this.makeArrayCase('hw-diag-D', POSTER_NEAR_WIDTH, POSTER_NEAR_HEIGHT, false, 5);
  }

  private makeE(): THREE.Group {
    const g = new THREE.Group();
    g.name = 'hw-diag-E';
    const tex = this.track(makeDirectTex(POSTER_NEAR_WIDTH, POSTER_NEAR_HEIGHT, 9));
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    const shell = new THREE.Mesh(
      new THREE.BoxGeometry(CASE_W, CASE_H, CASE_D),
      new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.7, metalness: 0, depthTest: true, depthWrite: true }),
    );
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(CASE_W * 0.96, CASE_H * 0.96),
      new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.62,
        metalness: 0,
        depthTest: true,
        depthWrite: true,
      }),
    );
    face.position.z = CASE_D * 0.52;
    g.add(shell);
    g.add(face);
    return g;
  }

  private makeArrayCase(name: string, w: number, h: number, mips: boolean, seed: number): THREE.Group {
    const g = new THREE.Group();
    g.name = name;
    const arr = this.track(makeArrayTex(w, h, mips, seed)) as THREE.DataArrayTexture;
    const mat = new THREE.ShaderMaterial({
      uniforms: { shelfMapArray: { value: arr } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        precision highp sampler2DArray;
        uniform sampler2DArray shelfMapArray;
        varying vec2 vUv;
        void main() {
          gl_FragColor = texture(shelfMapArray, vec3(vUv, 0.0));
        }
      `,
      depthTest: true,
      depthWrite: false,
    });
    const shell = new THREE.Mesh(
      new THREE.BoxGeometry(CASE_W, CASE_H, CASE_D),
      new THREE.MeshBasicMaterial({ color: 0x141414, depthTest: true, depthWrite: false }),
    );
    const face = new THREE.Mesh(new THREE.PlaneGeometry(CASE_W * 0.96, CASE_H * 0.96), mat);
    face.position.z = CASE_D * 0.52;
    g.add(shell);
    g.add(face);
    return g;
  }
}
