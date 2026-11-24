import { Config } from '../core/Config.js';
import { Minimap } from './Minimap.js';

/**
 * Lobby.js — Tela de entrada antes da partida (regra do pedido: o jogo NÃO
 * começa solto no mapa).
 *
 * É DOM sobre a cena 3D (o Engine mantém a cena renderizando com uma câmera
 * orbitando a cidade por trás), porque overlay de HUD em DOM é o caminho do
 * `threejs-android` skill — nada de widget 3D clicável dentro do WebGL.
 *
 * Responsabilidades:
 *  • título OPERATION ZERO + botão grande JOGAR (alvo de toque generoso);
 *  • seletor de QUALIDADE (AUTO/ALTA/MÉDIA/BAIXA) → Renderer + PerformanceMonitor;
 *  • seletor de MODO (SOLO/DUO) e de BOTS (treino/12/24/44);
 *  • no toque em JOGAR: `Immersive.enter()` (tela cheia + paisagem) ANTES de
 *    iniciar, já que fullscreen só pode ser pedido dentro de user gesture;
 *  • persistir a escolha em localStorage (`oz_lobby_v1`).
 *
 * O Lobby nunca escreve regra de jogo: ele só chama `gameState.setSettings`
 * e `gameState.startMatch()` (ui/ lê estado, comandos vêm do GameState).
 */
const STORAGE_KEY = 'oz_lobby_v1';

export class Lobby {
  /**
   * @param {{gameState:object, renderer:object, performance:object, immersive:object, onExit?:Function}} deps
   */
  constructor(deps) {
    this.gameState = deps.gameState;
    this.renderer = deps.renderer;
    this.performance = deps.performance;
    this.immersive = deps.immersive;
    this.onExit = deps.onExit || (() => {});
    this.onQuality = deps.onQuality || null; // Engine: fixa/auto no PerformanceMonitor

    this.root = document.getElementById('lobby');
    this.playBtn = document.getElementById('lobby-play');
    this.qualityBtns = [...document.querySelectorAll('#lobby-quality button')];
    this.modeBtns = [...document.querySelectorAll('#lobby-mode button')];
    this.botsBtns = [...document.querySelectorAll('#lobby-bots button')];
    this.diffBtns = [...document.querySelectorAll('#lobby-diff button')];
    this.statusEl = document.getElementById('lobby-status');
    this.infoEl = document.getElementById('lobby-info');
    this.mapCanvas = document.getElementById('lobby-map-canvas');
    this.mapEl = document.getElementById('lobby-map');
    this.mapMeta = document.querySelector('#lobby-map .map-meta');

    this.selection = { quality: 'auto', mode: 'solo', bots: Config.LOBBY_BOT_PRESETS[2], difficulty: 'normal' };
    this._load();
    this._bind();
    this._sync();
    this.applyQuality();
    this._paintMapPreview();
  }

