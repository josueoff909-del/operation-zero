import * as THREE from 'three';
import { Config } from '../core/Config.js';

/**
 * Lighting.js — Iluminação da Fase 1 (requisito: "com iluminação").
 * - Céu: esfera com gradiente shader (barato, sem textura).
 * - Sol: DirectionalLight com sombra única de 1024px (mobile).
 * - Hemisfério: luz ambiente suave céu/grama.
 * - Fog: profundidade + ajuda p/ culling visual de objetos distantes.
 */
export class Lighting {
  constructor(scene) {
    this.scene = scene;
    this._buildSky();
    this._buildLights();
    scene.fog = new THREE.Fog(0x9fc7e8, Config.FOG_NEAR, Config.FOG_FAR);
  }

  _buildSky() {
    const skyGeo = new THREE.SphereGeometry(500, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x3a7bd5) },
        bottomColor: { value: new THREE.Color(0xcfe8f5) },
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
        uniform vec3 topColor; uniform vec3 bottomColor;
        uniform float offset; uniform float exponent;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
          gl_FragColor = vec4(mix(bottomColor, topColor, pow(max(h, 0.0), exponent)), 1.0);
        }
      `,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.frustumCulled = false;
    this.scene.add(sky);
    this.sky = sky;
  }

  _buildLights() {
    // Hemisfério: céu azulado / chão esverdeado.
    const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x3a5f2f, 0.75);
    this.scene.add(hemi);

    // Sol com sombra. A área de sombra cobre o centro do mapa (spawn/POI inicial).
    const sun = new THREE.DirectionalLight(0xfff2d9, 1.6);
    sun.position.set(70, 95, 35);
    sun.castShadow = true;
    sun.shadow.mapSize.set(Config.SHADOW_MAP_SIZE, Config.SHADOW_MAP_SIZE);
    sun.shadow.camera.left = -70;
    sun.shadow.camera.right = 70;
    sun.shadow.camera.top = 70;
    sun.shadow.camera.bottom = -70;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 260;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
  }

  dispose() {
    if (this.sky) {
      this.sky.geometry.dispose();
      this.sky.material.dispose();
    }
    if (this.sun) {
      if (this.sun.shadow.map) this.sun.shadow.map.dispose();
    }
  }
}
