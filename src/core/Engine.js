import * as THREE from 'three';
import { Renderer } from './Renderer.js';
import { SceneManager } from './SceneManager.js';
import { InputManager } from './InputManager.js';
import { Loop } from './Loop.js';
import { PerformanceMonitor } from './PerformanceMonitor.js';
import { Config } from './Config.js';
import { Terrain } from '../world/Terrain.js';
import { Lighting } from '../world/Lighting.js';
import { Vegetation } from '../world/Vegetation.js';
import { Buildings } from '../world/Buildings.js';
import { Collision } from '../systems/Collision.js';
import { NavGrid } from '../systems/NavGrid.js';
import { Player } from '../entities/Player.js';
import { Viewmodel } from '../entities/Viewmodel.js';
import { Combat } from '../systems/Combat.js';
import { Bots } from '../systems/Bots.js';
import { GameState, PHASE } from '../systems/GameState.js';
import { HUD } from '../ui/HUD.js';
import { Settings } from '../ui/Settings.js';
import { Lobby } from '../ui/Lobby.js';
import { Immersive } from '../utils/Immersive.js';

/**
 * Engine.js — Orquestrador (núcleo das Fases 1–2 + fluxo de partida).
 *
 * Monta, nesta ordem (a ordem importa: colisão → navegação → bots):
 *   Renderer → SceneManager → InputManager → Terrain → Lighting →
 *   Vegetação (colisores) → Buildings (colisores) → Collision → NavGrid →
 *   Player → Viewmodel → Combat → Bots → HUD → Settings → GameState → Lobby.
 *
 * O Engine é o ÚNICO lugar que conhece todos os módulos; cada um continua
 * sozinho na sua pasta (Skill §2). Estado da partida em `GameState`, input em
 * `InputManager`, cena em `SceneManager`.
 *
 * Lobby: a cena renderiza com a câmera orbitando a cidade (input travado).
 * MATCH: jogador + combat + bots + sombra seguindo o jogador.
 */
export class Engine {
  constructor(container) {
    this.container = container;
    this.renderer = new Renderer(container);
    this.sceneManager = new SceneManager();
    this.input = new InputManager(this.renderer.domElement);
    this.hud = new HUD();
    this.immersive = new Immersive(container);

    this.settings = new Settings((mouseMult, touchMult) => {
      this.input.setSensitivity(mouseMult, touchMult);
    });

    // Qualidade adaptativa; MÍNIMA desliga a sombra do sol.
    this.performance = new PerformanceMonitor(this.renderer, (label) => {
      if (this.lighting && this.lighting.sun) this.lighting.setShadowsEnabled(label !== 'MÍNIMA');
    });

    this.gameState = new GameState((next, prev, payload) => this._onPhaseChange(next, prev, payload));

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
    this.nav = null;
    this.player = null;
    this.viewmodel = null;
    this.combat = null;
    this.bots = null;
    this.lobby = null;
    this._time = 0;
    this._aliveReportAt = 0;
    this._pendingHit = null;
    this._pendingDamage = 0;
  }

  // ------------------------------------------------------------------ build
  _buildScene() {
    const scene = new THREE.Scene();
    const camera = this.sceneManager.createCamera();

    this.terrain = new Terrain();
    scene.add(this.terrain.mesh);

    this.lighting = new Lighting(scene);

    // Cidade (colisores dentro do construtor) + vegetação (colisores explícitos)
    this.buildings = new Buildings(scene, this.collision, (x, z) => this.terrain.getHeightAt(x, z));
    this.vegetation = new Vegetation(scene);
    this.vegetation.applyTo(this.collision);

    // Grafo de navegação depois de TODOS os sólidos estarem no mundo
    this.nav = new NavGrid(this.collision);

    this.player = new Player(camera, this.terrain, this.collision);
    this.player.fov = Config.BASE_FOV;

    // Viewmodel é filho da câmera — a câmera precisa estar na cena.
    scene.add(camera);
    this.viewmodel = new Viewmodel(camera, scene);

    this.combat = new Combat({
      collision: this.collision,
      scene,
      getTargets: () => (this.bots ? this.bots.targetsFor() : []),
    });
    this.combat.onShot = (shot, impactDist) => this.viewmodel.playShot(impactDist);
    this.combat.onHit = (result) => {
      if (!result || result.miss) return;
      this._pendingHit = result;
      if (result.killed) {
        // credito do abate do jogador: UMA fonte (Combat nao conta)
        this.gameState.addKill();
        this._feedKill(`VOCÊ eliminou ${result.target.displayName}`, result.headshot ? 'HEADSHOT' : '');
      }
    };
    this.player.setWeapon(this.combat.weapon);

    this.bots = new Bots(scene, {
      collision: this.collision,
      terrain: this.terrain,
      nav: this.nav,
      onKill: (info) => this._onBotKilled(info),
      onPlayerDamage: (amount, part) => {
        if (this.player) this.player.takeDamage(amount, part);
      },
    });
    this.player.onDamaged = (amount) => { this._pendingDamage = amount; };
    this.player.onDeath = () => this._reportAlive();

    this.sceneManager.setScene(scene, camera);
    this._lobbyCamTarget = new THREE.Vector3(0, 2, 0);
    this.setPhaseClass(PHASE.LOBBY);
  }

