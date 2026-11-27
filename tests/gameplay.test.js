import test from 'node:test';
import assert from 'node:assert/strict';
import { Player } from '../src/player.js';
import { generateTrack, createFixedTrack, validateTrack } from '../src/trackgen.js';
import { createTerrain } from '../src/terrain.js';
import { calculateDifficulty, classifyDifficulty, calibrateDifficulty, scanCandidates, pickSeedLadder } from '../src/difficulty.js';
import { loadRecords, saveRecord, recordKey } from '../src/records.js';
import { RaceSession, RACE_STATES, RESPAWN_PENALTY_MS } from '../src/race.js';
import { Input } from '../src/input.js';

const DT = 1 / 120;
function input({ steer = 0, throttle = 0, jump = false, yaw = 0 } = {}) {
  let queuedYaw = yaw;
  let pendingJump = jump;
  return {
    steer: () => steer,
    throttle: () => throttle,
    jump: () => pendingJump,
    consumeJump: () => { const value = pendingJump; pendingJump = false; return value; },
    consumeYawDelta: () => { const delta = queuedYaw; queuedYaw = 0; return delta; },
  };
}
function simulate(player, controls, terrain, seconds) {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    player.savePrev();
    player.update(DT, controls, terrain);
  }
}

test('los controles táctiles mantienen pulsaciones independientes y limpian cancelaciones', () => {
  class FakeTarget {
    listeners = new Map();
    addEventListener(type, listener) {
      const handlers = this.listeners.get(type) ?? [];
      handlers.push(listener);
      this.listeners.set(type, handlers);
    }
    dispatch(type, event = {}) {
      for (const listener of this.listeners.get(type) ?? []) listener({ preventDefault() {}, ...event });
    }
  }
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = new FakeTarget();
  globalThis.document = { pointerLockElement: null };
  const canvas = new FakeTarget();
  const buttons = ['KeyW', 'KeyD'].map((code) => Object.assign(new FakeTarget(), { dataset: { key: code } }));
  const controls = { querySelectorAll: () => buttons };
  try {
    const input = new Input(canvas);
    input.bindTouchControls(controls);
    buttons[0].dispatch('pointerdown', { pointerId: 1 });
    buttons[1].dispatch('pointerdown', { pointerId: 2 });
    assert.equal(input.throttle(), 1);
    assert.equal(input.steer(), 1);
    buttons[0].dispatch('pointerup', { pointerId: 1 });
    assert.equal(input.throttle(), 0);
    assert.equal(input.steer(), 1);
    buttons[1].dispatch('pointercancel', { pointerId: 2 });
    assert.equal(input.steer(), 0);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('fase 1: giro con ratón, inercia y derrape sin roll; el teclado no desvía', () => {
  const slow = new Player();
  simulate(slow, input({ throttle: 1 }), null, 2);
  assert.ok(slow.speed > 1);
  const fast = new Player();
  fast.speed = 20;
  fast.velX = 0;
  fast.velZ = -20;
  fast.yaw = -0.6;
  simulate(fast, input({}), null, 0.05);
  assert.ok(Math.abs(fast.driftAngle) > 0.1, 'la inercia debe abrir un derrape');
  simulate(fast, input({}), null, 0.55);
  assert.ok(fast.speed < 20);
  assert.equal(fast.roll, 0);

  const mouse = new Player();
  simulate(mouse, input({ yaw: 0.5 }), null, 0.5);
  assert.ok(Math.abs(mouse.yaw) > 0.2, 'el ratón debe poder girar');
  const keyboard = new Player();
  simulate(keyboard, input({ steer: 1 }), null, 1);
  assert.equal(keyboard.yaw, 0, 'A/D y flechas no deben alterar el rumbo en el suelo');
});

test('fase 2: la distancia sampleada coincide con la distancia del mundo en pistas generadas', () => {
  const track = generateTrack('v1:0');
  const terrain = createTerrain(track);
  for (const distance of [0, 10, 100, 200, 300, track.jumps[0].takeoffS, track.length * 0.8, track.length - 1]) {
    const point = track.sampleAt(distance);
    const surface = terrain.sample(point.x, point.z);
    assert.ok(Math.abs(point.s - distance) < 1e-6, `sampleAt(${distance}) returned s=${point.s}`);
    assert.ok(Math.abs(surface.s - distance) < 2.1, `terrain at ${distance}m reports s=${surface.s}`);
  }
});

test('fase 2: consultas del mundo distinguen la cinta, el arcén y el exterior', () => {
  const track = createFixedTrack();
  const terrain = createTerrain(track);
  const sample = track.sampleAt(track.length * 0.2);
  const surface = terrain.sample(sample.x, sample.z);
  assert.ok(surface.onTrack, `sample ${sample.s} should fall on the track`);
  assert.ok(Math.abs(surface.height - sample.y) < 0.05);
  assert.ok(surface.normal.y > 0.8);
  const outside = terrain.sample(sample.x + 100, sample.z);
  assert.equal(outside.onTrack, false);
  assert.ok(outside.height < surface.height - 4);
  assert.ok(track.metrics.totalTurn > Math.PI, 'fixed route contains a tight curve and hairpin');
});

test('fase 3: 100 saltos de semillas distintas producen vuelo y aterrizaje sin atravesar el terreno', () => {
  for (let n = 0; n < 100; n++) {
    const track = generateTrack(`v1:${n}`);
    const terrain = createTerrain(track);
    const jump = track.jumps[0];
    const launch = track.sampleAt(jump.takeoffS - Math.min(10, jump.runup * 0.25));
    const speed = 15 + (n % 7);
    const rider = new Player({ x: launch.x, y: launch.y, z: launch.z, yaw: launch.yaw, speed });
    rider.velX = -Math.sin(rider.yaw) * speed;
    rider.velZ = -Math.cos(rider.yaw) * speed;
    let sawAir = false;
    let landed = false;
    let maxHeight = rider.y;
    let minClearance = 0;
    for (let i = 0; i < 900; i++) {
      rider.savePrev();
      rider.update(DT, input({ throttle: 1 }), terrain);
      const surface = terrain.sample(rider.x, rider.z);
      sawAir ||= rider.airborne;
      if (sawAir) minClearance = Math.min(minClearance, rider.y - surface.height);
      maxHeight = Math.max(maxHeight, rider.y);
      assert.equal(rider.roll, 0);
      assert.ok(Number.isFinite(rider.y));
      if (sawAir && rider.grounded) { landed = true; break; }
    }
    assert.ok(sawAir, `${track.id}: ramp must produce airborne state`);
    assert.ok(landed, `${track.id}: flight must land on track`);
    assert.ok(maxHeight > launch.y + 0.25, `${track.id}: must gain height`);
    assert.ok(minClearance >= -0.02, `${track.id}: penetrated terrain by ${minClearance}m`);
  }
});

test('fase 3: cada salto generado cabe en una recta continua', () => {
  for (let n = 0; n < 100; n++) {
    const track = generateTrack(`v1:${n}`);
    assert.ok(track.jumps.length > 0, `${track.id}: must include a jump`);
    for (const jump of track.jumps) {
      const rampStart = jump.takeoffS - jump.rampLength;
      const segment = track.segments.find((part) => part.startS <= rampStart && part.endS >= jump.landingS + 5);
      assert.ok(segment, `${track.id}: ramp and landing must fit inside one segment`);
      assert.equal(segment.type, 'straight', `${track.id}: jump must not be placed on a turn`);
    }
  }
});

test('fase 4: semilla reproducible y mil pistas válidas con curvas y saltos', () => {
  const a = generateTrack('v1:12345');
  const b = generateTrack('v1:12345');
  assert.equal(a.hash, b.hash);
  assert.deepEqual(a.points, b.points);
  for (let n = 0; n < 1000; n++) {
    const track = generateTrack(`v1:${n}`);
    const result = validateTrack(track);
    assert.equal(result.valid, true, `v1:${n}: ${result.reason}`);
    assert.ok(track.length >= 560 && track.length <= 1200);
    assert.ok(track.metrics.totalTurn > Math.PI * 1.5, `v1:${n} needs real turns`);
    assert.ok(track.jumps.length >= 1, `v1:${n} has no jump`);
    assert.ok(track.jumps.every((jump) => jump.runup >= 15 && jump.landing >= 15));
  }
});

test('física: sin tope duro la bici pasa de 24 m/s', () => {
  const player = new Player();
  simulate(player, input({ throttle: 1 }), null, 25);
  assert.ok(player.speed > 24, `debería superar 24 m/s sin recorte, velocidad=${player.speed}`);
});

test('física: el giro tiene resistencia y a más velocidad cuesta más meter la bici', () => {
  const slow = new Player({ speed: 5 });
  const fast = new Player({ speed: 30 });
  slow.velX = 0; slow.velZ = -5;
  fast.velX = 0; fast.velZ = -30;
  simulate(slow, input({ yaw: 1 }), null, 0.25);
  simulate(fast, input({ yaw: 1 }), null, 0.25);
  const slowTurn = Math.abs(slow.yaw);
  const fastTurn = Math.abs(fast.yaw);
  assert.ok(slowTurn > 0.15, `el ratón debe girar la bici, giro=${slowTurn.toFixed(2)}`);
  assert.ok(slowTurn > fastTurn * 1.3, `giro lento=${slowTurn.toFixed(2)} rápido=${fastTurn.toFixed(2)}`);

  const instant = new Player();
  simulate(instant, input({ yaw: 40 }), null, 1 / 120);
  assert.ok(Math.abs(instant.yaw) < 0.1, `un tirón del ratón no puede girar de golpe, yaw=${instant.yaw.toFixed(2)}`);
});

test('física: se salta con Espacio/Q/E y en el aire A/D rota la bici', () => {
  const track = createFixedTrack();
  const terrain = createTerrain(track);
  const start = track.sampleAt(30);
  const player = new Player({ x: start.x, y: start.y, z: start.z, yaw: start.yaw, speed: 12 });
  player.velX = -Math.sin(start.yaw) * 12;
  player.velZ = -Math.cos(start.yaw) * 12;
  let sawAir = false;
  let maxAirRoll = 0;
  for (let i = 0; i < 300; i++) {
    player.savePrev();
    player.update(DT, i === 0 ? input({ jump: true, throttle: 1, steer: 1 }) : input({ throttle: 1, steer: 1 }), terrain);
    if (player.airborne) {
      sawAir = true;
      maxAirRoll = Math.max(maxAirRoll, Math.abs(player.airRoll));
    }
    if (sawAir && player.grounded) break;
  }
  assert.ok(sawAir, 'el salto manual debe despegar');
  assert.ok(maxAirRoll > 0.3, `la bici debe rotar en el aire (roll=${maxAirRoll.toFixed(2)})`);
  assert.equal(player.roll, 0, 'la cámara nunca se inclina');
  for (let i = 0; i < 180 && Math.abs(player.airRoll) > 0.05; i++) {
    player.savePrev();
    player.update(DT, input({}), terrain);
  }
  assert.ok(Math.abs(player.airRoll) < 0.05, 'al aterrizar la bici vuelve a la vertical');
});

test('fase 5: tiers 1–5 aparecen en la pila ordenada y los scores son repetibles', () => {
  const candidates = scanCandidates({ count: 300, start: 12000 });
  assert.deepEqual([...candidates].sort((a, b) => a.score - b.score), candidates);
  assert.deepEqual(new Set(candidates.map((route) => route.tier)), new Set([1, 2, 3, 4, 5]));
  assert.equal(calibrateDifficulty(candidates).length, 4);
  assert.throws(() => calibrateDifficulty([]), /five deterministic candidates/);
  const easy = calculateDifficulty(generateTrack('v1:12001'));
  const same = calculateDifficulty(generateTrack('v1:12001'));
  assert.deepEqual(easy, same);
  assert.ok([1, 2, 3, 4, 5].includes(classifyDifficulty(easy.score)));

  const ladder = { tracks: pickSeedLadder({ count: 100, start: 3000, perTier: 2 }) };
  assert.deepEqual([...new Set(ladder.tracks.map((route) => route.tier))], [1, 2, 3, 4, 5]);
  assert.equal(ladder.tracks.length, 10);
  assert.equal(new Set(ladder.tracks.map((route) => route.id)).size, 10);
  assert.ok(ladder.tracks.every((route) => route.id.startsWith('v1:') && route.hash.length === 8));
  assert.deepEqual(ladder.tracks.map((route) => route.tier), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
});

test('fase 6: al caer fuera del arcén el respawn usa el último punto seguro y suma 3 s', () => {
  const track = createFixedTrack();
  const terrain = createTerrain(track);
  const player = new Player();
  const race = new RaceSession(track, player, { now: () => 0 });
  race.start();
  const safe = { ...race.safe };
  player.x += 40;
  const fallenSurface = terrain.sample(player.x, player.z);
  player.y = fallenSurface.height - 8;
  player.grounded = false;
  race.update(terrain);
  assert.deepEqual({ x: player.x, y: player.y, z: player.z }, { x: safe.x, y: safe.y, z: safe.z });
  assert.equal(race.penaltyMs, RESPAWN_PENALTY_MS);
});

test('fase 6: récords validan corrupción y carrera pausa, penaliza, respawnea y finaliza', () => {
  const data = {};
  const storage = { getItem: (key) => data[key] ?? null, setItem: (key, value) => { data[key] = value; } };
  const key = recordKey('v1:42');
  assert.deepEqual(loadRecords(storage), {});
  assert.equal(saveRecord(storage, key, 80_000), true);
  assert.equal(saveRecord(storage, key, 90_000), false);
  assert.equal(saveRecord(storage, key, 70_000), true);
  assert.equal(loadRecords(storage)[key], 70_000);
  data.downhillRecords = '{bad json';
  assert.deepEqual(loadRecords(storage), {});
  assert.equal(saveRecord({ getItem: () => null, setItem() { throw new Error('blocked'); } }, key, 1), false);

  const track = createFixedTrack();
  const player = new Player();
  let now = 0;
  const race = new RaceSession(track, player, { storage, now: () => now });
  assert.equal(race.start(), true);
  assert.equal(race.state, RACE_STATES.RACING);
  now += 1000;
  assert.equal(race.pause(), RACE_STATES.PAUSED);
  assert.equal(race.elapsedMs, 1000);
  now += 5000;
  race.pause();
  assert.equal(race.state, RACE_STATES.RACING);
  assert.equal(race.elapsedMs, 1000);
  const safe = { ...race.safe };
  race.respawn();
  assert.equal(player.x, safe.x);
  assert.equal(race.penaltyMs, RESPAWN_PENALTY_MS);
  race.player.x = track.points.at(-1).x;
  race.player.y = track.points.at(-1).y;
  race.player.z = track.points.at(-1).z;
  race.finish();
  assert.equal(race.state, RACE_STATES.FINISHED);
  assert.ok(race.elapsedMs >= 4000);
});
