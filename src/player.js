// Cuerpo libre en coordenadas de mundo; la pista solo aporta consultas de suelo.
import { wrapAngle } from './angles.js';

const GRAVITY = 9.81;
const PEDAL_ACCELERATION = 8.5;
const BRAKING = 18;
const AIR_DRAG = 0.012;
const ROLLING_DRAG = 0.55;
const AERO_DRAG = 0.0045;
const EYE_HEIGHT = 1.6;
// Velocidad de referencia para HUD y FOV. No es un tope: la resistencia crece
// con la velocidad y la bici sigue ganando metros por segundo, cada vez menos.
export const SPEED_REFERENCE = 40;
const PEDAL_FADE_SPEED = 60;

// --- Dirección en el suelo ---------------------------------------------------
// A/D y las flechas piden un régimen de giro; la bici lo alcanza acelerando y
// pierde autoridad con la velocidad, así que ninguna curva es instantánea.
export const YAW_RATE_SLOW = 1.85;
export const YAW_RATE_FAST = 0.78;
const YAW_ACCEL = 6.4;
const YAW_RECENTER = 5.6;
// Parado no se gira: la autoridad de dirección crece con la velocidad.
const TURN_FULL_SPEED = 3.5;
// Inclinación: sale del giro real y de la velocidad, con tope duro y una
// entrada suave (nada de tumbar la bici de golpe).
export const MAX_LEAN = 0.55;
const LEAN_RATE = 2;
const LEAN_RECENTER = 3.2;
const CONTROL_LOSS_ANGLE = Math.PI / 4;

// --- Rotación libre en el aire ----------------------------------------------
// Cada eje tiene su propio régimen angular: acelera al pulsar, frena al soltar
// y nunca pasa del tope (nada de giros instantáneos), pero no hay tope de
// ángulo: se puede dar una vuelta completa.
export const AIR_SPIN_MAX = 3;
const AIR_SPIN_ACCEL = 6.5;
const AIR_SPIN_DAMP = 2.4;
const AIR_LEVEL_RATE = 9;
const TAU = Math.PI * 2;

const JUMP_IMPULSE = 6.3;
// Caída máxima por frame que la rueda copia sin despegar: evita el rebote
// constante al bajar pendientes a toda velocidad.
const GROUND_SNAP = 0.45;