  // ------------------------------------------------------------------ start
  start() {
    this._buildScene();
    this.input.attachTouch(
      document.getElementById('joystick-zone'),
      document.getElementById('joystick-base'),
      document.getElementById('joystick-nub'),
      document.getElementById('look-zone'),
    );

    this.lobby = new Lobby({
      gameState: this.gameState,
      renderer: this.renderer,
      performance: this.performance,
      immersive: this.immersive,
      // o Lobby declara a qualidade; o Engine reaplica o que depende dela
      // (sombra do sol em MÍNIMA) — AUTO continua sendo do PerformanceMonitor
      onQuality: () => {
        if (this.lighting?.setShadowsEnabled) {
          this.lighting.setShadowsEnabled(this.renderer.getQualityLabel() !== 'MÍNIMA');
        }
      },
      onExit: () => {
        // no desktop, pede o pointer lock só depois que a partida começou
        if (window.matchMedia('(pointer: fine)').matches) {
          const hint = document.getElementById('lock-hint');
          if (hint) hint.classList.remove('hidden');
        }
      },
    });

    // Comandos que o GameState usa para pedir coisa ao Engine (inversão de deps)
    this.gameState.commands.deploy = (settings) => this._deploy(settings);
    this.gameState.commands.toLobby = () => this._toLobby();

    // Lobby visível assim que a cena existe
    this.input.setEnabled(false);
    this.lobby.show();
    this._toLobby();

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.loop.clock.stop();
      else this.loop.clock.start();
    });
    // Tela cheia / rotação muda o viewport sem necessariamente dar 'resize'
    this.immersive.onChange(() => {
      this.renderer.resize();
      this.sceneManager.resizeCamera();
    });

    this.loop.start();
  }

  /** Spawn do jogador + bots (chamado pelo GameState no DEPLOY). */
  _deploy(settings) {
    this.player.reset(0, 9);
    this.player.team = 0;
    this.player.setWeapon(this.combat.weapon);
    this.combat.reset();
    this.viewmodel.reset?.();
    this.hud.clearFeed();

    const allies = settings.mode === 'duo' ? 1 : 0;
    const level = Config.BOT_LEVELS[settings.difficulty] ?? Config.BOT_LEVELS.normal;
    const spawned = this.bots.spawn(settings.bots, {
      playerPos: this.player.position,
      allies,
      level,
    });
    this.gameState.totalCombatants = spawned + 1;
    this.aliveCount = spawned + 1;
    this.input.setEnabled(true);
  }

  _toLobby() {
    this.input.setEnabled(false);
    this.bots?.despawn();
    this.hud.clearFeed();
    if (this.lobby) this.lobby.show();
  }

  setPhaseClass(phase) {
    document.body.dataset.phase = phase.toLowerCase();
  }

  _onPhaseChange(next, prev, payload) {
    this.setPhaseClass(next);
    if (next === PHASE.MATCH) {
      this.hud.setMatchVisible(true);
      if (this.viewmodel) this.viewmodel.group.visible = true;
    }
    if (next === PHASE.LOBBY) {
      this.hud.setMatchVisible(false);
      this.lobby?.hideResult();
      if (this.viewmodel) this.viewmodel.group.visible = false;
    }
    if (next === PHASE.RESULT) {
      this.hud.setMatchVisible(false);
      this.input.setEnabled(false);
      this.lobby?.showResult({
        victory: !!payload.victory,
        placement: payload.placement ?? 0,
        kills: this.gameState.kills,
        time: this.gameState.getTimeText(),
        total: this.gameState.totalCombatants,
      });
    }
  }

  _feedKill(who, how) {
    this.hud.pushFeed(`${who}${how ? ` · <b>${how}</b>` : ''}`);
  }

  /**
   * Bot morreu (pelo jogador ou por outro bot). O crédito de abate do jogador
   * sai do Combat.onHit — aqui é só o feed e a contagem de vivos.
   */
  _onBotKilled(info) {
    if (info.attackerName) {
      this._feedKill(`${info.attackerName} eliminou ${info.name}`, info.part === 'head' ? 'HEADSHOT' : '');
    }
    this._reportAlive();
  }

  /** Vivos = bots vivos + jogador. Fonte única p/ HUD e fim de partida. */
  _reportAlive() {
    const botsAlive = this.bots ? this.bots.aliveCount : 0;
    const playerAlive = this.player ? this.player.alive : false;
    this.aliveCount = botsAlive + (playerAlive ? 1 : 0);
    this.gameState.reportAlive(botsAlive, playerAlive);
  }

  // ------------------------------------------------------------------ update
  _update(dt) {
    this._time += dt;
    this.gameState.update(dt);
    const phase = this.gameState.phase;
    const camera = this.sceneManager.camera;

    if (phase === PHASE.LOBBY || phase === PHASE.RESULT) {
      this._updateLobbyCamera(dt, camera);
      this.hud.update(dt, {
        perf: this.performance.getStats(),
        render: this.renderer.getStats(),
        player: null, combat: null, match: null, now: this._time,
      });
      return;
    }

    // --- DEPLOY: um respiro p/ a cena assentar, sem input do jogador ---
    const aiming = this.input.isAiming();
    const look = this.input.consumeLookDelta();
    this.player.applyLook(look.x, look.y, aiming);

    this.player.update(dt, {
      move: this.input.getMoveInput(),
      jump: this.input.isJumpPressed(),
      sprint: this.input.isSprintHeld(),
      crouch: this.input.isCrouching(),
      aiming,
      locked: phase === PHASE.MATCH,
    });

    // --- Combate: cadência, munição, hitscan com dano real ---
    if (phase === PHASE.MATCH) {
      if (this.input.isReloadPressed()) this.combat.reload();
      this.combat.update(dt, {
        trigger: this.input.isFiring(),
        aiming,
        moving: this.player.speed > 1.5,
        player: this.player,
        camera,
      });
    }

    // --- Viewmodel: respiração/bob/sway/ADS (o tiro é do Combat) ---
    this.viewmodel.update(dt, {
      speed: this.player.getSpeed(),
      sprinting: this.player.sprinting,
      aiming,
      onGround: this.player.onGround,
      lookX: look.x,
      lookY: look.y,
    });

    // --- Bots: decisão em lote + integração de todos ---
    this.bots.update(dt, { player: this.player });

    // --- Sombra segue o jogador (materials-lighting skill) ---
    if (Config.SHADOW_FOLLOW_PLAYER) {
      this.lighting.follow(this.player.position.x, this.player.position.y, this.player.position.z);
    }

    // --- fim de partida / contagem de vivos (a cada 0.25s) ---
    if (this._time - this._aliveReportAt > 0.25) {
      this._aliveReportAt = this._time;
      if (phase === PHASE.MATCH) this._reportAlive();
    }

    // --- HUD ---
    this.hud.update(dt, {
      perf: this.performance.getStats(),
      render: this.renderer.getStats(),
      player: this.player,
      combat: this.combat,
      match: {
        kills: this.gameState.kills,
        alive: Math.min(this.aliveCount ?? 1, this.gameState.totalCombatants),
        total: this.gameState.totalCombatants,
        timeText: this.gameState.getTimeText(),
      },
      hit: this._pendingHit,
      damage: this._pendingDamage,
      now: this._time,
    });
    this._pendingHit = null;
    this._pendingDamage = 0;
  }

  /** Câmera do Lobby: órbita lenta sobre a cidade (a cena é o fundo do menu). */
  _updateLobbyCamera(dt, camera) {
    this._lobbyAngle = (this._lobbyAngle ?? 0) + dt * Config.LOBBY_ORBIT_SPEED;
    const r = Config.LOBBY_ORBIT_RADIUS;
    const a = this._lobbyAngle;
    const y = Config.LOBBY_ORBIT_HEIGHT + Math.sin(a * 0.7) * 2.5;
    camera.position.set(Math.cos(a) * r, Math.max(this.terrain.getHeightAt(Math.cos(a) * r, Math.sin(a) * r) + 8, y), Math.sin(a) * r);
    camera.fov = 62;
    camera.updateProjectionMatrix();
    camera.rotation.order = 'YXZ';
    camera.lookAt(this._lobbyCamTarget);
    // luz ainda acompanha o "centro" p/ a cidade não ficar sem sombra no menu
    this.lighting.follow(0, 0, 0);
    if (this.viewmodel) this.viewmodel.idle(dt);
  }

  dispose() {
    this.loop.stop();
    this.immersive.dispose();
    if (this.bots) this.bots.dispose();
    if (this.viewmodel) this.viewmodel.dispose();
    if (this.buildings) this.buildings.dispose();
    if (this.vegetation) this.vegetation.dispose();
    if (this.lighting) this.lighting.dispose();
    if (this.terrain) this.terrain.dispose();
    this.collision.dispose();
    this.renderer.dispose();
  }
}
