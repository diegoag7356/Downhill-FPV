import * as THREE from 'three';
import { mulberry32, hashSeed } from './rng.js';
import { TRACK_WIDTH, SHOULDER_WIDTH } from './trackgen.js';

const BAND = 7;
const VALLEY = 38;
const BERM_LATERAL = TRACK_WIDTH / 2 + 1.5;

export function createTrackMeshes(track, { visual = false } = {}) {
  const root = new THREE.Group();
  root.name = `track:${track.id}`;
  const palette = visual
    ? paletteFor(track.id)
    : { earth: 0x999999, trail: 0x999999, edge: 0x999999, berm: 0x999999, rock: 0x999999, sky: 0x777777, fog: 0x777777 };
  const dirt = makeDirtTexture(track.id);
  const materials = {
    earth: new THREE.MeshLambertMaterial({ color: palette.earth, flatShading: true, vertexColors: true }),
    trail: new THREE.MeshLambertMaterial({ color: palette.trail, flatShading: true, vertexColors: true, map: dirt }),
    edge: new THREE.MeshLambertMaterial({ color: palette.edge, flatShading: true, vertexColors: true, map: dirt }),
    rut: new THREE.MeshLambertMaterial({ color: shade(palette.trail, -0.22), flatShading: true }),
    berm: new THREE.MeshLambertMaterial({ color: palette.berm, flatShading: true, vertexColors: true }),
    rock: new THREE.MeshLambertMaterial({ color: palette.rock, flatShading: true }),
    bark: new THREE.MeshLambertMaterial({ color: 0x4c3a2c, flatShading: true }),
    // Los colores llegan por instancia (instanceColor), no por vértice.
    pine: new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
    shrub: new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
    stake: new THREE.MeshLambertMaterial({ color: 0xe6e4da }),
    stakeCap: new THREE.MeshLambertMaterial({ color: 0xd2692f }),
    gate: new THREE.MeshLambertMaterial({ color: 0x3d4442 }),
    banner: new THREE.MeshLambertMaterial({ color: 0xd2692f }),
  };

  const shoulder = TRACK_WIDTH / 2 + SHOULDER_WIDTH;
  const outer = shoulder + BAND;
  const far = outer + VALLEY;
  const widths = [-far, -outer, -shoulder, -TRACK_WIDTH / 2, TRACK_WIDTH / 2, shoulder, outer, far];
  const lifts = [-22, -4.2, 0.1, 0.02, 0.02, 0.1, -4.2, -22];
  const bands = [
    { start: 0, end: 1, material: 'earth', tone: 1.1 },
    { start: 1, end: 2, material: 'earth', tone: 0.55 },
    { start: 2, end: 3, material: 'edge', tone: 0.1 },
    { start: 3, end: 4, material: 'trail', tone: 0 },
    { start: 4, end: 5, material: 'edge', tone: 0.1 },
    { start: 5, end: 6, material: 'earth', tone: 0.55 },
    { start: 6, end: 7, material: 'earth', tone: 1.1 },
  ];
  for (const band of bands) {
    const geometry = buildRibbon(track, widths[band.start], widths[band.end], lifts[band.start], lifts[band.end], {
      seed: `${track.id}/${band.material}/${band.start}`,
      tone: band.tone,
    });
    root.add(new THREE.Mesh(geometry, materials[band.material]));
  }
  // Surcos de rueda sobre la cinta.
  for (const offset of [-1.05, 1.05]) {
    const geometry = buildRibbon(track, offset - 0.34, offset + 0.34, 0.028, 0.028, {
      seed: `${track.id}/rut/${offset}`,
      tone: 0,
      flat: true,
    });
    root.add(new THREE.Mesh(geometry, materials.rut));
  }
  root.add(new THREE.Mesh(buildBerms(track), materials.berm));

  if (visual) {
    addSky(track, root, palette);
    addGates(track, root, materials);
    addStakes(track, root, materials);
    addForest(track, root, { materials, palette });
    addShrubs(track, root, materials);
    addRocks(track, root, materials);
    addGrass(track, root, materials);
  }
  return {
    root,
    palette,
    dispose: () => {
      dirt.dispose();
      disposeGroup(root);
    },
  };
}

