import { TRACK_WIDTH, SHOULDER_WIDTH } from './trackgen.js';

const CELL_SIZE = 28;
const FALL_DISTANCE = 40;
const FALL_SLOPE = 1.4;

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
    const y = lerp(a.y, b.y, nearest.t);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const planarLength = Math.max(1e-6, Math.hypot(dx, dz));
    const grade = (b.y - a.y) / planarLength;
    const yaw = a.yaw + wrapAngle(b.yaw - a.yaw) * nearest.t;
    const distance = Math.sqrt(nearest.distanceSq);
    const onTrack = distance <= TRACK_WIDTH / 2;
    const onShoulder = distance <= TRACK_WIDTH / 2 + SHOULDER_WIDTH;
    const lateral = Math.sign(dx * (z - nearest.pz) - dz * (x - nearest.px)) * distance;
    const fall = Math.max(0, distance - TRACK_WIDTH / 2 - SHOULDER_WIDTH);
    const height = y - Math.min(FALL_DISTANCE, fall * FALL_SLOPE);
    const ahead = track.points[Math.min(track.points.length - 1, nearest.segment.index + 1)];
    const pitch = Math.atan2(b.y - a.y, planarLength);
    const normal = normalize({ x: -grade * Math.sin(yaw), y: 1, z: grade * Math.cos(yaw) });
    return { height, centerHeight: y, normal, grade, pitch, yaw, distance, lateral, onTrack, onShoulder, segmentIndex: nearest.segment.index, s: lerp(a.s, b.s, nearest.t), next: ahead };
  }

  return { track, sample, heightAt: (x, z) => sample(x, z).height, normalAt: (x, z) => sample(x, z).normal };
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
