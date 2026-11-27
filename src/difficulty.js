import { generateTrack } from './trackgen.js';

export function calculateDifficulty(track) {
  const curves = track.points.filter((p) => p.curvature > 0.008);
  const tightestRadius = curves.length ? 1 / Math.max(...curves.map((p) => p.curvature)) : 1000;
  const jumps = track.jumps.map((jump) => ({ ...jump, airtime: Math.sqrt((2 * jump.height) / 9.81) * 2 }));
  const jumpDuration = jumps.reduce((sum, jump) => sum + jump.airtime, 0);
  const descending = Math.max(0, -track.metrics.meanGrade * 100);
  // Escala normalizada: curvas, saltos, pendiente y radio mínimo pesan en
  // proporción a su rango real, sin saturar el 100.
  const turnLoad = clamp(track.metrics.totalTurn / 26, 0, 1);
  const jumpLoad = clamp(jumps.length / 8, 0, 1);
  const steepLoad = clamp(descending / 28, 0, 1);
  const tightLoad = clamp((110 - tightestRadius) / 80, 0, 1);
  const score = clamp(100 * (turnLoad * 0.32 + jumpLoad * 0.3 + steepLoad * 0.24 + tightLoad * 0.14), 0, 100);
  return {
    score: round(score),
    totalTurn: round(track.metrics.totalTurn),
    tightestRadius: round(tightestRadius),
    curveCount: curves.length,
    jumpCount: jumps.length,
    jumpDuration: round(jumpDuration),
    meanGrade: round(track.metrics.meanGrade * 100),
    maxGrade: round(track.metrics.maxGrade * 100),
  };
}

export function calibrateDifficulty(candidates) {
  const scores = candidates.map((candidate) => candidate.score).filter(Number.isFinite).sort((a, b) => a - b);
  if (scores.length < 5) throw new Error('At least five deterministic candidates are required for tier calibration');
  return [0.2, 0.4, 0.6, 0.8].map((quantile) => scores[Math.min(scores.length - 1, Math.ceil(scores.length * quantile) - 1)]);
}

export function classifyDifficulty(score, thresholds = [33, 42, 53, 68]) {
  if (!Number.isFinite(score)) throw new TypeError('Difficulty score must be finite');
  if (thresholds.length !== 4 || thresholds.some((value, index) => index > 0 && value < thresholds[index - 1])) {
    throw new RangeError('Difficulty thresholds must be four monotonically increasing values');
  }
  if (score <= thresholds[0]) return 1;
  if (score <= thresholds[1]) return 2;
  if (score <= thresholds[2]) return 3;
  if (score <= thresholds[3]) return 4;
  return 5;
}

export const TIER_LABELS = ['Fácil', 'Media', 'Difícil', 'Muy difícil', 'Extrema'];
export function tierLabel(tier) {
  return TIER_LABELS[Math.max(0, Math.min(4, tier - 1))];
}

export function scanCandidates({ count = 100, start = 0, thresholds } = {}) {
  const scored = Array.from({ length: count }, (_, i) => {
    const track = generateTrack(`v1:${start + i}`);
    const metrics = calculateDifficulty(track);
    return { id: track.id, hash: track.hash, score: metrics.score, metrics };
  }).sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
  const calibrated = thresholds ?? calibrateDifficulty(scored);
  return scored.map((candidate) => ({ ...candidate, tier: classifyDifficulty(candidate.score, calibrated) }));
}

export function pickSeedLadder({ count = 240, start = 0, perTier = 3 } = {}) {
  const candidates = scanCandidates({ count, start });
  const result = [];
  for (let tier = 1; tier <= 5; tier++) {
    const matches = candidates.filter((item) => item.tier === tier);
    for (const item of evenlySpaced(matches, perTier)) result.push({ ...item, tier });
  }
  return result.sort((a, b) => a.tier - b.tier || a.score - b.score);
}

function evenlySpaced(items, count) {
  if (items.length <= count) return items;
  return Array.from({ length: count }, (_, i) => items[Math.round(i * (items.length - 1) / Math.max(1, count - 1))]);
}
function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x));
}
function round(x) {
  return Math.round(x * 100) / 100;
}
