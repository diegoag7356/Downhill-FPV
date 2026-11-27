import test from 'node:test';
import assert from 'node:assert/strict';
import { Player, MAX_LEAN } from '../src/player.js';
import { wrapAngle } from '../src/angles.js';
import { createCamera, updateCamera } from '../src/camera.js';
import { hashSeed, mulberry32 } from '../src/rng.js';
import { createFixedTrack } from '../src/trackgen.js';
import { createTerrain } from '../src/terrain.js';

const DT = 1 / 120;

function fakeInput({ steer = 0, throttle = 0, yawDelta = 0 } = {}) {
  let pendingYaw = yawDelta;
  return {
    steer: () => steer,
    throttle: () => throttle,
    airRoll: () => 0,
    airPitch: () => -steer,
    airYaw: () => 0,
    consumeYawDelta: () => {
      const d = pendingYaw;
      pendingYaw = 0;
      return d;
    },
    setSteer(s) {
      steer = s;
    },
  };
}

function run(player, input, seconds) {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    player.savePrev();
    player.update(DT, input);
  }
}

test('la cámara gira pero nunca se inclina (roll = 0)', () => {
  const camera = createCamera(16 / 9);
  const rand = mulberry32(hashSeed('v1:0'));
  for (let i = 0; i < 500; i++) {
    const yaw = (rand() * 2 - 1) * Math.PI * 4;
    const pitch = (rand() * 2 - 1) * 0.9;
    updateCamera(camera, { position: { x: rand() * 100, y: 1.6, z: -rand() * 100 }, yaw, pitch });
    assert.equal(camera.rotation.order, 'YXZ');
    assert.equal(camera.rotation.z, 0);
    assert.ok(Math.abs(camera.rotation.y - wrapAngle(yaw)) < 1e-12);
    assert.ok(Math.abs(camera.rotation.x - pitch) < 1e-12);
  }
});

test('el jugador se mueve en espacio de mundo según su rumbo', () => {
  const player = new Player();
  player.yaw = 0; // mira a -Z
  run(player, fakeInput({ throttle: 1 }), 2);
  assert.ok(player.speed > 10, `debería acelerar, velocidad=${player.speed}`);
  assert.equal(player.x, 0, 'yaw 0 solo avanza en -Z');
  assert.ok(player.z < -1, 'debería avanzar hacia -Z');

  const other = new Player();
  other.yaw = Math.PI / 2; // mira a -X
  run(other, fakeInput({ throttle: 1 }), 2);
  assert.ok(other.x < -1, 'debería avanzar hacia -X');
  assert.ok(Math.abs(other.z) < 1e-9, 'yaw +90° no debe generar avance lateral');
});

test('A/D y las flechas giran en el suelo, inclinan la bici con tope y en el aire solo rotan', () => {
  const right = new Player({ speed: 8 });
  right.velX = 0;
  right.velZ = -8;
  run(right, fakeInput({ steer: 1 }), 0.6);
  assert.ok(right.yaw < -0.15, `D debe girar a la derecha, yaw=${right.yaw.toFixed(2)}`);
  assert.ok(right.lean < -0.05, 'la bici se inclina hacia el lado del giro');
  assert.ok(Math.abs(right.lean) <= MAX_LEAN + 1e-9, 'la inclinación tiene tope');
  assert.equal(right.roll, 0, 'la cámara nunca se inclina');

  const left = new Player({ speed: 8 });
  left.velX = 0;
  left.velZ = -8;
  run(left, fakeInput({ steer: -1 }), 0.6);
  assert.ok(left.yaw > 0.15, 'A gira al otro lado');
  assert.ok(left.lean > 0.05, 'y se inclina al otro lado');

  // En el aire A/D no cambia el rumbo: rota la bici en el eje de pitch.
  const track = createFixedTrack();
  const terrain = createTerrain(track);
  const start = track.sampleAt(20);
  const airborne = new Player({ x: start.x, y: start.y + 20, z: start.z, yaw: 0, speed: 8 });
  airborne.velX = 0;
  airborne.velZ = -8;
  airborne.grounded = false;
  for (let i = 0; i < 24; i++) {
    airborne.savePrev();
    airborne.update(DT, fakeInput({ steer: 1 }), terrain);
  }
  assert.equal(airborne.yaw, 0, 'A/D no desvían en el aire');
  assert.ok(airborne.airPitch < -0.02, `D baja el morro (pitch=${airborne.airPitch.toFixed(2)})`);
  assert.ok(Math.abs(airborne.airRoll) < 1e-9, 'A/D no hacen roll');
  assert.equal(airborne.roll, 0, 'la cámara nunca se inclina');
});

test('el ratón aporta rumbo con resistencia, no inclinación', () => {
  const player = new Player();
  run(player, fakeInput({ yawDelta: -0.35 }), DT);
  assert.ok(player.yaw < 0, 'movementX positivo gira a la derecha');
  assert.ok(Math.abs(player.yaw) < 0.02, 'un solo frame no aplica el giro entero');
  assert.equal(player.pitch, 0);

  // Un movimiento de ratón sostenido sí gira, pero acelerando.
  for (let i = 0; i < 60; i++) {
    player.savePrev();
    player.update(DT, {
      steer: () => 0,
      throttle: () => 0,
      airRoll: () => 0,
      airPitch: () => 0,
      airYaw: () => 0,
      consumeYawDelta: () => -0.02,
    });
  }
  assert.ok(player.yaw < -0.2, `el ratón sostenido gira la bici, yaw=${player.yaw.toFixed(2)}`);

  const turned = player.yaw;
  run(player, fakeInput({}), 0.5);
  assert.ok(Math.abs(player.yawRate) < 0.01, 'al soltar, el giro se frena');
  assert.ok(Math.abs(player.yaw - turned) < 0.2, 'sin ratón el rumbo no se va solo');
});

test('el paso fijo es determinista', () => {
  const a = new Player();
  const b = new Player();
  a.yaw = 0.7;
  b.yaw = 0.7;

  const inputA = fakeInput({ steer: 0.4, throttle: 1 });
  const inputB = fakeInput({ steer: 0.4, throttle: 1 });
  run(a, inputA, 2);
  run(b, inputB, 2);
  assert.equal(a.x, b.x);
  assert.equal(a.z, b.z);
  assert.equal(a.yaw, b.yaw);
  assert.equal(a.speed, b.speed);
  assert.equal(a.lean, b.lean);
});

test('rng: misma semilla, misma secuencia', () => {
  const s1 = mulberry32(hashSeed('v1:42'));
  const s2 = mulberry32(hashSeed('v1:42'));
  const s3 = mulberry32(hashSeed('v1:43'));
  const seq1 = Array.from({ length: 20 }, s1);
  const seq2 = Array.from({ length: 20 }, s2);
  const seq3 = Array.from({ length: 20 }, s3);
  assert.deepEqual(seq1, seq2);
  assert.notDeepEqual(seq1, seq3);
  assert.ok(seq1.every((v) => v >= 0 && v < 1));
});
