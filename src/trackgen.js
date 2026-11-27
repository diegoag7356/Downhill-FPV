import { hashSeed, mulberry32, normalizeSeed, GENERATOR_VERSION } from './rng.js';
import { wrapAngle } from './angles.js';

// Ancho de la calzada (de -TRACK_WIDTH/2 a +TRACK_WIDTH/2).
export const TRACK_WIDTH = 7;
// Arcén transitable a cada lado.
export const SHOULDER_WIDTH = 4;
// Talud fuerte que cae justo después del arcén: ya es ladera de montaña.
export const BANK_WIDTH = 7;
// Falda final del corredor, hasta donde llega la colisión.
export const VERGE_WIDTH = 8;
// Semiancho del corredor jugable (calzada + arcén + talud + falda).
export const CORRIDOR_HALF = TRACK_WIDTH / 2 + SHOULDER_WIDTH + BANK_WIDTH + VERGE_WIDTH;
// Dos tramos de pista que se crucen en planta comparten ladera: el más bajo
// quedaría enterrado y la pista "atravesaría" al jugador. Se exige esta
// separación entre tramos que no son vecinos.
export const CORRIDOR_CLEARANCE = CORRIDOR_HALF * 2 + 1;
// Franja visual extra que se hunde para que no se vea el borde del mundo.
export const OUTLOOK_WIDTH = 12;
// Breakpoints del perfil lateral: [|lateral|, desnivel respecto al centro].
// Se usan tanto para la malla como para la colisión, así que el suelo que se ve
// es exactamente el suelo que se pisa.
export const PROFILE = [
  [TRACK_WIDTH / 2, -0.02],
  [TRACK_WIDTH / 2 + 1.7, -0.12],
  [TRACK_WIDTH / 2 + SHOULDER_WIDTH, -0.6],
  [TRACK_WIDTH / 2 + SHOULDER_WIDTH + BANK_WIDTH, -7.5],
  [CORRIDOR_HALF, -21],
  [CORRIDOR_HALF + OUTLOOK_WIDTH, -48],
];

const STEP = 2;
const MIN_RADIUS = 26;
const SELF_CLEARANCE_S = 58;

// Perfil lateral del corredor: lo usan a la vez la malla y la colisión.
function profileOffset(distance) {
  if (distance <= 0) return 0;
  let previousEdge = 0;
  let previousOffset = 0;
  for (const [edge, offset] of PROFILE) {
    if (distance <= edge) {
      const t = (distance - previousEdge) / Math.max(1e-6, edge - previousEdge);
      return previousOffset + (offset - previousOffset) * t;
    }
    previousEdge = edge;
    previousOffset = offset;
  }
  return PROFILE[PROFILE.length - 1][1];
}

// Altura del suelo a una distancia lateral del eje de la pista, con el peralte
// del lado exterior de la curva.
export function corridorHeight(centerY, lateral, curvature = 0) {
  const d = Math.abs(lateral);
  const side = Math.sign(lateral);
  let height = centerY + profileOffset(d);
  if (curvature && Math.sign(curvature) === side) {
    const crest = TRACK_WIDTH / 2 + 1.7;
    const berm = Math.min(1.7, Math.abs(curvature) * 26);
    if (berm > 1e-3 && d > TRACK_WIDTH / 2 && d < crest + 1.8) {
      const t = d <= crest ? (d - TRACK_WIDTH / 2) / (crest - TRACK_WIDTH / 2) : 1 - (d - crest) / 1.8;
      height += berm * Math.max(0, Math.min(1, t));
    }
  }
  return height;
}

