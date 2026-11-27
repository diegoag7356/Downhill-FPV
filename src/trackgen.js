import { hashSeed, mulberry32, normalizeSeed, GENERATOR_VERSION } from './rng.js';
import { wrapAngle } from './angles.js';

export const TRACK_WIDTH = 7;
export const SHOULDER_WIDTH = 4;
const STEP = 2;
const MIN_RADIUS = 12;

function point(x, y, z, index) {
  return { x, y, z, s: index * STEP };
}

function createPointsFromKnots(knots, step = STEP) {
  const result = [];
  let distance = 0;
  for (let k = 0; k < knots.length - 1; k++) {
    const a = knots[k];
    const b = knots[k + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    const pieces = Math.max(1, Math.ceil(length / step));
    for (let i = 0; i < pieces; i++) {
      const t = i / pieces;
      const x = a.x + dx * t;
      const z = a.z + dz * t;
      const y = a.y + (b.y - a.y) * t;
      result.push({ x, y, z, s: distance + length * t });
    }
    distance += length;
    if (k === knots.length - 2) result.push({ x: b.x, y: b.y, z: b.z, s: distance });
  }
  return result;
}

function smoothKnots(raw, step = STEP) {
  const knots = [];
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i];
    const prior = raw[Math.max(0, i - 1)];
    const next = raw[Math.min(raw.length - 1, i + 1)];
    const incoming = Math.atan2(p.x - prior.x, -(p.z - prior.z));
    const outgoing = Math.atan2(next.x - p.x, -(next.z - p.z));
    const delta = wrapAngle(outgoing - incoming);
    const length = Math.hypot(next.x - p.x, next.z - p.z);
    const count = Math.max(2, Math.ceil(length / 18));
    if (i === 0) knots.push({ ...p });
    for (let j = 1; j <= count; j++) {
      const t = j / count;
      const q = raw[Math.min(i + 1, raw.length - 1)];
      const x = p.x + (q.x - p.x) * t;
      const z = p.z + (q.z - p.z) * t;
      const y = p.y + (q.y - p.y) * t;
      const heading = incoming + delta * t * 0.25;
      knots.push({ x, y, z, heading });
    }
  }
  return createPointsFromKnots(knots, step);
}

function finalizeTrack(id, points, jumps, kind = 'generated') {
  const tangents = [];
  let totalTurn = 0;
  let maxGrade = 0;
  let gradeSum = 0;
  for (let i = 0; i < points.length; i++) {
    const before = points[Math.max(0, i - 1)];
    const after = points[Math.min(points.length - 1, i + 1)];
    const dx = after.x - before.x;
    const dz = after.z - before.z;
    const horizontal = Math.max(1e-6, Math.hypot(dx, dz));
    const yaw = Math.atan2(-dx, -dz);
    const grade = (after.y - before.y) / horizontal;
    const previous = tangents[i - 1];
    const curvature = previous ? Math.abs(wrapAngle(yaw - previous.yaw)) / Math.max(STEP, horizontal * 0.5) : 0;
    if (previous) totalTurn += Math.abs(wrapAngle(yaw - previous.yaw));
    maxGrade = Math.max(maxGrade, Math.abs(grade));
    gradeSum += grade;
    tangents.push({ ...points[i], yaw, grade, curvature, s: points[i].s });
  }
  const samples = tangents.map((p) => ({ ...p }));
  const track = {
    id,
    kind,
    width: TRACK_WIDTH,
    shoulder: SHOULDER_WIDTH,
    step: STEP,
    points: tangents,
    jumps,
    length: points.at(-1)?.s ?? 0,
    metrics: { totalTurn, maxGrade, meanGrade: tangents.length ? gradeSum / tangents.length : 0 },
    sampleAt(distance) {
      const s = Math.max(0, Math.min(this.length, distance));
      let low = 0;
      let high = this.points.length - 1;
      while (low < high - 1) {
        const middle = (low + high) >> 1;
        if (this.points[middle].s <= s) low = middle;
        else high = middle;
      }
      const index = Math.min(this.points.length - 2, low);
      const a = this.points[index];
      const b = this.points[index + 1];
      const t = Math.max(0, Math.min(1, (s - a.s) / Math.max(1e-6, b.s - a.s)));
      const yaw = a.yaw + wrapAngle(b.yaw - a.yaw) * t;
      return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t), yaw, s };
    },
    hash: '',
    _samples: samples,
  };
  track.hash = hashTrack(track);
  return track;
}

