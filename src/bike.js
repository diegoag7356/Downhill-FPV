import * as THREE from 'three';

export function createBikeCockpit() {
  const root = new THREE.Group();
  root.name = 'fpv-bike-cockpit';
  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x263c38, roughness: 0.5, metalness: 0.62, flatShading: true });
  const metalMaterial = new THREE.MeshStandardMaterial({ color: 0x969991, roughness: 0.36, metalness: 0.76, flatShading: true });
  const rubberMaterial = new THREE.MeshStandardMaterial({ color: 0x20211f, roughness: 0.82, metalness: 0.05 });
  const accentMaterial = new THREE.MeshStandardMaterial({ color: 0xc6753d, roughness: 0.55, metalness: 0.12, flatShading: true });
  function tube(start, end, radius, material, sides = 7) {
    const a = new THREE.Vector3(...start);
    const b = new THREE.Vector3(...end);
    const direction = new THREE.Vector3().subVectors(b, a);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.82, radius, direction.length(), sides, 1), material);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    root.add(mesh);
    return mesh;
  }
  tube([-0.34, -0.56, -0.7], [-0.11, -0.28, -0.46], 0.018, frameMaterial);
  tube([0.34, -0.56, -0.7], [0.11, -0.28, -0.46], 0.018, frameMaterial);
  tube([-0.11, -0.28, -0.46], [0.11, -0.28, -0.46], 0.026, metalMaterial);
  tube([-0.36, -0.53, -0.69], [0.36, -0.53, -0.69], 0.014, metalMaterial);
  tube([-0.36, -0.53, -0.69], [-0.57, -0.57, -0.7], 0.027, rubberMaterial, 9);
  tube([0.36, -0.53, -0.69], [0.57, -0.57, -0.7], 0.027, rubberMaterial, 9);
  tube([-0.11, -0.28, -0.46], [-0.18, -0.45, -0.68], 0.021, metalMaterial);
  tube([0.11, -0.28, -0.46], [0.18, -0.45, -0.68], 0.021, metalMaterial);
  tube([-0.19, -0.48, -0.68], [-0.31, -0.55, -0.69], 0.009, accentMaterial);
  tube([0.19, -0.48, -0.68], [0.31, -0.55, -0.69], 0.009, accentMaterial);
  const stem = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.17, 0.055), metalMaterial);
  stem.position.set(0, -0.3, -0.45);
  stem.rotation.x = -0.18;
  root.add(stem);
  const headset = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.045, 8), accentMaterial);
  headset.rotation.x = Math.PI / 2;
  headset.position.set(0, -0.29, -0.45);
  root.add(headset);
  const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.012, 6), metalMaterial);
  bolt.rotation.x = Math.PI / 2;
  bolt.position.set(0, -0.29, -0.423);
  root.add(bolt);
  root.traverse((object) => { if (object.isMesh) object.frustumCulled = false; });
  return root;
}
