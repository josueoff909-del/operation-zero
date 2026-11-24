import { Config } from '../core/Config.js';

/**
 * GameState.js — Fluxo da partida (GDD §1; Fase 8 antecipada no essencial).
 *
 *   LOBBY ──JOGAR──▶ DEPLOY ──(spawn pronto)──▶ MATCH ──morte/tempo──▶ RESULT
 *     ▲                                                            │
 *     └───────────────────── voltar ao lobby ────────────────────┘
 *
 * DEPLOY é a janela curta (0.6 s) em que a cena "acorda": spawn do jogador,
 * bots e primeira sincronização de câmera — mantém o toque em JOGAR instantâneo
 * em vez de congelar o frame com o trabalho pesado.
 *
 * A máquina não conhece DOM nem Three.js: quem decide (UI) chama os comandos e
 * lê `state`; o Engine escuta `onChange` e liga/desliga câmera/input/HUD.
 */
export const PHASE = {
  LOBBY: 'LOBBY',
  DEPLOY: 'DEPLOY',
  MATCH: 'MATCH',
  RESULT: 'RESULT',
};

export class GameState {
  constructor(onChange) {
    this.onChange = onChange || (() => {});
    this._phase = PHASE.LOBBY;
    this.matchTime = 0;
    this.deployTimer = 0;
    this.kills = 0;
    this.placement = 0;
    this.totalCombatants = 1;
    this.settings = {
      bots: Config.LOBBY_BOT_PRESETS[2],
      mode: 'solo', // 'solo' | 'duo'
      quality: 'auto', // 'auto' | 0..3 (índice de Renderer.qualityLevels)
      difficulty: 'normal',
    };
    this.commands = {}; // preenchido pelo Engine: { deploy, toLobby, restart }
  }

  get phase() {
    return this._phase;
  }

  get isPlaying() {
    return this._phase === PHASE.MATCH || this._phase === PHASE.DEPLOY;
  }

  get inLobby() {
    return this._phase === PHASE.LOBBY;
  }

  _set(next, payload) {
    const prev = this._phase;
    if (prev === next) return;
    this._phase = next;
    this.onChange(next, prev, payload || {});
  }

  setSettings(patch) {
    Object.assign(this.settings, patch);
  }

  /** JOGAR no lobby → entra direto na partida. */
  startMatch() {
    if (this._phase !== PHASE.LOBBY) return;
    this.matchTime = 0;
    this.kills = 0;
    this.placement = 0;
    this.deployTimer = 0.6;
    this._set(PHASE.DEPLOY, { settings: { ...this.settings } });
    if (this.commands.deploy) this.commands.deploy(this.settings);
  }

  restart() {
    if (this._phase !== PHASE.RESULT) return;
    this._set(PHASE.LOBBY);
    this.startMatch();
  }

  toLobby() {
    if (this._phase === PHASE.LOBBY) return;
    this._set(PHASE.LOBBY);
  }

  /**
   * Contagem de vivos → fim de partida.
   * @param {number} botsAlive bots ainda vivos
   * @param {boolean} playerAlive
   */
  reportAlive(botsAlive, playerAlive) {
    const alive = botsAlive + (playerAlive ? 1 : 0);
    this.totalCombatants = Math.max(this.totalCombatants, alive);
    if (this._phase !== PHASE.MATCH) return;
    if (!playerAlive) {
      // morreu com N vivos ao redor → ficou em (N+1)º
      this.placement = botsAlive + 1;
      this._set(PHASE.RESULT, { victory: false, placement: this.placement, kills: this.kills, total: this.totalCombatants });
    } else if (botsAlive <= 0) {
      this.placement = 1;
      this._set(PHASE.RESULT, { victory: true, placement: 1, kills: this.kills, total: this.totalCombatants });
    }
  }

  addKill() {
    this.kills += 1;
  }

  update(dt) {
    if (this._phase === PHASE.DEPLOY) {
      this.deployTimer -= dt;
      if (this.deployTimer <= 0) this._set(PHASE.MATCH);
      return;
    }
    if (this._phase === PHASE.MATCH) this.matchTime += dt;
  }

  getTimeText() {
    const m = Math.floor(this.matchTime / 60);
    const s = Math.floor(this.matchTime % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
}