function hashTrack(track) {
  let hash = 0x811c9dc5;
  for (const p of track.points) {
    for (const value of [p.x, p.y, p.z]) {
      const quantized = Math.round(value * 1000);
      hash ^= quantized;
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function createFixedTrack() {
  const knots = [
    { x: 0, y: 0, z: 0 }, { x: 0, y: -16, z: -150 }, { x: 48, y: -28, z: -250 },
    { x: 90, y: -46, z: -335 }, { x: 20, y: -62, z: -405 }, { x: -75, y: -79, z: -475 },
    { x: -135, y: -101, z: -560 }, { x: -90, y: -123, z: -650 }, { x: 5, y: -143, z: -720 },
    { x: 82, y: -163, z: -810 }, { x: 42, y: -180, z: -910 }, { x: -35, y: -195, z: -1010 },
    { x: 10, y: -210, z: -1130 }, { x: 30, y: -225, z: -1260 },
  ];
  const points = createPointsFromKnots(knots);
  const jumps = [{ takeoffS: 240, landingS: 288, runup: 30, landing: 24, height: 1.8, rampLength: 22.5, type: 'table' }];
  applyJumpProfiles(points, jumps);
  return finalizeTrack('fixed-greybox', points, jumps, 'fixed');
}

export function candidate(seed, attempt) {
  const random = mulberry32(hashSeed(`${seed}/route/${attempt}`));
  const complexity = 0.25 + random() * 0.75;
  // Bajadas cortas e intensas: menos metros, más curvas y más pendiente.
  const targetLength = 640 + random() * 420;
  const raw = [{ x: 0, y: 0, z: 0 }];
  let x = 0;
  let z = 0;
  let y = 0;
  let heading = 0;
  let distance = 0;
  const segments = [];
  while (distance < targetLength) {
    const choice = random();
    let length = 70 + random() * 60;
    let turn = 0;
    let type = 'straight';
    if (segments.length === 0) {
      // Recta de salida: la bajada empieza rodada y da tiempo a colocar la bici
      // antes de la primera curva.
      type = 'straight';
      length = 85 + random() * 25;
    } else if (choice < 0.5) {
      type = 'open-curve'; turn = (random() < 0.5 ? -1 : 1) * (0.95 + random() * 0.8); length = 70 + random() * 45;
    } else if (choice < 0.8) {
      type = 'hairpin'; turn = (random() < 0.5 ? -1 : 1) * (Math.PI * 0.85 + random() * 0.3); length = 105 + random() * 40;
    } else if (choice < 0.92) {
      type = 's-bend'; turn = (random() < 0.5 ? -1 : 1) * (1 + random() * 0.5); length = 100 + random() * 35;
    } else {
      type = 'straight'; length = 70 + random() * 55;
    }
    const radius = Math.abs(turn) > 1e-6 ? length / Math.abs(turn) : Infinity;
    if (radius < MIN_RADIUS) length = Math.abs(turn) * (MIN_RADIUS + 3);
    const stepCount = Math.max(3, Math.ceil(length / 3));
    const startS = distance;
    const side = Math.sign(turn);
    const arc = Math.abs(turn);
    for (let i = 0; i < stepCount; i++) {
      const t = (i + 1) / stepCount;
      const localHeading = heading + turn * t;
      const ds = length / stepCount;
      x += -Math.sin(localHeading) * ds;
      z += -Math.cos(localHeading) * ds;
      const grade = 0.1 + random() * 0.05;
      y -= grade * ds;
      raw.push({ x, y, z });
      distance += ds;
    }
    heading = wrapAngle(heading + turn);
    segments.push({ type, turn, length, turnSign: side, arc, startS, endS: distance });
  }

  const points = createPointsFromKnots(raw);
  const jumps = [];
  const jumpSegments = segments.filter((segment) => segment.type === 'straight' && segment.length >= 75);
  const jumpCount = Math.max(1, Math.min(2, Math.floor(distance / 420)));
  const selected = [];
  for (const segment of jumpSegments) {
    if (selected.length >= jumpCount) break;
    const height = 1.2 + complexity * 0.35;
    const rampLength = height / 0.07;
    const desiredTakeoff = segment.startS + Math.max(26, Math.min(42, segment.length * 0.3));
    const takeoffS = Math.max(desiredTakeoff, segment.startS + rampLength + 4);
    const desiredJumpLength = 26 + random() * 10;
    const jumpLength = Math.min(desiredJumpLength, segment.endS - takeoffS - 5);
    if (takeoffS < 90 || jumpLength < 18 || takeoffS - rampLength < segment.startS) continue;
    if (selected.some((jump) => Math.abs(takeoffS - jump.takeoffS) < 180)) continue;
    selected.push({ takeoffS, landingS: takeoffS + jumpLength, runup: takeoffS - segment.startS, landing: 25, height, rampLength, type: random() < 0.5 ? 'table' : 'double' });
  }
  jumps.push(...selected);
  jumps.sort((a, b) => a.takeoffS - b.takeoffS);

  applyJumpProfiles(points, jumps);
  const track = finalizeTrack(seed, points, jumps);
  track.complexity = complexity;
  track.segments = segments;
  track.metrics.totalTurn = segments.reduce((sum, segment) => sum + segment.arc, 0);
  return track;
}

export function generateTrack(rawSeed, { maxAttempts = 80 } = {}) {
  const id = normalizeSeed(rawSeed);
  if (!id || !id.startsWith(`${GENERATOR_VERSION}:`)) throw new Error(`Unsupported seed: ${rawSeed}`);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const track = candidate(id, attempt);
    const result = validateTrack(track);
    if (result.valid) return track;
  }
  throw new Error(`Could not generate valid route for ${id} after ${maxAttempts} deterministic attempts`);
}

function applyJumpProfiles(points, jumps) {
  for (const jump of jumps) {
    const rampStart = jump.takeoffS - jump.rampLength;
    const landingEnd = jump.landingS + 28;
    for (const p of points) {
      if (p.s < rampStart || p.s > landingEnd) continue;
      let offset = 0;
      if (p.s <= jump.takeoffS) {
        offset = jump.height * clamp01((p.s - rampStart) / jump.rampLength);
      } else if (p.s <= jump.landingS) {
        const t = clamp01((p.s - jump.takeoffS) / Math.max(1, jump.landingS - jump.takeoffS));
        offset = jump.height - (jump.height + 0.65) * t;
      } else {
        const t = clamp01((p.s - jump.landingS) / (landingEnd - jump.landingS));
        offset = -0.65 * (1 - t);
      }
      p.y += offset;
    }
  }
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

export function validateTrack(track) {
  if (!track || track.points.length < 3) return { valid: false, reason: 'too few samples' };
  if (track.length < 560 || track.length > 1200) return { valid: false, reason: `length ${track.length.toFixed(1)}m outside range` };
  if (track.metrics.totalTurn < 5) return { valid: false, reason: `only ${track.metrics.totalTurn.toFixed(1)}rad of turns` };
  const cellSize = TRACK_WIDTH + SHOULDER_WIDTH;
  const occupied = new Map();
  const points = track.points;
  for (let i = 2; i < points.length - 2; i += 3) {
    const p = points[i];
    const cx = Math.floor(p.x / cellSize);
    const cz = Math.floor(p.z / cellSize);
    const key = `${cx},${cz}`;
    const nearby = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) nearby.push(...(occupied.get(`${cx + dx},${cz + dz}`) ?? []));
    for (const prior of nearby) {
      if (Math.abs(p.s - prior.s) > 35 && Math.hypot(p.x - prior.x, p.z - prior.z) < TRACK_WIDTH + 2) {
        return { valid: false, reason: `self intersection near s=${p.s.toFixed(0)}m` };
      }
    }
    const bucket = occupied.get(key) ?? [];
    bucket.push(p);
    occupied.set(key, bucket);
  }
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const ds = Math.max(0.1, p.s - points[i - 1].s);
    const grade = Math.abs((p.y - points[i - 1].y) / ds);
    if (grade > 0.25) return { valid: false, reason: `grade ${grade.toFixed(3)} exceeds limit` };
    if (p.curvature > 1 / MIN_RADIUS * 3) return { valid: false, reason: `radius below limit near s=${p.s.toFixed(0)}m` };
  }
  if (!track.jumps.length) return { valid: false, reason: 'no safe straight available for a jump' };
  for (const jump of track.jumps) {
    if (jump.runup < 15 || jump.landing < 15) return { valid: false, reason: 'jump run-up or landing under 15m' };
    const rampStart = jump.takeoffS - jump.rampLength;
    const runway = track.segments?.find((segment) => segment.startS <= rampStart && segment.endS >= jump.landingS + 5);
    if (!runway || runway.type !== 'straight') return { valid: false, reason: 'jump ramp and landing must fit in one straight segment' };
    const landing = track.sampleAt(jump.landingS);
    if (landing.y >= track.sampleAt(jump.takeoffS).y + 1) return { valid: false, reason: 'jump landing has no downhill approach' };
  }
  return { valid: true, reason: null };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
