/**
 * HUD.js — Atualiza o overlay de performance (Fase 1).
 * Lê PerformanceMonitor + Renderer + Player e escreve no DOM
 * no máximo ~10x/s (evita custo de layout por frame).
 */
export class HUD {
  constructor() {
    this.fpsEl = document.getElementById('fps-value');
    this.msEl = document.getElementById('stat-ms');
    this.callsEl = document.getElementById('stat-calls');
    this.trisEl = document.getElementById('stat-tris');
    this.qualityEl = document.getElementById('stat-quality');
    this.posEl = document.getElementById('stat-pos');
    this.stateEl = document.getElementById('stat-state');
    this._accum = 0;
  }

  /** Chamado todo frame; só escreve no DOM a cada ~0.1s. */
  update(dt, perfStats, renderStats, playerPos, playerState) {
    this._accum += dt;
    if (this._accum < 0.1) return;
    this._accum = 0;

    if (this.fpsEl) {
      this.fpsEl.textContent = `${perfStats.fps} FPS`;
      this.fpsEl.classList.toggle('low', perfStats.fps < 45);
    }
    if (this.msEl) this.msEl.textContent = `${perfStats.frameMs.toFixed(1)} ms`;
    if (this.callsEl) this.callsEl.textContent = String(renderStats.calls);
    if (this.trisEl) this.trisEl.textContent = renderStats.triangles.toLocaleString('pt-BR');
    if (this.qualityEl) this.qualityEl.textContent = perfStats.quality;
    if (this.posEl && playerPos) {
      this.posEl.textContent = `${playerPos.x.toFixed(0)}, ${playerPos.z.toFixed(0)}`;
    }
  }
}
