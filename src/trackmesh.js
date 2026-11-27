import * as THREE from 'three';
import { mulberry32, hashSeed } from './rng.js';
import { TRACK_WIDTH, SHOULDER_WIDTH } from './trackgen.js';

const BAND = 9;

export function createTrackMeshes(track, { visual = false } = {}) {
  const root = new THREE.Group();
  root.name = `track:${track.id}`;
  const palette = visual
    ? paletteFor(track.id)
    : { earth: 0x999999, trail: 0x999999, edge: 0x999999, berm: 0x999999, rock: 0x999999, sky: 0x777777, fog: 0x777777 };
  const materials = {
    earth: new THREE.MeshLambertMaterial({ color: palette.earth, flatShading: true }),
    trail: new THREE.MeshLambertMaterial({ color: palette.trail, flatShading: true }),
    edge: new THREE.MeshLambertMaterial({ color: palette.edge, flatShading: true }),
    berm: new THREE.MeshLambertMaterial({ color: palette.berm, flatShading: true }),
    rock: new THREE.MeshLambertMaterial({ color: palette.rock, flatShading: true }),
  };
  const widths = [-(TRACK_WIDTH / 2 + SHOULDER_WIDTH + BAND), -(TRACK_WIDTH / 2 + SHOULDER_WIDTH), -TRACK_WIDTH / 2, 0, TRACK_WIDTH / 2, TRACK_WIDTH / 2 + SHOULDER_WIDTH, TRACK_WIDTH / 2 + SHOULDER_WIDTH + BAND];
  const surfaceOffsets = [0.7, 0.45, 0.15, 0, 0.15, 0.45, 0.7];
  const bands = [
    { start: 0, end: 1, material: 'earth' },
    { start: 1, end: 2, material: 'edge' },
    { start: 2, end: 4, material: 'trail' },
    { start: 4, end: 5, material: 'edge' },
    { start: 5, end: 6, material: 'earth' },
  ];
  for (const band of bands) {
    const geometry = buildRibbon(track, widths[band.start], widths[band.end], surfaceOffsets[band.start], surfaceOffsets[band.end]);
    const mesh = new THREE.Mesh(geometry, materials[band.material]);
    mesh.receiveShadow = false;
    root.add(mesh);
  }
  const bermGeometry = buildBerms(track);
  const berms = new THREE.Mesh(bermGeometry, materials.berm);
  root.add(berms);
  if (visual) {
    addForest(track, root, materials.rock);
    addRockFaces(track, root, materials.rock);
  }
  return { root, palette, dispose: () => disposeGroup(root) };
}

function paletteFor(id) {
  const palettes = [
    { earth: 0x704530, trail: 0xa86a43, edge: 0xc08a5a, berm: 0x86543b, rock: 0x737b78, sky: 0x8ca4ae, fog: 0x9bacaa },
    { earth: 0x625342, trail: 0x927354, edge: 0xb89b74, berm: 0x76624b, rock: 0x77786f, sky: 0x94a6a7, fog: 0xaeb9af },
    { earth: 0x594d3b, trail: 0x89714d, edge: 0xb49a6d, berm: 0x6e5b42, rock: 0x7d817c, sky: 0x7f9caa, fog: 0x99aaad },
    { earth: 0x634236, trail: 0x9a6044, edge: 0xc07b53, berm: 0x784a38, rock: 0x797e79, sky: 0x9a9d91, fog: 0xb4aea0 },
  ];
  return palettes[hashSeed(`${id}/biome/v1`) % palettes.length];
}

function addRockFaces(track, root, material) {
  const random = mulberry32(hashSeed(`${track.id}/cutbanks/v1`));
  const rockGeometry = new THREE.DodecahedronGeometry(1, 0);
  const rocks = new THREE.InstancedMesh(rockGeometry, material, Math.ceil(track.length / 38));
  const dummy = new THREE.Object3D();
  let index = 0;
  for (let s = 30; s < track.length; s += 24 + random() * 26) {
    if (index >= rocks.count) break;
    const point = track.sampleAt(s);
    const side = random() < 0.5 ? -1 : 1;
    const lateral = side * (10 + random() * 4);
    const scale = 0.8 + random() * 2.4;
    dummy.position.set(point.x + Math.cos(point.yaw) * lateral, point.y + scale * 0.25, point.z - Math.sin(point.yaw) * lateral);
    dummy.rotation.set(random() * 0.4, random() * Math.PI, random() * 0.3);
    dummy.scale.set(scale * 1.35, scale * 0.68, scale);
    dummy.updateMatrix();
    rocks.setMatrixAt(index++, dummy.matrix);
  }
  rocks.count = index;
  rocks.instanceMatrix.needsUpdate = true;
  rocks.computeBoundingSphere();
  root.add(rocks);
}

