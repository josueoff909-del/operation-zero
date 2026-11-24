import * as THREE from 'three';
import { Config } from '../core/Config.js';
import { Bot } from '../entities/Bot.js';
import { applyConeSpread } from '../utils/Hitbox.js';

/**
 * Bots.js — Esquadrão de bots: spawn, atualização escalonada e render.
 *
 * Skill `threejs-android` §4 (obrigatória): **nunca** decidir os 44 bots no
 * mesmo frame. Aqui a decisão (percepção + FSM + re-path) roda em lotes de
 * `Config.BOT_DECISION_BATCH` bots por frame (ciclo de 4), enquanto a
 * integração de movimento/animação roda todo frame p/ o movimento ficar
 * suave a 60 FPS.
 *
 * Skill `threejs-android` §1: os 44 bots são desenhados com
 * `InstancedMesh` — **6 draw calls** para corpos + 1 para tracers, e não 264
 * `Mesh` individuais. Cores por instância (time + flash de dano).
 *
 * Regra do pedido: bot também obedece a colisão sólida (usa o mesmo
 * `Collision.resolveCircle` do jogador) e o tiro dele **para na cobertura**
 * (usa o mesmo `rayDistance` do Combat).
 */
const FIRST_NAMES = ['Rafa', 'Léo', 'Bia', 'Téo', 'Nina', 'Caio', 'Ivo', 'Rui', 'Ana', 'Beto',
  'Dora', 'Elis', 'Fera', 'Gau', 'Hugo', 'Iara', 'Jota', 'Kaku', 'Lia', 'Marcos'];

export class Bots {
  /**
   * @param {THREE.Scene} scene
   * @param {{collision:object, terrain:object, nav:object, onKill:Function, onPlayerDamage:Function}} deps
   */
  constructor(scene, deps) {
    this.scene = scene;
    this.collision = deps.collision;
    this.terrain = deps.terrain;
    this.nav = deps.nav;
    this.onKill = deps.onKill || (() => {});
    this.onPlayerDamage = deps.onPlayerDamage || (() => {});
    this.onTracer = deps.onTracer || null;

    this.list = [];
    this.cursor = 0;      // ponteiro do lote de decisão
    this.time = 0;
    this.alive = 0;
    this._rng = this._mulberry(4242);
    this._dummy = new THREE.Object3D();
    this._color = new THREE.Color();
    this._ctx = {
      time: 0, dtTick: 1 / 15, rng: this._rng,
      collision: this.collision, terrain: this.terrain, nav: this.nav,
      targets: [], player: null, zone: null,
      fireBotShot: (bot) => this._fireBotShot(bot),
      claimRepath: () => this._claimRepath(),
    };
    this._repathBudget = 0;
    this._buildVisual();
    this._buildTracers();
  }

