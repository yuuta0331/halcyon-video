// Tiny first-projection scene. No posters, probes, mirrors, AO, or store shaders.

import * as THREE from 'three';

export const XR_BOOT_STABLE_FRAMES = 3;

export function createXrBootScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x040a15);
  scene.add(new THREE.HemisphereLight(0xc8d4e8, 0x1a1a18, 1.1));

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 8),
    new THREE.MeshBasicMaterial({ color: 0x2a2e28 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const marker = new THREE.Mesh(
    new THREE.BoxGeometry(0.35, 0.35, 0.35),
    new THREE.MeshBasicMaterial({ color: 0xf2c14e }),
  );
  marker.position.set(0, 1.2, -1.6);
  scene.add(marker);

  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 0.28),
    new THREE.MeshBasicMaterial({ map: makeBootLabelTexture(), transparent: true }),
  );
  label.position.set(0, 1.55, -1.55);
  scene.add(label);
  return scene;
}

function makeBootLabelTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#111418';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#f4f1ea';
  ctx.font = '28px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('店内を準備しています…', canvas.width / 2, canvas.height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function disposeXrBootScene(scene: THREE.Scene | null): void {
  if (!scene) return;
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      const map = (mat as THREE.MeshBasicMaterial).map;
      map?.dispose();
      mat.dispose();
    }
  });
}
