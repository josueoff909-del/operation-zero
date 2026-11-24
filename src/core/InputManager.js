import { Joystick } from '../ui/Joystick.js';
import { TouchLook } from '../ui/TouchLook.js';
import { Config } from './Config.js';

/**
 * InputManager.js — Unifica teclado + mouse + touch (Skill §3).
 * - Desktop: WASD/setas, Shift correr, Espaço pular, mouse com Pointer Lock.
 * - Android: joystick flutuante (esquerda) + Touch Look (direita) + botões.
 * Multitouch simultâneo: andar + girar + pular/correr ao mesmo tempo.
 * Expõe: getMoveInput(), consumeLookDelta(), isJumpPressed(), isSprintHeld().
 */
export class InputManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseDelta = { x: 0, y: 0 };
    this.pointerLocked = false;
    this.jumpQueued = false; // pulo por "borda" (pressionou neste frame)
    this.sprintToggle = false; // botão CORRER alterna (mobile)
    this.sprintHeld = false; // Shift (desktop)

    this.joystick = null;
    this.touchLook = null;
    this._bindKeyboard();
    this._bindMouse();
    this._bindButtons();
  }

  /** Liga joystick + touch look aos elementos do DOM (chamado pelo Engine). */
  attachTouch(joystickZone, joystickBase, joystickNub, lookZone) {
    this.joystick = new Joystick(joystickZone, joystickBase, joystickNub);
    this.touchLook = new TouchLook(lookZone);
  }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) this.jumpQueued = true;
      }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.sprintHeld = true;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.sprintHeld = false;
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => this.keys.clear());
  }

  _bindMouse() {
    // Escuta na janela (não no canvas): as zonas de toque cobrem a tela
    // e interceptariam o clique no desktop. Pointer Lock só com mouse.
    window.addEventListener('click', () => {
      if (window.matchMedia('(pointer: fine)').matches && !this.pointerLocked) {
        this.canvas.requestPointerLock();
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      const hint = document.getElementById('lock-hint');
      if (hint) hint.classList.toggle('hidden', this.pointerLocked);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.mouseDelta.x += e.movementX || 0;
      this.mouseDelta.y += e.movementY || 0;
    });
  }

  _bindButtons() {
    const jumpBtn = document.getElementById('btn-jump');
    const sprintBtn = document.getElementById('btn-sprint');
    if (jumpBtn) {
      jumpBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.jumpQueued = true;
      }, { passive: false });
      jumpBtn.addEventListener('mousedown', () => { this.jumpQueued = true; });
    }
    if (sprintBtn) {
      const toggle = (e) => {
        e.preventDefault();
        this.sprintToggle = !this.sprintToggle;
        sprintBtn.classList.toggle('active', this.sprintToggle);
      };
      sprintBtn.addEventListener('touchstart', toggle, { passive: false });
      sprintBtn.addEventListener('mousedown', toggle);
    }
  }

  /**
   * Vetor de movimento normalizado (-1..1): x = direita, y = frente.
   * Combina teclado (WASD) e joystick; joystick tem prioridade se ativo.
   */
  getMoveInput() {
    let x = 0;
    let y = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;

    if (this.joystick) {
      const v = this.joystick.getVector();
      if (Math.abs(v.x) > 0.01 || Math.abs(v.y) > 0.01) {
        x = v.x;
        y = v.y;
      }
    }
    // Normaliza diagonal (teclado) p/ não andar mais rápido na diagonal.
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  }

  /** Deltas de olhar acumulados (mouse + touch), zerados após leitura. */
  consumeLookDelta() {
    const touch = this.touchLook ? this.touchLook.consumeDelta() : { x: 0, y: 0 };
    const d = {
      x: this.mouseDelta.x + touch.x,
      y: this.mouseDelta.y + touch.y,
    };
    this.mouseDelta.x = 0;
    this.mouseDelta.y = 0;
    return d;
  }

  /** true uma única vez por pressionamento (borda). */
  isJumpPressed() {
    const pressed = this.jumpQueued;
    this.jumpQueued = false;
    return pressed;
  }

  isSprintHeld() {
    return this.sprintHeld || this.sprintToggle;
  }

  /** Sensibilidade conforme a fonte do delta (mouse vs. touch). */
  getSensitivity() {
    return Config.MOUSE_SENSITIVITY;
  }
}
