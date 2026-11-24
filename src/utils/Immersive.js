import { Config } from '../core/Config.js';

/**
 * Immersive.js — Tela cheia + orientação paisagem ao entrar na partida.
 *
 * Só pode ser chamado DENTRO de um gesto do usuário (o navegador exige
 * user activation), por isso é disparado no toque em JOGAR / no primeiro
 * toque na tela. Tudo aqui é **best effort com fallback seguro**:
 *
 *  • `requestFullscreen()` → cai em `webkitEnterFullscreen` (iOS/Safari
 *    antigo) → se nada der, seguimos em tela "cheia de CSS" (o canvas já
 *    ocupa `inset: 0`), sem nunca lançar exceção p/ fora.
 *  • `screen.orientation.lock('landscape')` → existe só em alguns
 *    navegadores/modos (Android Chrome em tela cheia: sim; iOS: não).
 *    Promessa rejeitada é engolida e mostramos a dica "vire o celular".
 *
 * Expõe também `onResize` para o Engine re-ajustar câmera/renderer quando a
 * barra do navegador some (o viewport muda sem `resize` em alguns casos).
 */
export class Immersive {
  constructor(root = document.documentElement) {
    this.root = root;
    this.listeners = new Set();
    this._fullscreenError = null;
    this._onChange = this._onChange.bind(this);
    document.addEventListener('fullscreenchange', this._onChange);
    document.addEventListener('webkitfullscreenchange', this._onChange);
    window.addEventListener('resize', this._onChange);
    window.addEventListener('orientationchange', this._onChange);
  }

  get isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement
      || document.webkitIsFullScreen);
  }

  get isLandscape() {
    const angle = (screen.orientation && typeof screen.orientation.angle === 'number')
      ? screen.orientation.angle
      : (window.innerWidth >= window.innerHeight ? 90 : 0);
    return angle === 90 || angle === 270;
  }

  /** true quando o navegador de fato travou a orientação (raro fora do Android). */
  get orientationLocked() {
    return this._locked === true;
  }

  /**
   * Tenta tela cheia + paisagem. Chamado no toque em JOGAR.
   * @returns {{fullscreen:boolean, orientation:string|null, error:string|null}}
   */
  async enter() {
    const result = { fullscreen: false, orientation: null, error: null };

    if (!this.isFullscreen) {
      const el = this.root;
      try {
        if (el.requestFullscreen) {
          await el.requestFullscreen({ navigationUI: 'hide' });
        } else if (el.webkitRequestFullscreen) {
          el.webkitRequestFullscreen();
        } else if (typeof el.webkitEnterFullscreen === 'function') {
          el.webkitEnterFullscreen();
        } else {
          result.error = 'fullscreen-indisponivel';
        }
        result.fullscreen = this.isFullscreen;
      } catch (err) {
        // navegador bloqueou (sem user activation, iframe sem allow, etc.)
        result.error = 'fullscreen-bloqueado';
        this._fullscreenError = err;
      }
    } else {
      result.fullscreen = true;
    }

    // trava de orientação: melhor esforço (funciona no Android em fullscreen)
    const orientation = screen.orientation;
    if (orientation && typeof orientation.lock === 'function') {
      try {
        await orientation.lock(Config.ORIENTATION_LOCK || 'landscape');
        this._locked = true;
        result.orientation = 'landscape';
      } catch {
        this._locked = false; // segue com a dica "vire o celular"
        result.orientation = null;
      }
    }

    this._applyClass();
    this._onChange();
    return result;
  }

  exit() {
    try {
      if (document.exitFullscreen && this.isFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
      if (this._locked && screen.orientation && typeof screen.orientation.unlock === 'function') {
        screen.orientation.unlock();
        this._locked = false;
      }
    } catch {
      /* ignora: sair de tela cheia nunca deve quebrar o jogo */
    }
    this._applyClass();
  }

  _applyClass() {
    document.documentElement.classList.toggle('is-fullscreen', this.isFullscreen);
  }

  _onChange() {
    this._applyClass();
    for (const fn of this.listeners) fn({ fullscreen: this.isFullscreen, landscape: this.isLandscape });
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  dispose() {
    document.removeEventListener('fullscreenchange', this._onChange);
    document.removeEventListener('webkitfullscreenchange', this._onChange);
    window.removeEventListener('resize', this._onChange);
    window.removeEventListener('orientationchange', this._onChange);
    this.listeners.clear();
  }
}
