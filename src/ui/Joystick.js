/**
 * Joystick.js — Joystick virtual flutuante (Skill §3).
 * A base nasce onde o dedo toca na zona esquerda e segue o dedo
 * até o raio máximo; soltar zera o vetor. Multitouch: rastreia
 * o primeiro toque da zona esquerda pelo identifier.
 */
export class Joystick {
  constructor(zoneEl, baseEl, nubEl) {
    this.zone = zoneEl;
    this.base = baseEl;
    this.nub = nubEl;
    this.activeTouchId = null;
    this.originX = 0;
    this.originY = 0;
    this.vector = { x: 0, y: 0 }; // x: direita+, y: frente+ (invertido do dy)
    this.radius = 55; // px de deslocamento máximo

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
    if (this.activeTouchId !== null) return; // já há um dedo no joystick
    const touch = e.changedTouches[0];
    this.activeTouchId = touch.identifier;
    this.originX = touch.clientX;
    this.originY = touch.clientY;
    this.base.style.display = 'block';
    this.base.style.left = `${touch.clientX}px`;
    this.base.style.top = `${touch.clientY}px`;
    this._updateNub(0, 0);
  }

  _onMove(e) {
    e.preventDefault();
    for (const touch of e.changedTouches) {
      if (touch.identifier !== this.activeTouchId) continue;
      let dx = touch.clientX - this.originX;
      let dy = touch.clientY - this.originY;
      const dist = Math.hypot(dx, dy);
      if (dist > this.radius) {
        dx = (dx / dist) * this.radius;
        dy = (dy / dist) * this.radius;
      }
      this._updateNub(dx, dy);
      // Normaliza p/ -1..1; frente = -dy (arrastar p/ cima = andar p/ frente)
      this.vector.x = dx / this.radius;
      this.vector.y = -dy / this.radius;
    }
  }

  _onEnd(e) {
    e.preventDefault();
    for (const touch of e.changedTouches) {
      if (touch.identifier !== this.activeTouchId) continue;
      this.activeTouchId = null;
      this.vector.x = 0;
      this.vector.y = 0;
      this.base.style.display = 'none';
    }
  }

  _updateNub(dx, dy) {
    this.nub.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  /** Zera o joystick (usado quando o input é desligado, ex.: Lobby). */
  reset() {
    this.activeTouchId = null;
    this.vector.x = 0;
    this.vector.y = 0;
    if (this.base) this.base.style.display = 'none';
  }

  /** Vetor atual (-1..1). Chamado pelo InputManager a cada frame. */
  getVector() {
    return this.vector;
  }

  dispose() {
    this.zone.removeEventListener('touchstart', this._onStart);
    this.zone.removeEventListener('touchmove', this._onMove);
    this.zone.removeEventListener('touchend', this._onEnd);
    this.zone.removeEventListener('touchcancel', this._onEnd);
  }
}