export class Player {
  constructor({ x = 0, y = 0, z = 0, yaw = 0, speed = 0 } = {}) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.yaw = yaw;
    this.velX = -Math.sin(yaw) * speed;
    this.velZ = -Math.cos(yaw) * speed;
    this.speed = speed;
    this.vy = 0;
    this.grounded = true;
    this.pitch = 0;
    this.roll = 0;
    this.driftAngle = 0;
    this.yawRate = 0;
    this.steerAngle = 0;
    this.lean = 0;
    this.mouseTurn = 0;
    this.airRoll = 0;
    this.airPitch = 0;
    this.airYaw = 0;
    this.airRate = { roll: 0, pitch: 0, yaw: 0 };
    this.lossOfControl = 0;
    this.impact = 0;
    this.prev = { x, y, z, yaw, pitch: 0 };
  }

  get airborne() {
    return !this.grounded;
  }

  savePrev() {
    Object.assign(this.prev, { x: this.x, y: this.y, z: this.z, yaw: this.yaw, pitch: this.pitch });
  }

  forward() {
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
  }

  update(dt, input, terrain = null) {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    const startingSurface = terrain?.sample(this.x, this.z) ?? null;
    const currentSpeed = Math.hypot(this.velX, this.velZ);
    const speedRatio = Math.min(currentSpeed / SPEED_REFERENCE, 1);
    const velocityHeading = currentSpeed > 0.01 ? Math.atan2(-this.velX, -this.velZ) : this.yaw;
    this.driftAngle = wrapAngle(velocityHeading - this.yaw);

    if (Math.abs(this.driftAngle) > CONTROL_LOSS_ANGLE) this.lossOfControl = 0.55;
    else this.lossOfControl = Math.max(0, this.lossOfControl - dt);
    const controlScale = this.lossOfControl > 0 ? 0.5 : 1;

    // --- Dirección -----------------------------------------------------------
    // El rumbo se alcanza acelerando y tiene tope de régimen que baja con la
    // velocidad: las curvas cuestan. El ratón suma la misma demanda.
    const steerInput = clamp(input.steer?.() ?? 0, -1, 1);
    const mouseDelta = input.consumeYawDelta?.() ?? 0;
    this.mouseTurn = clamp(this.mouseTurn * Math.exp(-dt * 12) + mouseDelta * 2.2, -1, 1);

    if (this.grounded) {
      const turnCommand = clamp(-steerInput + this.mouseTurn, -1, 1);
      // Parado no hay giro: la autoridad llega con la velocidad.
      const turnAuthority = clamp(currentSpeed / TURN_FULL_SPEED, 0, 1);
      const maxYawRate = (YAW_RATE_SLOW + (YAW_RATE_FAST - YAW_RATE_SLOW) * speedRatio) * controlScale * turnAuthority;
      const targetYawRate = turnCommand * maxYawRate;
      const rateStep = (turnCommand !== 0 ? YAW_ACCEL : YAW_RECENTER) * dt;
      this.yawRate += clamp(targetYawRate - this.yawRate, -rateStep, rateStep);
      this.yaw = wrapAngle(this.yaw + this.yawRate * dt);
      this.steerAngle = clamp(this.yawRate / YAW_RATE_SLOW, -1, 1);
      // Inclinación física: atan(v·ω/g), acotada por MAX_LEAN.
      const leanTarget = clamp(Math.atan2(currentSpeed * this.yawRate, GRAVITY) * 1.15, -MAX_LEAN, MAX_LEAN);
      const leanStep = (Math.abs(leanTarget) > Math.abs(this.lean) ? LEAN_RATE : LEAN_RECENTER) * dt;
      this.lean += clamp(leanTarget - this.lean, -leanStep, leanStep);
    } else {
      // En el aire A/D no cambian el rumbo: el giro que traías se disipa.
      this.yawRate *= Math.exp(-dt * 3);
      this.steerAngle = 0;
      this.lean += clamp(-this.lean, -LEAN_RECENTER * dt, LEAN_RECENTER * dt);
    }

    // --- Rotación libre de la bici en el aire --------------------------------
    // Q/E roll (eje rojo), W/S pitch (eje azul), A/D yaw (eje verde).
    const rollAxis = clamp(input.airRoll?.() ?? 0, -1, 1);
    const pitchAxis = clamp(input.airPitch?.() ?? 0, -1, 1);
    const yawAxis = clamp(input.airYaw?.() ?? 0, -1, 1);
    if (!this.grounded) {
      this.airRate.roll = spinAxis(this.airRate.roll, rollAxis, dt);
      this.airRate.pitch = spinAxis(this.airRate.pitch, pitchAxis, dt);
      this.airRate.yaw = spinAxis(this.airRate.yaw, yawAxis, dt);
      // Sin topes de ángulo: se puede dar una vuelta completa (o varias).
      this.airRoll += this.airRate.roll * dt;
      this.airPitch += this.airRate.pitch * dt;
      this.airYaw += this.airRate.yaw * dt;
    } else if (this.airRoll !== 0 || this.airPitch !== 0 || this.airYaw !== 0) {
      // Al tocar suelo la bici vuelve sola a la vertical.
      for (const axis of ['roll', 'pitch', 'yaw']) this.airRate[axis] *= Math.exp(-dt * 14);
      this.airRoll = settle(this.airRoll * Math.exp(-dt * AIR_LEVEL_RATE));
      this.airPitch = settle(this.airPitch * Math.exp(-dt * AIR_LEVEL_RATE));
      this.airYaw = settle(this.airYaw * Math.exp(-dt * AIR_LEVEL_RATE));
    }

    // --- Pedaleo y freno (solo con las ruedas en el suelo) -------------------
    let vx = this.velX;
    let vz = this.velZ;
    const throttle = this.grounded ? input.throttle() : 0;
    if (throttle > 0) {
      const pedal = PEDAL_ACCELERATION * Math.max(0.12, 1 - currentSpeed / PEDAL_FADE_SPEED);
      vx += -Math.sin(this.yaw) * pedal * throttle * dt;
      vz += -Math.cos(this.yaw) * pedal * throttle * dt;
    } else if (throttle < 0 && currentSpeed > 0.001) {
      const reduction = Math.min(currentSpeed, BRAKING * -throttle * dt);
      vx -= (vx / currentSpeed) * reduction;
      vz -= (vz / currentSpeed) * reduction;
    }

    const newSpeed = Math.hypot(vx, vz);
    const gripRate = 2.4 - 2 * speedRatio;
    const velocityHeadingAfterThrottle = newSpeed > 0.001 ? Math.atan2(-vx, -vz) : this.yaw;
    const velocityDelta = wrapAngle(this.yaw - velocityHeadingAfterThrottle);
    const maxGripTurn = gripRate * dt;
    const rotatedHeading = velocityHeadingAfterThrottle + Math.sign(velocityDelta) * Math.min(Math.abs(velocityDelta), maxGripTurn);
    if (newSpeed > 0.001) {
      const drag = ROLLING_DRAG + AERO_DRAG * newSpeed * newSpeed;
      const retainedSpeed = Math.max(0, newSpeed - drag * dt);
      vx = -Math.sin(rotatedHeading) * retainedSpeed;
      vz = -Math.cos(rotatedHeading) * retainedSpeed;
      if (startingSurface?.onTrack && this.grounded) {
        const grade = -startingSurface.grade;
        const downhillAcceleration = Math.max(-3, Math.min(3, -grade * GRAVITY));
        vx += (-Math.sin(rotatedHeading)) * downhillAcceleration * dt;
        vz += (-Math.cos(rotatedHeading)) * downhillAcceleration * dt;
      }
      const driftLoss = Math.sin(Math.min(Math.abs(this.driftAngle), Math.PI / 2)) * currentSpeed * 0.82 * dt;
      const afterDrift = Math.max(0, Math.hypot(vx, vz) - driftLoss);
      const magnitude = Math.hypot(vx, vz);
      if (magnitude > 0.001) {
        vx *= afterDrift / magnitude;
        vz *= afterDrift / magnitude;
      }
    }
    this.velX = vx;
    this.velZ = vz;
    // Sin recorte duro: la velocidad sube mientras la resistencia y la
    // pendiente lo permitan, y se estanca de forma progresiva.
    this.speed = Math.hypot(vx, vz);

    const nextX = this.x + this.velX * dt;
    const nextZ = this.z + this.velZ * dt;
    const nextSurface = terrain?.sample(nextX, nextZ) ?? null;
    const oldY = this.y;
    this.impact = 0;

    if (!terrain) {
      this.x = nextX;
      this.z = nextZ;
      this.y = 0;
      this.vy = 0;
      this.grounded = true;
      this.pitch = 0;
      return;
    }

    // Salto manual: Espacio. Vale en cualquier punto del trazado.
    if (input.consumeJump?.()) {
      this.vy = Math.max(this.vy, JUMP_IMPULSE);
      this.grounded = false;
    }

    if (this.grounded && startingSurface?.onTrack) {
      const jumped = terrain.track.jumps.find((jump) => {
        const launchS = jump.takeoffS - 3;
        return startingSurface.s <= launchS && nextSurface?.s >= launchS && this.speed >= 5;
      });
      if (jumped) {
        const landing = terrain.track.sampleAt(jumped.landingS);
        const flightDistance = Math.max(8, jumped.landingS - startingSurface.s);
        const flightTime = Math.min(1.75, Math.max(0.55, flightDistance / Math.max(this.speed, 5)));
        const landingDeltaY = landing.y - (nextSurface?.height ?? this.y);
        this.vy = Math.min(10, Math.max(4.2, (landingDeltaY + 0.5 * GRAVITY * flightTime ** 2) / flightTime));
        this.grounded = false;
      }
      const ballisticY = this.y + this.vy * dt - 0.5 * GRAVITY * dt * dt;
      if (this.grounded && nextSurface) {
        if (!nextSurface.onTrack) {
          this.grounded = false;
          this.vy = Math.min(this.vy, 0);
        } else if (nextSurface.height < ballisticY - GROUND_SNAP) {
          // Cresta o borde: el suelo se cae de golpe y la bici despega.
          this.grounded = false;
        } else {
          // Pegada al suelo: copia la pendiente sin despegar ni rebotar.
          this.y = nextSurface.height;
          const ahead = terrain.sample(nextX + this.velX * 0.08, nextZ + this.velZ * 0.08);
          const forwardDistance = Math.max(0.1, Math.hypot(this.velX, this.velZ) * 0.08);
          const targetPitch = Math.atan2(ahead.height - nextSurface.height, forwardDistance);
          this.pitch += (targetPitch - this.pitch) * (1 - Math.exp(-dt * 12));
          this.vy = clamp(this.speed * Math.tan(this.pitch), -60, 60);
        }
      }
    }

    if (!this.grounded) {
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      this.x = nextX;
      this.z = nextZ;
      if (nextSurface?.onTrack && this.y <= nextSurface.height && this.vy <= 0) {
        this.impact = Math.max(0, -this.vy);
        this.y = nextSurface.height;
        if (this.impact > 7) {
          const loss = Math.min(this.speed * 0.65, (this.impact - 7) * 1.1);
          const ratio = this.speed > 0 ? Math.max(0, (this.speed - loss) / this.speed) : 0;
          this.velX *= ratio;
          this.velZ *= ratio;
          this.speed *= ratio;
        }
        this.vy = 0;
        this.grounded = true;
        this.airRate.roll = 0;
        this.airRate.pitch = 0;
        this.airRate.yaw = 0;
        // Al tocar suelo se toma el ángulo equivalente más cercano: una vuelta
        // completa queda a cero en vez de desenrollarse a cámara lenta.
        this.airRoll -= Math.round(this.airRoll / TAU) * TAU;
        this.airPitch -= Math.round(this.airPitch / TAU) * TAU;
        this.airYaw -= Math.round(this.airYaw / TAU) * TAU;
        this.pitch = nextSurface.pitch;
      }
    } else {
      this.x = nextX;
      this.z = nextZ;
      if (!nextSurface?.onTrack) {
        this.grounded = false;
        this.vy = Math.min(this.vy, 0);
      }
    }

    if (!this.grounded) {
      this.velX *= Math.max(0, 1 - AIR_DRAG * dt);
      this.velZ *= Math.max(0, 1 - AIR_DRAG * dt);
      this.speed = Math.hypot(this.velX, this.velZ);
      this.pitch = Math.atan2(this.vy, Math.max(this.speed, 0.1));
    }
    this.yaw = wrapAngle(this.yaw);
    this.roll = 0;
    this.impact = Math.max(this.impact, Math.abs(oldY - this.y) > 2 ? 9.81 : 0);
    this.driftAngle = wrapAngle(Math.atan2(-this.velX, -this.velZ) - this.yaw);
  }

  eyePosition(alpha) {
    return {
      x: lerp(this.prev.x, this.x, alpha),
      y: lerp(this.prev.y, this.y, alpha) + EYE_HEIGHT,
      z: lerp(this.prev.z, this.z, alpha),
    };
  }

  renderYaw(alpha) {
    return this.prev.yaw + wrapAngle(this.yaw - this.prev.yaw) * alpha;
  }

  renderPitch(alpha) {
    return lerp(this.prev.pitch, this.pitch, alpha);
  }
}

/** Régimen angular de un eje en el aire: acelera, frena al soltar y tiene tope. */
function spinAxis(rate, axis, dt) {
  if (!axis) {
    const damped = rate * Math.exp(-AIR_SPIN_DAMP * dt);
    return Math.abs(damped) < 0.02 ? 0 : damped;
  }
  const target = clamp(axis, -1, 1) * AIR_SPIN_MAX;
  const step = AIR_SPIN_ACCEL * dt;
  return clamp(rate + clamp(target - rate, -step, step), -AIR_SPIN_MAX, AIR_SPIN_MAX);
}

function settle(angle) {
  return Math.abs(angle) < 0.01 ? 0 : angle;
}

function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

export { EYE_HEIGHT, GRAVITY, wrapAngle };
