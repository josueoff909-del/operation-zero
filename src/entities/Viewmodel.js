import * as THREE from 'three';
import { Config } from '../core/Config.js';

/**
 * Viewmodel.js — Arma + mãos em 1ª pessoa (Fase 2).
 * Rifle low-poly montado por primitivas (sem assets externos),
 * preso à câmera. Animações: respiração (idle), bob de caminhada/
 * corrida, inclinação ao correr, sway do olhar, coice do tiro e
 * transição hip-fire → ADS (mira no centro + FOV reduzido no Player).
 * O tiro é VISUAL nesta fase (flash + tracer + coice); dano/balística
 * real é da Fase 4 (Combat). `onFire` avisa o Engine a cada disparo.
 */
export class Viewmodel {
  constructor(camera, scene) {
    this.camera = camera;
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.frustumCulled = false;
    camera.add(this.group);

    this.adsBlend = 0; // 0 = quadril, 1 = mira (ADS)
    this.recoil = 0; // 0..1, decai rápido
    this.bobPhase = 0;
    this.bobAmp = 0;
    this.breathTime = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.fireTimer = 0;
    this.flashLife = 0;
    this.tracerLife = 0;

    this._buildRifle();
    this._buildFlashAndTracer();
  }

  _buildRifle() {
    const metal = new THREE.MeshStandardMaterial({ color: 0x1a1d21, roughness: 0.55, metalness: 0.5 });
    const accent = new THREE.MeshStandardMaterial({ color: 0x4a4238, roughness: 0.7, metalness: 0.2 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x3a4a2f, roughness: 0.95 });
    const add = (geo, mat, x, y, z, rx = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.x = rx;
      m.castShadow = false;
      m.receiveShadow = false;
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    };

    // Corpo da arma (canos apontam p/ -Z, como a câmera).
    add(new THREE.BoxGeometry(0.09, 0.13, 0.42), metal, 0, 0, -0.05); // receiver
    add(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 8), metal, 0, 0.02, -0.35, Math.PI / 2); // cano
    add(new THREE.BoxGeometry(0.08, 0.09, 0.24), accent, 0, 0, -0.28); // handguard
    add(new THREE.BoxGeometry(0.06, 0.16, 0.09), metal, 0, -0.12, -0.02, 0.2); // carregador
    add(new THREE.BoxGeometry(0.07, 0.11, 0.18), accent, 0, -0.01, 0.22); // coronha
    add(new THREE.BoxGeometry(0.05, 0.1, 0.06), metal, 0, -0.09, 0.08, 0.3); // empunhadura
    add(new THREE.BoxGeometry(0.02, 0.05, 0.02), metal, 0, 0.09, -0.02); // massa de mira
    add(new THREE.BoxGeometry(0.05, 0.04, 0.03), metal, 0, 0.085, 0.08); // alça de mira
    add(new THREE.CylinderGeometry(0.028, 0.028, 0.06, 8), accent, 0, 0.02, -0.52, Math.PI / 2); // boca

    // Mãos (luvas) sobre a empunhadura e o handguard.
    add(new THREE.BoxGeometry(0.07, 0.08, 0.09), glove, 0, -0.1, 0.08, 0.3); // mão direita
    add(new THREE.BoxGeometry(0.07, 0.07, 0.1), glove, 0.02, -0.06, -0.28); // mão esquerda