function buildRibbon(track, left, right, leftLift, rightLift) {
  const positions = [];
  const indices = [];
  for (let i = 0; i < track.points.length; i++) {
    const p = track.points[i];
    const before = track.points[Math.max(0, i - 1)];
    const after = track.points[Math.min(track.points.length - 1, i + 1)];
    const dx = after.x - before.x;
    const dz = after.z - before.z;
    const length = Math.max(1e-6, Math.hypot(dx, dz));
    const nx = -dz / length;
    const nz = dx / length;
    const curveLift = Math.min(0.42, Math.abs(p.curvature) * 11);
    const lY = p.y + leftLift + (p.curvature > 0 ? curveLift : 0);
    const rY = p.y + rightLift + (p.curvature < 0 ? curveLift : 0);
    positions.push(p.x + nx * left, lY, p.z + nz * left);
    positions.push(p.x + nx * right, rY, p.z + nz * right);
    if (i < track.points.length - 1) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildBerms(track) {
  const positions = [];
  const indices = [];
  for (let i = 1; i < track.points.length - 1; i += 2) {
    const p = track.points[i];
    if (p.curvature < 0.012) continue;
    const before = track.points[i - 1];
    const after = track.points[i + 1];
    const dx = after.x - before.x;
    const dz = after.z - before.z;
    const length = Math.max(1e-6, Math.hypot(dx, dz));
    const nx = -dz / length;
    const nz = dx / length;
    const side = Math.sign(p.curvature);
    const cx = p.x - nx * side * (TRACK_WIDTH / 2 - 0.2);
    const cz = p.z - nz * side * (TRACK_WIDTH / 2 - 0.2);
    const outerX = p.x + nx * side * (TRACK_WIDTH / 2 + 1.2);
    const outerZ = p.z + nz * side * (TRACK_WIDTH / 2 + 1.2);
    const base = positions.length / 3;
    positions.push(cx, p.y + 0.08, cz, outerX, p.y + Math.min(1.8, 0.3 + p.curvature * 28), outerZ, p.x + nx * side * TRACK_WIDTH / 2, p.y + 0.1, p.z + nz * side * TRACK_WIDTH / 2);
    indices.push(base, base + 1, base + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function addForest(track, root, rockMaterial) {
  const random = mulberry32(hashSeed(`${track.id}/forest/v1`));
  const trees = [];
  const rocks = [];
  for (let s = 24; s < track.length; s += 8 + random() * 8) {
    const p = track.sampleAt(s);
    const segment = track.segments?.find((part) => s >= part.startS && s <= part.endS);
    if (segment && (segment.type === 'hairpin' || segment.type === 's-bend')) continue;
    const side = random() < 0.5 ? -1 : 1;
    const lateral = side * (15 + random() * 50);
    const scale = 0.65 + random() * 1.6;
    trees.push({ x: p.x + Math.cos(p.yaw) * lateral, y: p.y - 0.3, z: p.z - Math.sin(p.yaw) * lateral, scale, tint: random() });
    if (random() < 0.18) rocks.push({ x: p.x + Math.cos(p.yaw) * side * (11 + random() * 12), y: p.y, z: p.z - Math.sin(p.yaw) * side * (11 + random() * 12), scale: 0.3 + random() * 1.3, tint: random() });
  }
  const trunkGeometry = new THREE.CylinderGeometry(0.15, 0.28, 1.8, 5, 1);
  const crownGeometry = new THREE.ConeGeometry(1, 2.2, 5, 1);
  const trunkMaterial = new THREE.MeshLambertMaterial({ color: 0x59463a, flatShading: true });
  const crownMaterial = new THREE.MeshLambertMaterial({ color: 0x315849, flatShading: true, vertexColors: true });
  const trunk = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, trees.length);
  const crowns = [
    new THREE.InstancedMesh(crownGeometry, crownMaterial, trees.length),
    new THREE.InstancedMesh(crownGeometry, crownMaterial, trees.length),
  ];
  const dummy = new THREE.Object3D();
  const green = new THREE.Color();
  trees.forEach((tree, index) => {
    dummy.position.set(tree.x, tree.y + tree.scale * 0.9, tree.z);
    dummy.scale.setScalar(tree.scale);
    dummy.updateMatrix();
    trunk.setMatrixAt(index, dummy.matrix);
    trunk.setColorAt(index, new THREE.Color(0x634a3a));
    for (let layer = 0; layer < crowns.length; layer++) {
      dummy.position.set(tree.x, tree.y + tree.scale * (1.4 + layer * 0.62), tree.z);
      dummy.scale.set(tree.scale * (1.15 - layer * 0.22), tree.scale * (1.1 - layer * 0.16), tree.scale * (1.15 - layer * 0.22));
      dummy.updateMatrix();
      crowns[layer].setMatrixAt(index, dummy.matrix);
      green.setHSL(0.37 + tree.tint * 0.055, 0.25 + tree.tint * 0.2, 0.2 + layer * 0.045 + tree.tint * 0.04);
      crowns[layer].setColorAt(index, green);
    }
  });
  trunk.instanceMatrix.needsUpdate = true;
  trunk.computeBoundingSphere();
  root.add(trunk, ...crowns);
  const rockGeometry = new THREE.DodecahedronGeometry(1, 0);
  const rockMesh = new THREE.InstancedMesh(rockGeometry, rockMaterial, rocks.length);
  rocks.forEach((rock, i) => {
    dummy.position.set(rock.x, rock.y + rock.scale * 0.35, rock.z);
    dummy.rotation.set(random() * 0.5, random() * Math.PI, random() * 0.4);
    dummy.scale.set(rock.scale * 1.3, rock.scale * 0.7, rock.scale);
    dummy.updateMatrix();
    rockMesh.setMatrixAt(i, dummy.matrix);
    green.setHSL(0.46 + rock.tint * 0.07, 0.06, 0.34 + rock.tint * 0.16);
    rockMesh.setColorAt(i, green);
  });
  rockMesh.instanceMatrix.needsUpdate = true;
  rockMesh.computeBoundingSphere();
  root.add(rockMesh);
}

function disposeGroup(group) {
  group.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry?.dispose();
    if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
    else object.material?.dispose();
  });
  group.clear();
}