// Grano de tierra barato: ruido gris + motas, repetido a lo largo de la pista.
function makeDirtTexture(seed) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const random = mulberry32(hashSeed(`${seed}/dirt/v1`));
  const image = context.createImageData(size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const value = 206 + random() * 49;
    image.data[i] = value;
    image.data[i + 1] = value;
    image.data[i + 2] = value;
    image.data[i + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  for (let i = 0; i < 260; i++) {
    context.fillStyle = `rgba(0, 0, 0, ${0.05 + random() * 0.14})`;
    context.beginPath();
    context.arc(random() * size, random() * size, 1 + random() * 2.6, 0, Math.PI * 2);
    context.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.6, 1);
  texture.anisotropy = 4;
  return texture;
}

function paletteFor(id) {
  const palettes = [
    { earth: 0x5a3d2a, trail: 0x8d5a36, edge: 0xc29a6b, berm: 0x7a4c33, rock: 0x7d7f78, sky: 0x9fb4bd, fog: 0xb3c1c2, sun: 0xfff0d8 },
    { earth: 0x3f3c2d, trail: 0x77593c, edge: 0xae9064, berm: 0x5c4c37, rock: 0x71766f, sky: 0x8ea8b2, fog: 0xa9b8b8, sun: 0xfff2df },
    { earth: 0x4a4438, trail: 0x7f6a4c, edge: 0xb9a077, berm: 0x63553f, rock: 0x8a8d88, sky: 0xa8bcc4, fog: 0xbcc8ca, sun: 0xfff6e8 },
    { earth: 0x59321f, trail: 0x8a4a2c, edge: 0xc08055, berm: 0x6b3c28, rock: 0x7b7168, sky: 0xb0a79b, fog: 0xc4b9a9, sun: 0xffe9cf },
  ];
  return palettes[hashSeed(`${id}/biome/v2`) % palettes.length];
}

function shade(hex, amount) {
  const color = new THREE.Color(hex);
  const target = amount > 0 ? new THREE.Color(0xffffff) : new THREE.Color(0x000000);
  return color.lerp(target, Math.abs(amount)).getHex();
}

function buildRibbon(track, left, right, leftLift, rightLift, { seed = '', tone = 0, flat = false } = {}) {
  const positions = [];
  const colors = [];
  const uvs = [];
  const indices = [];
  const random = mulberry32(hashSeed(seed || track.id));
  const color = new THREE.Color();
  const noise = [];
  for (let i = 0; i < track.points.length; i++) noise.push(0.78 + random() * 0.34);

  for (let i = 0; i < track.points.length; i++) {
    const p = track.points[i];
    const before = track.points[Math.max(0, i - 1)];
    const after = track.points[Math.min(track.points.length - 1, i + 1)];
    const dx = after.x - before.x;
    const dz = after.z - before.z;
    const length = Math.max(1e-6, Math.hypot(dx, dz));
    const nx = -dz / length;
    const nz = dx / length;
    const curveLift = flat ? 0 : Math.min(0.55, Math.abs(p.curvature) * 14);
    const lY = p.y + leftLift + (p.curvature > 0 ? curveLift : 0);
    const rY = p.y + rightLift + (p.curvature < 0 ? curveLift : 0);
    positions.push(p.x + nx * left, lY, p.z + nz * left);
    positions.push(p.x + nx * right, rY, p.z + nz * right);
    color.setScalar(noise[i] + tone * 0.06);
    colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    const v = p.s / 7;
    uvs.push(0, v, 1, v);
    if (i < track.points.length - 1) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// Peralte continuo: una pared que sigue la curva en el lado exterior.
function buildBerms(track) {
  const positions = [];
  const colors = [];
  const indices = [];
  const color = new THREE.Color();
  const active = [];
  for (let i = 0; i < track.points.length; i++) {
    const p = track.points[i];
    active.push(Math.abs(p.curvature) > 0.005);
  }
  let stripStart = -1;
  for (let i = 0; i <= track.points.length; i++) {
    const on = i < track.points.length && active[i];
    if (on && stripStart < 0) stripStart = i;
    if (!on && stripStart >= 0) {
      addBermStrip(stripStart, i - 1);
      stripStart = -1;
    }
  }

  function addBermStrip(from, to) {
    if (to - from < 2) return;
    const base = positions.length / 3;
    for (let i = from; i <= to; i++) {
      const p = track.points[i];
      const before = track.points[Math.max(0, i - 1)];
      const after = track.points[Math.min(track.points.length - 1, i + 1)];
      const dx = after.x - before.x;
      const dz = after.z - before.z;
      const length = Math.max(1e-6, Math.hypot(dx, dz));
      const nx = -dz / length;
      const nz = dx / length;
      const side = Math.sign(p.curvature) || 1;
      const ramp = Math.min(1, (i - from) / 3, (to - i) / 3);
      const height = (0.55 + Math.min(1.05, Math.abs(p.curvature) * 26)) * Math.max(0.15, ramp);
      const innerX = p.x + nx * side * (TRACK_WIDTH / 2 - 0.15);
      const innerZ = p.z + nz * side * (TRACK_WIDTH / 2 - 0.15);
      const outerX = p.x + nx * side * (BERM_LATERAL);
      const outerZ = p.z + nz * side * (BERM_LATERAL);
      positions.push(innerX, p.y + 0.04, innerZ, outerX, p.y + height, outerZ);
      color.setScalar(0.92 + Math.sin(i * 0.7) * 0.05);
      colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
      if (i > from) {
        const a = base + (i - from - 1) * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function gateAt(track, s, root, materials, banner) {
  const point = track.sampleAt(s);
  const gate = new THREE.Group();
  const left = new THREE.Vector3(Math.cos(point.yaw), 0, -Math.sin(point.yaw));
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.7, 0.16), materials.gate);
    post.position.set(left.x * side * 4.1, 1.35, left.z * side * 4.1);
    gate.add(post);
  }
  const top = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.3, 0.09), materials.banner);
  top.position.y = 2.55;
  gate.add(top);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.05, 0.1), materials.stake);
  stripe.position.y = 2.44;
  gate.add(stripe);
  gate.position.set(point.x, point.y, point.z);
  gate.rotation.y = point.yaw;
  gate.userData.label = banner;
  root.add(gate);
}

