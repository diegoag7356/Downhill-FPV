import { recordKey, saveRecord } from './records.js';

export const RACE_STATES = Object.freeze({ MENU: 'menu', READY: 'ready', RACING: 'racing', PAUSED: 'paused', FINISHED: 'finished' });
export const RESPAWN_PENALTY_MS = 3000;

export class RaceSession {
  constructor(track, player, { storage, now = () => performance.now() } = {}) {
    this.track = track;
    this.player = player;
    this.storage = storage;
    this.now = now;
    this.state = RACE_STATES.MENU;
    this.startedAt = 0;
    this.penaltyMs = 0;
    this.elapsedMs = 0;
    this.bestMs = null;
    this.checkpointIndex = 0;
    this.checkpoints = [0.25, 0.5, 0.75].map((fraction) => ({ s: track.length * fraction, fraction }));
    this.safe = { x: 0, y: 0, z: 0, yaw: 0, s: 0 };
    this.finishedAt = 0;
  }

  start() {
    const sample = this.track.sampleAt(0);
    this.player.x = sample.x;
    this.player.y = sample.y;
    this.player.z = sample.z;
    this.player.yaw = sample.yaw;
    this.player.velX = 0;
    this.player.velZ = 0;
    this.player.vy = 0;
    this.player.speed = 0;
    this.player.grounded = true;
    this.safe = { ...sample };
    this.state = RACE_STATES.RACING;
    this.startedAt = this.now();
    this.elapsedMs = 0;
    this.penaltyMs = 0;
    this.checkpointIndex = 0;
    return true;
  }

  update(terrain) {
    if (this.state !== RACE_STATES.RACING) return;
    const surface = terrain.sample(this.player.x, this.player.z);
    if (surface.onTrack && surface.s >= this.safe.s - 12) {
      this.safe = { x: this.player.x, y: surface.height, z: this.player.z, yaw: this.player.yaw, s: surface.s };
    }
    while (this.checkpointIndex < this.checkpoints.length && surface.onTrack && surface.s >= this.checkpoints[this.checkpointIndex].s) {
      this.checkpointIndex++;
      this.safe = { x: this.player.x, y: surface.height, z: this.player.z, yaw: this.player.yaw, s: surface.s };
    }
    // Solo se reaparece si la bici se sale del corredor o se cae por el talud.
    if (!surface.inside && this.player.y < surface.height - 6) this.respawn();
    else if (this.player.y < surface.centerHeight - 45) this.respawn();
    if (surface.onTrack && surface.s >= this.track.length - 5) this.finish();
    this.elapsedMs = this.now() - this.startedAt + this.penaltyMs;
  }

  respawn() {
    this.player.x = this.safe.x;
    this.player.y = this.safe.y;
    this.player.z = this.safe.z;
    this.player.yaw = this.safe.yaw;
    this.player.velX = 0;
    this.player.velZ = 0;
    this.player.vy = 0;
    this.player.speed = 0;
    this.player.grounded = true;
    this.player.roll = 0;
    this.penaltyMs += RESPAWN_PENALTY_MS;
    return RESPAWN_PENALTY_MS;
  }

  finish() {
    if (this.state !== RACE_STATES.RACING) return false;
    this.state = RACE_STATES.FINISHED;
    this.finishedAt = this.now();
    this.elapsedMs = this.finishedAt - this.startedAt + this.penaltyMs;
    this.bestMs = saveRecord(this.storage, recordKey(this.track.id), this.elapsedMs) ? this.elapsedMs : null;
    return true;
  }

  pause() {
    if (this.state === RACE_STATES.RACING) {
      this.elapsedMs = this.now() - this.startedAt + this.penaltyMs;
      this.state = RACE_STATES.PAUSED;
    } else if (this.state === RACE_STATES.PAUSED) {
      this.state = RACE_STATES.RACING;
      this.startedAt = this.now() - this.elapsedMs + this.penaltyMs;
    }
    return this.state;
  }

  reset() {
    this.state = RACE_STATES.READY;
    this.penaltyMs = 0;
    this.elapsedMs = 0;
    this.checkpointIndex = 0;
    return this.start();
  }

  get progress() {
    return Math.max(0, Math.min(1, this.safe.s / this.track.length));
  }
}
