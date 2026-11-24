/**
 * Settings.js — Configurações do jogador (Fase 2).
 * Painel com sensibilidade de mouse/toque ajustável (0.5×–2.0×),
 * persistida em localStorage. O InputManager lê os multiplicadores
 * via setSensitivity(). (SaveSystem completo é da Fase 11.)
 */
const STORAGE_KEY = 'oz_settings_v1';

export class Settings {
  /** @param {(mouseMult:number, touchMult:number) => void} onChange */
  constructor(onChange) {
    this.onChange = onChange;
    this.mouseMult = 1;
    this.touchMult = 1;
    this._load();
    this._bindPanel();
    this._emit();
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (typeof data.mouse === 'number') this.mouseMult = data.mouse;
      if (typeof data.touch === 'number') this.touchMult = data.touch;
    } catch {
      // localStorage indisponível (modo privado, etc.) — usa padrão.
    }
  }

  _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ mouse: this.mouseMult, touch: this.touchMult }));
    } catch {
      // Ignora: sensibilidade vale só na sessão.
    }
  }

  _emit() {
    if (this.onChange) this.onChange(this.mouseMult, this.touchMult);
  }

  _bindPanel() {
    const gearBtn = document.getElementById('btn-settings');
    const panel = document.getElementById('settings-panel');
    const mouseInput = document.getElementById('sens-mouse');
    const touchInput = document.getElementById('sens-touch');
    const mouseVal = document.getElementById('sens-mouse-val');
    const touchVal = document.getElementById('sens-touch-val');
    const resetBtn = document.getElementById('sens-reset');
    if (!gearBtn || !panel) return;

    const syncInputs = () => {
      if (mouseInput) mouseInput.value = String(this.mouseMult);
      if (touchInput) touchInput.value = String(this.touchMult);
      if (mouseVal) mouseVal.textContent = `${this.mouseMult.toFixed(1)}×`;
      if (touchVal) touchVal.textContent = `${this.touchMult.toFixed(1)}×`;
    };
    syncInputs();

    gearBtn.addEventListener('click', (e) => {
      e.preventDefault();
      panel.classList.toggle('open');
    });
    if (mouseInput) {
      mouseInput.addEventListener('input', () => {
        this.mouseMult = parseFloat(mouseInput.value) || 1;
        this._save();
        syncInputs();
        this._emit();
      });
    }
    if (touchInput) {
      touchInput.addEventListener('input', () => {
        this.touchMult = parseFloat(touchInput.value) || 1;
        this._save();
        syncInputs();
        this._emit();
      });
    }
    if (resetBtn) {
      resetBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.mouseMult = 1;
        this.touchMult = 1;
        this._save();
        syncInputs();
        this._emit();
      });
    }
  }

  getMouseMult() {
    return this.mouseMult;
  }

  getTouchMult() {
    return this.touchMult;
  }
}
