// Teclado y ratón. El ratón solo aporta rumbo (yaw); nunca pitch ni roll.

const CAPTURE_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'KeyQ',
  'KeyE',
]);

export const JUMP_KEYS = ['Space', 'KeyQ', 'KeyE'];

export class Input {
  constructor(canvas, { onKey } = {}) {
    this.canvas = canvas;
    this.keys = new Set();
    this.yawDelta = 0;
    this.mouseSensitivity = 0.0022;
    this.locked = false;
    this.jumpPressed = false;
    this.onKey = onKey ?? (() => {});
    this.onLockChange = null;

    this._onKeyDown = (e) => {
      if (e.repeat) {
        if (CAPTURE_KEYS.has(e.code)) e.preventDefault();
        return;
      }
      this.keys.add(e.code);
      this._touchKeys.delete(e.code);
      if (JUMP_KEYS.includes(e.code)) this.jumpPressed = true;
      if (CAPTURE_KEYS.has(e.code)) e.preventDefault();
      this.onKey(e.code);
    };
    this._onKeyUp = (e) => {
      this.keys.delete(e.code);
      this._touchKeys.delete(e.code);
      if (CAPTURE_KEYS.has(e.code)) e.preventDefault();
    };
    this._touchKeys = new Set();
    this._onBlur = () => {
      this.keys.clear();
      this._touchKeys.clear();
    };
    this._onMouseMove = (e) => {
      if (!this.locked) return;
      this.yawDelta -= e.movementX * this.mouseSensitivity;
    };
    this._onClick = () => {
      if (this.locked || !this.canvas.requestPointerLock) return;
      // Puede fallar (iframe, pestaña sin foco, contextos no seguros). No es
      // fatal: el teclado sigue funcionando.
      try {
        const result = this.canvas.requestPointerLock();
        if (result && typeof result.catch === 'function') result.catch(() => {});
      } catch {
        /* sin captura de ratón */
      }
    };
    this._onPointerLockChange = () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.keys.clear();
        this._touchKeys.clear();
      }
      this.onLockChange?.(this.locked);
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('pointerlockchange', this._onPointerLockChange);
    canvas.addEventListener('click', this._onClick);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  bindTouchControls(container) {
    for (const button of container?.querySelectorAll('[data-key]') ?? []) {
      const key = button.dataset.key;
      if (!key) continue;
      const release = (event) => {
        event.preventDefault();
        this._touchKeys.delete(key);
        if (button.hasPointerCapture?.(event.pointerId)) button.releasePointerCapture(event.pointerId);
      };
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        this._touchKeys.add(key);
        if (JUMP_KEYS.includes(key)) this.jumpPressed = true;
        button.setPointerCapture?.(event.pointerId);
      });
      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
      button.addEventListener('lostpointercapture', (event) => this._touchKeys.delete(key));
      button.addEventListener('contextmenu', (event) => event.preventDefault());
    }
  }

  down(code) {
    return this.keys.has(code) || this._touchKeys.has(code);
  }

  /** -1 izquierda ... +1 derecha (A/D y flechas): solo rotan la bici en el aire. */
  steer() {
    let s = 0;
    if (this.down('KeyA') || this.down('ArrowLeft')) s -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) s += 1;
    return s;
  }

  /** -1 freno ... +1 pedal (W/S y flechas verticales). */
  throttle() {
    let t = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) t += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) t -= 1;
    return t;
  }

  /** ¿Se pidió un salto desde la última llamada? (Espacio, Q o E). */
  consumeJump() {
    const pressed = this.jumpPressed;
    this.jumpPressed = false;
    return pressed;
  }

  /** Rumbo acumulado por el ratón desde la última llamada. */
  consumeYawDelta() {
    const d = this.yawDelta;
    this.yawDelta = 0;
    return d;
  }
}
