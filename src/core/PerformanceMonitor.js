import { Config } from './Config.js';

/**
 * PerformanceMonitor.js — Controle de performance/FPS (requisito Fase 1).
 *
 * - Calcula FPS com média exponencial (EMA) p/ não oscilar a cada frame.
 * - Qualidade adaptativa: se FPS < 45 por 2s → desce 1 nível;
 *   se FPS > 58 por 5s → sobe 1 nível (histerese p/ não "serrar").
 * - Expõe estatísticas p/ o HUD (FPS, ms, qualidade).
 */
export class PerformanceMonitor {
  constructor(renderer, onQualityChange) {
    this.renderer = renderer;
    this.onQualityChange = onQualityChange;
    this.fpsEMA = 60;
    this.frameMsEMA = 16.7;
    this.lowTime = 0; // tempo acumulado abaixo do limiar
    this.highTime = 0; // tempo acumulado acima do limiar
    this.cooldown = 0; // evita mudanças em rajada
  }

  /** Chamado a cada frame pelo Loop (rawDelta sem clamp p/ medir FPS real). */
  record(rawDelta, frameMs) {
    if (rawDelta > 0) {
      const fps = 1 / rawDelta;
      // EMA com alpha 0.05: suave, mas reage em ~1s.
      this.fpsEMA = this.fpsEMA * 0.95 + fps * 0.05;
      this.frameMsEMA = this.frameMsEMA * 0.95 + frameMs * 0.05;
    }
    this.cooldown = Math.max(0, this.cooldown - rawDelta);

    if (this.cooldown > 0) return;

    if (this.fpsEMA < Config.FPS_LOW_THRESHOLD) {
      this.lowTime += rawDelta;
      this.highTime = 0;
      if (this.lowTime >= 2 && this.renderer.qualityIndex < this.renderer.qualityLevels.length - 1) {
        this._applyQuality(this.renderer.qualityIndex + 1);
        this.lowTime = 0;
        this.cooldown = 1.5;
      }
    } else if (this.fpsEMA > Config.FPS_HIGH_THRESHOLD) {
      this.highTime += rawDelta;
      this.lowTime = 0;
      if (this.highTime >= 5 && this.renderer.qualityIndex > 0) {
        this._applyQuality(this.renderer.qualityIndex - 1);
        this.highTime = 0;
        this.cooldown = 1.5;
      }
    } else {
      this.lowTime = 0;
      this.highTime = 0;
    }
  }

  _applyQuality(index) {
    const level = this.renderer.setQuality(index);
    if (this.onQualityChange) this.onQualityChange(level.label);
  }

  getStats() {
    return {
      fps: Math.round(this.fpsEMA),
      frameMs: this.frameMsEMA,
      quality: this.renderer.getQualityLabel(),
    };
  }
}