// Árboles y piedras: se generan aquí para que la malla dibuje justo los mismos
// troncos y rocas que luego bloquean.
function buildScenery(track) {
  const random = mulberry32(hashSeed(`${track.id}/scenery/v3`));
  const scenery = [];
  const inner = TRACK_WIDTH / 2 + SHOULDER_WIDTH + 1.4;
  for (let s = 8; s < track.length - 8; s += 2.6 + random() * 3.4) {
    const point = track.sampleAt(s);
    const curvature = curvatureAt(track, s);
    for (const side of [-1, 1]) {
      if (random() < 0.22) continue;
      const lateral = side * (inner + random() * (CORRIDOR_HALF + 26 - inner));
      const scale = 0.7 + random() * 1.7;
      scenery.push({
        kind: 'tree',
        x: point.x + Math.cos(point.yaw) * lateral,
        z: point.z - Math.sin(point.yaw) * lateral,
        y: corridorHeight(point.y, lateral, curvature),
        radius: 0.34 * scale + 0.22,
        scale,
        tint: random(),
        spin: random() * Math.PI * 2,
      });
    }
  }
  for (let s = 14; s < track.length - 12; s += 9 + random() * 14) {
    const point = track.sampleAt(s);
    const curvature = curvatureAt(track, s);
    const side = random() < 0.5 ? -1 : 1;
    const lateral = side * (TRACK_WIDTH / 2 + SHOULDER_WIDTH + 0.6 + random() * 6.5);
    const scale = 0.5 + random() * 1.3;
    scenery.push({
      kind: 'rock',
      x: point.x + Math.cos(point.yaw) * lateral,
      z: point.z - Math.sin(point.yaw) * lateral,
      y: corridorHeight(point.y, lateral, curvature),
      radius: 0.55 * scale,
      scale,
      rotation: random() * Math.PI,
    });
  }
  return scenery;
}

function curvatureAt(track, s) {
  const index = Math.max(0, Math.min(track.points.length - 1, Math.round(s / track.step)));
  return track.points[index]?.curvature ?? 0;
}

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
      result.push({
        x: a.x + dx * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + dz * t,
        s: distance + length * t,
      });
    }
    distance += length;
    if (k === knots.length - 2) result.push({ x: b.x, y: b.y, z: b.z, s: distance });
  }
  return result;
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
  const start = tangents[0];
  const end = tangents.at(-1) ?? start;
  const track = {
    id,
    kind,
    width: TRACK_WIDTH,
    shoulder: SHOULDER_WIDTH,
    step: STEP,
    points: tangents,
    jumps,
    length: points.at(-1)?.s ?? 0,
    drop: start.y - end.y,
    start: { x: start.x, y: start.y, z: start.z },
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
  };
  track.hash = hashTrack(track);
  track.scenery = buildScenery(track);
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
  // Misma filosofía que las pistas generadas: cima, rampa y bajada continua.
  const knots = [
    { x: 0, y: 0, z: 0 }, { x: 0, y: -2, z: -42 }, { x: 4, y: -26, z: -150 },
    { x: 52, y: -54, z: -252 }, { x: 96, y: -84, z: -352 }, { x: 34, y: -112, z: -432 },
    { x: -58, y: -142, z: -502 }, { x: -126, y: -178, z: -592 }, { x: -84, y: -212, z: -688 },
    { x: 12, y: -246, z: -768 }, { x: 92, y: -284, z: -858 }, { x: 48, y: -318, z: -962 },
    { x: -40, y: -352, z: -1062 }, { x: 14, y: -388, z: -1188 }, { x: 40, y: -420, z: -1320 },
  ];
  const points = createPointsFromKnots(knots);
  const jumps = [
    { type: 'table', takeoffS: 250, landingS: 284, height: 2.1, gap: 34, rampLength: 18, runup: 34, landing: 30 },
    { type: 'drop', takeoffS: 520, landingS: 536, height: 3.6, gap: 16, rampLength: 6, runup: 30, landing: 30 },
    { type: 'double', takeoffS: 830, landingS: 868, height: 2.4, gap: 38, rampLength: 20, runup: 32, landing: 30 },
  ];
  applyJumpProfiles(points, jumps);
  return finalizeTrack('fixed-greybox', points, jumps, 'fixed');
}

