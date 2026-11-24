import * as THREE from 'three';
import { Config } from '../core/Config.js';
import { terrainHeight } from '../utils/Noise.js';

/**
 * Zone.js — Zona segura / gás (Fase 6, GDD §2).
 *
 * Regras:
 *  • 6 fases (`Config.ZONE_PHASES`): raio alvo, tempo parado (`wait`), tempo
 *    fechando (`close`) e dano por tick escalonado (1.2 → 14 de vida/s).
 *  • O centro novo é **semi-ponderado**: puxado para um POI (peso do POI) mas
 *    com ruído — as últimas zonas nunca são previsíveis (anti-camping do GDD).
 *  • O novo centro é sempre escolhido dentro do círculo atual
 *    (`d ≤ R - r`), então ninguém fica preso fora por causa do sorteio.
 *  • O dano é por *tick* de 1 s e só para quem está FORA — quem está na borda
 *    recebe um empurrão de tolerância (`ZONE_EDGE_FALLOFF`) p/ não morrer por
 *    flutuação de frame.
 *
 * Visual (2 draw calls, zero textura):
 *  • parede: `CylinderGeometry` aberta com fresnel + listras subindo; fica
 *    vermelha enquanto fecha (leitura imediata de "está fechando");
 *  • anel do PRÓXIMO círculo desenhado com `depthTest: false` (holograma por
 *    cima do relevo — sem o z-fighting que um anel no chão teria nas colinas).
 *
 * A Zone **não** dá dano sozinha: ela informa (`dpsAt`) e o Engine aplica, para
 * o dano continuar passando pelo mesmo caminho do dano de tiro (HUD, kill feed).
 */
export const ZONE_STATE = Object.freeze({
  IDLE: 'IDLE', WAIT: 'WAIT', CLOSING: 'CLOSING', FINAL: 'FINAL',
});

