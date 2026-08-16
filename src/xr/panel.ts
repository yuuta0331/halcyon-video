// High-acuity XR help / status surface.
//
// When compositor layers are available this is an XRQuadLayer whose pixel
// size is independent of the projection buffer. Otherwise the same canvas
// is shown on a Three.js mesh (world-occluded). Never head-locked: the
// surface is body-oriented on the player rig (local-floor / rig parent).

import * as THREE from 'three';
import { BB_MONO } from '../bundled-fonts';
import { canvasFontStack, containsCjk } from '../i18n/text';
import { ensureCjkFont } from '../i18n/cjk-font';
import { STORE_UNITS_PER_METER } from '../platform';
import { xrPanelContent, type XrPanelContent } from './panel-content';

export { xrPanelContent } from './panel-content';
export type { XrPanelContent } from './panel-content';

export const XR_PANEL_PIXEL_WIDTH = 1024;
export const XR_PANEL_PIXEL_HEIGHT = 512;
/** Quad width in meters (then scaled by the rig origin). */
export const XR_PANEL_WIDTH_M = 0.72;
export const XR_PANEL_HEIGHT_M = 0.36;

export function paintXrPanel(
  ctx: CanvasRenderingContext2D,
  content: XrPanelContent,
): void {
  const w = XR_PANEL_PIXEL_WIDTH;
  const h = XR_PANEL_PIXEL_HEIGHT;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0c1220';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#c9a227';
  ctx.lineWidth = 10;
  ctx.strokeRect(8, 8, w - 16, h - 16);

  const texts = [content.title, ...content.lines];
  if (texts.some(containsCjk)) ensureCjkFont();

  ctx.fillStyle = '#f4efe4';
  ctx.textBaseline = 'top';
  ctx.font = `bold 42px ${canvasFontStack(content.title, BB_MONO)}`;
  ctx.fillText(content.title, 48, 36);
  ctx.fillStyle = '#c9a227';
  ctx.fillRect(48, 92, 280, 4);

  ctx.fillStyle = '#e8e0d0';
  let y = 120;
  for (const line of content.lines) {
    ctx.font = `28px ${canvasFontStack(line, BB_MONO)}`;
    ctx.fillText(line, 48, y);
    y += 48;
  }
}

export class XrHelpPanel {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  readonly mesh: THREE.Mesh;
  private dirty = true;
  private content: XrPanelContent;
  private cjkArmed = false;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = XR_PANEL_PIXEL_WIDTH;
    this.canvas.height = XR_PANEL_PIXEL_HEIGHT;
    this.content = xrPanelContent({
      compositor: 'mesh-fallback',
      layersFeature: 'unknown',
      referenceSpace: null,
      targetHz: null,
    });
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const geom = new THREE.PlaneGeometry(XR_PANEL_WIDTH_M, XR_PANEL_HEIGHT_M);
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: false,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geom, mat);
    this.mesh.name = 'xr-help-panel';
    this.mesh.renderOrder = 999;
    // Body-oriented, not head-locked: offset in the meter-scaled origin.
    // ~1.15 m ahead, slightly left and below eye height so it is not a HUD.
    this.mesh.position.set(-0.22, 1.25, -1.15);
    this.mesh.rotation.y = 0.12;
  }

  setContent(content: XrPanelContent): void {
    this.content = content;
    this.dirty = true;
    if (!this.cjkArmed && [content.title, ...content.lines].some(containsCjk)) {
      this.cjkArmed = true;
      ensureCjkFont(() => {
        this.dirty = true;
      });
    }
  }

  /** Returns true when the canvas was rewritten this call. */
  flush(): boolean {
    if (!this.dirty) return false;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return false;
    paintXrPanel(ctx, this.content);
    this.texture.needsUpdate = true;
    this.dirty = false;
    return true;
  }

  showMesh(origin: THREE.Object3D): void {
    if (this.mesh.parent !== origin) origin.add(this.mesh);
    this.mesh.visible = true;
  }

  hideMesh(): void {
    this.mesh.visible = false;
    this.mesh.removeFromParent();
  }

  dispose(): void {
    this.hideMesh();
    this.texture.dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

export function panelUsesIndependentResolution(): boolean {
  return XR_PANEL_PIXEL_WIDTH > 0 && XR_PANEL_PIXEL_HEIGHT > 0;
}

/** Store-unit size of the fallback mesh (meters × store scale). */
export function panelMeshSizeStoreUnits(): { w: number; h: number } {
  return {
    w: XR_PANEL_WIDTH_M * STORE_UNITS_PER_METER,
    h: XR_PANEL_HEIGHT_M * STORE_UNITS_PER_METER,
  };
}