    // Ponto da boca (flash/tracer nascem aqui).
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.02, -0.56);
    this.group.add(this.muzzle);
  }

  _buildFlashAndTracer() {
    // Flash: 2 planos cruzados aditivos + luz pontual (vida ~40ms).
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffd27a, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.flash = new THREE.Group();
    const f1 = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), flashMat);
    const f2 = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), flashMat);
    f2.rotation.z = Math.PI / 2;
    this.flash.add(f1, f2);
    this.flash.position.copy(this.muzzle.position);
    this.flash.visible = false;
    this.group.add(this.flash);
    this.flashMat = flashMat;

    this.flashLight = new THREE.PointLight(0xffc266, 0, 10, 2);
    this.flashLight.position.copy(this.muzzle.position);
    this.group.add(this.flashLight);

    // Tracer: caixa fina reutilizada (pool de 1), no espaço do mundo.
    this.tracer = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.02, 1),
      new THREE.MeshBasicMaterial({
        color: 0xffe9a8, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    this.tracer.visible = false;
    this.scene.add(this.tracer);
  }

  /**
   * @param {number} dt tempo do frame (≤ 0.05)
   * @param {{speed:number, sprinting:boolean, aiming:boolean, firing:boolean, onGround:boolean, lookX:number, lookY:number}} state
   */
  update(dt, state) {
    // --- ADS: mistura quadril ↔ mira ---
    const adsTarget = state.aiming ? 1 : 0;
    this.adsBlend += (adsTarget - this.adsBlend) * Math.min(1, dt * 12);
    const hip = Config.VIEWMODEL_HIP_POS;
    const ads = Config.VIEWMODEL_ADS_POS;
    const b = this.adsBlend;
    let px = hip[0] + (ads[0] - hip[0]) * b;
    let py = hip[1] + (ads[1] - hip[1]) * b;
    let pz = hip[2] + (ads[2] - hip[2]) * b;

    // --- Respiração (sempre, mais sutil ao mirar) ---
    this.breathTime += dt;
    const breath = Math.sin(this.breathTime * 1.7);
    py += breath * 0.0035 * (1 - b * 0.6);

    // --- Bob de caminhada/corrida ---
    const moving = state.speed > 0.5 && state.onGround;
    const ampTarget = moving ? (state.sprinting ? 0.022 : 0.013) * (1 - b * 0.7) : 0;
    this.bobAmp += (ampTarget - this.bobAmp) * Math.min(1, dt * 8);
    if (moving) this.bobPhase += dt * (state.sprinting ? 11 : 8);
    py += Math.sin(this.bobPhase * 2) * this.bobAmp;
    px += Math.cos(this.bobPhase) * this.bobAmp * 0.7;

    // --- Sway do olhar (arma atrasa um pouco atrás da câmera) ---
    const swayK = Math.min(1, dt * 10);
    this.swayX += (-state.lookX * 0.6 - this.swayX) * swayK;
    this.swayY += (-state.lookY * 0.6 - this.swayY) * swayK;
    px += THREE.MathUtils.clamp(this.swayX, -0.04, 0.04);
    py += THREE.MathUtils.clamp(this.swayY, -0.03, 0.03);

    // --- Coice do tiro ---
    this.recoil = Math.max(0, this.recoil - dt * 5);
    pz += this.recoil * 0.07;

    this.group.position.set(px, py, pz);
    const runTilt = state.sprinting && !state.aiming ? 0.1 : 0;
    this.group.rotation.set(
      breath * 0.004 + this.recoil * 0.1 + this.swayY * 0.5,
      this.swayX * 0.8,
      runTilt + this.swayX * 0.4,
    );

    // flash/tracer decaem em _shoot()/abaixo; o agendamento é do Combat.

    // --- Decaimento do flash e do tracer ---
    if (this.flashLife > 0) {
      this.flashLife -= dt;
      const k = Math.max(0, this.flashLife / 0.04);
      this.flashMat.opacity = k * 0.9;
      this.flashLight.intensity = k * 6;
      if (this.flashLife <= 0) {
        this.flash.visible = false;
        this.flashLight.intensity = 0;
      }
    }
    if (this.tracerLife > 0) {
      this.tracerLife -= dt;
      this.tracer.material.opacity = Math.max(0, this.tracerLife / 0.07) * 0.9;
      if (this.tracerLife <= 0) this.tracer.visible = false;
    }
  }

  _shoot(hitDistance = 0) {
    this.recoil = 1;
    this.flashLife = 0.04;
    this.flash.visible = true;
    this.flash.rotation.z = Math.random() * Math.PI;
    const s = 0.8 + Math.random() * 0.5;
    this.flash.scale.set(s, s, s);

    // Tracer do cano até o ponto de impacto (ou 40 m se não bateu em nada).
    const from = new THREE.Vector3();
    this.muzzle.getWorldPosition(from);
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const len = Math.max(6, Math.min(60, hitDistance > 0 ? hitDistance : 40));
    this.tracer.position.copy(from).addScaledVector(dir, len / 2);
    this.tracer.lookAt(from.clone().addScaledVector(dir, len));
    this.tracer.scale.set(1, 1, len);
    this.tracer.visible = true;
    this.tracer.material.opacity = 0.9;
    this.tracerLife = 0.07;
  }

  /** Volta ao estado neutro (nova partida). */
  reset() {
    this.recoil = 0;
    this.adsBlend = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.fireTimer = 0;
    this.flashLife = 0;
    this.tracerLife = 0;
    if (this.flash) { this.flash.visible = false; }
    if (this.flashLight) { this.flashLight.intensity = 0; }
    if (this.tracer) { this.tracer.visible = false; }
  }

  /** Só respiração (usado na câmera do Lobby, com a arma escondida). */
  idle(dt) {
    this.breathTime += dt;
  }

  /** Dispara o visual de UM tiro (chamado pelo Combat no ritmo da arma).
   * @param {number} [hitDistance] distância até o impacto — o tracer para lá
   *   em vez de voar 40 m "no nada" (feedback honesto de bala batendo em cobertura).
   */
  playShot(hitDistance = 0) {
    this._shoot(hitDistance);
  }

  /** 0..1: o quanto a arma está "quentando" (p/ animar recuo/spread se quiser). */
  get heat() {
    return this.recoil;
  }

  dispose() {
    this.group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
    this.camera.remove(this.group);
    if (this.tracer) {
      this.tracer.geometry.dispose();
      this.tracer.material.dispose();
      this.scene.remove(this.tracer);
    }
  }
}
