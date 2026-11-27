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
const STEER_BUILD_RATE = 7.5;
const STEER_RETURN_RATE = 4.2;
const BASE_TURN_RATE = 2.2;
const CONTROL_LOSS_ANGLE = Math.PI / 4;

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
    this.steerAngle = 0;
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
    const controlScale = this.lossOfControl > 0 ? 0.28 : 1;
    // El manillar no obedece al instante: se carga al girar y vuelve solo al
    // centro al soltar. A más velocidad, más resistencia a cambiar de rumbo.
    const steerInput = input.steer();
    const steerRate = steerInput === 0 ? STEER_RETURN_RATE : STEER_BUILD_RATE;
    const steerStep = steerRate * dt;
    this.steerAngle += Math.max(-steerStep, Math.min(steerStep, steerInput - this.steerAngle));
    const turnRate = BASE_TURN_RATE * Math.max(0.45, 1 - 0.5 * speedRatio);
    this.yaw = wrapAngle(this.yaw - this.steerAngle * turnRate * controlScale * dt + input.consumeYawDelta());

    let vx = this.velX;
    let vz = this.velZ;
    const throttle = input.throttle();
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
        this.vy = Math.min(9, Math.max(2.2, (landingDeltaY + 0.5 * GRAVITY * flightTime ** 2) / flightTime));
        this.grounded = false;
      }
      const ballisticY = this.y + this.vy * dt - 0.5 * GRAVITY * dt * dt;
      if (this.grounded && nextSurface && (nextSurface.height < ballisticY - 0.015 || !nextSurface.onTrack)) {
        this.grounded = false;
      } else if (this.grounded && nextSurface?.onTrack) {
        this.y = nextSurface.height;
        const ahead = terrain.sample(nextX + this.velX * 0.08, nextZ + this.velZ * 0.08);
        const forwardDistance = Math.max(0.1, Math.hypot(this.velX, this.velZ) * 0.08);
        this.pitch = Math.atan((ahead.height - nextSurface.height) / forwardDistance);
        this.vy = this.pitch > 0 ? this.speed * Math.tan(this.pitch) : 0;
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

function lerp(a, b, t) {
  return a + (b - a) * t;
}

export { EYE_HEIGHT, GRAVITY, wrapAngle };
