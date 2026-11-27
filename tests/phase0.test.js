import test from 'node:test';
import assert from 'node:assert/strict';
import { Player } from '../src/player.js';
import { wrapAngle } from '../src/angles.js';
import { createCamera, updateCamera } from '../src/camera.js';
import { hashSeed, mulberry32 } from '../src/rng.js';

const DT = 1 / 120;

function fakeInput({ steer = 0, throttle = 0, yawDelta = 0 } = {}) {
  let pendingYaw = yawDelta;
  return {
    steer: () => steer,
    throttle: () => throttle,
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

test('A gira a la izquierda y D a la derecha sobre el plano', () => {
  const left = new Player();
  run(left, fakeInput({ steer: -1 }), 0.5);
  assert.ok(left.yaw > 0.5, `A debe aumentar yaw, yaw=${left.yaw}`);

  const right = new Player();
  run(right, fakeInput({ steer: 1 }), 0.5);
  assert.ok(right.yaw < -0.5, `D debe reducir yaw, yaw=${right.yaw}`);
  assert.equal(right.x, 0, 'girar quieto no desplaza al jugador');
  assert.equal(right.z, 0);
});

test('el ratón aporta rumbo, no inclinación', () => {
  const player = new Player();
  run(player, fakeInput({ yawDelta: -0.3 }), DT);
  assert.ok(Math.abs(player.yaw + 0.3) < 1e-9, 'movementX positivo gira a la derecha');
  assert.equal(player.pitch, 0);
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