export class Zone {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.rng = opts.rng || Math.random;
    this.enabled = false;
    this.phaseIndex = 0;
    this.state = ZONE_STATE.IDLE;
    this.timer = 0;
    this.time = 0;
    this.center = new THREE.Vector2(0, 0);
    this.radius = Config.ZONE_PHASES[0].radius;
    this.from = { x: 0, z: 0, r: this.radius };
    this.to = { x: 0, z: 0, r: this.radius };
    this.progress = 1;
    this._tickAccum = 0;
    this._onCloseStart = opts.onCloseStart || null;
    this._onPhase = opts.onPhase || null;
    this._buildMeshes();
  }

  // ------------------------------------------------------------- ciclo de vida
  reset(startX = 0, startZ = 0) {
    const first = Config.ZONE_PHASES[0];
    this.enabled = true;
    this.phaseIndex = 0;
    this.state = ZONE_STATE.WAIT;
    // respiro extra ANTES do primeiro fechamento (o `wait` da tabela continua
    // valendo para as outras fases — é o timer da fase, não um número do Engine)
    this.timer = first.wait + (Config.ZONE_MIN_BREATH || 0);
    this.radius = first.radius;
    // centro inicial levemente deslocado p/ o lado do spawn (nunca simétrico demais)
    this.center.set(startX * 0.25, startZ * 0.25);
    this.from = { x: this.center.x, z: this.center.y, r: first.radius };
    this.to = { ...this.from };
    this.progress = 1;
    this._sync();
  }

  disable() {
    this.enabled = false;
    this.state = ZONE_STATE.IDLE;
    this.wall.visible = false;
    this.nextRing.visible = false;
  }

  /**
   * true uma vez por Config.ZONE_TICK — o Engine usa ISTO p/ aplicar dano
   * (jogador e bots no mesmo relógio, senão o tick do bot e do jogador
   * desencontram e a morte no gás fica fora de sincronia com o HUD).
   */
  shouldTick(dt) {
    if (!this.enabled) return false;
    this._tickAccum += dt;
    if (this._tickAccum < Config.ZONE_TICK) return false;
    this._tickAccum = 0;
    return true;
  }

  update(dt) {
    if (!this.enabled) return;
    this.time += dt;
    this.timer = Math.max(0, this.timer - dt);
    const phases = Config.ZONE_PHASES;

    if (this.state === ZONE_STATE.WAIT && this.timer <= 0) {
      const next = phases[Math.min(this.phaseIndex + 1, phases.length - 1)];
      this._pickTarget(next);
      this.state = ZONE_STATE.CLOSING;
      this.timer = next.close;
      this.progress = 0;
      if (this._onCloseStart) this._onCloseStart(next, this.phaseIndex + 1);
    } else if (this.state === ZONE_STATE.CLOSING) {
      const next = phases[this.phaseIndex + 1];
      const dur = next ? next.close : 1;
      this.progress = Math.min(1, 1 - this.timer / Math.max(0.001, dur));
      const e = ease(this.progress);
      this.radius = lerp(this.from.r, this.to.r, e);
      this.center.set(lerp(this.from.x, this.to.x, e), lerp(this.from.z, this.to.z, e));
      if (this.timer <= 0) {
        this.phaseIndex = Math.min(this.phaseIndex + 1, phases.length - 1);
        this.radius = this.to.r;
        this.center.set(this.to.x, this.to.z);
        const settled = phases[this.phaseIndex];
        const isLast = this.phaseIndex >= phases.length - 1;
        this.state = isLast ? ZONE_STATE.FINAL : ZONE_STATE.WAIT;
        this.timer = isLast ? 0 : settled.wait;
        if (this._onPhase) this._onPhase(this.phaseIndex, this.state);
      }
    }
    this._sync();
  }

  _pickTarget(next) {
    const cur = this.radius;
    const r = next.radius;
    // centro semi-ponderado por POI + jitter (GDD: "centro aleatório ou
    // semi-ponderado" / "prevenção de zonas finais previsíveis")
    const pull = Config.ZONE_CENTER_POI_PULL;
    let best = { x: this.center.x, z: this.center.y, score: -Infinity };
    for (let i = 0; i < 22; i++) {
      let cx;
      let cz;
      if (i < Config.POIS.length * 2) {
        const poi = Config.POIS[i % Config.POIS.length];
        const ang = this.rng() * Math.PI * 2;
        const rad = Math.sqrt(this.rng()) * poi.r * 0.9;
        cx = poi.x + Math.cos(ang) * rad;
        cz = poi.z + Math.sin(ang) * rad;
      } else {
        const ang = this.rng() * Math.PI * 2;
        const rad = Math.sqrt(this.rng()) * cur;
        cx = this.center.x + Math.cos(ang) * rad;
        cz = this.center.y + Math.sin(ang) * rad;
      }
      const d = Math.hypot(cx - this.center.x, cz - this.center.y);
      if (d > cur - r) continue; // precisa caber no círculo atual
      const poiBonus = Math.max(0, 1 - d / (cur + 1)) * pull;
      let nearPoi = 0;
      for (const p of Config.POIS) {
        const pd = Math.hypot(cx - p.x, cz - p.z);
        nearPoi = Math.max(nearPoi, (p.weight || 1) * Math.max(0, 1 - pd / (p.r * 1.7)));
      }
      const score = nearPoi * pull + poiBonus + this.rng() * 0.75;
      if (score > best.score) best = { x: cx, z: cz, score };
    }
    this.from = { x: this.center.x, z: this.center.y, r: cur };
    this.to = { x: best.x, z: best.z, r };
  }

  // ------------------------------------------------------------------ queries
  /** Distância horizontal assinada: >0 = fora da zona. */
  distanceOutside(x, z) {
    return Math.hypot(x - this.center.x, z - this.center.y) - this.radius;
  }

  isOutside(x, z) {
    return this.distanceOutside(x, z) > Config.ZONE_EDGE_FALLOFF * this.radius;
  }

  /** Dano por segundo deste ponto (0 dentro da zona / zona desligada). */
  dpsAt(x, z) {
    if (!this.enabled) return 0;
    const tol = Math.max(0.4, Config.ZONE_EDGE_FALLOFF * this.radius);
    const out = this.distanceOutside(x, z);
    if (out <= 0) return 0;
    const dps = this.currentDps;
    // entra suave na borda: 0 em 0 → dps plenos a 2× a tolerância
    return dps * Math.min(1, out / (tol * 2));
  }

  /**
   * dano/s VIGENTE. Enquanto o círculo ESTÁ FECHANDO vale a fase de destino
   * (o gás "puxa" o jogador para dentro, então ele já queima lá fora durante o
   * fechamento — ler `phaseIndex` puro deixaria 26 s de fechamento inofensivos,
   * que é exatamente o bug que faz a partida nunca terminar).
   */
  get currentDps() {
    const phases = Config.ZONE_PHASES;
    const idx = this.state === ZONE_STATE.CLOSING
      ? Math.min(this.phaseIndex + 1, phases.length - 1)
      : this.phaseIndex;
    return phases[idx]?.dps ?? 0;
  }

  /** Vida útil p/ o HUD: texto do contador + estado. */
  getCountdownText() {
    if (!this.enabled) return '';
    const t = Math.max(0, Math.ceil(this.timer));
    const mm = Math.floor(t / 60);
    const ss = String(t % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  getTimeText() {
    return this.getCountdownText();
  }

  /**
   * p/ o HUD: 0→1 dentro da ESPERA e 0→1 dentro do FECHAMENTO. Sem isso a
   * barrinha do HUD travava em 1 e o jogador não media o tempo que faltava.
   */
  get phaseProgress() {
    const phases = Config.ZONE_PHASES;
    if (this.state === ZONE_STATE.CLOSING) return this.progress;
    if (this.state === ZONE_STATE.FINAL) return 1;
    const wait = phases[this.phaseIndex]?.wait || 1;
    return this.timer <= 0 ? 1 : 1 - Math.min(1, this.timer / wait);
  }

  /** p/ o minimapa: próximo centro/raio (enquanto fecha, o destino). */
  getNext() {
    if (this.state === ZONE_STATE.CLOSING) return { x: this.to.x, z: this.to.z, r: this.to.r, closing: true };
    const next = Config.ZONE_PHASES[Math.min(this.phaseIndex + 1, Config.ZONE_PHASES.length - 1)];
    // só faz sentido desenhar o anel se ele for MENOR que o atual (senão o
    // "próximo círculo" da fase 0 coincide com o muro e vira ruído visual)
    if (next.radius >= this.radius - 4) return null;
    return { x: this.center.x, z: this.center.y, r: next.radius, closing: false };
  }

  get label() {
    if (this.state === ZONE_STATE.CLOSING) return 'ZONA FECHANDO';
    if (this.state === ZONE_STATE.FINAL) return 'ZONA FINAL';
    return 'ZONA SEGURA';
  }

  // ------------------------------------------------------------------ visual
  _buildMeshes() {
    // parede da zona
    const wallGeo = new THREE.CylinderGeometry(1, 1, 1, 72, 1, true);
    const wallMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uHeat: { value: 0 }, // 0 = azul (espera), 1 = vermelho (fechando)
      },
      vertexShader: /* glsl */`
        varying vec2 vUv; varying vec3 vNormal; varying vec3 vView;
        void main() {
          vUv = uv;
          vNormal = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vView = -mv.xyz;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */`
        uniform float uTime; uniform float uHeat;
        varying vec2 vUv; varying vec3 vNormal; varying vec3 vView;
        void main() {
          vec3 V = normalize(vView);
          float fres = pow(1.0 - abs(dot(normalize(vNormal), V)), 1.6);
          // listras subindo + grade fina: dá escala de movimento p/ o olho
          float stripes = smoothstep(0.55, 0.95, sin((vUv.y * 9.0 - uTime * 0.5) * 6.2831) * 0.5 + 0.5);
          float grid = smoothstep(0.9, 1.0, sin(vUv.x * 6.2831 * 36.0) * 0.5 + 0.5);
          float fade = smoothstep(0.0, 0.22, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
          vec3 cool = vec3(0.24, 0.52, 0.95);
          vec3 hot = vec3(0.95, 0.30, 0.18);
          vec3 col = mix(cool, hot, clamp(uHeat, 0.0, 1.0));
          float a = (0.14 + 0.42 * fres + 0.30 * stripes * fade + 0.16 * grid) ;
          gl_FragColor = vec4(col * (0.55 + 0.85 * fres + 0.5 * stripes), a * 0.9);
        }
      `,
    });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.visible = false;
    wall.frustumCulled = false;
    wall.renderOrder = 3;
    wall.name = 'zone-wall';
    this.scene.add(wall);
    this.wall = wall;
    this._wallGeo = wallGeo;
    this._wallMat = wallMat;

    // anel do próximo círculo (holograma no chão, por cima do relevo)
    const ringGeo = new THREE.RingGeometry(0.985, 1.0, 96);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x7fe3ff, transparent: true, opacity: 0.8,
      side: THREE.DoubleSide, depthWrite: false, depthTest: false, fog: false,
      blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    ring.frustumCulled = false;
    ring.renderOrder = 4;
    ring.name = 'zone-next';
    this.scene.add(ring);
    this.nextRing = ring;
    this._ringGeo = ringGeo;
    this._ringMat = ringMat;
  }

  _sync() {
    if (!this.enabled) return;
    const h = Config.ZONE_WALL_HEIGHT;
    const y = terrainHeight(this.center.x, this.center.z);
    this.wall.visible = true;
    this.wall.position.set(this.center.x, y + h / 2 - 4, this.center.y);
    this.wall.scale.set(Math.max(0.5, this.radius), h, Math.max(0.5, this.radius));
    this._wallMat.uniforms.uTime.value = this.time;
    this._wallMat.uniforms.uHeat.value = this.state === ZONE_STATE.CLOSING
      ? 0.55 + 0.45 * Math.sin(this.time * 4.2) * 0.5 + 0.2
      : 0;

    const next = this.getNext();
    this.nextRing.visible = !!next;
    if (!next) return;
    this.nextRing.position.set(next.x, y + 0.4, next.z);
    this.nextRing.scale.set(Math.max(0.5, next.r), Math.max(0.5, next.r), 1);
    this._ringMat.opacity = this.state === ZONE_STATE.CLOSING ? 0.95 : 0.4;
  }

  /** Tempo (s) até o círculo começar a fechar / terminar de fechar. */
  get timeLeft() {
    return this.timer;
  }

  dispose() {
    this.scene.remove(this.wall);
    this.scene.remove(this.nextRing);
    this._wallGeo.dispose();
    this._wallMat.dispose();
    this._ringGeo.dispose();
    this._ringMat.dispose();
  }
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
function ease(t) {
  // easeInOutQuad: o fechamento arranca devagar, acelera e assenta no fim
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
