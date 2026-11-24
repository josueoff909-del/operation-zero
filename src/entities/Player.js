import * as THREE from 'three';
import { Config } from '../core/Config.js';

/**
 * Player.js — Controlador do jogador FPS (Fases 1–2).
 *
 * - Câmera em 1ª pessoa com Euler 'YXZ' (Skill §3: sem Gimbal Lock).
 * - Movimento relativo ao yaw, gravidade, pulo e chão = terreno
 *   (ou topo de crate/caixa baixa, via CollisionWorld).
 * - Fase 2: agachar (olho mais baixo + lento), ADS (FOV 75→50 +
 *   sensibilidade reduzida), sprint com abertura de FOV, head bob
 *   e colisão sólida contra prédios/coberturas (eixos separados).
 * - A Fase 3 converterá p/ 3ª pessoa over-the-shoulder reaproveitando
 *   este núcleo de movimento (velocidade, gravidade, pulo, colisão).
 */
export class Player {
  constructor(camera, terrain, collision = null) {
    this.camera = camera;
    this.terrain = terrain;
    this.collision = collision;
    this.position = new THREE.Vector3(0, 0, 0); // pés do jogador
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = true;

    // Estado da Fase 2.
    this.crouching = false;
    this.aiming = false;
    this.sprinting = false;
    this.speed = 0; // velocidade horizontal atual (p/ viewmodel/HUD)
    this.eyeHeight = Config.PLAYER_EYE_HEIGHT;
    this.fov = Config.BASE_FOV;
    this.bobPhase = 0;
    this.bobAmp = 0;

    // Spawn: centro do mapa, sobre o terreno (rua em cruz da cidade).
    this.position.set(0, terrain.getHeightAt(0, 0), 8);
    this._syncCamera();
  }

  /**
   * Aplica deltas de olhar em RADIANOS (InputManager já aplicou a
   * sensibilidade base). Ao mirar (ADS), a sensibilidade cai p/ precisão.
   */
  applyLook(deltaX, deltaY, aiming = false) {
    const s = aiming ? Config.ADS_SENS_MULT : 1;
    this.yaw -= deltaX * s;
    this.pitch -= deltaY * s;
    // Limita o pitch p/ não virar a câmera de cabeça p/ baixo.
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
  }

  /** Coice de câmera ao atirar (chamado pelo Engine a cada disparo). */
  applyRecoil(amount) {
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + amount));
  }

  /**
   * Atualiza física e câmera. `input` = { move, jump, sprint, crouch, aiming }.
   * `dt` já vem limitado (≤ 0.05) pelo Loop.
   */
  update(dt, input) {
    this.crouching = !!input.crouch;
    this.aiming = !!input.aiming;
    this.sprinting = !!input.sprint && !this.crouching && !this.aiming;

    // --- Direção desejada no plano XZ, relativa ao yaw ---
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // Frente = (-sin(yaw), -cos(yaw)); Direita = (cos(yaw), -sin(yaw))
    const wishX = (-sin * input.move.y) + (cos * input.move.x);
    const wishZ = (-cos * input.move.y) + (-sin * input.move.x);

    let speedMult = 1;
    if (this.crouching) speedMult = Config.PLAYER_CROUCH_SPEED_MULT;
    else if (this.aiming) speedMult = Config.ADS_SPEED_MULT;
    else if (this.sprinting) speedMult = Config.PLAYER_SPRINT_MULT;
    const speed = Config.PLAYER_SPEED * speedMult;
    // Aceleração simples e direta (protótipo): velocidade horizontal = desejo * speed.
    this.velocity.x = wishX * speed;
    this.velocity.z = wishZ * speed;
    this.speed = Math.hypot(this.velocity.x, this.velocity.z);

    // --- Movimento por eixos separados + colisão (desliza nas paredes) ---
    this.position.x += this.velocity.x * dt;
    if (this.collision) this.collision.resolveCircle(this.position, Config.PLAYER_RADIUS, this.position.y);
    this.position.z += this.velocity.z * dt;
    if (this.collision) this.collision.resolveCircle(this.position, Config.PLAYER_RADIUS, this.position.y);

    // --- Gravidade / pulo ---
    if (input.jump && this.onGround) {
      this.velocity.y = Config.PLAYER_JUMP_VELOCITY;
      this.onGround = false;
    }
    this.velocity.y -= Config.PLAYER_GRAVITY * dt;
    this.position.y += this.velocity.y * dt;

    // --- Chão = terreno ou topo de caixa baixa (crate/mesa/muro) ---
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

    // --- Bordas do mundo ---
    this.terrain.clampToWorld(this.position, Config.PLAYER_RADIUS);

    // --- Altura do olho (agachar) com transição suave ---
    const eyeTarget = this.crouching ? Config.PLAYER_CROUCH_EYE_HEIGHT : Config.PLAYER_EYE_HEIGHT;
    this.eyeHeight += (eyeTarget - this.eyeHeight) * Math.min(1, dt * 10);

    // --- FOV: ADS fecha, sprint abre ---
    let fovTarget = Config.BASE_FOV;
    if (this.aiming) fovTarget = Config.ADS_FOV;
    else if (this.sprinting && this.speed > 1) fovTarget = Config.SPRINT_FOV;
    this.fov += (fovTarget - this.fov) * Math.min(1, dt * 8);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    // --- Head bob (câmera) ---
    const moving = this.speed > 0.5 && this.onGround;
    const bobTarget = moving ? (this.sprinting ? 0.05 : 0.03) : 0;
    this.bobAmp += (bobTarget - this.bobAmp) * Math.min(1, dt * 8);
    if (moving) this.bobPhase += dt * (this.sprinting ? 11 : 8);

    this._syncCamera();
  }

  _syncCamera() {
    const bobY = Math.sin(this.bobPhase * 2) * this.bobAmp;
    const roll = Math.sin(this.bobPhase) * this.bobAmp * 0.2;
    this.camera.position.set(
      this.position.x,
      this.position.y + this.eyeHeight + bobY,
      this.position.z,
    );
    this.camera.rotation.set(this.pitch, this.yaw, roll); // ordem YXZ definida no SceneManager
  }

  getPosition() {
    return this.position;
  }

  getSpeed() {
    return this.speed;
  }

  /** Texto p/ o HUD: AGACHADO / MIRANDO / CORRENDO / EM PÉ. */
  getState() {
    if (this.crouching) return 'AGACHADO';
    if (this.aiming) return 'MIRANDO';
    if (this.sprinting && this.speed > 1) return 'CORRENDO';
    return 'EM PÉ';
  }
}