export function candidate(seed, attempt) {
  const random = mulberry32(hashSeed(`${seed}/route/${attempt}`));
  const complexity = 0.25 + random() * 0.75;
  // Bajada larga desde la cima: más metros, más desnivel y ritmo de descenso.
  const targetLength = 820 + random() * 520;
  const pitch = 0.15 + complexity * 0.12 + random() * 0.04;
  const raw = [{ x: 0, y: 0, z: 0 }];
  let x = 0;
  let z = 0;
  let y = 0;
  let heading = 0;
  let distance = 0;
  let lastSide = 1;
  let lastStraightEnd = 0;
  const segments = [];

  const push = (length, turn, grade) => {
    const stepCount = Math.max(3, Math.ceil(length / 3));
    const ds = length / stepCount;
    for (let i = 0; i < stepCount; i++) {
      const t = (i + 1) / stepCount;
      const localHeading = heading + turn * t;
      x += -Math.sin(localHeading) * ds;
      z += -Math.cos(localHeading) * ds;
      y -= grade * ds;
      raw.push({ x, y, z });
    }
    heading = wrapAngle(heading + turn);
    distance += length;
  };

  while (distance < targetLength) {
    const choice = random();
    let length = 90;
    let turn = 0;
    let type = 'straight';
    let grade = pitch + (random() - 0.5) * 0.05;
    if (segments.length === 0) {
      // Cima: meseta de salida en lo alto, casi en llano y con sitio para
      // arrancar, antes de que la ladera se tire de verdad.
      type = 'summit';
      length = 46;
      grade = 0.02;
      push(length, 0, grade);
      segments.push({ type, turn: 0, length, turnSign: 0, arc: 0, startS: 0, endS: distance });
      continue;
    }
    if (segments.length === 1) {
      // Rampa de lanzamiento: recta que ya cae con fuerza.
      type = 'straight';
      length = 70 + random() * 40;
      grade = Math.min(0.32, pitch + 0.05);
      push(length, 0, grade);
      segments.push({ type, turn: 0, length, turnSign: 0, arc: 0, startS: distance - length, endS: distance });
      continue;
    }
    // Alterna el sentido del giro: la bajada serpentea la ladera en vez de
    // dar vueltas sobre sí misma.
    const side = random() < 0.68 ? -lastSide : lastSide;
    // En pistas duras se fuerza una recta cada cierto tiempo: es donde entran
    // los saltos y los drops.
    if (complexity > 0.35 && distance - lastStraightEnd > 260) {
      type = 'straight';
      length = 125 + random() * 95;
      push(length, 0, grade);
      lastStraightEnd = distance;
      segments.push({ type, turn: 0, length, turnSign: 0, arc: 0, startS: distance - length, endS: distance });
      continue;
    }
    if (choice < 0.34) {
      type = 'curve';
      const arc = 0.7 + random() * 0.75;
      const radius = 46 + random() * 44;
      length = arc * radius;
      turn = side * arc;
    } else if (choice < 0.62) {
      type = 'hairpin';
      const arc = 2.5 + random() * 0.55;
      const radius = 30 + random() * 8;
      length = arc * radius;
      turn = side * arc;
    } else if (choice < 0.84) {
      type = 's-bend';
      const arc = 0.95 + random() * 0.45;
      const radius = 34 + random() * 20;
      length = arc * radius * 2;
      turn = side * arc;
    } else {
      type = 'straight';
      length = 80 + random() * 60;
    }
    const radius = Math.abs(turn) > 1e-6 ? length / Math.abs(turn) : Infinity;
    if (radius < MIN_RADIUS) length = Math.abs(turn) * (MIN_RADIUS + 2);
    const startS = distance;
    push(length, turn, grade);
    if (type === 'straight') lastStraightEnd = distance;
    lastSide = turn === 0 ? lastSide : side;
    segments.push({ type, turn, length, turnSign: Math.sign(turn), arc: Math.abs(turn), startS, endS: distance });
  }

  const points = createPointsFromKnots(raw);
  const jumps = planFeatures(segments, random, complexity);
  applyJumpProfiles(points, jumps);
  const track = finalizeTrack(seed, points, jumps);
  track.complexity = complexity;
  track.segments = segments;
  track.metrics.totalTurn = segments.reduce((sum, segment) => sum + segment.arc, 0);
  return track;
}

// Saltos y drops: cuanto más difícil la pista, más cantidad y más grandes.
function planFeatures(segments, random, complexity) {
  const features = [];
  const target = 2 + Math.round(complexity * 6);
  const straights = segments.filter((segment) => segment.type === 'straight' && segment.endS - segment.startS >= 70);
  for (const segment of straights) {
    if (features.length >= target) break;
    let offset = 24 + random() * 10;
    // Encadena saltos dentro de cada recta hasta llenar el cupo de la pista.
    while (features.length < target) {
      const drop = random() < 0.28 + complexity * 0.34;
      const height = drop ? 3 + complexity * 3.4 : 2.1 + complexity * 2.2;
      const gap = drop ? 11 + random() * 13 : 22 + complexity * 16;
      const takeoffS = segment.startS + offset;
      if (takeoffS + gap + 34 > segment.endS) break;
      features.push({
        type: drop ? 'drop' : random() < 0.5 ? 'table' : 'double',
        takeoffS,
        landingS: takeoffS + gap,
        height,
        gap,
        // Rampa de verdad (≈29°): en una ladera al 25% el labio tiene que ser
        // claramente más empinado que el suelo para lanzar la bici.
        rampLength: drop ? 7 : Math.max(6, height / 0.55),
        runup: takeoffS - segment.startS,
        landing: 30,
      });
      offset += gap + 34 + random() * 30;
    }
  }
  // Las pistas más serias siempre llevan al menos un drop.
  if (complexity > 0.6 && features.length && !features.some((feature) => feature.type === 'drop')) {
    const last = features.at(-1);
    last.type = 'drop';
    last.height = 2.8 + complexity * 3.2;
    last.gap = Math.min(last.gap, 16);
    last.landingS = last.takeoffS + last.gap;
    last.rampLength = 7;
  }
  return features.sort((a, b) => a.takeoffS - b.takeoffS);
}

