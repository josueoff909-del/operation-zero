import { Joystick } from '../ui/Joystick.js';
import { TouchLook } from '../ui/TouchLook.js';
import { Config } from './Config.js';

/**
 * InputManager.js — Unifica teclado + mouse + touch (Skill §3).
 * - Desktop: WASD/setas, Shift correr, Espaço pular, C agachar,
 *   mouse com Pointer Lock (botão esq. atira, dir. mira/ADS).
 * - Android (paisagem): joystick flutuante (esquerda) + Touch Look
 *   (direita) + botões ATIRAR/MIRAR/PULAR/CORRER/AGACHAR.
 * Multitouch simultâneo: andar + girar + atirar/mirar/pular ao mesmo tempo.
 * Sensibilidade ajustável via Settings (multiplicadores 0.5×–2.0×).
 * Expõe: getMoveInput(), consumeLookDelta() (radianos), isJumpPressed(),
 * isSprintHeld(), isFiring(), isAiming(), isCrouching().
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
    this.firing = false; // botão ATIRAR / botão esquerdo do mouse
    this.aiming = false; // botão MIRAR / botão direito do mouse (ADS)
    this.crouchToggle = false; // botão AGACHAR / tecla C (alterna)
    this.sensMouse = 1; // multiplicador (Settings)
    this.sensTouch = 1; // multiplicador (Settings)

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

  /** Multiplicadores de sensibilidade vindos do painel de Settings. */
  setSensitivity(mouseMult, touchMult) {
    this.sensMouse = mouseMult;
    this.sensTouch = touchMult;
  }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) this.jumpQueued = true;
      }
      if (e.code === 'KeyC' && !e.repeat) {
        this.crouchToggle = !this.crouchToggle;
        const btn = document.getElementById('btn-crouch');
        if (btn) btn.classList.toggle('active', this.crouchToggle);
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
      // A dica de mouse só existe no desktop (nunca no mobile).
      const fine = window.matchMedia('(pointer: fine)').matches;
      const hint = document.getElementById('lock-hint');
      if (hint) hint.classList.toggle('hidden', !fine || this.pointerLocked);
      if (!this.pointerLocked) {
        this.firing = false;
        this.aiming = false;
      }
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.mouseDelta.x += e.movementX || 0;
      this.mouseDelta.y += e.movementY || 0;
    });
    // Botões do mouse com Pointer Lock: esq. atira, dir. mira (ADS).
    window.addEventListener('mousedown', (e) => {
      if (!this.pointerLocked) return;
      if (e.button === 0) this.firing = true;
      if (e.button === 2) this.aiming = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
      if (e.button === 2) this.aiming = false;
    });
    document.addEventListener('contextmenu', (e) => {
      if (this.pointerLocked) e.preventDefault();
    });
  }

  _bindButtons() {
    // PULAR (borda) — Fase 1, mantido.
    const jumpBtn = document.getElementById('btn-jump');
    if (jumpBtn) {
      jumpBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.jumpQueued = true;
      }, { passive: false });
      jumpBtn.addEventListener('mousedown', () => { this.jumpQueued = true; });
    }
    // CORRER (alterna) — Fase 1, mantido.
    const sprintBtn = document.getElementById('btn-sprint');
    if (sprintBtn) {
      const toggle = (e) => {
        e.preventDefault();
        this.sprintToggle = !this.sprintToggle;
        sprintBtn.classList.toggle('active', this.sprintToggle);
      };
      sprintBtn.addEventListener('touchstart', toggle, { passive: false });
      sprintBtn.addEventListener('mousedown', toggle);
    }
    // ATIRAR / MIRAR (segurar) e AGACHAR (alterna) — Fase 2.
    this._bindHoldButton(document.getElementById('btn-fire'), (v) => { this.firing = v; });
    this._bindHoldButton(document.getElementById('btn-aim'), (v) => { this.aiming = v; });
    const crouchBtn = document.getElementById('btn-crouch');
    if (crouchBtn) {
      const toggle = (e) => {
        e.preventDefault();
        this.crouchToggle = !this.crouchToggle;
        crouchBtn.classList.toggle('active', this.crouchToggle);
      };
      crouchBtn.addEventListener('touchstart', toggle, { passive: false });
      crouchBtn.addEventListener('mousedown', toggle);
    }
  }

  /** Botão de segurar: touch + mouse, com classe .active enquanto pressionado. */
  _bindHoldButton(el, set) {
    if (!el) return;
    const on = (e) => {
      e.preventDefault();
      set(true);
      el.classList.add('active');
    };
    const off = (e) => {
      e.preventDefault();
      set(false);
      el.classList.remove('active');
    };
    el.addEventListener('touchstart', on, { passive: false });
    el.addEventListener('touchend', off, { passive: false });
    el.addEventListener('touchcancel', off, { passive: false });
    el.addEventListener('mousedown', on);
    el.addEventListener('mouseup', off);
    el.addEventListener('mouseleave', off);
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

  /**
   * Deltas de olhar em RADIANOS (já com sensibilidade aplicada).
   * Mouse e toque têm sensibilidades próprias (Config × Settings).
   * O Player aplica a redução de ADS por cima.
   */
  consumeLookDelta() {
    const touch = this.touchLook ? this.touchLook.consumeDelta() : { x: 0, y: 0 };
    const d = {
      x: this.mouseDelta.x * Config.MOUSE_SENSITIVITY * this.sensMouse
        + touch.x * Config.TOUCH_SENSITIVITY * this.sensTouch,
      y: this.mouseDelta.y * Config.MOUSE_SENSITIVITY * this.sensMouse
        + touch.y * Config.TOUCH_SENSITIVITY * this.sensTouch,
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

  /** true enquanto o botão ATIRAR / botão esquerdo estiver pressionado. */
  isFiring() {
    return this.firing;
  }

  /** true enquanto o botão MIRAR / botão direito estiver pressionado (ADS). */
  isAiming() {
    return this.aiming;
  }

  /** true enquanto agachado (botão AGACHAR / tecla C alternam). */
  isCrouching() {
    return this.crouchToggle;
  }
}
