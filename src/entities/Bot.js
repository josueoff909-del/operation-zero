import * as THREE from 'three';
import { Config } from '../core/Config.js';

/**
 * Bot.js — Um bot de combate (Fase 9 antecipada no essencial).
 *
 * Máquina de estados com **histerese** (game-ai skill: limiar de entrada ≠
 * limiar de saída + tempo mínimo em estado), alimentada por um *blackboard*
 * que o `Bots` escreve 1× por tick de decisão:
 *
 *   PATROL      → anda por waypoints do NavGrid (loot/rotação)
 *   INVESTIGATE → vai à última posição conhecida, procura, volta a patrulhar
 *   ATTACK      → mantém banda de distância, faz strafe, atira em rajadas
 *   REPOSITION  → apanhou muito e está com pouca vida: sai da linha de tiro
 *   DEAD        → colapsa e some depois de BOT_CORPSE_LIFE
 *
 * O bot nunca faz raycast dentro de `decide` (regra da skill: percepção é
 * escrita uma vez e lida por todos), e o caminho vem do NavGrid com budget
 * de re-path controlado por quem agenda.
 *
 * Sem mesh próprio: `Bots` desenha todos com `InstancedMesh` (Skill §1 — os
 * 44 bots são 6 draw calls, não 264). Este módulo só produz os dados de
 * transform/anim em `writeTo(dummy)`.
 */
export const BOT_STATE = {
  PATROL: 'PATROL',
  INVESTIGATE: 'INVESTIGATE',
  ATTACK: 'ATTACK',
  REPOSITION: 'REPOSITION',
  DEAD: 'DEAD',
};

const MIN_STATE_TIME = 0.4; // anti-flicker (game-ai skill)

export class Bot {
  constructor(id, team, level, name) {
    this.id = id;
    this.team = team;
    this.level = level; // 0..1 (mira, reação, agressão)
    this.name = name;

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.health = Config.BOT_HP;
    this.maxHealth = Config.BOT_HP;
    this.alive = true;
    this.state = BOT_STATE.PATROL;
    this.stateTime = 0;
    this.onKilledBy = null; // (attackerTeam) => {}

    // Hitbox p/ o Combat do jogador (cápsula vertical)
    this.hitRadius = 0.4;
    this.hitHeight = 1.8;

    // Blackboard (escrito pelo Bots._perceive)
    this.board = {
      target: null,
      dist: 0,
      canSee: false,
      lastKnown: new THREE.Vector3(),
      heardAt: -99,
      heardPos: new THREE.Vector3(),
      aimYaw: 0,
      aimPitch: 0,
    };

    // Navegação
    this.path = [];
    this.pathIndex = 0;
    this.waypoint = null;
    this.pathAge = 0;
    this.needsRepath = false;
    this.progressAnchor = new THREE.Vector3();
    this.progressTimer = 0;
    this.strafe = 1;
    this.strafeTimer = 0;
    this.wishX = 0;
    this.wishZ = 0;
    this.wishSpeed = 0;
    this.hasWish = false;
    this.separation = new THREE.Vector2();

    // Tiro
    this.reactionAt = 0;
    this.burstLeft = 0;
    this.fireTimer = 0;
    this.engagedAt = -99;

    // Visual/estado
    this.animPhase = 0;
    this.hitFlash = 0;
    this.deathTimer = 0;
    this.hidden = true;
    this.tint = 0.5;

    this._tmp = new THREE.Vector3();
    this.unstickTimer = 0; // "desgrudar" ativo (contornar quina)
    // alvo de steering reutilizado (zero alocação por frame)
    this._steer = { x: 0, z: 0 };
  }

  get feetY() {
    return this.position.y;
  }

  spawnAt(x, y, z, rng) {
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this.yaw = rng() * Math.PI * 2;
    this.health = this.maxHealth;
    this.alive = true;
    this.hidden = false;
    this.state = BOT_STATE.PATROL;
    this.stateTime = 0;
    this.path.length = 0;
    this.pathIndex = 0;
    this.waypoint = null;
    this.needsRepath = true;
    this.reactionAt = 0;
    this.burstLeft = 0;
    this.fireTimer = 0;
    this.deathTimer = 0;
    this.hitFlash = 0;
    this.tint = rng();
    this.board.target = null;
    this.board.canSee = false;
    this.board.lastKnown.copy(this.position);
    this.progressAnchor.copy(this.position);
  }

