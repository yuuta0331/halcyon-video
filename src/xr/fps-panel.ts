// Immersive FPS readout. Same statistics source as the desktop DOM meter.
// No extra rAF loop.

import * as THREE from 'three';
import { fpsMeterReadout, isFpsMeterEnabled } from '../fps-meter.ts';
import { FPS_HUD_SIZE_M } from './hud-placement.ts';

const W = 768;
const H = 360;
const PAINT_INTERVAL_MS = 500;

export class XrFpsHud {
  readonly mesh: THREE.Mesh;
  private readonly canvas: HTMLCanvasElement;
  private readonly texture: THREE.CanvasTexture;
  private lastPaintKey = '';
  private lastPaintAt = -Infinity;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    const geom = new THREE.PlaneGeometry(FPS_HUD_SIZE_M.width, FPS_HUD_SIZE_M.height);
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geom, mat);
    this.mesh.name = 'xr-fps-hud';
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
    this.mesh.position.set(-0.25, 0.17, -0.62);
  }

  sync(parent: THREE.Object3D | null, pose?: {
    x: number; y: number; z: number;
    qx: number; qy: number; qz: number; qw: number;
  } | null, atMs = typeof performance !== 'undefined' ? performance.now() : 0): void {
    const on = isFpsMeterEnabled();
    if (!on || !parent) {
      this.mesh.visible = false;
      if (this.mesh.parent) this.mesh.removeFromParent();
      return;
    }
    if (this.mesh.parent !== parent) parent.add(this.mesh);
    this.mesh.visible = true;
    if (pose) {
      this.mesh.position.set(pose.x, pose.y, pose.z);
      this.mesh.quaternion.set(pose.qx, pose.qy, pose.qz, pose.qw);
    }
    // Transform follows every fresh pose, but stats sorting + canvas upload are
    // capped at 2Hz so the diagnostic does not manufacture its own frame loss.
    if (atMs - this.lastPaintAt < PAINT_INTERVAL_MS) return;
    this.lastPaintAt = atMs;
    const readout = fpsMeterReadout(atMs);
    const major = readout.fps == null ? 'FPS --' : `FPS ${Math.round(readout.fps)}`;
    const low = readout.p99Ms == null ? '1% --' : `1% ${Math.round(1000 / readout.p99Ms)}`;
    const worst = readout.worstMs == null ? 'worst --' : `worst ${readout.worstMs.toFixed(1)}ms`;
    const mean = readout.meanMs == null ? 'mean --' : `mean ${readout.meanMs.toFixed(1)}ms`;
    const key = `${major}|${low}|${worst}|${mean}`;
    if (key === this.lastPaintKey) return;
    this.lastPaintKey = key;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(2,5,10,0.92)';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#9fe8d8';
    ctx.lineWidth = 8;
    ctx.strokeRect(5, 5, W - 10, H - 10);
    ctx.fillStyle = '#f4fffc';
    ctx.font = 'bold 116px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillText(major, 34, 128);
    ctx.fillStyle = '#9fe8d8';
    ctx.font = '52px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillText(`${low}   ${worst}`, 36, 226);
    ctx.fillStyle = '#d8e5e2';
    ctx.font = '42px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillText(mean, 36, 300);
    this.texture.needsUpdate = true;
  }

  snapshot() {
    return {
      visible: this.mesh.visible,
      parent: this.mesh.parent?.name ?? null,
      position: { x: this.mesh.position.x, y: this.mesh.position.y, z: this.mesh.position.z },
      quaternion: {
        x: this.mesh.quaternion.x,
        y: this.mesh.quaternion.y,
        z: this.mesh.quaternion.z,
        w: this.mesh.quaternion.w,
      },
      sizeM: FPS_HUD_SIZE_M,
      canvas: { width: W, height: H },
      paintIntervalMs: PAINT_INTERVAL_MS,
    };
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.texture.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.geometry.dispose();
  }
}
