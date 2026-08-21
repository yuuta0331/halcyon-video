import * as THREE from 'three';
import { MODE_HUD_SIZE_M, MODE_HUD_VIEW_OFFSET, placeHudFromViewerPose } from './hud-placement.ts';
import type { XrViewerPoseState } from './viewer-pose.ts';
import { jp4aTestSnapshot, type LivePosterMode } from './jp4a-test-state.ts';
import { jp4aHudStep, type Jp4aTestPhase } from './jp4a-test-phase.ts';

const W = 1024;
const H = 320;

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
    const baselineReady = session.samples.filter((s) => s.phase === 'baseline').length >= 8;
    this.paint(
      session.testPhase,
      baselineReady,
      session.mode,
      session.modeVerdicts[session.mode],
      session.lockedPoster?.opaqueId ?? null,
    );
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

  private paint(
    testPhase: Jp4aTestPhase,
    baselineReady: boolean,
    mode: LivePosterMode,
    verdict: string,
    opaqueId: string | null,
  ): void {
    const step = jp4aHudStep(testPhase, baselineReady);
    const key = `${step.title}|${step.instruction}|${mode}|${verdict}|${opaqueId}|${step.hint}`;
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
    ctx.font = 'bold 46px ui-monospace,Menlo,Consolas,monospace';
    ctx.fillText(step.title, W / 2, 58);
    ctx.fillStyle = '#f4fffc';
    ctx.font = 'bold 32px ui-monospace,Menlo,Consolas,monospace';
    ctx.fillText(step.instruction, W / 2, 108);
    ctx.fillStyle = '#ffd56a';
    ctx.font = 'bold 40px ui-monospace,Menlo,Consolas,monospace';
    ctx.fillText(`${mode}  [${verdict}]`, W / 2, 168);
    ctx.fillStyle = '#d8e5e2';
    ctx.font = '26px ui-monospace,Menlo,Consolas,monospace';
    ctx.fillText(step.hint, W / 2, 220);
    ctx.fillStyle = '#9fe8d8';
    ctx.font = '28px ui-monospace,Menlo,Consolas,monospace';
    ctx.fillText(opaqueId ? opaqueId : 'NO LOCK — TRIGGER LOCKS ONLY', W / 2, 270);
    this.texture.needsUpdate = true;
  }
}