  _mulberry(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------------------------------------------------------------- visuals
  _buildVisual() {
    const max = Config.BOT_MAX;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    this._partGeo = geo;
    // corpo + cabeça + 2 braços + 2 pernas = 6 InstancedMesh
    this.partMeshes = [];
    this._writers = [];
    const body = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.05 });
    const head = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0 });
    for (let p = 0; p < 6; p++) {
      const mesh = new THREE.InstancedMesh(geo, p === 1 ? head : body, max);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // true aqui cortaria o mundo inteiro: o boundingSphere de um InstancedMesh
      // é calculado UMA vez e as instâncias mudam todo frame (bots andam), então a
      // cache fica velha e o esquadrão piscaria. São 6 draw calls — não vale o risco.
      mesh.frustumCulled = false;
      mesh.name = `bot-${p}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); // muda todo frame
      this.scene.add(mesh);
      this.partMeshes.push(mesh);
    }
  }

  _buildTracers() {
    const geo = new THREE.BoxGeometry(0.06, 0.06, 1);
    this._tracerGeo = geo;
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffd27a, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.tracerMesh = new THREE.InstancedMesh(geo, mat, Config.BOT_TRACER_POOL);
    this.tracerMesh.frustumCulled = false;
    this.tracerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tracerMesh.name = 'bot-tracers';
    this.scene.add(this.tracerMesh);
    this.tracers = [];
    for (let i = 0; i < Config.BOT_TRACER_POOL; i++) {
      this.tracers.push({ life: 0, from: new THREE.Vector3(), to: new THREE.Vector3() });
    }
    this._tracerCursor = 0;
  }

  // ---------------------------------------------------------------- spawn
  /**
   * Espalha bots pelo mapa longe do jogador. `allies` viram time 0 (DUO).
   */
  /**
   * @param {number} count
   * @param {{playerPos?:THREE.Vector3, allies?:number, level?:number,
   *          spots?:Array<{x:number,z:number}>}} opts
   *   `spots`: pontos de interesse do mapa (cidade/depósito/lago...). Quando
   *   passados, os bots são distribuídos ROUND-ROBIN entre os POIs — é isso que
   *   faz a partida acontecer no mapa inteiro em vez de só em volta do spawn.
   */
  spawn(count, { playerPos, allies = 0, level = Config.BOT_LEVELS.normal, spots = null } = {}) {
    this.despawn();
    const total = Math.min(Config.BOT_MAX, count);
    const poiSpots = spots && spots.length > 3 ? spots : null;
    for (let i = 0; i < total; i++) {
      const team = i < allies ? 0 : 1;
      const bot = new Bot(i, team, team === 0 ? Math.min(1, level + 0.15) : level,
        `${FIRST_NAMES[i % FIRST_NAMES.length]}${String(i + 1).padStart(2, '0')}`);
      let spot = null;
      if (poiSpots) {
        for (let t = 0; t < 8 && !spot; t++) {
          const p = poiSpots[(i * 5 + t * 11) % poiSpots.length];
          const x = p.x + (this._rng() - 0.5) * 9;
          const z = p.z + (this._rng() - 0.5) * 9;
          if (this.collision.isBlockedCircle(x, z, Config.BOT_RADIUS + 0.25)) continue;
          // o NavGrid é mais exigente que o raio do colisor (celha inteira
          // livre). Validar aqui é o que impede o bot de nascer num vão de 1 m
          // e ficar empurrando parede para sempre.
          if (this.nav && !this.nav.isOpenWorld(x, z)) continue;
          if (playerPos && Math.hypot(x - playerPos.x, z - playerPos.z) < 22) continue;
          spot = { x, z, y: this.terrain ? this.terrain.getHeightAt(x, z) : 0 };
        }
      }
      if (!spot) spot = this._findSpawn(playerPos, team);
      bot.onKilledBy = (fromTeam, part, meta) => this._onBotKilled(bot, fromTeam, part, meta);
      bot.spawnAt(spot.x, spot.y, spot.z, this._rng);
      if (team === 0 && playerPos) {
        bot.board.target = null;
        bot.team = 0;
      }
      this.list.push(bot);
    }
    this.alive = this.list.length;
    this._ctx.targets = this.list;
    return this.list.length;
  }

  _findSpawn(playerPos, team) {
    const minDist = team === 0 ? 18 : 70;
    for (let tries = 0; tries < 60; tries++) {
      const a = this._rng() * Math.PI * 2;
      const r = minDist + this._rng() * (Config.WORLD_SIZE / 2 - minDist - 12);
      const x = (playerPos?.x ?? 0) + Math.cos(a) * r;
      const z = (playerPos?.z ?? 0) + Math.sin(a) * r;
      if (Math.abs(x) > Config.WORLD_SIZE / 2 - 10 || Math.abs(z) > Config.WORLD_SIZE / 2 - 10) continue;
      const free = this.nav ? this.nav.nearestFreeWorld(x, z, 5) : { x, z };
      if (!free) continue;
      if (this.collision.isBlockedCircle(free.x, free.z, Config.BOT_RADIUS + 0.3)) continue;
      const y = this.terrain.getHeightAt(free.x, free.z);
      return { x: free.x, z: free.z, y };
    }
    const x = 40 + this._rng() * 60;
    const z = 40 + this._rng() * 60;
    return { x, z, y: this.terrain.getHeightAt(x, z) };
  }

  despawn() {
    for (const bot of this.list) bot.hidden = true;
    this.list.length = 0;
    this.alive = 0;
    this.cursor = 0;
    for (const t of this.tracers) t.life = 0;
    this._writeInstances();
  }

  // ---------------------------------------------------------------- update
  /**
   * @param {number} dt
   * @param {{player:object, firing:boolean, playerShots:number}} ctxExtras
   */
  update(dt, extras) {
    this.time += dt;
    this._ctx.time = this.time;
    this._ctx.player = extras.player;
    this._ctx.zone = extras.zone || null;
    this._repathBudget = Config.BOT_REPATH_BUDGET;

    const n = this.list.length;
    if (n > 0) {
      // --- LOTE de decisão: perception + FSM de BOT_DECISION_BATCH bots ---
      const batch = Math.min(Config.BOT_DECISION_BATCH, n);
      for (let k = 0; k < batch; k++) {
        this.cursor = (this.cursor + 1) % n;
        const bot = this.list[this.cursor];
        if (!bot.alive) continue;
        this._perceive(bot, extras.player);
        bot.decide(this._ctx);
      }
      this._separate();
    }

    // --- integração de TODO bot, todo frame (movimento suave) ---
    for (const bot of this.list) bot.integrate(dt, this._ctx);

    // --- dano do gás (mesmo tick do jogador, decidido pelo Engine) ---
    if (extras.zoneTick && this._ctx.zone) {
      const zone = this._ctx.zone;
      for (const bot of this.list) {
        if (!bot.alive) continue;
        const dps = zone.dpsAt(bot.position.x, bot.position.z);
        if (dps > 0) bot.takeDamage(dps, 'zone', -1, { zone: true });
      }
    }

    this._updateTracers(dt);
    this._writeInstances();
  }

  _claimRepath() {
    if (this._repathBudget <= 0) return false;
    this._repathBudget -= 1;
    return true;
  }

  /**
   * Percepção (game-ai skill): barato → caro.
   * distância² → cone de visão → 1 raycast de linha de tiro.
   * Só o bot do lote atual paga o raycast.
   */
  _perceive(bot, player) {
    const b = bot.board;
    let best = null;
    let bestDsq = Config.BOT_VIEW_DISTANCE * Config.BOT_VIEW_DISTANCE;
    const fx = Math.sin(bot.yaw);
    const fz = Math.cos(bot.yaw);
    const cosHalf = Math.cos(Config.BOT_VIEW_FOV / 2);

    const consider = (t) => {
      if (!t || t === bot || !t.alive || t.team === bot.team) return;
      const dx = t.position.x - bot.position.x;
      const dz = t.position.z - bot.position.z;
      const dsq = dx * dx + dz * dz;
      if (dsq > bestDsq) return;
      const d = Math.sqrt(dsq) || 1e-3;
      if ((dx / d) * fx + (dz / d) * fz < cosHalf) return; // fora do cone de visão
      best = t;
      bestDsq = dsq;
    };
    if (player && player.alive) consider(player);
    for (const other of this.list) consider(other);

    b.target = best;
    if (!best) { b.canSee = false; b.dist = Math.sqrt(bestDsq); return; }

    b.dist = Math.sqrt(bestDsq);
    // linha de tiro: dois pontos (cabeça e peito) p/ cobertura baixa não enganar
    const from = this._dummy.position.set(bot.position.x, bot.position.y + 1.5, bot.position.z);
    const to = best.position;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const flat = Math.max(0.001, Math.hypot(dx, dz));
    const dirX = dx / flat;
    const dirZ = dz / flat;
    const cover = this.collision.rayDistance(from.x, from.z, from.y, dirX, dirZ, flat, 0.45, (to.y + 1.2 - from.y) / flat);
    b.canSee = cover >= flat - 0.4;
    if (b.canSee) b.lastKnown.set(to.x, to.y, to.z);
  }

  /** Separação por grade (game-ai skill: nada de O(n²) por par a cada frame). */
  _separate() {
    const cell = 4;
    const buckets = new Map();
    for (const bot of this.list) {
      if (!bot.alive) continue;
      const k = `${Math.floor(bot.position.x / cell)},${Math.floor(bot.position.z / cell)}`;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(bot);
    }
    for (const bot of this.list) {
      bot.separation.set(0, 0);
      if (!bot.alive) continue;
      const ix = Math.floor(bot.position.x / cell);
      const iz = Math.floor(bot.position.z / cell);
      for (let a = -1; a <= 1; a++) {
        for (let b = -1; b <= 1; b++) {
          const list = buckets.get(`${ix + a},${iz + b}`);
          if (!list) continue;
          for (const other of list) {
            if (other === bot) continue;
            const dx = bot.position.x - other.position.x;
            const dz = bot.position.z - other.position.z;
            const d = Math.hypot(dx, dz);
            if (d > 0.001 && d < 2.2) {
              const push = (2.2 - d) / 2.2;
              bot.separation.x += (dx / d) * push * 0.55;
              bot.separation.y += (dz / d) * push * 0.55;
            }
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------- tiro do bot
  _fireBotShot(bot) {
    const target = bot.board.target;
    if (!target || !target.alive) { bot.burstLeft = 0; return; }
    const from = { x: bot.position.x, y: bot.position.y + 1.5, z: bot.position.z };
    const aim = { x: target.position.x, y: target.position.y + (bot._aimHead ? 1.55 : 1.15), z: target.position.z };
    const dx = aim.x - from.x;
    const dy = aim.y - from.y;
    const dz = aim.z - from.z;
    const dist = Math.max(0.5, Math.hypot(dx, dy, dz));
    const dir = applyConeSpread({ x: dx / dist, y: dy / dist, z: dz / dist }, this._botSpread(bot), this._rng);

    // cobertura bloqueia o tiro do bot também
    const cover = this.collision.rayDistance(from.x, from.z, from.y, dir.x, dir.z, dist, 0.4, dir.y);
    const blocked = cover < dist - 0.5;
    const endT = blocked ? cover : dist;
    this._spawnTracer(
      from.x, from.y, from.z,
      from.x + dir.x * endT, from.y + dir.y * endT, from.z + dir.z * endT,
    );
    if (this.onTracer) this.onTracer(from, endT, bot);
    if (blocked) return;

    // acerto: sorteia pela precisão do nível (bots erram de propósito)
    const hitChance = this._hitChance(bot, dist, target);
    if (this._rng() > hitChance) return; // erro proposital (fps-shooter skill)
    const part = this._rng() < 0.14 ? 'head' : this._rng() < 0.75 ? 'torso' : 'legs';
    const mult = part === 'head' ? 2.2 : part === 'legs' ? 0.8 : 1;
    const damage = Config.BOT_DAMAGE * mult;
    if (target === this._ctx.player) {
      this.onPlayerDamage(damage, part, bot);
    } else {
      target.takeDamage(damage, part, bot.team, {
        fromPosition: bot.position, time: this.time, attackerName: bot.name,
      });
    }
    // bot que atira deixa de "ouvir" só o próprio tiro
    bot.engagedAt = this.time;
  }

  /** Erro proposital: longe + nível baixo = mais spread (nunca aimbot). */
  _botSpread(bot) {
    const levelFactor = 1.35 - bot.level * 0.9;
    const moving = Math.hypot(bot.velocity.x, bot.velocity.z) > 3 ? 1.5 : 1;
    const targetSpeed = bot.board.target && bot.board.target.velocity
      ? 1 + Math.min(1.4, Math.hypot(bot.board.target.velocity.x, bot.board.target.velocity.z) / 8)
      : 1;
    return Config.BOT_SPREAD_BASE * levelFactor * moving * targetSpeed;
  }

  _hitChance(bot, dist, target) {
    const acc = 0.28 + bot.level * 0.42;
    const rangeFall = Math.max(0.35, 1 - dist / 90);
    const moving = target.velocity ? Math.hypot(target.velocity.x, target.velocity.z) : 0;
    const targetPenalty = moving > 5 ? 0.72 : moving > 2 ? 0.88 : 1;
    return Math.max(0.08, Math.min(0.92, acc * rangeFall * targetPenalty));
  }

  _spawnTracer(x0, y0, z0, x1, y1, z1) {
    const t = this.tracers[this._tracerCursor];
    this._tracerCursor = (this._tracerCursor + 1) % this.tracers.length;
    t.life = 0.07;
    t.from.set(x0, y0, z0);
    t.to.set(x1, y1, z1);
  }

  _updateTracers(dt) {
    const dummy = this._dummy;
    for (let i = 0; i < this.tracers.length; i++) {
      const t = this.tracers[i];
      if (t.life > 0) {
        t.life -= dt;
        const mid = dummy;
        mid.position.set((t.from.x + t.to.x) / 2, (t.from.y + t.to.y) / 2, (t.from.z + t.to.z) / 2);
        mid.lookAt(t.to.x, t.to.y, t.to.z);
        const len = Math.max(0.5, t.from.distanceTo(t.to));
        mid.scale.set(1, 1, len);
        mid.updateMatrix();
        this.tracerMesh.setMatrixAt(i, mid.matrix);
        const on = t.life > 0;
        this._color.setRGB(on ? 1 : 0, on ? 0.78 : 0, on ? 0.4 : 0);
        this.tracerMesh.setColorAt(i, this._color);
      } else {
        dummy.position.set(0, -999, 0);
        dummy.scale.set(0.001, 0.001, 0.001);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        this.tracerMesh.setMatrixAt(i, dummy.matrix);
      }
    }
    this.tracerMesh.instanceMatrix.needsUpdate = true;
    if (this.tracerMesh.instanceColor) this.tracerMesh.instanceColor.needsUpdate = true;
  }

  _onBotKilled(bot, fromTeam, part, meta) {
    this.alive = Math.max(0, this.alive - 1);
    this.onKill({
      name: bot.name,
      team: bot.team,
      fromTeam,
      part,
      // abate do jogador é anunciado pelo Combat (lá é "VOCÊ eliminou ...")
      attackerName: meta && meta.byPlayer ? null : (meta && meta.attackerName) || null,
      zone: !!(meta && meta.zone),
    });
  }

  // ---------------------------------------------------------------- render
  /**
   * Um `Bot.writeTo` emite 6 matrizes na ordem fixa (torso, cabeça, braço E,
   * braço D, perna E, perna D) → cada uma vai para o seu InstancedMesh.
   * Cor por instância é reescrita só quando o flash de dano/estado muda
   * (escrever 44×6 cores por frame é trabalho de GPU desnecessário).
   */
  _writeInstances() {
    const dummy = this._dummy;
    const meshes = this.partMeshes;
    const color = this._color;
    for (let i = 0; i < Config.BOT_MAX; i++) {
      const bot = this.list[i];
      if (!bot || bot.hidden) {
        // slot livre: encolhe p/ fora da vista (nunca re-alocar o buffer)
        dummy.position.set(0, -999, 0);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(0.0001, 0.0001, 0.0001);
        dummy.updateMatrix();
        for (const mesh of meshes) mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }
      let part = 0;
      bot.writeTo(dummy, (matrix) => {
        if (part < meshes.length) meshes[part++].setMatrixAt(i, matrix);
      });

      const flashChanged = Math.abs(bot.hitFlash - (bot._flashWritten ?? -1)) > 0.02;
      const aliveChanged = bot.alive !== bot._aliveWritten;
      if (flashChanged || aliveChanged) {
        bot._flashWritten = bot.hitFlash;
        bot._aliveWritten = bot.alive;
        const shade = bot.alive ? 1 : 0.32;
        const f = bot.hitFlash * 0.85;
        const base = bot.team === 0
          ? [0.34 + bot.tint * 0.1, 0.72, 0.44]
          : [0.7, 0.4 + bot.tint * 0.12, 0.28];
        color.setRGB(
          Math.min(1, base[0] * shade + f),
          Math.min(1, base[1] * shade + f),
          Math.min(1, base[2] * shade + f),
        );
        for (const mesh of meshes) mesh.setColorAt(i, color);
        for (const mesh of meshes) {
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
      }
    }
    for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
  }

  /** Alvo p/ o hitscan do jogador: posição + hitbox + time + takeDamage. */
  targetsFor() {
    return this.list;
  }

  /** Quantos BOTS seguem vivos (o jogador é contado por quem pergunta). */
  get aliveCount() {
    return this.alive;
  }

  dispose() {
    this.despawn();
    for (const mesh of this.partMeshes) {
      mesh.material.dispose();
      this.scene.remove(mesh);
    }
    this.partMeshes.length = 0;
    if (this._partGeo) this._partGeo.dispose();
    this.tracerMesh.geometry.dispose();
    this.tracerMesh.material.dispose();
    this.scene.remove(this.tracerMesh);
    this.list.length = 0;
  }
}
