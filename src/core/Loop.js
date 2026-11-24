import * as THREE from 'three';
import { Config } from './Config.js';

/**
 * Loop.js — Game loop com THREE.Clock.
 * Skill §2: deltaTime limitado a 0.05s p/ a física não explodir
 * se o navegador travar por um instante (GC, aba em background, etc.).
 */
export class Loop {
  constructor(updateFn, renderFn, onFrame) {
    this.clock = new THREE.Clock();
    this.updateFn = updateFn;
    this.renderFn = renderFn;
    this.onFrame = onFrame; // callback p/ PerformanceMonitor (fps, frameMs)
    this.running = false;
    this.rafId = 0;
    this._tick = this._tick.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this.rafId = requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  _tick() {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this._tick);
    const rawDelta = this.clock.getDelta();
    const delta = Math.min(rawDelta, Config.MAX_DELTA);
    const frameStart = performance.now();
    this.updateFn(delta);
    this.renderFn();
    const frameMs = performance.now() - frameStart;
    if (this.onFrame) this.onFrame(rawDelta, frameMs);
  }
}
