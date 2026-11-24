import * as THREE from 'three';
import { Config } from '../core/Config.js';

/**
 * Lighting.js — Rig de iluminação da cena (threejs-materials-lighting skill).
 *
 * - Key: `DirectionalLight` com intensidade fisicamente correta (r155+: ~2–3).
 * - Fill: `HemisphereLight` céu/chão — nada de superfície preta em sombra.
 * - Sombra: UM shadow map de 1024px, com o frustum ortográfico **ajustado e
 *   centrado no jogador** (a skill é explícita: mover a luz + o target com o
 *   jogador em vez de alargar o frustum e diluir a resolução).
 * - Céu: gradiente em shader (barato, sem textura) + disco solar.
 * - Fog: profundidade e "esconde" o fim do terreno.
 *
 * `updateTarget(x, y, z)` é chamado pelo Engine a cada frame; o Engine também
 * avisa quando a qualidade cai p/ MÍNIMA (aí desligamos o castShadow).
 */
export class Lighting {
  constructor(scene) {
    this.scene = scene;
    this._buildSky();
    this._buildLights();
    scene.fog = new THREE.Fog(Config.FOG_COLOR, Config.FOG_NEAR, Config.FOG_FAR);
  }

  _buildSky() {
    const skyGeo = new THREE.SphereGeometry(500, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x2f6fc4) },
        midColor: { value: new THREE.Color(0xbfe0f2) },
        bottomColor: { value: new THREE.Color(0xe8d7b8) }, // horizonte quente
        sunDir: { value: new THREE.Vector3(0.55, 0.62, 0.3).normalize() },
        sunColor: { value: new THREE.Color(0xfff0cf) },
        offset: { value: 33 },
        exponent: { value: 0.7 },
      },
      vertexShader: /* glsl */`
        varying vec3 vWorldPosition;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPosition = wp.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        uniform vec3 topColor; uniform vec3 midColor; uniform vec3 bottomColor;
        uniform vec3 sunDir; uniform vec3 sunColor;
        uniform float offset; uniform float exponent;
        varying vec3 vWorldPosition;
        void main() {
          vec3 dir = normalize(vWorldPosition + vec3(0.0, offset, 0.0));
          float h = dir.y;
          vec3 col = mix(bottomColor, midColor, smoothstep(-0.02, 0.22, h));
          col = mix(col, topColor, pow(max(h, 0.0), exponent));
          // halo + disco solar: o sol "existe" na cena e orienta o olhar
          float sd = max(dot(normalize(vWorldPosition), sunDir), 0.0);
          col += sunColor * pow(sd, 320.0) * 1.6;          // disco
          col += sunColor * pow(sd, 6.0) * 0.16;           // halo
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.frustumCulled = false;
    sky.name = 'sky';
    this.scene.add(sky);
    this.sky = sky;
  }

  _buildLights() {
    // Fill céu/chão (nada de preto em sombra — regra da skill).
    const hemi = new THREE.HemisphereLight(Config.HEMI_SKY, Config.HEMI_GROUND, Config.HEMI_INTENSITY);
    this.scene.add(hemi);
    this.hemi = hemi;

    // Key solar com sombra ajustada em torno do jogador.
    const sun = new THREE.DirectionalLight(Config.SUN_COLOR, Config.SUN_INTENSITY);
    const [sx, sy, sz] = Config.SUN_POSITION;
    sun.position.set(sx, sy, sz);
    sun.castShadow = true;
    sun.shadow.mapSize.set(Config.SHADOW_MAP_SIZE, Config.SHADOW_MAP_SIZE);
    const r = Config.SHADOW_RADIUS;
    const cam = sun.shadow.camera;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
    cam.near = 1;
    cam.far = 260;
    cam.updateProjectionMatrix();
    // Sem acne: bias pequeno negativo + normalBias (skill: "tune shadow.bias").
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.target.position.set(0, 0, 0);
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
    this.sunOffset = new THREE.Vector3(sx, sy, sz);
  }

  /**
   * Centraliza o frustum da sombra no jogador (chamado todo frame).
   * `sun` e `sun.target` andam juntos → a área de 2×SHADOW_RADIUS segue o
   * jogador e os 1024px rendem ~15 px/metro em qualquer ponto do mapa.
   */
  follow(x, y, z) {
    this.sun.position.set(x + this.sunOffset.x, y + this.sunOffset.y, z + this.sunOffset.z);
    this.sun.target.position.set(x, y, z);
    this.sun.target.updateMatrixWorld();
  }

  /** MÍNIMA desliga a sombra ( Economia de 1 render pass do shadow map). */
  setShadowsEnabled(enabled) {
    if (this.sun.castShadow === enabled) return;
    this.sun.castShadow = enabled;
  }

  dispose() {
    if (this.sky) {
      this.sky.geometry.dispose();
      this.sky.material.dispose();
      this.scene.remove(this.sky);
    }
    if (this.sun) {
      if (this.sun.shadow.map) this.sun.shadow.map.dispose();
      this.scene.remove(this.sun);
      this.scene.remove(this.sun.target);
    }
    if (this.hemi) this.scene.remove(this.hemi);
    this.scene.fog = null;
  }
}
