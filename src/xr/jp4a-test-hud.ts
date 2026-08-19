import * as THREE from 'three';
import { MODE_HUD_SIZE_M, MODE_HUD_VIEW_OFFSET, placeHudFromViewerPose } from './hud-placement.ts';
import type { XrViewerPoseState } from './viewer-pose.ts';
import { jp4aTestSnapshot, type LivePosterMode } from './jp4a-test-state.ts';

const W = 1024;
const H = 320;

const STEPS = [
  ['STEP 1 / 5', 'CHECK BASELINE FPS'],
  ['STEP 2 / 5', 'POINT AT A BLACK POSTER — TRIGGER TO LOCK'],
  ['STEP 3 / 5', 'THUMBSTICK: NEXT  •  GRIP: PREVIOUS'],
  ['STEP 4 / 5', 'APPROACH POSTER / WAIT FOR FOCUS'],
  ['STEP 5 / 5', 'DONE — EXIT VR AND COPY RESULT'],
] as const;

export class Jp4aTestHud {
  readonly mesh: THREE.Mesh;
  private readonly canvas: HTMLCanvasElement;
  private readonly texture: THREE.CanvasTexture;
  private lastKey = '';

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(MODE_HUD_SIZE_M.width, MODE_HUD_SIZE_M.height),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false }),
    );
    this.mesh.name = 'jp4a-test-hud';
    this.mesh.renderOrder = 30;
    this.mesh.visible = false;
  }

  sync(parent: THREE.Object3D | null, pose: XrViewerPoseState): void {
    const session = jp4aTestSnapshot();
    if (!parent || !session?.active) {
      this.mesh.visible = false;
      this.mesh.removeFromParent();
      return;
    }
    if (this.mesh.parent !== parent) parent.add(this.mesh);
    this.mesh.visible = true;
    const placed = placeHudFromViewerPose(pose, MODE_HUD_VIEW_OFFSET);
    if (placed) {
      this.mesh.position.set(placed.x, placed.y, placed.z);
      this.mesh.quaternion.set(placed.qx, placed.qy, placed.qz, placed.qw);
    }
    this.paint(session.step, session.mode, session.modeVerdicts[session.mode], session.lockedPoster?.opaqueId ?? null);
  }

  snapshot() {
    return {
      visible: this.mesh.visible,
      viewerOffsetM: MODE_HUD_VIEW_OFFSET,
      sizeM: MODE_HUD_SIZE_M,
      followsViewer: true,
      centered: true,
    };
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.texture.dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }

  private paint(step: number, mode: LivePosterMode, verdict: string, opaqueId: string | null): void {
    const i = Math.max(0, Math.min(4, step - 1));
    const key = `${i}|${mode}|${verdict}|${opaqueId}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(2,5,10,0.94)';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#9fe8d8';
    ctx.lineWidth = 8;
    ctx.strokeRect(5, 5, W - 10, H - 10);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#9fe8d8';
    ctx.font = 'bold 54px ui-monospace,Menlo,Consolas,monospace';
    ctx.fillText(STEPS[i]![0], W / 2, 67);
    ctx.fillStyle = '#f4fffc';
    ctx.font = 'bold 44px ui-monospace,Menlo,Consolas,monospace';
    ctx.fillText(STEPS[i]![1], W / 2, 126);
    ctx.fillStyle = '#ffd56a';
    ctx.font = 'bold 46px ui-monospace,Menlo,Consolas,monospace';
    ctx.fillText(`${mode}  [${verdict}]`, W / 2, 200);
    ctx.fillStyle = '#d8e5e2';
    ctx.font = '34px ui-monospace,Menlo,Consolas,monospace';
    ctx.fillText(opaqueId ? `${opaqueId}  •  TRIGGER MARKS BLACK/CLEAN` : 'TRIGGER: LOCK POSTER', W / 2, 260);
    this.texture.needsUpdate = true;
  }
}
