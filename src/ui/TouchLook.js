/**
 * TouchLook.js — Rotação de câmera por toque na zona direita (Skill §3).
 * Acumula deltas de arrasto (dx, dy) que o Player consome por frame.
 * Multitouch: cada dedo da zona direita contribui independentemente.
 */
export class TouchLook {
  constructor(zoneEl) {
    this.zone = zoneEl;
    this.lastPositions = new Map(); // touchId -> {x, y}
    this.deltaX = 0;
    this.deltaY = 0;

    this._onStart = this._onStart.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onEnd = this._onEnd.bind(this);

    zoneEl.addEventListener('touchstart', this._onStart, { passive: false });
    zoneEl.addEventListener('touchmove', this._onMove, { passive: false });
    zoneEl.addEventListener('touchend', this._onEnd, { passive: false });
    zoneEl.addEventListener('touchcancel', this._onEnd, { passive: false });
  }

  _onStart(e) {
    e.preventDefault();
    for (const touch of e.changedTouches) {
      this.lastPositions.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
    }
  }

  _onMove(e) {
    e.preventDefault();
    for (const touch of e.changedTouches) {
      const last = this.lastPositions.get(touch.identifier);
      if (!last) continue;
      this.deltaX += touch.clientX - last.x;
      this.deltaY += touch.clientY - last.y;
      this.lastPositions.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
    }
  }

  _onEnd(e) {
    e.preventDefault();
    for (const touch of e.changedTouches) {
      this.lastPositions.delete(touch.identifier);
    }
  }

  /** Retorna e zera os deltas acumulados desde o último frame. */
  consumeDelta() {
    const d = { x: this.deltaX, y: this.deltaY };
    this.deltaX = 0;
    this.deltaY = 0;
    return d;
  }

  dispose() {
    this.zone.removeEventListener('touchstart', this._onStart);
    this.zone.removeEventListener('touchmove', this._onMove);
    this.zone.removeEventListener('touchend', this._onEnd);
    this.zone.removeEventListener('touchcancel', this._onEnd);
  }
}