export function generateTrack(rawSeed, { maxAttempts = 160 } = {}) {
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
    const landingEnd = jump.landingS + 30;
    for (const p of points) {
      if (p.s < rampStart || p.s > landingEnd) continue;
      let offset = 0;
      if (jump.type === 'drop') {
        // Labio corto y caída vertical: el suelo desaparece bajo la rueda.
        if (p.s <= jump.takeoffS) {
          offset = 0.35 * clamp01((p.s - rampStart) / Math.max(1, jump.rampLength));
        } else {
          const face = Math.min(1, (p.s - jump.takeoffS) / 2);
          offset = 0.35 - (jump.height + 0.35) * face;
        }
      } else if (p.s <= jump.takeoffS) {
        offset = jump.height * clamp01((p.s - rampStart) / jump.rampLength);
      } else if (p.s <= jump.landingS) {
        const t = clamp01((p.s - jump.takeoffS) / Math.max(1, jump.landingS - jump.takeoffS));
        offset = jump.height - (jump.height + 0.8) * t;
      } else {
        const t = clamp01((p.s - jump.landingS) / (landingEnd - jump.landingS));
        offset = -0.8 * (1 - t);
      }
      p.y += offset;
    }
  }
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function insideFeatureGap(track, s) {
  return track.jumps.some((jump) => s > jump.takeoffS - jump.rampLength - 1 && s < jump.landingS + 30);
}

export function validateTrack(track) {
  if (!track || track.points.length < 3) return { valid: false, reason: 'too few samples' };
  if (track.length < 700 || track.length > 1500) return { valid: false, reason: `length ${track.length.toFixed(1)}m outside range` };
  if (track.metrics.totalTurn < 6) return { valid: false, reason: `only ${track.metrics.totalTurn.toFixed(1)}rad of turns` };
  const points = track.points;
  // Separación entre tramos no vecinos: evita que la pista se atraviese y que
  // dos laderas se coman la una a la otra.
  const cellSize = CORRIDOR_CLEARANCE;
  const occupied = new Map();
  for (let i = 2; i < points.length - 2; i += 3) {
    const p = points[i];
    const cx = Math.floor(p.x / cellSize);
    const cz = Math.floor(p.z / cellSize);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const prior of occupied.get(`${cx + dx},${cz + dz}`) ?? []) {
          if (Math.abs(p.s - prior.s) < SELF_CLEARANCE_S) continue;
          if (Math.hypot(p.x - prior.x, p.z - prior.z) < CORRIDOR_CLEARANCE) {
            return { valid: false, reason: `corridor overlap near s=${p.s.toFixed(0)}m` };
          }
        }
      }
    }
    const key = `${cx},${cz}`;
    const bucket = occupied.get(key) ?? [];
    bucket.push(p);
    occupied.set(key, bucket);
  }
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const ds = Math.max(0.1, p.s - points[i - 1].s);
    const grade = Math.abs((p.y - points[i - 1].y) / ds);
    if (grade > 0.34 && !insideFeatureGap(track, p.s) && !insideFeatureGap(track, points[i - 1].s)) {
      return { valid: false, reason: `grade ${grade.toFixed(3)} exceeds limit` };
    }
    if (p.curvature > 1 / MIN_RADIUS * 3) return { valid: false, reason: `radius below limit near s=${p.s.toFixed(0)}m` };
  }
  if (!track.jumps.length) return { valid: false, reason: 'no safe straight available for a jump' };
  if ((track.complexity ?? 0) > 0.55 && track.jumps.length < 3) {
    return { valid: false, reason: `only ${track.jumps.length} features on a hard route` };
  }
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
