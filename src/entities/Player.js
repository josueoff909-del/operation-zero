import * as THREE from 'three';
import { Config } from '../core/Config.js';
import { intersectCylinder } from '../utils/Hitbox.js';

/**
 * Player.js — Controlador FPS + combatente (Fases 1–2 → combate).
 *
 * Mantém o núcleo das Fases 1–2 (Euler 'YXZ', agachar, ADS, sprint com
 * abertura de FOV, head bob, colisão por eixos) e adiciona o que o pedido
 * atual pede:
 *  • vida/dano/morte (p/ os bots serem jogáveis);
 *  • recuo como OFFSET que decai a zero — a fps-shooter skill avisa do
 *    contrário: escrever recuo no ângulo de olhar "briga" com o jogador;
 *  • sensibilidade de ADS = tan(adsFov/2)/tan(hipFov/2) (fórmula da skill),
 *    não um número chutado;
 *  • clamp de pitch em ±89° e hitbox cilíndrica p/ os tiros inimigos.
 *
 * A Fase 3 converte p/ 3ª pessoa reaproveitando exatamente este núcleo.
 */
export class Player {
  constructor(camera, terrain, collision = null) {
    this.camera = camera;
    this.terrain = terrain;
    this.collision = collision;
    this.position = new THREE.Vector3(); // pés do jogador
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = true;

    this.crouching = false;
    this.aiming = false;
    this.sprinting = false;
    this.speed = 0;
    this.eyeHeight = Config.PLAYER_EYE_HEIGHT;
    this.fov = Config.BASE_FOV;
    this.adsFov = 50;
    this.bobPhase = 0;
    this.bobAmp = 0;

    // Combate
    this.team = 0;
    this.health = Config.PLAYER_HEALTH;
    this.maxHealth = Config.PLAYER_HEALTH;
    this.alive = true;
    this.kills = 0;
    this.lastHitAt = -99;
    this.onDamaged = null;
    this.onDeath = null;

    // Recuo (offset que decai — nunca somado ao olhar de forma permanente)
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.recoilHold = 0;
    this.recoilDelay = 0.35;
    this.recoilSpeed = 6;

    this.hitFlash = 0;

    // Spawn na rua em cruz, no centro da cidade
    this.reset(0, 8);
  }

  reset(x = 0, z = 8) {
    this.position.set(x, this.terrain.getHeightAt(x, z), z);
    this.velocity.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.health = this.maxHealth;
    this.alive = true;
    this.crouching = false;
    this.aiming = false;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.hitFlash = 0;
    this.onGround = true;
    this._syncCamera();
  }

  /** Arma equipada define o FOV do ADS (e a sensibilidade vem dele). */
  setWeapon(weapon) {
    if (!weapon) return;
    this.adsFov = weapon.adsFov ?? Config.BASE_FOV;
    this.recoilDelay = weapon.recoilRecoverDelay ?? 0.35;
    this.recoilSpeed = weapon.recoilRecoverSpeed ?? 6;
  }

  /**
   * Deltas de olhar em RADIANOS (InputManager já aplicou a sensibilidade).
   * ADS reduz pela razão das tangentes do meio-FOV (fps-shooter skill): o
   * retículo varre o alvo na mesma velocidade de tela quando se zooma.
   */
  applyLook(deltaX, deltaY, aiming = false) {
    const s = aiming ? this.adsSensitivity() : 1;
    this.yaw -= deltaX * s;
    this.pitch -= deltaY * s;
    this.pitch = Math.max(-Config.PITCH_LIMIT, Math.min(Config.PITCH_LIMIT, this.pitch));
  }

  adsSensitivity() {
    const half = (deg) => Math.tan((deg * Math.PI) / 180 / 2);
    return half(this.adsFov) / half(Config.BASE_FOV);
  }

  /** Recuo do disparo: entra como offset somado à câmera e decai sozinho. */
  applyRecoil(pitchAmount, yawAmount = 0) {
    this.recoilPitch += pitchAmount;
    this.recoilYaw += yawAmount;
    this.recoilHold = this.recoilDelay;
  }

  takeDamage(amount, part = 'torso') {
    if (!this.alive || amount <= 0) return 0;
    const applied = Math.min(this.health, amount);
    this.health -= applied;
    this.hitFlash = 1;
    if (this.onDamaged) this.onDamaged(applied, part);
    if (this.health <= 0) {
      this.alive = false;
      if (this.onDeath) this.onDeath();
    }
    return applied;
  }

  heal(amount) {
    const before = this.health;
    this.health = Math.min(this.maxHealth, this.health + amount);
    return this.health - before;
  }

  /** Teste de tiro inimigo contra a cápsula do jogador. */
  hitTest(origin, dir, maxDist = Infinity) {
    const height = this.crouching ? Config.PLAYER_HEIGHT * 0.68 : Config.PLAYER_HEIGHT;
    const o = intersectCylinder(
      origin.x, origin.y, origin.z, dir.x, dir.y, dir.z,
      this.position.x, this.position.z, this.position.y,
      Config.PLAYER_HIT_RADIUS, height,
    );
    return o && o.t <= maxDist ? o : null;
  }

