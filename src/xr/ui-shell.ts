import * as THREE from 'three';
import { ensureCjkFont } from '../i18n/cjk-font';
import { XR_UI_PIXEL_HEIGHT, XR_UI_PIXEL_WIDTH, uvToRowIndex } from './ui/hit';
import { clipXrLabel, layoutXrLines, xrUiFontStack, xrUiNeedsCjk } from './ui/layout';
import type { XrUiPaint } from './ui-session';

export const XR_UI_WIDTH_M = 0.84;
export const XR_UI_HEIGHT_M = 0.63;

export function paintXrUi(ctx: CanvasRenderingContext2D, paint: XrUiPaint): void {
  const w = XR_UI_PIXEL_WIDTH;
  const h = XR_UI_PIXEL_HEIGHT;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0c1220';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#c9a227';
  ctx.lineWidth = 10;
  ctx.strokeRect(8, 8, w - 16, h - 16);

  const texts = [paint.title, paint.hint, ...paint.rows.flatMap((r) => [r.label, r.value])];
  if (xrUiNeedsCjk(texts)) ensureCjkFont();

  ctx.textBaseline = 'top';
  ctx.fillStyle = '#f4efe4';
  ctx.font = `bold 40px ${xrUiFontStack(paint.title)}`;
  ctx.fillText(clipXrLabel(paint.title, w - 96, (s) => ctx.measureText(s).width), 48, 28);
  ctx.fillStyle = '#c9a227';
  ctx.fillRect(48, 80, 280, 4);

  ctx.fillStyle = '#9aa3b5';
  ctx.font = `22px ${xrUiFontStack(paint.hint)}`;
  const hintLines = layoutXrLines(paint.hint, w - 96, (s) => ctx.measureText(s).width, 2);
  let hy = 96;
  for (const line of hintLines) {
    ctx.fillText(line, 48, hy);
    hy += 28;
  }

  const bodyTop = 160;
  const bodyBottom = h - 56;
  const rowH = paint.rows.length > 0 ? (bodyBottom - bodyTop) / paint.rows.length : 48;
  paint.rows.forEach((row, i) => {
    const y = bodyTop + i * rowH;
    if (row.selected) {
      ctx.fillStyle = 'rgba(201,162,39,0.22)';
      ctx.fillRect(32, y, w - 64, rowH - 6);
    }
    ctx.fillStyle = row.status ? '#8b93a7' : '#e8e0d0';
    ctx.font = `28px ${xrUiFontStack(row.label)}`;
    const label = clipXrLabel(row.label, 560, (s) => ctx.measureText(s).width);
    ctx.fillText(label, 48, y + 10);
    if (row.value) {
      ctx.fillStyle = row.status ? '#6e778a' : '#c9a227';
      ctx.font = `26px ${xrUiFontStack(row.value)}`;
      const value = clipXrLabel(row.value, 360, (s) => ctx.measureText(s).width);
      ctx.textAlign = 'right';
      ctx.fillText(value, w - 48, y + 10);
      ctx.textAlign = 'left';
    }
  });
}

export class XrUiShell {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  readonly mesh: THREE.Mesh;
  private dirty = true;
  private paintState: XrUiPaint = { title: '', hint: '', rows: [] };
  private cjkArmed = false;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = XR_UI_PIXEL_WIDTH;
    this.canvas.height = XR_UI_PIXEL_HEIGHT;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const geom = new THREE.PlaneGeometry(XR_UI_WIDTH_M, XR_UI_HEIGHT_M);
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: false,
      depthTest: true,
      depthWrite: true,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geom, mat);
    this.mesh.name = 'xr-ui-shell';
    this.mesh.position.set(0, 1.28, -1.05);
    this.mesh.visible = false;
  }

  setPaint(paint: XrUiPaint): void {
    this.paintState = paint;
    this.dirty = true;
    const texts = [paint.title, paint.hint, ...paint.rows.flatMap((r) => [r.label, r.value])];
    if (!this.cjkArmed && xrUiNeedsCjk(texts)) {
      this.cjkArmed = true;
      ensureCjkFont(() => { this.dirty = true; });
    }
  }

  flush(): boolean {
    if (!this.dirty) return false;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return false;
    paintXrUi(ctx, this.paintState);
    this.texture.needsUpdate = true;
    this.dirty = false;
    return true;
  }

  show(origin: THREE.Object3D): void {
    if (this.mesh.parent !== origin) origin.add(this.mesh);
    this.mesh.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  rowFromUv(v: number): number | null {
    return uvToRowIndex(v, this.paintState.rows.length);
  }
}

export { uvToRowIndex };
