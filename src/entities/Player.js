import * as THREE from 'three';
import { Config } from '../core/Config.js';

/**
 * Player.js — Controlador do jogador (protótipo FPS da Fase 1).
 *
 * - Câmera em 1ª pessoa com Euler 'YXZ' (Skill §3: sem Gimbal Lock).
 * - Movimento relativo ao yaw, gravidade, pulo e chão = altura do terreno.
 * - A Fase 3 converterá p/ 3ª pessoa over-the-shoulder reaproveitando
 *   este núcleo de movimento (velocidade, gravidade, pulo, clamp de mundo).
 */
export class Player {
  constructor(camera, terrain) {
    this.camera = camera;
    this.terrain = terrain;
    this.position = new THREE.Vector3(0, 0, 0); // pés do jogador
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = true;

    // Spawn: centro do mapa, sobre o terreno.
    this.position.set(0, terrain.getHeightAt(0, 0), 8);
    this._syncCamera();
  }

  /** Aplica deltas de olhar (mouse/touch) com sensibilidade configurada. */
  applyLook(deltaX, deltaY) {
    const s = Config.MOUSE_SENSITIVITY;
    this.yaw -= deltaX * s;
    this.pitch -= deltaY * s;
    // Limita o pitch p/ não virar a câmera de cabeça p/ baixo.
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
  }

  /**
   * Atualiza física e câmera. `input` = { move: {x,y}, jump: bool, sprint: bool }.
   * `dt` já vem limitado (≤ 0.05) pelo Loop.
   */
  update(dt, input) {
    // --- Direção desejada no plano XZ, relativa ao yaw ---
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // Frente = (-sin(yaw), -cos(yaw)); Direita = (cos(yaw), -sin(yaw))
    const wishX = (-sin * input.move.y) + (cos * input.move.x);
    const wishZ = (-cos * input.move.y) + (-sin * input.move.x);

    const speed = Config.PLAYER_SPEED * (input.sprint ? Config.PLAYER_SPRINT_MULT : 1);
    // Aceleração simples e direta (protótipo): velocidade horizontal = desejo * speed.
    this.velocity.x = wishX * speed;
    this.velocity.z = wishZ * speed;

    // --- Gravidade / pulo ---
    if (input.jump && this.onGround) {
      this.velocity.y = Config.PLAYER_JUMP_VELOCITY;
      this.onGround = false;
    }
    this.velocity.y -= Config.PLAYER_GRAVITY * dt;

    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.position.y += this.velocity.y * dt;

    // --- Chão = terreno ---
    const groundY = this.terrain.getHeightAt(this.position.x, this.position.z);
    if (this.position.y <= groundY) {
      this.position.y = groundY;
      this.velocity.y = 0;
      this.onGround = true;
    } else if (this.position.y > groundY + 0.05) {
      this.onGround = false;
    }

    // --- Bordas do mundo ---
    this.terrain.clampToWorld(this.position, Config.PLAYER_RADIUS);

    this._syncCamera();
  }

  _syncCamera() {
    this.camera.position.set(
      this.position.x,
      this.position.y + Config.PLAYER_EYE_HEIGHT,
      this.position.z,
    );
    this.camera.rotation.set(this.pitch, this.yaw, 0); // ordem YXZ definida no SceneManager
  }

  getPosition() {
    return this.position;
  }
}
