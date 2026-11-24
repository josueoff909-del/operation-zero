import * as THREE from 'three';
import { Config } from '../core/Config.js';
import { terrainHeight, fbm } from '../utils/Noise.js';

/**
 * Backdrop.js — o "limite" que não existe mais.
 *
 * O mapa jogável é um quadrado de 400 m; antes disso a câmera mostrava o corte
 * seco do terreno no horizonte (o "só tem uma cidade e um limite" da reclamação).
 * Aqui entram 4 meshes baratos, todos **sem colisão, sem sombra e sem fog
 * manual** (a cor de cada camada já é misturada com a cor do horizonte, que é
 * como a névoa atmosférica funciona de verdade):
 *
 *  1. `chão distante` — anel de 190 → 900 m amostrando o MESMO heightmap do
 *     terreno → emenda invisível, o mundo continua até o horizonte.
 *  2. `mata distante` — cortina baixa de árvores a 250 m (silhueta escura).
 *  3/4. `montanha near/far` — duas cortinas a 340/520 m com alturas e cores de
 *     névoa diferentes → profundidade em camadas (técnica clássica de BR).
 *
 * Custo: 4 draw calls, ~5k triângulos, uma vez no boot.
 */
export class Backdrop {
  constructor(scene) {
    this.scene = scene;
    this.meshes = [];
    this._buildFarGround();
    this._buildCurtain('mata', 252, 16, 220, 0x3d5138, 0.32);
    this._buildCurtain('montanha-perto', 342, 74, 150, 0x6f7f93, 0.58);
    this._buildCurtain('montanha-longe', 520, 118, 110, 0x8fa2b8, 0.8);
  }

  _haze(hex, amount) {
    // mistura a cor da camada com a cor do horizonte (fog color) = névoa
    const c = new THREE.Color(hex);
    return c.lerp(new THREE.Color(Config.FOG_COLOR), amount);
  }

  /**
   * Re-aplica a névoa das cores de vértice com a fog ATUAL.
   * O Climate muda a cor do céu/fog durante a partida (tempestade, gás da
   * zona final); como o Backdrop tem `fog:false` (senão a névoa engoliria o
   * horizonte), a cor tem de ser re-lerpada à mão — 2 varreduras de atributo
   * a 4 Hz durante a transição, nada por frame.
   */
  refreshTint(fogColor) {
    if (!fogColor) return;
    const tmp = new THREE.Color();
    for (const m of this.meshes) {
      const attr = m.geometry.attributes.color;
      const tint = m.userData.tint;
      const haze = m.userData.haze;
      if (!attr || !tint || !haze) continue;
      for (let i = 0; i < attr.count; i++) {
        tmp.setRGB(tint[i * 3], tint[i * 3 + 1], tint[i * 3 + 2]);
        tmp.lerp(fogColor, haze[i]);
        attr.setXYZ(i, tmp.r, tmp.g, tmp.b);
      }
      attr.needsUpdate = true;
    }
  }

  /** Anel de chão que continua o heightmap até o horizonte. */
  _buildFarGround() {
    const inner = 188; // dentro do círculo inscrito do quadrado de 400 m
    const outer = Config.FAR_GROUND_RADIUS;
    const geo = new THREE.RingGeometry(inner, outer, 128, 5);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const baseTint = new Float32Array(pos.count * 3);
    const baseHaze = new Float32Array(pos.count);
    const dry = new THREE.Color(0x6d7f57);
    const far = new THREE.Color(0x8f9a86);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const r = Math.hypot(x, z);
      const h = terrainHeight(x, z) * 0.7 - 0.06 + (r > inner * 1.6 ? (r - inner) * 0.012 : 0);
      pos.setY(i, h);
      const t = Math.min(1, Math.max(0, (r - inner) / (outer - inner)));
      tmp.copy(dry).lerp(far, t * 0.8 + fbm(x * 0.01, z * 0.01, 2, 5150) * 0.2);
      tmp.lerp(new THREE.Color(Config.FOG_COLOR), Math.min(0.72, t * 1.1));
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
      baseTint[i * 3] = tmp.r;
      baseTint[i * 3 + 1] = tmp.g;
      baseTint[i * 3 + 2] = tmp.b;
      baseHaze[i] = Math.min(0.72, t * 1.1);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, fog: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'chao-distante';
    mesh.frustumCulled = false; // é o fundo do mundo: nunca cortar
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    mesh.userData.tint = baseTint;
    mesh.userData.haze = baseHaze;
    this.scene.add(mesh);
    this.meshes.push(mesh);
  }

  /**
   * Cortina de silhueta: anel vertical com topo deslocado por ruído.
   * Um triângulo a cada passo angular → barata e legível de longe.
   */
  _buildCurtain(name, radius, height, angular, color, haze) {
    const steps = Math.max(48, Math.round(angular));
    const verts = [];
    const idx = [];
    const base = new THREE.Color(color);
    const horizon = new THREE.Color(Config.FOG_COLOR);
    const col = [];
    const tintBase = [];
    const hazeBase = [];
    const push = (x, z, y, tint) => {
      verts.push(x, y, z);
      const c = base.clone().lerp(horizon, haze * tint);
      col.push(c.r, c.g, c.b);
      tintBase.push(base.r, base.g, base.b);
      hazeBase.push(haze * tint);
    };
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const wob = fbm(Math.cos(a) * 3.1 + radius * 0.01, Math.sin(a) * 3.1, 3, 909 + radius) - 0.5;
      const r = radius * (1 + wob * 0.16);
      const hh = height * (0.42 + fbm(Math.cos(a) * 2.2 + 7, Math.sin(a) * 2.2 + 3, 3, 1234 + radius) * 1.1);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const y0 = terrainHeight(Math.min(Math.abs(x), 195) * Math.sign(x), Math.min(Math.abs(z), 195) * Math.sign(z)) * 0.5 - 4;
      push(x, z, y0, 0.55); // base
      push(x, z, y0 + hh, 1); // topo (mais névoa no alto)
      if (i > 0) {
        const b = (i - 1) * 2;
        idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 1, metalness: 0,
      side: THREE.DoubleSide, flatShading: true, fog: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.tint = Float32Array.from(tintBase);
    mesh.userData.haze = Float32Array.from(hazeBase);
    this.scene.add(mesh);
    this.meshes.push(mesh);
  }

  dispose() {
    for (const m of this.meshes) {
      this.scene.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
    this.meshes.length = 0;
  }
}
