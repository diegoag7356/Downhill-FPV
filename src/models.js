import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
// Vite emite los .glb generados por generar_3d.py como assets con hash, así
// funcionan tanto en local como en GitHub Pages con base relativa. Se admite
// el .glb directo o su versión .glb.gz, que se descomprime en el navegador.
const bikeModules = import.meta.glob(
  ['../assets_3d/bicicleta.glb', '../assets_3d/bicicleta.glb.gz'],
  { query: '?url', import: 'default', eager: true },
);

const loader = new GLTFLoader();

function load(url) {
  return new Promise((resolve, reject) => {
    loader.load(url, (gltf) => resolve(gltf.scene), undefined, reject);
  });
}

async function loadCompressed(url) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream no está disponible en este navegador');
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`No se pudo descargar ${url}`);
  const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Promise((resolve, reject) => {
    loader.parse(buffer, '', (gltf) => resolve(gltf.scene), reject);
  });
}

async function loadBikeScene() {
  const entries = Object.entries(bikeModules);
  if (!entries.length) return null;
  const plain = entries.find(([path]) => path.endsWith('.glb'));
  const compressed = entries.find(([path]) => path.endsWith('.glb.gz'));
  if (plain) return load(plain[1]);
  if (compressed) return loadCompressed(compressed[1]);
  return null;
}

/**
 * Centra el modelo en el origen, lo apoya en el suelo y lo escala para que su
 * dimensión mayor mida `size` metros.
 */
export function normalizeModel(object, size = 2.2) {
  const box = new THREE.Box3().setFromObject(object);
  const dimensions = box.getSize(new THREE.Vector3());
  const longest = Math.max(dimensions.x, dimensions.y, dimensions.z) || 1;
  const scale = size / longest;
  const center = box.getCenter(new THREE.Vector3());

  const holder = new THREE.Group();
  object.position.set(-center.x, -box.min.y, -center.z);
  object.scale.setScalar(1);
  holder.add(object);
  holder.scale.setScalar(scale);
  holder.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = false;
      child.receiveShadow = false;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (!material) continue;
        material.side = THREE.FrontSide;
        material.envMapIntensity = 0.6;
      }
    }
  });
  holder.userData.size = dimensions.clone().multiplyScalar(scale);
  return holder;
}

// Sombra de contacto suave para que el modelo generado no parezca flotar.
export function createContactShadow(width = 2.7, depth = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(64, 32, 4, 64, 32, 60);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
  gradient.addColorStop(0.55, 'rgba(0, 0, 0, 0.24)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 64);
  const texture = new THREE.CanvasTexture(canvas);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.03;
  mesh.renderOrder = 1;
  return mesh;
}

export async function loadBikeModel() {
  const scene = await loadBikeScene();
  if (!scene) return null;
  return normalizeModel(scene, 2.1);
}