function addGates(track, root, materials) {
  gateAt(track, track.length - 10, root, materials, 'META');
}

// Cielo degradado: una cúpula de vértices barata que sustituye al color plano.
function addSky(track, root, palette) {
  const geometry = new THREE.SphereGeometry(1400, 20, 12);
  const horizon = new THREE.Color(palette.fog);
  const zenith = new THREE.Color(palette.sky).multiplyScalar(0.78);
  const positions = geometry.attributes.position;
  const colors = [];
  const color = new THREE.Color();
  for (let i = 0; i < positions.count; i++) {
    const height = Math.max(0, positions.getY(i) / 1400);
    const t = Math.pow(Math.min(1, height * 1.4), 0.65);
    color.copy(horizon).lerp(zenith, t);
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
  const sky = new THREE.Mesh(geometry, material);
  const start = track.points[0];
  sky.position.set(start.x, start.y - 60, start.z);
  sky.renderOrder = -1;
  root.add(sky);
}

function addStakes(track, root, materials) {
  const positions = [];
  for (let s = 18; s < track.length - 12; s += 22) {
    const point = track.sampleAt(s);
    for (const side of [-1, 1]) {
      if (side === 1 && (s / 22) % 2 < 1) continue;
      const lateral = side * (TRACK_WIDTH / 2 + SHOULDER_WIDTH - 0.4);
      positions.push({
        x: point.x + Math.cos(point.yaw) * lateral,
        y: point.y,
        z: point.z - Math.sin(point.yaw) * lateral,
      });
    }
  }
  const post = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.045, 1.1, 5), materials.stake, positions.length);
  const cap = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 6), materials.stakeCap, positions.length);
  const dummy = new THREE.Object3D();
  positions.forEach((p, i) => {
    dummy.position.set(p.x, p.y + 0.55, p.z);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    post.setMatrixAt(i, dummy.matrix);
    dummy.position.y = p.y + 1.12;
    dummy.updateMatrix();
    cap.setMatrixAt(i, dummy.matrix);
  });
  post.instanceMatrix.needsUpdate = true;
  cap.instanceMatrix.needsUpdate = true;
  root.add(post, cap);
}

function addForest(track, root, { materials }) {
  const random = mulberry32(hashSeed(`${track.id}/forest/v2`));
  const trees = [];
  for (let s = 10; s < track.length; s += 3.4 + random() * 4) {
    const point = track.sampleAt(s);
    const side = random() < 0.5 ? -1 : 1;
    const lateral = side * (9 + random() * 50);
    const scale = 0.7 + random() * 1.9;
    const x = point.x + Math.cos(point.yaw) * lateral;
    const z = point.z - Math.sin(point.yaw) * lateral;
    const y = point.y - 0.4 - Math.max(0, Math.abs(lateral) - TRACK_WIDTH / 2 - SHOULDER_WIDTH) * 0.35;
    trees.push({ x, y, z, scale, tint: random(), spin: random() * Math.PI * 2 });
  }
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.13, 0.26, 2.6, 5), materials.bark, trees.length);
  const layers = [
    new THREE.InstancedMesh(new THREE.ConeGeometry(1.35, 2.6, 6), materials.pine, trees.length),
    new THREE.InstancedMesh(new THREE.ConeGeometry(1.05, 2.2, 6), materials.pine, trees.length),
    new THREE.InstancedMesh(new THREE.ConeGeometry(0.72, 1.8, 6), materials.pine, trees.length),
  ];
  const dummy = new THREE.Object3D();
  const green = new THREE.Color();
  trees.forEach((tree, i) => {
    dummy.position.set(tree.x, tree.y + 1.3 * tree.scale, tree.z);
    dummy.rotation.set(0, tree.spin, 0);
    dummy.scale.set(tree.scale, tree.scale, tree.scale);
    dummy.updateMatrix();
    trunk.setMatrixAt(i, dummy.matrix);
    layers.forEach((layer, index) => {
      dummy.position.set(tree.x, tree.y + tree.scale * (2.1 + index * 1.05), tree.z);
      const spread = 1 - index * 0.16;
      dummy.scale.set(tree.scale * spread, tree.scale * (1 - index * 0.1), tree.scale * spread);
      dummy.updateMatrix();
      layer.setMatrixAt(i, dummy.matrix);
      green.setHSL(0.33 + tree.tint * 0.06, 0.28 + tree.tint * 0.14, 0.24 + index * 0.04 + tree.tint * 0.06);
      layer.setColorAt(i, green);
    });
  });
  for (const mesh of [trunk, ...layers]) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    root.add(mesh);
  }
}

