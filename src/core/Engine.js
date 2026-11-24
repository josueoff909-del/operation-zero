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
import { Landmarks } from '../world/Landmarks.js';
import { Backdrop } from '../world/Backdrop.js';
import { Water } from '../world/Water.js';
import { Climate, CLIMATE } from '../world/Climate.js';
import { Collision } from '../systems/Collision.js';
import { NavGrid } from '../systems/NavGrid.js';
import { Player } from '../entities/Player.js';
import { Viewmodel } from '../entities/Viewmodel.js';
import { Combat } from '../systems/Combat.js';
import { Bots } from '../systems/Bots.js';
import { Zone } from '../systems/Zone.js';
import { GameState, PHASE } from '../systems/GameState.js';
import { HUD } from '../ui/HUD.js';
import { Minimap } from '../ui/Minimap.js';
import { Settings } from '../ui/Settings.js';
import { Lobby } from '../ui/Lobby.js';
import { Immersive } from '../utils/Immersive.js';

/**
 * Engine.js — Orquestrador (núcleo das Fases 1–2 + fluxo de partida).
 *
 * Monta, nesta ordem (a ordem importa: tudo que gera colisor vem ANTES da
 * navegação, e a navegação vem antes dos bots):
 *   Renderer → SceneManager → InputManager → Terrain → Lighting (céu/PMREM) →
 *   Buildings → Vegetação → Water (lago) → Landmarks (POIs) → Collision →
 *   NavGrid → Player → Viewmodel → Combat → Zone (Fase 6) → Bots →
 *   HUD + Minimap → Settings → GameState → Lobby.
 *
 * Cada mundo novo (Fase 8: avião/paraquedas) entra aqui, não nos módulos.
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
      if (this.lighting && this.lighting.sun) {
        this.lighting.setShadowsEnabled(label !== 'MÍNIMA');
        this.lighting.setQuality(label); // nuvens/shadow map por nível
      }
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
    this.backdrop = null;
    this.water = null;
    this.landmarks = null;
    this.zone = null;
    this.minimap = null;
    this._zoneTickAt = 0;
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

    this.lighting = new Lighting(scene, { renderer: this.renderer.renderer });

    // Cidade (colisores dentro do construtor) + vegetação (colisores explícitos)
    this.buildings = new Buildings(scene, this.collision, (x, z) => this.terrain.getHeightAt(x, z));
    this.vegetation = new Vegetation(scene);
    this.vegetation.applyTo(this.collision);
    // POIs novos: lago (água + margem funda bloqueando), depósito/fazenda/
    // antenas/subúrbios. Tudo empurrando colisor na MESMA grade.
    this.water = new Water(scene);
    this.climate = new Climate(scene, { lighting: this.lighting });
    this.water.applyTo(this.collision);
    this.landmarks = new Landmarks(scene, this.collision);
    this.backdrop = new Backdrop(scene);

    // Grafo de navegação depois de TODOS os sólidos estarem no mundo
    this.nav = new NavGrid(this.collision);

    // Reflexo do céu nos materiais PBR + exposição casada com o Sky
    this.lighting.applyEnvironment(scene);
    this.lighting.applyExposure(this.renderer.renderer);

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

    // --- zona segura (Fase 6): dano por tick + feedback no feed ---------
    this.zone = new Zone(scene, {
      onCloseStart: (next, idx) => this._feedKill(`<b>ZONA FECHANDO</b> · fase ${idx} → ${Math.round(next.radius)} m`, ''),
      onPhase: (idx, state) => {
        // Fase final: o céu vira gás (Climate) — feedback no mundo, não só no HUD
        this.climate.onZonePhase(idx, state === 'FINAL');
        if (state === 'FINAL') this._feedKill('<b>ZONA FINAL</b> · gás subindo', '');
      },
    });

    this.minimap = new Minimap(document.getElementById('minimap-canvas'));

    this.sceneManager.setScene(scene, camera);
    // puxado para o lago: o quadro pega cidade + água + antenas juntos
    this._lobbyCamTarget = new THREE.Vector3(Config.LAKE.x * 0.16, 3, Config.LAKE.z * 0.16);
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

    this.climate?.set(CLIMATE.CLEAR, { instant: true });
    this.zone.reset(this.player.position.x, this.player.position.z);
    const allies = settings.mode === 'duo' ? 1 : 0;
    // spawn distribuído nos POIs (cidade + depósito + fazenda + antenas + lago)
    const spots = [...(this.buildings.spawnPoints() || []), ...(this.landmarks.spawnPoints || [])];
    const level = Config.BOT_LEVELS[settings.difficulty] ?? Config.BOT_LEVELS.normal;
    const spawned = this.bots.spawn(settings.bots, {
      playerPos: this.player.position,
      allies,
      level,
      spots,
    });
    this.gameState.totalCombatants = spawned + 1;
    this.aliveCount = spawned + 1;
    this.input.setEnabled(true);
  }

  _toLobby() {
    this.input.setEnabled(false);
    this.zone?.disable();
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
      const how = info.zone ? '🔥 NO GÁS' : info.part === 'head' ? 'HEADSHOT' : '';
      this._feedKill(`${info.attackerName} eliminou ${info.name}`, how);
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

    // céu/água vivem fora do MATCH também (o Lobby é a vitrine do mapa)
    this.lighting.update(dt);
    this.water.update(dt);
    this.climate.update(dt);
    // transição de clima em curso → re-lerp das cores do Backdrop (4 Hz)
    if (this.climate.blend < 1) {
      this._climateTintAt = (this._climateTintAt || 0) + dt;
      if (this._climateTintAt > 0.25) {
        this._climateTintAt = 0;
        if (this.sceneManager.scene?.fog) this.backdrop.refreshTint(this.sceneManager.scene.fog.color);
      }
    }

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

    // --- Zona: fecha, marca o tick e fere quem está fora ---
    let zoneTick = false;
    if (phase === PHASE.MATCH && this.zone.enabled) {
      this.zone.update(dt);
      zoneTick = this.zone.shouldTick(dt);
      if (zoneTick && this.player.alive) {
        const dps = this.zone.dpsAt(this.player.position.x, this.player.position.z);
        if (dps > 0) this.player.takeDamage(dps, 'zone');
      }
    }

    // --- Bots: decisão em lote + integração de todos (correm p/ a zona) ---
    this.bots.update(dt, { player: this.player, zone: this.zone, zoneTick });

    // --- minimapa (12 Hz, canvas 2D) ---
    this.minimap.update(dt, { player: this.player, zone: this.zone, bots: this.bots });

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
      zone: this._zoneHud(phase),
      now: this._time,
    });
    this._pendingHit = null;
    this._pendingDamage = 0;
  }

  /** Objeto de leitura da zona p/ o HUD (HUD não conhece a Zone, só dados). */
  _zoneHud(phase) {
    const z = this.zone;
    if (!z || !z.enabled || phase !== PHASE.MATCH) return null;
    const p = this.player.position;
    return {
      label: z.label,
      countdown: z.getCountdownText(),
      distance: Math.max(0, z.distanceOutside(p.x, p.z)),
      outside: z.isOutside(p.x, p.z),
      closing: z.state === 'CLOSING',
      // barra = quanto do estado ATUAL já passou (espera ou fechamento). Ler
      // `z.progress` fora do CLOSING dava 1 o tempo todo e a barra ficava morta.
      progress: z.phaseProgress,
    };
  }

  /** Câmera do Lobby: órbita lenta sobre a cidade (a cena é o fundo do menu). */
  _updateLobbyCamera(dt, camera) {
    this._lobbyAngle = (this._lobbyAngle ?? 0) + dt * Config.LOBBY_ORBIT_SPEED;
    const r = Config.LOBBY_ORBIT_RADIUS;
    const a = this._lobbyAngle;
    const y = Config.LOBBY_ORBIT_HEIGHT + Math.sin(a * 0.7) * 2.5;
    camera.position.set(Math.cos(a) * r, Math.max(this.terrain.getHeightAt(Math.cos(a) * r, Math.sin(a) * r) + 8, y), Math.sin(a) * r);
    camera.fov = Config.LOBBY_ORBIT_FOV ?? 58;
    camera.updateProjectionMatrix();
    camera.rotation.order = 'YXZ';
    camera.lookAt(this._lobbyCamTarget); // alvo levemente deslocado p/ o lago
    // luz ainda acompanha o "centro" p/ a cidade não ficar sem sombra no menu
    this.lighting.follow(0, 0, 0);
    if (this.viewmodel) this.viewmodel.idle(dt);
  }

  dispose() {
    this.loop.stop();
    this.immersive.dispose();
    if (this.minimap) this.minimap.dispose?.();
    if (this.climate) this.climate.dispose();
    if (this.zone) this.zone.dispose();
    if (this.backdrop) this.backdrop.dispose();
    if (this.water) this.water.dispose();
    if (this.landmarks) this.landmarks.dispose();
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
