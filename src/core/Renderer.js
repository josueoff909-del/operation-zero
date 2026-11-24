import * as THREE from 'three';
import { Config } from './Config.js';

/**
 * Renderer.js — Wrapper do WebGLRenderer (Three.js usa WebGL 2 por padrão).
 * Responsabilidades: pixel ratio limitado, sombras, tone mapping,
 * qualidade adaptativa (PerformanceMonitor) e dispose().
 */
export class Renderer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({
      antialias: Config.ANTIALIAS,
      powerPreference: 'high-performance',
      stencil: false, // mobile: stencil não é usado na Fase 1
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Config.PIXEL_RATIO_MAX));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    // Níveis de qualidade adaptativa (pixel ratio + sombra).
    // Índice 0 = melhor qualidade. PerformanceMonitor sobe/desce.
    this.qualityLevels = [
      { pixelRatio: 1.5, shadows: true, label: 'ALTA' },
      { pixelRatio: 1.25, shadows: true, label: 'MÉDIA' },
      { pixelRatio: 1.0, shadows: true, label: 'BAIXA' },
      { pixelRatio: 0.75, shadows: false, label: 'MÍNIMA' },
    ];
    this.qualityIndex = 0;

    window.addEventListener('resize', () => this.resize());
  }

  get domElement() {
    return this.renderer.domElement;
  }

  /**
   * Aplica um nível de qualidade (0..3). Chamado pelo PerformanceMonitor.
   * Só mexe no pixel ratio aqui; a sombra é ligada/desligada pelo Engine
   * via sun.castShadow (evita recompilar todos os materiais em runtime).
   */
  setQuality(index) {
    const clamped = Math.max(0, Math.min(this.qualityLevels.length - 1, index));
    this.qualityIndex = clamped;
    const level = this.qualityLevels[clamped];
    const pr = Math.min(window.devicePixelRatio || 1, level.pixelRatio);
    this.renderer.setPixelRatio(pr);
    this.resize();
    return level;
  }

  getQualityLabel() {
    return this.qualityLevels[this.qualityIndex].label;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
  }

  render(scene, camera) {
    this.renderer.render(scene, camera);
  }

  /** Estatísticas p/ HUD (draw calls / triângulos reais da cena). */
  getStats() {
    const info = this.renderer.info;
    return {
      calls: info.render.calls,
      triangles: info.render.triangles,
    };
  }

  dispose() {
    window.removeEventListener('resize', () => {});
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}
