import test from 'node:test';
import assert from 'node:assert/strict';
import { Player, AIR_SPIN_MAX, YAW_RATE_SLOW, wrapAngle } from '../src/player.js';
import { generateTrack, createFixedTrack, validateTrack, CORRIDOR_HALF, CORRIDOR_CLEARANCE } from '../src/trackgen.js';
import { createTerrain } from '../src/terrain.js';
import { calculateDifficulty, classifyDifficulty, calibrateDifficulty, scanCandidates, pickSeedLadder } from '../src/difficulty.js';
import { loadRecords, saveRecord, recordKey } from '../src/records.js';
import { RaceSession, RACE_STATES, RESPAWN_PENALTY_MS } from '../src/race.js';
import { Input } from '../src/input.js';

const DT = 1 / 120;
function input({ steer = 0, throttle = 0, jump = false, yaw = 0, holdYaw = 0, roll = 0, pitch = null, airYaw = 0 } = {}) {
  let queuedYaw = yaw;
  let pendingJump = jump;
  return {
    steer: () => steer,
    throttle: () => throttle,
    airRoll: () => roll,
    airPitch: () => (pitch === null ? 0 : pitch),
    airYaw: () => airYaw,
    jump: () => pendingJump,
    consumeJump: () => { const value = pendingJump; pendingJump = false; return value; },
    consumeYawDelta: () => { const delta = queuedYaw; queuedYaw = 0; return delta + holdYaw; },
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

test('fase 1: inercia y derrape sin roll; el teclado gira en el suelo con resistencia', () => {
  const slow = new Player();
  simulate(slow, input({ throttle: 1 }), null, 2);
  assert.ok(slow.speed > 1);
  const fast = new Player({ speed: 20 });
  fast.velX = 0;
  fast.velZ = -20;
  fast.yaw = -0.6;
  simulate(fast, input({}), null, 0.05);
  assert.ok(Math.abs(fast.driftAngle) > 0.1, 'la inercia debe abrir un derrape');
  simulate(fast, input({}), null, 0.55);
  assert.ok(fast.speed < 20);
  assert.equal(fast.roll, 0);

  const mouse = new Player({ speed: 6 });
  mouse.velX = 0;
  mouse.velZ = -6;
  simulate(mouse, input({ holdYaw: 0.02 }), null, 0.5);
  assert.ok(Math.abs(mouse.yaw) > 0.2, `el ratón debe poder girar, yaw=${mouse.yaw.toFixed(2)}`);
  const keyboard = new Player({ speed: 10 });
  keyboard.velX = 0;
  keyboard.velZ = -10;
  simulate(keyboard, input({ steer: 1 }), null, 1);
  assert.ok(keyboard.yaw < -0.4, `D debe girar en el suelo, yaw=${keyboard.yaw.toFixed(2)}`);
  assert.equal(keyboard.roll, 0);
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
    let maxClearance = -Infinity;
    let minClearance = 0;
    for (let i = 0; i < 900; i++) {
      rider.savePrev();
      rider.update(DT, input({ throttle: 1 }), terrain);
      const surface = terrain.sample(rider.x, rider.z);
      sawAir ||= rider.airborne;
      if (sawAir) minClearance = Math.min(minClearance, rider.y - surface.height);
      maxClearance = Math.max(maxClearance, rider.y - surface.height);
      assert.equal(rider.roll, 0);
      assert.ok(Number.isFinite(rider.y));
      if (sawAir && rider.grounded) { landed = true; break; }
    }
    assert.ok(sawAir, `${track.id}: ramp must produce airborne state`);
    assert.ok(landed, `${track.id}: flight must land on track`);
    if (jump.type === 'drop') {
      assert.ok(track.sampleAt(jump.landingS).y < launch.y - 1.5, `${track.id}: drop must fall (${jump.height.toFixed(1)}m)`);
    } else {
      assert.ok(maxClearance > 0.6, `${track.id}: the ramp must lift the bike (${maxClearance.toFixed(2)} m sobre el suelo)`);
    }
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
    assert.ok(track.length >= 700 && track.length <= 1500);
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

test('física: el giro acelera, tiene tope de régimen y pierde autoridad con la velocidad', () => {
  const slow = new Player({ speed: 5 });
  const fast = new Player({ speed: 30 });
  slow.velX = 0; slow.velZ = -5;
  fast.velX = 0; fast.velZ = -30;
  simulate(slow, input({ steer: 1 }), null, 0.6);
  simulate(fast, input({ steer: 1 }), null, 0.6);
  const slowTurn = Math.abs(slow.yaw);
  const fastTurn = Math.abs(fast.yaw);
  assert.ok(slowTurn > 0.3, `D debe girar la bici, giro=${slowTurn.toFixed(2)}`);
  assert.ok(slowTurn > fastTurn * 1.3, `giro lento=${slowTurn.toFixed(2)} rápido=${fastTurn.toFixed(2)}`);

  const instant = new Player({ speed: 10 });
  instant.velX = 0; instant.velZ = -10;
  simulate(instant, input({ steer: 1 }), null, DT);
  assert.ok(Math.abs(instant.yaw) < 0.02, `un frame no puede girar de golpe, yaw=${instant.yaw.toFixed(3)}`);

  const spinner = new Player({ speed: 0.5 });
  spinner.velX = 0; spinner.velZ = -0.5;
  let peak = 0;
  for (let i = 0; i < 240; i++) {
    spinner.savePrev();
    spinner.update(DT, input({ steer: 1 }), null);
    peak = Math.max(peak, Math.abs(spinner.yawRate));
  }
  assert.ok(peak <= YAW_RATE_SLOW + 1e-6, `tope de régimen ${peak.toFixed(2)} > ${YAW_RATE_SLOW}`);
});

test('física: se salta con Espacio y en el aire Q/E rota con aceleración y tope', () => {
  const track = createFixedTrack();
  const terrain = createTerrain(track);
  const start = track.sampleAt(30);
  const player = new Player({ x: start.x, y: start.y, z: start.z, yaw: start.yaw, speed: 12 });
  player.velX = -Math.sin(start.yaw) * 12;
  player.velZ = -Math.cos(start.yaw) * 12;
  let sawAir = false;
  let maxRoll = 0;
  let peakRate = 0;
  let firstAirStep = 0;
  let wasAir = false;
  for (let i = 0; i < 400; i++) {
    player.savePrev();
    const before = player.airRoll;
    player.update(DT, i === 0 ? input({ jump: true, throttle: 1, roll: 1 }) : input({ throttle: 1, roll: 1 }), terrain);
    if (player.airborne) {
      sawAir = true;
      if (!wasAir) firstAirStep = Math.abs(player.airRoll - before);
      wasAir = true;
      peakRate = Math.max(peakRate, Math.abs(player.airRate.roll));
      maxRoll = Math.max(maxRoll, Math.abs(player.airRoll));
    }
    if (sawAir && player.grounded) break;
  }
  assert.ok(sawAir, 'el salto con Espacio debe despegar');
  assert.ok(firstAirStep < 0.01, `la rotación arranca acelerando, no de golpe (${firstAirStep.toFixed(4)})`);
  assert.ok(maxRoll > 0.25, `la bici debe rotar en el aire (roll=${maxRoll.toFixed(2)})`);
  assert.ok(peakRate <= AIR_SPIN_MAX + 1e-6, `tope de régimen de giro (${peakRate.toFixed(2)} > ${AIR_SPIN_MAX})`);
  assert.equal(player.roll, 0, 'la cámara nunca se inclina');

  player.velX = 0;
  player.velZ = 0;
  player.speed = 0;
  for (let i = 0; i < 240 && Math.abs(player.airRoll) > 0.05; i++) {
    player.savePrev();
    player.update(DT, input({}), terrain);
  }
  assert.ok(Math.abs(player.airRoll) < 0.05, 'al aterrizar la bici vuelve a la vertical');
});

test('física: en el aire W/S es pitch, A/D es yaw y no se pedalea ni se frena', () => {
  const track = createFixedTrack();
  const terrain = createTerrain(track);
  const start = track.sampleAt(40);
  const rider = new Player({ x: start.x, y: start.y + 30, z: start.z, yaw: start.yaw, speed: 14 });
  rider.velX = -Math.sin(start.yaw) * 14;
  rider.velZ = -Math.cos(start.yaw) * 14;
  rider.grounded = false;
  const yaw0 = rider.yaw;
  const speed0 = rider.speed;
  for (let i = 0; i < 40; i++) {
    rider.savePrev();
    rider.update(DT, input({ throttle: 1, steer: 1, pitch: -1, airYaw: 1 }), terrain);
  }
  assert.ok(rider.airPitch < -0.1, `un pitch negativo baja el morro (pitch=${rider.airPitch.toFixed(2)})`);
  assert.ok(rider.airYaw > 0.1, `A gira en yaw (yaw visual=${rider.airYaw.toFixed(2)})`);
  assert.ok(Math.abs(rider.airRoll) < 1e-9, 'sin Q/E no hay roll');
  assert.ok(Math.abs(wrapAngle(rider.yaw - yaw0)) < 1e-9, 'el rumbo no cambia en el aire');
  assert.ok(rider.speed <= speed0, 'en el aire no se acelera ni se frena');
});

test('trazado: la bajada empieza en la cima, cae fuerte y no se cruza consigo misma', () => {
  for (let n = 0; n < 40; n++) {
    const track = generateTrack(`v1:${n}`);
    assert.ok(track.drop > 120, `${track.id}: solo baja ${track.drop.toFixed(0)} m`);
    assert.ok(-track.metrics.meanGrade > 0.14, `${track.id}: pendiente media ${(track.metrics.meanGrade * 100).toFixed(1)}%`);
    assert.ok(Math.abs(track.points[0].y - track.sampleAt(44).y) < 5, `${track.id}: la salida debe ser una cima`);
    for (let i = 0; i < track.points.length; i += 8) {
      for (let j = i + 4; j < track.points.length; j += 8) {
        const a = track.points[i];
        const b = track.points[j];
        if (Math.abs(a.s - b.s) < 60) continue;
        const gap = Math.hypot(a.x - b.x, a.z - b.z);
        assert.ok(gap >= CORRIDOR_CLEARANCE - 0.01, `${track.id}: dos tramos a ${gap.toFixed(1)} m (s=${a.s.toFixed(0)})`);
      }
    }
  }
});

test('trazado: las pistas difíciles acumulan saltos grandes y drops', () => {
  let hard = 0;
  for (let n = 0; n < 40; n++) {
    const track = generateTrack(`v1:${n}`);
    const score = calculateDifficulty(track).score;
    if (score < 58) continue;
    hard++;
    assert.ok(track.jumps.length >= 3, `${track.id}: solo ${track.jumps.length} saltos`);
    assert.ok(track.jumps.filter((feature) => feature.height >= 2.4).length >= 2, `${track.id}: saltos pequeños (${track.jumps.map((f) => f.height.toFixed(1)).join(',')})`);
    if ((track.complexity ?? 0) > 0.62) {
      assert.ok(track.jumps.some((feature) => feature.type === 'drop'), `${track.id}: falta un drop`);
    }
  }
  assert.ok(hard >= 3, 'debe haber pistas difíciles en la muestra');
});

test('suelo: calzada, arcén y talud son transitables y sólidos', () => {
  const track = createFixedTrack();
  const terrain = createTerrain(track);
  const centre = track.sampleAt(track.length * 0.3);
  const at = (lateral) => terrain.sample(
    centre.x + Math.cos(centre.yaw) * lateral,
    centre.z - Math.sin(centre.yaw) * lateral,
  );
  const road = at(0);
  const shoulder = at(5.5);
  const bank = at(20);
  const void_ = at(CORRIDOR_HALF + 3);
  assert.ok(Math.abs(road.height - centre.y) < 0.1, 'la calzada está a la altura del eje');
  assert.ok(shoulder.inside && shoulder.height < road.height && shoulder.height > road.height - 1.5, 'el arcén es transitable');
  assert.ok(bank.inside && bank.height < shoulder.height - 5, 'el talud cae con fuerza');
  assert.equal(void_.inside, false, 'más allá del corredor no hay suelo');
});

test('obstáculos: los árboles paran la bici en vez de dejarla pasar', () => {
  const track = createFixedTrack();
  const terrain = createTerrain(track);
  const tree = terrain.obstacles.items.find((item) => item.kind === 'tree');
  assert.ok(tree, 'la pista tiene árboles');
  const rider = new Player({ x: tree.x, y: tree.y + 2, z: tree.z + 6, yaw: 0, speed: 12 });
  rider.velX = 0;
  rider.velZ = -12;
  let closest = Infinity;
  for (let i = 0; i < 240; i++) {
    rider.savePrev();
    rider.update(DT, input({ throttle: 1 }), terrain);
    closest = Math.min(closest, Math.hypot(rider.x - tree.x, rider.z - tree.z));
  }
  assert.ok(closest >= tree.radius, `la bici atravesó el árbol (${closest.toFixed(2)} m < ${tree.radius.toFixed(2)} m)`);
});

test('física: rodar rápido por una pista generada no hace rebotar la bici', () => {
  let chosen = null;
  for (let n = 0; n < 12 && !chosen; n++) {
    const route = generateTrack(`v1:${n}`);
    const segment = route.segments.find((part) => part.type === 'straight' && part.endS - part.startS > 50 && !route.jumps.some((jump) => jump.takeoffS > part.startS - 15 && jump.takeoffS < part.endS));
    if (segment) chosen = { route, segment };
  }
  assert.ok(chosen, 'debe existir una recta larga sin rampa');
  const terrain = createTerrain(chosen.route);
  const start = chosen.route.sampleAt(chosen.segment.startS + 5);
  const player = new Player({ x: start.x, y: start.y, z: start.z, yaw: start.yaw, speed: 22 });
  player.velX = -Math.sin(start.yaw) * 22;
  player.velZ = -Math.cos(start.yaw) * 22;
  let flips = 0;
  let maxStep = 0;
  let lastY = player.y;
  for (let i = 0; i < 120; i++) {
    player.savePrev();
    player.update(DT, input({}), terrain);
    if (player.airborne) flips++;
    maxStep = Math.max(maxStep, Math.abs(player.y - lastY));
    lastY = player.y;
  }
  assert.equal(flips, 0, 'la bici no debe despegar rodando en una recta');
  assert.ok(maxStep < 0.4, `la altura no debe dar saltos (${maxStep.toFixed(2)} m por frame)`);
});

test('física: parado no se gira y en el aire cabe una vuelta completa', () => {
  const stopped = new Player();
  simulate(stopped, input({ steer: 1 }), null, 0.5);
  assert.equal(stopped.yaw, 0, 'sin velocidad no se puede girar');
  assert.equal(stopped.lean, 0, 'sin velocidad no hay inclinación');

  const rolling = new Player({ speed: 6 });
  rolling.velX = 0;
  rolling.velZ = -6;
  simulate(rolling, input({ steer: 1 }), null, 0.4);
  assert.ok(rolling.yaw < -0.1, `rodando sí gira, yaw=${rolling.yaw.toFixed(2)}`);

  const track = createFixedTrack();
  const terrain = createTerrain(track);
  const start = track.sampleAt(40);
  const rider = new Player({ x: start.x, y: start.y + 90, z: start.z, yaw: start.yaw, speed: 10 });
  rider.velX = -Math.sin(start.yaw) * 10;
  rider.velZ = -Math.cos(start.yaw) * 10;
  rider.grounded = false;
  let maxRoll = 0;
  for (let i = 0; i < 300; i++) {
    rider.savePrev();
    rider.update(DT, input({ roll: 1 }), terrain);
    maxRoll = Math.max(maxRoll, Math.abs(rider.airRoll));
  }
  assert.ok(maxRoll > Math.PI * 2, `debe poder dar una vuelta completa, roll=${maxRoll.toFixed(2)}`);
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
