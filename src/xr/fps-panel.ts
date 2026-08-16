// Immersive FPS readout. Same statistics source as the desktop DOM meter.
// No extra rAF loop.

import * as THREE from 'three';
import { fpsMeterReadout, isFpsMeterEnabled } from '../fps-meter.ts';

const W = 256;
const H = 64;

export class XrFpsHud {
  readonly mesh: THREE.Mesh;
  private readonly canvas: HTMLCanvasElement;
  private readonly texture: THREE.CanvasTexture;
  private lastTop = '';
  private lastBot = '';

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    const geom = new THREE.PlaneGeometry(0.28, 0.07);
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
    this.mesh.position.set(-0.22, 0.18, -0.55);
  }

  sync(parent: THREE.Object3D | null): void {
    const on = isFpsMeterEnabled();
    if (!on || !parent) {
      this.mesh.visible = false;
      if (this.mesh.parent) this.mesh.removeFromParent();
      return;
    }
    if (this.mesh.parent !== parent) parent.add(this.mesh);
    this.mesh.visible = true;
    const readout = fpsMeterReadout();
    if (readout.top === this.lastTop && readout.bot === this.lastBot) return;
    this.lastTop = readout.top;
    this.lastBot = readout.bot;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(4,8,14,0.55)';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(159,232,216,0.35)';
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
    ctx.fillStyle = '#9fe8d8';
    ctx.font = '16px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillText(readout.top, 10, 24);
    ctx.globalAlpha = 0.75;
    ctx.fillText(readout.bot, 10, 46);
    ctx.globalAlpha = 1;
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.texture.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.geometry.dispose();
  }
}