function addShrubs(track, root, materials) {
  const random = mulberry32(hashSeed(`${track.id}/shrubs/v1`));
  const items = [];
  for (let s = 8; s < track.length; s += 7 + random() * 9) {
    const point = track.sampleAt(s);
    const side = random() < 0.5 ? -1 : 1;
    const lateral = side * (TRACK_WIDTH / 2 + 2.5 + random() * 9);
    items.push({
      x: point.x + Math.cos(point.yaw) * lateral,
      y: point.y + 0.05,
      z: point.z - Math.sin(point.yaw) * lateral,
      scale: 0.35 + random() * 0.85,
      tint: random(),
    });
  }
  const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.7, 0), materials.shrub, items.length);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  items.forEach((item, i) => {
    dummy.position.set(item.x, item.y + item.scale * 0.35, item.z);
    dummy.scale.set(item.scale * 1.2, item.scale * 0.75, item.scale * 1.2);
    dummy.rotation.set(0, item.tint * Math.PI, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    color.setHSL(0.24 + item.tint * 0.08, 0.3, 0.3 + item.tint * 0.12);
    mesh.setColorAt(i, color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  root.add(mesh);
}

function addRocks(track, root, materials) {
  const random = mulberry32(hashSeed(`${track.id}/rocks/v2`));
  const rocks = [];
  for (let s = 20; s < track.length; s += 16 + random() * 22) {
    const point = track.sampleAt(s);
    const side = random() < 0.5 ? -1 : 1;
    const lateral = side * (TRACK_WIDTH / 2 + 2 + random() * 14);
    const scale = 0.4 + random() * 1.8;
    rocks.push({
      x: point.x + Math.cos(point.yaw) * lateral,
      y: point.y + scale * 0.2,
      z: point.z - Math.sin(point.yaw) * lateral,
      scale,
      rotation: random() * Math.PI,
    });
  }
  const mesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), materials.rock, rocks.length);
  const dummy = new THREE.Object3D();
  rocks.forEach((rock, i) => {
    dummy.position.set(rock.x, rock.y, rock.z);
    dummy.rotation.set(random() * 0.4, rock.rotation, random() * 0.3);
    dummy.scale.set(rock.scale * 1.3, rock.scale * 0.75, rock.scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  root.add(mesh);
}

function addGrass(track, root, materials) {
  const random = mulberry32(hashSeed(`${track.id}/grass/v1`));
  const tufts = [];
  const edge = TRACK_WIDTH / 2 + SHOULDER_WIDTH;
  for (let s = 5; s < track.length; s += 2.2 + random() * 3.4) {
    const point = track.sampleAt(s);
    const side = random() < 0.5 ? -1 : 1;
    const lateral = side * (edge - 0.8 + random() * 5.5);
    tufts.push({
      x: point.x + Math.cos(point.yaw) * lateral,
      y: point.y + 0.02,
      z: point.z - Math.sin(point.yaw) * lateral,
      scale: 0.18 + random() * 0.42,
      tint: random(),
    });
  }
  const geometry = new THREE.ConeGeometry(0.16, 0.55, 4, 1);
  const mesh = new THREE.InstancedMesh(geometry, materials.shrub, tufts.length);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  tufts.forEach((tuft, i) => {
    dummy.position.set(tuft.x, tuft.y + tuft.scale * 0.6, tuft.z);
    dummy.rotation.set(0.2, tuft.tint * Math.PI, 0.15);
    dummy.scale.set(tuft.scale * 1.4, tuft.scale * 2.1, tuft.scale * 1.4);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    color.setHSL(0.24 + tuft.tint * 0.08, 0.28 + tuft.tint * 0.12, 0.24 + tuft.tint * 0.12);
    mesh.setColorAt(i, color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  root.add(mesh);
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
