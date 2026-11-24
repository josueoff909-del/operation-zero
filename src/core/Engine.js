import * as THREE from 'three';
import { Renderer } from './Renderer.js';
import { SceneManager } from './SceneManager.js';
import { InputManager } from './InputManager.js';
import { Loop } from './Loop.js';
import { PerformanceMonitor } from './PerformanceMonitor.js';
import { Terrain } from '../world/Terrain.js';
import { Lighting } from '../world/Lighting.js';
import { Vegetation } from '../world/Vegetation.js';
import { Player } from '../entities/Player.js';
import { HUD } from '../ui/HUD.js';

/**
 * Engine.js — Orquestrador da Fase 1.
 * Monta: Renderer → SceneManager (cena do mapa) → InputManager →
 * Player → Loop (update/render) + PerformanceMonitor (FPS/qualidade).
 * Fases futuras plugarão aqui: GameState (fluxo de partida),
 * SafeZone, Bots, Veículos, Rede — sem reescrever este núcleo.
 */
export class Engine {
  constructor(container) {
    this.container = container;
    this.renderer = new Renderer(container);
    this.sceneManager = new SceneManager();
    this.input = new InputManager(this.renderer.domElement);
    this.hud = new HUD();
    // Qualidade adaptativa: nível MÍNIMA desliga a sombra do sol (castShadow).
    this.performance = new PerformanceMonitor(this.renderer, (label) => {
      if (this.lighting && this.lighting.sun) {
        this.lighting.sun.castShadow = label !== 'MÍNIMA';
      }
    });
    this.loop = new Loop(
      (dt) => this._update(dt),
      () => this.renderer.render(this.sceneManager.scene, this.sceneManager.camera),
      (rawDelta, frameMs) => this.performance.record(rawDelta, frameMs),
    );
    this.terrain = null;
    this.lighting = null;
    this.vegetation = null;
    this.player = null;
  }

  /** Constrói a cena da Fase 1: terreno + iluminação + vegetação + jogador. */
  _buildPhase1Scene() {
    const scene = new THREE.Scene();
    const camera = this.sceneManager.createCamera();

    this.terrain = new Terrain();
    scene.add(this.terrain.mesh);

    this.lighting = new Lighting(scene);
    this.vegetation = new Vegetation(scene);

    this.player = new Player(camera, this.terrain);

    this.sceneManager.setScene(scene, camera);
  }

  _update(dt) {
    // Olhar (mouse + touch) → yaw/pitch.
    const look = this.input.consumeLookDelta();
    this.player.applyLook(look.x, look.y);

    // Movimento + física.
    this.player.update(dt, {
      move: this.input.getMoveInput(),
      jump: this.input.isJumpPressed(),
      sprint: this.input.isSprintHeld(),
    });

    // HUD (throttled internamente).
    this.hud.update(dt, this.performance.getStats(), this.renderer.getStats(), this.player.getPosition());
  }

  start() {
    this._buildPhase1Scene();
    this.input.attachTouch(
      document.getElementById('joystick-zone'),
      document.getElementById('joystick-base'),
      document.getElementById('joystick-nub'),
      document.getElementById('look-zone'),
    );
    // Pausa o relógio quando a aba fica oculta (evita salto de dt ao voltar).
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.loop.clock.stop();
      else this.loop.clock.start();
    });
    this.loop.start();
  }

  dispose() {
    this.loop.stop();
    if (this.vegetation) this.vegetation.dispose();
    if (this.lighting) this.lighting.dispose();
    if (this.terrain) this.terrain.dispose();
    this.renderer.dispose();
  }
}