  /** Dano externo (jogador / outro bot). */
  takeDamage(amount, part, fromTeam, meta) {
    if (!this.alive) return { died: false, credits: false };
    this.health -= amount;
    this.hitFlash = 1;
    // apanhar = saber de onde veio (game-ai: hearing/awareness)
    if (meta && meta.fromPosition) {
      this.board.lastKnown.copy(meta.fromPosition);
      this.board.heardPos.copy(meta.fromPosition);
      // quem atirou vira "ouvido": o bot investiga a origem do disparo
      this.board.heardAt = meta.time ?? 0;
    }
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.state = BOT_STATE.DEAD;
      this.deathTimer = Config.BOT_CORPSE_LIFE;
      if (this.onKilledBy) this.onKilledBy(fromTeam, part, meta);
      return { died: true, credits: fromTeam === 0, part };
    }
    // ser atingido enquanto patrulha → investigate imediato
    if (this.state === BOT_STATE.PATROL) this._go(BOT_STATE.INVESTIGATE, { force: true });
    return { died: false, part };
  }

  /**
   * Troca de estado com **histerese temporal**: sem tempo mínimo em estado,
   * o limiar de visão ligado/desligado faz o bot piscar entre estados
   * (game-ai skill: ">2 transições/s = falta histerese").
   */
  _go(next, opts = {}) {
    if (this.state === next) return;
    if (!opts.force && this.stateTime < MIN_STATE_TIME && this.state !== BOT_STATE.DEAD) return;
    this.state = next;
    this.stateTime = 0;
    this.needsRepath = true;
  }

  /**
   * Decisão — chamada em lote (Config.BOT_DECISION_BATCH bots por frame).
   * Só lê o blackboard; nada de raycast aqui.
   */
  decide(ctx) {
    if (!this.alive) return;
    const b = this.board;
    const time = ctx.time;

    // --- transições com histerese espacial (entra a 44 m, solta a 60 m) ---
    if (this.state !== BOT_STATE.REPOSITION) {
      const seesFight = time - b.heardAt < 3.5;
      if (this.state === BOT_STATE.ATTACK) {
        const lostSight = !b.canSee && time - this.engagedAt > 3;
        if (b.dist > Config.BOT_ATTACK_EXIT || lostSight) {
          this._go(BOT_STATE.INVESTIGATE);
        }
      } else if ((b.canSee && b.dist < Config.BOT_VIEW_DISTANCE) || (seesFight && b.dist < Config.BOT_VIEW_DISTANCE)) {
        if (this.state === BOT_STATE.ATTACK || b.canSee || seesFight) {
          if (b.canSee && b.dist < Config.BOT_ATTACK_ENTER) {
            this._go(BOT_STATE.ATTACK);
            // reação humana, não aimbot (fps-shooter skill: 0.3–0.6 s)
            if (this.reactionAt < time) {
              this.reactionAt = time + THREE.MathUtils.lerp(Config.BOT_REACTION_MAX, Config.BOT_REACTION_MIN, this.level);
            }
          } else {
            this._go(BOT_STATE.INVESTIGATE);
          }
        }
      } else if (this.state === BOT_STATE.INVESTIGATE) {
        const arrived = b.lastKnown.distanceTo(this.position) < 3;
        if (arrived && time - this.engagedAt > 4) this._go(BOT_STATE.PATROL);
      }
    }

    // --- fujão: levou dano recente e está com pouca vida ---
    if (this.state === BOT_STATE.ATTACK && this.health < this.maxHealth * 0.3 && this.hitFlash > 0.5) {
      this._go(BOT_STATE.REPOSITION);
    }

    switch (this.state) {
      case BOT_STATE.ATTACK: {
        this.engagedAt = time;
        if (b.target) {
          const toX = b.target.position.x - this.position.x;
          const toZ = b.target.position.z - this.position.z;
          b.aimYaw = Math.atan2(toX, toZ); // yaw do modelo (olhar p/ +Z local)
          const flat = Math.max(0.5, Math.hypot(toX, toZ));
          b.aimPitch = Math.atan2((b.target.position.y + 1.3) - (this.position.y + 1.4), flat);
          // mantém a banda de distância + strafe (nunca corre em linha reta p/ cima)
          this.strafeTimer -= ctx.dtTick;
          if (this.strafeTimer <= 0) {
            this.strafe = Math.random() < 0.5 ? -1 : 1;
            this.strafeTimer = 0.9 + Math.random() * 1.4;
          }
          let forward = 0;
          if (b.dist > Config.BOT_KEEP_DISTANCE_MAX) forward = 1;
          else if (b.dist < Config.BOT_KEEP_DISTANCE_MIN) forward = -1;
          this._setWish(toX, toZ, forward, 0.65 * this.strafe);
          if (b.canSee) this._startBurst();
        }
        break;
      }
      case BOT_STATE.REPOSITION: {
        if (this.stateTime > 2.4) {
          this._go(BOT_STATE.INVESTIGATE);
          break;
        }
        const awayX = this.position.x - b.lastKnown.x;
        const awayZ = this.position.z - b.lastKnown.z;
        this._setWish(awayX, awayZ, -1, 0.8 * this.strafe);
        break;
      }
      case BOT_STATE.INVESTIGATE: {
        this._steerTo(b.lastKnown.x, b.lastKnown.z, ctx);
        const t = this._nextNode(b.lastKnown.x, b.lastKnown.z);
        this._setWish(t.x - this.position.x, t.z - this.position.z, 1, 0.2 * this.strafe);
        break;
      }
      default: { // PATROL
        if (!this.waypoint) this._pickWaypoint(ctx);
        else if (Math.hypot(this.waypoint.x - this.position.x, this.waypoint.z - this.position.z) < Config.NAV_WAYPOINT_RADIUS) this._pickWaypoint(ctx);
        if (this.waypoint) {
          this._steerTo(this.waypoint.x, this.waypoint.z, ctx);
          const t = this._nextNode(this.waypoint.x, this.waypoint.z);
          this._setWish(t.x - this.position.x, t.z - this.position.z, 1, 0);
        }
      }
    }
  }

  /** Direção desejada (mundo) a partir de vetor alvo + avanço + strafe. */
  _setWish(dx, dz, forward, strafeAmount) {
    if (this.unstickTimer > 0) {
      const ang = (this.strafe >= 0 ? 1 : -1) * (Math.PI / 3);
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const rx = dx * c - dz * s;
      const rz = dx * s + dz * c;
      dx = rx;
      dz = rz;
    }
    const len = Math.hypot(dx, dz) || 1;
    const fx = dx / len;
    const fz = dz / len;
    const sx = -fz * this.strafe;
    const sz = fx * this.strafe;
    let wx = fx * forward + sx * Math.abs(strafeAmount);
    let wz = fz * forward + sz * Math.abs(strafeAmount);
    // separação (steering leve p/ não empilhar bots no mesmo ponto)
    wx += this.separation.x;
    wz += this.separation.y;
    const wl = Math.hypot(wx, wz);
    if (wl > 1e-4) {
      this.wishX = wx / wl;
      this.wishZ = wz / wl;
      this.wishSpeed = this.state === BOT_STATE.ATTACK || this.state === BOT_STATE.REPOSITION
        ? Config.BOT_SPEED_RUN
        : Config.BOT_SPEED_WALK;
      this.hasWish = true;
    } else {
      this.hasWish = false;
    }
  }

  /**
   * Para onde andar AGORA: o próximo nó do A*, não o destino final.
   * Errar aqui é o clássico "o bot encosta na parede e empurra para sempre":
   * o caminho existia mas ninguém olhava para ele (game-ai skill / pathfinding).
   */
  _nextNode(tx, tz) {
    if (this.path.length && this.pathIndex < this.path.length) {
      const node = this.path[this.pathIndex];
      if (node) return node;
    }
    this._steer.x = tx;
    this._steer.z = tz;
    return this._steer;
  }

  _steerTo(x, z, ctx) {
    if (!ctx.nav) return;
    const far = Math.hypot(x - this.position.x, z - this.position.z);
    if (far > 12 && (this.needsRepath || this.pathAge > 4)) this._repath(x, z, ctx);
  }

  _repath(x, z, ctx) {
    if (ctx.claimRepath && !ctx.claimRepath()) return; // budget anti-hitch
    const path = ctx.nav.findPath(this.position.x, this.position.z, x, z);
    if (path.length) {
      this.path = path;
      this.pathIndex = 0;
    }
    this.pathAge = 0;
    this.needsRepath = false;
  }

  _pickWaypoint(ctx) {
    const p = ctx.nav
      ? ctx.nav.randomFreeNear(this.position.x, this.position.z, 18, 60, ctx.rng,
        (x, z, r) => ctx.collision.isBlockedCircle(x, z, r))
      : { x: this.position.x + 10, z: this.position.z + 10 };
    this.waypoint = p;
    this.progressAnchor.copy(this.position);
    this.progressTimer = 0;
    if (ctx.nav) this._repath(p.x, p.z, ctx);
  }

  /** Começa uma rajada (o disparo real sai em integrate, no relógio do bot). */
  _startBurst() {
    if (this.burstLeft > 0 || this.fireTimer > 0) return;
    const min = Config.BOT_BURST_MIN;
    const max = Config.BOT_BURST_MAX;
    this.burstLeft = min + Math.floor(Math.random() * (max - min + 1));
    this.fireTimer = 0.05;
  }

  /**
   * Integração física — todo frame, p/ TODOS os bots (Suave a 60 FPS,
   * Skill §4: só a decisão é em lote).
   */
  integrate(dt, ctx) {
    if (!this.alive) {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) this.hidden = true;
      return;
    }
    this.stateTime += dt;
    this.pathAge += dt;
    if (this.unstickTimer > 0) this.unstickTimer = Math.max(0, this.unstickTimer - dt);
    if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt * 4);

    // --- velocidade desejada ---
    const accel = Math.min(1, dt * 9);
    const dvx = (this.hasWish ? this.wishX * this.wishSpeed : 0) - this.velocity.x;
    const dvz = (this.hasWish ? this.wishZ * this.wishSpeed : 0) - this.velocity.z;
    this.velocity.x += dvx * accel;
    this.velocity.z += dvz * accel;

    // --- mover + colidir (mesma função do jogador: não atravessa nada) ---
    this.position.x += this.velocity.x * dt;
    ctx.collision.resolveCircle(this.position, Config.BOT_RADIUS, this.position.y);
    this.position.z += this.velocity.z * dt;
    ctx.collision.resolveCircle(this.position, Config.BOT_RADIUS, this.position.y);

    // --- chão ---
    let groundY = ctx.terrain.getHeightAt(this.position.x, this.position.z);
    const boxGround = ctx.collision.getGroundHeight(this.position.x, this.position.z, this.position.y);
    if (boxGround > groundY) groundY = boxGround;
    if (this.position.y < groundY) {
      this.position.y = groundY;
      this.velocity.y = 0;
    } else if (this.position.y > groundY + 0.05) {
      this.velocity.y -= Config.PLAYER_GRAVITY * dt;
      this.position.y += this.velocity.y * dt;
      if (this.position.y < groundY) { this.position.y = groundY; this.velocity.y = 0; }
    }
    ctx.terrain.clampToWorld(this.position, Config.BOT_RADIUS);

    // --- yaw suave em direção ao alvo quando atirando, senão à direção do movimento ---
    const moving = Math.hypot(this.velocity.x, this.velocity.z) > 0.4;
    let yawTarget = this.state === BOT_STATE.ATTACK && this.board.target
      ? this.board.aimYaw
      : moving ? Math.atan2(this.velocity.x, this.velocity.z) : this.yaw;
    let diff = yawTarget - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += diff * Math.min(1, dt * 8);

    // --- progresso / anti-"preso" (game-ai skill: <0.5u em 2s = travado) ---
    this.progressTimer += dt;
    if (this.progressTimer >= Config.NAV_STUCK_TIME) {
      const moved = Math.hypot(this.position.x - this.progressAnchor.x, this.position.z - this.progressAnchor.z);
      if (moved < Config.NAV_STUCK_PROGRESS) {
        this.needsRepath = true;
        if (this.state !== BOT_STATE.ATTACK) this.waypoint = null; // escolhe outro destino
        this.strafe = Math.random() < 0.5 ? -1 : 1;
        // impulso de desgrudar: por ~0.5s o desejo gira 60 graus, o que faz o
        // bot contornar a quina em vez de empurrar a parede (steering puro
        // trava em quina porque o "push out" do resolveCircle cancela o avanço)
        this.unstickTimer = 0.5;
      }
      this.progressAnchor.copy(this.position);
      this.progressTimer = 0;
    }

    // --- seguir o caminho (avança quando dentro do raio do waypoint) ---
    if (this.path.length) {
      const node = this.path[this.pathIndex];
      if (node) {
        const advance = Math.max(Config.NAV_WAYPOINT_RADIUS, Math.hypot(this.velocity.x, this.velocity.z) * dt);
        if (Math.hypot(node.x - this.position.x, node.z - this.position.z) <= advance) {
          this.pathIndex += 1;
          if (this.pathIndex >= this.path.length) { this.path.length = 0; this.pathIndex = 0; this.needsRepath = true; }
        }
      }
    }

    // --- animação ---
    this.animPhase += dt * (moving ? (this.wishSpeed > 5 ? 10 : 6.5) : 1.6);

    // --- tiro do bot (rajadas com cadência própria) ---
    if (this.state === BOT_STATE.ATTACK && this.burstLeft > 0) {
      this.fireTimer -= dt;
      if (this.fireTimer <= 0) {
        if (this.reactionAt <= ctx.time) {
          ctx.fireBotShot(this);
          this.burstLeft -= 1;
          this.engagedAt = ctx.time;
          this.fireTimer = Config.BOT_FIRE_INTERVAL;
        } else {
          this.fireTimer = 0.05; // ainda dentro do tempo de reação
        }
        if (this.burstLeft <= 0) this.fireTimer = 0.7 + Math.random() * 1.1;
      }
    } else if (this.fireTimer > 0) {
      this.fireTimer -= dt;
    }
  }

  /** Escreve as partes do corpo no writer do Bots (InstancedMesh compartilhado). */
  writeTo(dummy, setAt, scale = 1) {
    const yaw = this.yaw;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const p = this.position;
    const swing = Math.sin(this.animPhase) * (this.alive ? 1 : 0);
    const collapsed = this.alive ? 0 : 1;
    const lean = collapsed ? 0 : Math.sin(this.animPhase * 2) * 0.02;
    const baseY = p.y + (collapsed ? -0.55 : 0);
    const rotX = collapsed ? Math.PI / 2 : lean;

    const put = (ox, oy, oz, sx, sy, sz, rx = rotX, rz = 0) => {
      const wx = p.x + ox * cos + oz * sin;
      const wz = p.z - ox * sin + oz * cos;
      dummy.position.set(wx, baseY + oy, wz);
      dummy.rotation.set(rx, yaw, rz);
      dummy.scale.set(sx * scale, sy * scale, sz * scale);
      dummy.updateMatrix();
      setAt(dummy.matrix);
    };

    put(0, 1.12, 0, 0.56, 0.66, 0.34);          // torso
    put(0, 1.62, 0.02, 0.3, 0.3, 0.3);          // cabeça
    put(-0.4, 1.18 + swing * 0.02, 0.06, 0.16, 0.55, 0.16, rotX - 0.5, 0); // braço esq
    put(0.4, 1.18 - swing * 0.02, 0.06, 0.16, 0.55, 0.16, rotX - 0.5, 0);  // braço dir
    put(-0.16, 0.42, swing * 0.16, 0.2, 0.84, 0.22);      // perna esq
    put(0.16, 0.42, -swing * 0.16, 0.2, 0.84, 0.22);      // perna dir
  }

  get displayName() {
    return this.name;
  }
}