  /**
   * @param {number} dt delta já limitado (≤ 0.05) pelo Loop
   * @param {{move:{x:number,y:number},jump:boolean,sprint:boolean,crouch:boolean,aiming:boolean,locked:boolean}} input
   */
  update(dt, input) {
    const active = input.locked !== false && this.alive;
    this.crouching = active && !!input.crouch;
    this.aiming = active && !!input.aiming;
    this.sprinting = active && !!input.sprint && !this.crouching && !this.aiming;

    const moveX = active ? input.move.x : 0;
    const moveY = active ? input.move.y : 0;

    // --- Direção desejada no plano XZ, relativa ao yaw ---
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const wishX = -sin * moveY + cos * moveX;
    const wishZ = -cos * moveY - sin * moveX;

    let speedMult = 1;
    if (this.crouching) speedMult = Config.PLAYER_CROUCH_SPEED_MULT;
    else if (this.aiming) speedMult = Config.ADS_SPEED_MULT;
    else if (this.sprinting) speedMult = Config.PLAYER_SPRINT_MULT;
    const speed = Config.PLAYER_SPEED * speedMult;
    this.velocity.x = wishX * speed;
    this.velocity.z = wishZ * speed;
    this.speed = Math.hypot(this.velocity.x, this.velocity.z);

    // --- Movimento por eixo + colisão (desliza nas paredes, não prende) ---
    this.position.x += this.velocity.x * dt;
    this._resolve();
    this.position.z += this.velocity.z * dt;
    this._resolve();

    // --- Gravidade / pulo ---
    if (active && input.jump && this.onGround) {
      this.velocity.y = Config.PLAYER_JUMP_VELOCITY;
      this.onGround = false;
    }
    this.velocity.y -= Config.PLAYER_GRAVITY * dt;
    this.position.y += this.velocity.y * dt;

    // --- Chão = terreno OU topo de caixa/pedra subível ---
    let groundY = this.terrain.getHeightAt(this.position.x, this.position.z);
    if (this.collision) {
      const boxGround = this.collision.getGroundHeight(this.position.x, this.position.z, this.position.y);
      if (boxGround > groundY) groundY = boxGround;
    }
    if (this.position.y <= groundY) {
      this.position.y = groundY;
      this.velocity.y = 0;
      this.onGround = true;
    } else if (this.position.y > groundY + 0.05) {
      this.onGround = false;
    }

    this.terrain.clampToWorld(this.position, Config.PLAYER_RADIUS);

    // --- Recuo decai p/ zero (depois do delay sem atirar) ---
    if (this.recoilHold > 0) this.recoilHold -= dt;
    else {
      const k = Math.min(1, dt * this.recoilSpeed);
      this.recoilPitch += (0 - this.recoilPitch) * k;
      this.recoilYaw += (0 - this.recoilYaw) * k;
    }
    if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt * 3.2);

    // --- Altura do olho / FOV / bob ---
    const eyeTarget = this.crouching ? Config.PLAYER_CROUCH_EYE_HEIGHT : Config.PLAYER_EYE_HEIGHT;
    this.eyeHeight += (eyeTarget - this.eyeHeight) * Math.min(1, dt * 10);

    let fovTarget = Config.BASE_FOV;
    if (this.aiming) fovTarget = this.adsFov;
    else if (this.sprinting && this.speed > 1) fovTarget = Config.SPRINT_FOV;
    this.fov += (fovTarget - this.fov) * Math.min(1, dt * 8);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    const moving = this.speed > 0.5 && this.onGround;
    const bobTarget = moving ? (this.sprinting ? 0.05 : 0.03) : 0;
    this.bobAmp += (bobTarget - this.bobAmp) * Math.min(1, dt * 8);
    if (moving) this.bobPhase += dt * (this.sprinting ? 11 : 8);

    this._syncCamera();
  }

  /** Colisão com o mundo (parede/tronco/pedra) — regra: nunca atravessar. */
  _resolve() {
    if (this.collision) this.collision.resolveCircle(this.position, Config.PLAYER_RADIUS, this.position.y);
  }

  _syncCamera() {
    const bobY = Math.sin(this.bobPhase * 2) * this.bobAmp;
    const roll = Math.sin(this.bobPhase) * this.bobAmp * 0.2;
    this.camera.position.set(
      this.position.x,
      this.position.y + this.eyeHeight + bobY,
      this.position.z,
    );
    // recuo entra NA CÂMERA (offset), não no ângulo de olhar do jogador
    this.camera.rotation.set(
      Math.max(-Config.PITCH_LIMIT, Math.min(Config.PITCH_LIMIT, this.pitch + this.recoilPitch)),
      this.yaw + this.recoilYaw,
      roll,
    );
  }

  /** Direção que a arma efetivamente aponta (com o recuo aplicado). */
  getAimDirection(out = new THREE.Vector3()) {
    return out.set(0, 0, -1).applyEuler(this.camera.rotation);
  }

  getPosition() {
    return this.position;
  }

  getSpeed() {
    return this.speed;
  }

  getHealthRatio() {
    return this.maxHealth > 0 ? this.health / this.maxHealth : 0;
  }

  getState() {
    if (!this.alive) return 'ELIMINADO';
    if (this.crouching) return 'AGACHADO';
    if (this.aiming) return 'MIRANDO';
    if (this.sprinting && this.speed > 1) return 'CORRENDO';
    return 'EM PÉ';
  }
}