  /**
   * Preview estático da arena no canto do Lobby — a resposta direta a
   * "só tem uma cidade cercada de árvore": o jogador VÊ os 5 POIs, as
   * estradas e o lago ANTES do deploy. 1 paint, zero custo por frame.
   */
  _paintMapPreview() {
    const canvas = this.mapCanvas;
    if (!canvas || !canvas.getContext) return;
    const size = 132;
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    try {
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      Minimap.drawBaseMap(ctx, size, { frame: true });
    } catch {
      if (this.mapEl && this.mapEl.parentNode) this.mapEl.remove(); // sem canvas 2D: some o bloco
      this.mapCanvas = null;
    }
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      Object.assign(this.selection, JSON.parse(raw));
      // valida bots contra as presets atuais
      if (!Config.LOBBY_BOT_PRESETS.includes(this.selection.bots)) {
        this.selection.bots = Config.LOBBY_BOT_PRESETS[2];
      }
    } catch {
      /* localStorage indisponível: segue com o padrão */
    }
  }

  _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.selection));
    } catch {
      /* ignora */
    }
  }

  _bindGroup(btns, field, apply, after) {
    for (const btn of btns) {
      const handler = (e) => {
        e.preventDefault();
        this.selection[field] = apply(btn);
        this._save();
        this._sync();
        if (after) after(); // ex.: qualidade dá preview imediato no renderer
      };
      btn.addEventListener('click', handler);
      btn.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    }
  }

  _bind() {
    if (!this.root) return;
    this._bindGroup(this.qualityBtns, 'quality', (b) => (b.dataset.value === 'auto' ? 'auto' : Number(b.dataset.value)), () => this.applyQuality());
    this._bindGroup(this.modeBtns, 'mode', (b) => b.dataset.value);
    this._bindGroup(this.botsBtns, 'bots', (b) => Number(b.dataset.value));
    this._bindGroup(this.diffBtns, 'difficulty', (b) => b.dataset.value);

    const start = (e) => {
      if (e) e.preventDefault();
      this._start();
    };
    if (this.playBtn) {
      this.playBtn.addEventListener('click', start);
      this.playBtn.addEventListener('touchend', start, { passive: false });
    }
    // Enter também inicia (desktop)
    this._onKey = (e) => {
      if (e.code !== 'Enter' && e.code !== 'Space') return;
      // na tela de resultado, Enter = jogar de novo (atalho de teclado do botão)
      if (this._resultShown) {
        e.preventDefault();
        this.hideResult();
        this.gameState.restart();
        return;
      }
      if (this.visible) {
        e.preventDefault();
        this._start();
      }
    };
    window.addEventListener('keydown', this._onKey);

    // primeiro toque na tela (fora do lobby) tenta tela cheia p/ o mobile
    this._onFirstTouch = () => this._tryImmersive();
    window.addEventListener('touchstart', this._onFirstTouch, { once: true, passive: true });

    // tela de resultado: jogar de volta / voltar ao lobby
    const again = document.getElementById('result-again');
    if (again) again.addEventListener('click', (e) => {
      e.preventDefault();
      this.hideResult();
      this.gameState.restart();
    });
    const back = document.getElementById('result-lobby');
    if (back) back.addEventListener('click', (e) => {
      e.preventDefault();
      this.hideResult();
      this.gameState.toLobby();
    });
  }

  async _start() {
    if (this._starting) return;
    this._starting = true;
    if (this.statusEl) this.statusEl.textContent = 'ENTRANDO NA PARTIDA...';
    await this._tryImmersive();
    // deixa um frame p/ o navegador processar a mudança de tela cheia
    requestAnimationFrame(() => requestAnimationFrame(() => {
      this.gameState.setSettings({ ...this.selection });
      this.applyQuality();
      this.hide();
      this.gameState.startMatch();
      this.onExit();
      this._starting = false;
    }));
  }

  async _tryImmersive() {
    if (!this.immersive || this.immersive.isFullscreen) return;
    try {
      const r = await this.immersive.enter();
      if (this.infoEl && r && r.error) {
        this.infoEl.textContent = 'Tela cheia bloqueada pelo navegador — jogando em janela.';
      }
    } catch {
      /* nunca deixa o botão falhar por causa de fullscreen */
    }
  }

  /**
   * Aplica a qualidade escolhida (ou devolve o controle ao adaptativo):
   * `setAuto(false)` + `renderer.setQuality(i)` + aviso ao Engine, que reaplica
   * o que depende da qualidade (ex.: sombra do sol em MÍNIMA). O Lobby não
   * conhece luz nem renderer internamente — só declara a vontade.
   */
  applyQuality() {
    const q = this.selection.quality;
    if (q === 'auto') {
      if (this.performance.setAuto) this.performance.setAuto(true);
      return;
    }
    if (this.performance.setAuto) this.performance.setAuto(false);
    this.renderer.setQuality(Number(q));
    if (this.performance.onQualityChange) this.performance.onQualityChange(this.renderer.getQualityLabel());
    if (this.onQuality) this.onQuality(Number(q));
  }

  _sync() {
    const mark = (btns, value) => {
      for (const b of btns) {
        const v = b.dataset.value === 'auto' ? 'auto' : (Number.isNaN(Number(b.dataset.value)) ? b.dataset.value : Number(b.dataset.value));
        b.classList.toggle('on', v === value);
        b.setAttribute('aria-pressed', v === value ? 'true' : 'false');
      }
    };
    mark(this.qualityBtns, this.selection.quality);
    mark(this.modeBtns, this.selection.mode);
    mark(this.botsBtns, this.selection.bots);
    mark(this.diffBtns, this.selection.difficulty);
    if (this.infoEl) {
      const label = { solo: 'SOLO', duo: 'DUO' }[this.selection.mode];
      const bots = this.selection.bots === 0 ? 'sem bots (treino)' : `${this.selection.bots} bots`;
      this.infoEl.textContent = `${label} · ${bots} · dificuldade ${this.selection.difficulty}`;
    }
    if (this.mapMeta) {
      this.mapMeta.innerHTML = `<b>ARENA 01</b>400 m · 5 POIs · ${this.selection.bots} bots`;
    }
  }

  /**
   * Libera os listeners globais (keydown/touchstart). Instanciar um segundo
   * Lobby — teste, preview, reinstalação do fluxo — sem destruir o anterior
   * faria DOIS handlers de Enter chamarem `startMatch()` no mesmo GameState.
   */
  destroy() {
    if (this._onKey) window.removeEventListener('keydown', this._onKey);
    if (this._onFirstTouch) window.removeEventListener('touchstart', this._onFirstTouch);
    this._onKey = null;
    this._onFirstTouch = null;
    this.visible = false;
  }

  show() {
    this.visible = true;
    if (this.root) this.root.classList.add('show');
    if (this.statusEl) this.statusEl.textContent = 'PRONTO PARA O SALTO';
    this._sync();
  }

  hide() {
    this.visible = false;
    if (this.root) this.root.classList.remove('show');
  }

  /** Resultado da partida (mostrado sobre a cena congelada). */
  showResult(payload) {
    const el = document.getElementById('result');
    if (!el) return;
    this._resultShown = true;
    const title = document.getElementById('result-title');
    const sub = document.getElementById('result-sub');
    const stats = document.getElementById('result-stats');
    if (title) title.textContent = payload.victory ? 'BOOYAH!' : 'VOCÊ FOI ELIMINADO';
    if (title) title.classList.toggle('win', !!payload.victory);
    if (sub) sub.textContent = payload.victory ? 'último sobrevivente' : `${payload.placement}º lugar entre ${payload.total}`;
    if (stats) {
      stats.innerHTML = '';
      const rows = [['abates', payload.kills], ['tempo em partida', payload.time], ['qualidade', this.renderer.getQualityLabel()]];
      for (const [k, v] of rows) {
        const row = document.createElement('div');
        row.className = 'stat-row';
        row.innerHTML = `<span>${k}</span><span>${v}</span>`;
        stats.appendChild(row);
      }
    }
    el.classList.add('show');
  }

  hideResult() {
    this._resultShown = false;
    const el = document.getElementById('result');
    if (el) el.classList.remove('show');
  }
}
