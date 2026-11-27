// Overlay de depuración (Fase 0). Sin estilo de diseño: solo texto monoespaciado.

export class Debug {
  constructor(element) {
    this.el = element;
    this.visible = false;
    if (this.el) this.el.style.display = 'none';
    this.fps = 0;
    this.worstMs = 0;
    this._frames = 0;
    this._elapsed = 0;
    this._worst = 0;
    this._seed = '';
    this._wireframe = false;
    this._lastText = '';
  }

  setSeed(seed) {
    this._seed = seed;
  }

  setWireframe(on) {
    this._wireframe = on;
  }

  toggle() {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
  }

  /** Llamar una vez por frame. */
  update(dt, renderer, player) {
    this._frames++;
    this._elapsed += dt;
    this._worst = Math.max(this._worst, dt * 1000);
    if (this._elapsed >= 0.5) {
      this.fps = this._frames / this._elapsed;
      this.worstMs = this._worst;
      this._frames = 0;
      this._elapsed = 0;
      this._worst = 0;
    }
    if (!this.visible) return;

    const info = renderer.info.render;
    const yawDeg = ((player.yaw * 180) / Math.PI + 360) % 360;
    const text = [
      `fps        ${this.fps.toFixed(0).padStart(3)}  (peor frame ${this.worstMs.toFixed(1)} ms)`,
      `draw calls ${info.calls}`,
      `triángulos ${info.triangles}${info.lines ? ` (+${info.lines} líneas)` : ''}`,
      `velocidad  ${player.speed.toFixed(1)} m/s`,
      `yaw        ${yawDeg.toFixed(1)}°`,
      `semilla    ${this._seed}`,
      `wireframe  ${this._wireframe ? 'on' : 'off'}`,
    ].join('\n');

    if (text !== this._lastText) {
      this.el.textContent = text;
      this._lastText = text;
    }
  }
}
