// Suelo del mundo. La ladera se construye alrededor de la pista con el mismo
// perfil que dibuja trackmesh, así que todo lo que se ve (calzada, arcén,
// peraltes y taludes) es exactamente lo que se puede pisar.
import { TRACK_WIDTH, SHOULDER_WIDTH, CORRIDOR_HALF, corridorHeight } from './trackgen.js';

const CELL_SIZE = 28;

export function createTerrain(track) {
  const buckets = new Map();
  const segments = [];
  for (let i = 0; i < track.points.length - 1; i++) {
    const a = track.points[i];
    const b = track.points[i + 1];
    const segment = { a, b, index: i };
    segments.push(segment);
    const minX = Math.floor(Math.min(a.x, b.x) / CELL_SIZE);
    const maxX = Math.floor(Math.max(a.x, b.x) / CELL_SIZE);
    const minZ = Math.floor(Math.min(a.z, b.z) / CELL_SIZE);
    const maxZ = Math.floor(Math.max(a.z, b.z) / CELL_SIZE);
    for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
      const key = `${x},${z}`;
      const list = buckets.get(key) ?? [];
      list.push(segment);
      buckets.set(key, list);
    }
  }

  function closest(x, z) {
    const cx = Math.floor(x / CELL_SIZE);
    const cz = Math.floor(z / CELL_SIZE);
    let candidates = [];
    for (let ring = 0; ring <= 3 && candidates.length === 0; ring++) {
      for (let dx = -ring; dx <= ring; dx++) for (let dz = -ring; dz <= ring; dz++) {
        if (ring && Math.abs(dx) !== ring && Math.abs(dz) !== ring) continue;
        candidates.push(...(buckets.get(`${cx + dx},${cz + dz}`) ?? []));
      }
    }
    if (!candidates.length) candidates = segments;
    let best = null;
    for (const segment of candidates) {
      const { a, b } = segment;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const lengthSq = dx * dx + dz * dz;
      const t = lengthSq > 1e-8 ? clamp(((x - a.x) * dx + (z - a.z) * dz) / lengthSq, 0, 1) : 0;
      const px = a.x + dx * t;
      const pz = a.z + dz * t;
      const distanceSq = (x - px) ** 2 + (z - pz) ** 2;
      if (!best || distanceSq < best.distanceSq) best = { segment, t, px, pz, distanceSq };
    }
    return best;
  }

  function sample(x, z) {
    const nearest = closest(x, z);
    const { a, b } = nearest.segment;
    const centerHeight = lerp(a.y, b.y, nearest.t);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const planarLength = Math.max(1e-6, Math.hypot(dx, dz));
    const grade = (b.y - a.y) / planarLength;
    const yaw = a.yaw + wrapAngle(b.yaw - a.yaw) * nearest.t;
    const curvature = lerp(a.curvature ?? 0, b.curvature ?? 0, nearest.t);
    const distance = Math.sqrt(nearest.distanceSq);
    // Signo coherente con la malla: positivo hacia la normal (nx, nz).
    const lateral = (dx * (z - nearest.pz) - dz * (x - nearest.px) >= 0 ? 1 : -1) * distance;
    const onTrack = distance <= TRACK_WIDTH / 2;
    const onShoulder = distance <= TRACK_WIDTH / 2 + SHOULDER_WIDTH;
    const inside = distance <= CORRIDOR_HALF;
    const height = corridorHeight(centerHeight, lateral, curvature);
    const pitch = Math.atan2(b.y - a.y, planarLength);
    const normal = normalize({ x: -grade * Math.sin(yaw), y: 1, z: grade * Math.cos(yaw) });
    return {
      height,
      centerHeight,
      normal,
      grade,
      pitch,
      yaw,
      curvature,
      lateral,
      distance,
      onTrack,
      onShoulder,
      inside,
      segmentIndex: nearest.segment.index,
      s: lerp(a.s, b.s, nearest.t),
      next: track.points[Math.min(track.points.length - 1, nearest.segment.index + 1)],
    };
  }

  return {
    track,
    sample,
    obstacles: createObstacles(track),
    heightAt: (x, z) => sample(x, z).height,
    normalAt: (x, z) => sample(x, z).normal,
    insideCorridor: (x, z) => sample(x, z).inside,
  };
}

// Obstáculos sólidos (árboles y piedras grandes). Se generan en un único sitio
// para que lo que se dibuja sea exactamente lo que bloquea.
export function createObstacles(track) {
  const obstacles = [];
  const buckets = new Map();
  const cell = 8;
  const add = (obstacle) => {
    obstacles.push(obstacle);
  };
  for (const obstacle of track.scenery ?? []) add(obstacle);
  for (const obstacle of obstacles) {
    const key = `${Math.floor(obstacle.x / cell)},${Math.floor(obstacle.z / cell)}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(obstacle);
    buckets.set(key, bucket);
  }
  function near(x, z, radius = 3) {
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    const found = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const obstacle of buckets.get(`${cx + dx},${cz + dz}`) ?? []) {
        if ((obstacle.x - x) ** 2 + (obstacle.z - z) ** 2 <= (radius + obstacle.radius) ** 2) found.push(obstacle);
      }
    }
    return found;
  }
  return { items: obstacles, near };
}

function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
function normalize(v) {
  const length = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}
function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x));
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}

export { CELL_SIZE };
