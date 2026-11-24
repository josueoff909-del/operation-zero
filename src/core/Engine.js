import * as THREE from 'three';
import { Renderer } from './Renderer.js';
import { SceneManager } from './SceneManager.js';
import { InputManager } from './InputManager.js';
import { Loop } from './Loop.js';
import { PerformanceMonitor } from './PerformanceMonitor.js';
import { Terrain } from '../world/Terrain.js';
import { Lighting } from '../world/Lighting.js';
import { Vegetation } from '../world/Vegetation.js';
import { Buildings } from '../world/Buildings.js';
import { Collision } from '../systems/Collision.js';
import { Player } from '../entities/Player.js';
import { Viewmodel } from '../entities/Viewmodel.js';
import { HUD } from '../ui/HUD.js';
import { Settings } from '../ui/Settings.js';
import { Config } from './Config.js';

/**
 * Engine.js — Orquestrador do jogo (Fases 1–2).
 * Monta: Renderer → SceneManager (cena do mapa) → InputManager →
 * Player → Viewmodel → Loop (update/render) + PerformanceMonitor.
 * Fase 2 adiciona: cidade (Buildings), CollisionWorld, viewmodel
 * com ADS/tiro visual e Settings (sensibilidade ajustável).
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
    // Sensibilidade ajustável (painel de engrenagem, persistida).
    this.settings = new Settings((mouseMult, touchMult) => {
      this.input.setSensitivity(mouseMult, touchMult);
    });
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
    this.buildings = null;
    this.collision = new Collision();
    this.player = null;
    this.viewmodel = null;
  }

  /** Constrói a cena (Fase 1: terreno/luz/vegetação; Fase 2: cidade/viewmodel). */
  _buildPhase1Scene() {
    const scene = new THREE.Scene();
    const camera = this.sceneManager.createCamera();

    this.terrain = new Terrain();
    scene.add(this.terrain.mesh);

    this.lighting = new Lighting(scene);
    this.vegetation = new Vegetation(scene);

    // Fase 2: cidade explorável com colisão sólida.
    this.buildings = new Buildings(scene, this.collision);

    this.player = new Player(camera, this.terrain, this.collision);

    // Viewmodel é filho da câmera — a câmera precisa estar na cena.
    scene.add(camera);
    this.viewmodel = new Viewmodel(camera, scene);

    this.sceneManager.setScene(scene, camera);
  }

  _update(dt) {
    const aiming = this.input.isAiming();
    // Olhar (mouse + touch, em radianos) → yaw/pitch.
    const look = this.input.consumeLookDelta();
    this.player.applyLook(look.x, look.y, aiming);

    // Movimento + física (agachar/ADS incluídos).
    this.player.update(dt, {
      move: this.input.getMoveInput(),
      jump: this.input.isJumpPressed(),
      sprint: this.input.isSprintHeld(),
      crouch: this.input.isCrouching(),
      aiming,
    });

    // Viewmodel: respiração/bob/ADS/tiro visual (+ coice na câmera).
    this.viewmodel.update(dt, {
      speed: this.player.getSpeed(),
      sprinting: this.player.sprinting,
      aiming,
      firing: this.input.isFiring(),
      onGround: this.player.onGround,
      lookX: look.x,
      lookY: look.y,
    }, () => this.player.applyRecoil(Config.RECOIL_PITCH));

    // HUD (throttled internamente).
    this.hud.update(dt, this.performance.getStats(), this.renderer.getStats(), this.player.getPosition(), this.player.getState());
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
    if (this.viewmodel) this.viewmodel.dispose();
    if (this.buildings) this.buildings.dispose();
    if (this.vegetation) this.vegetation.dispose();
    if (this.lighting) this.lighting.dispose();
    if (this.terrain) this.terrain.dispose();
    this.collision.dispose();
    this.renderer.dispose();
  }
}
