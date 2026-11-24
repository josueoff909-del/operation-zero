import * as THREE from 'three';
import { Config } from '../core/Config.js';
import { terrainHeight, lakeDepth } from '../utils/Noise.js';

/**
 * Water.js — Lago Zero (1 draw call, sem textura baixada).
 *
 * É um `MeshStandardMaterial` vivo: a reflexão do céu vem do **environment do
 * PMREM** criado no `Lighting` (por isso a água tem brilho de céu e não um
 * azul chapado), e `onBeforeCompile` injeta duas coisas baratas:
 *   • deslocamento + normal perturbada por 2 senos → ondulação animada;
 *   • cor por profundidade (raso = turquesa, fundo = verde-escuro) e **espuma**
 *     na linha da margem, usando `aDepth` (atributo por vértice).
 *
 * Costeira/mergulho: `this.colliders` marca onde a lâmina é funda, então o
 * jogador anda no vau raso mas não atravessa o lago a pé — mesma regra de
 * colisão do resto do mundo (o `Engine` chama `applyTo(collision)`).
 */
export class Water {
  constructor(scene) {
    this.scene = scene;
    this.colliders = [];
    this._time = { value: 0 };
    this._build();
  }

  _build() {
    const { x: cx, z: cz, r } = Config.LAKE;
    const size = (r + 22) * 2;
    const geo = new THREE.PlaneGeometry(size, size, 48, 48);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const depth = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const lx = cx + pos.getX(i); // o plano é local; o mesh fica no centro do lago
      const lz = cz + pos.getZ(i);
      // Só o deslocamento de onda (no shader) mexe em Y: aqui a lâmina é chata.
      pos.setY(i, 0);
      depth[i] = Config.WATER_LEVEL - terrainHeight(lx, lz);
    }
    geo.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      color: 0x2f6a72,
      roughness: 0.08,
      metalness: 0.0,
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide,
      envMapIntensity: 1.6, // reflete o céu (environment) → não fica "plástico"
    });
    const uTime = this._time;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWaterTime = uTime;
      shader.vertexShader = `
        attribute float aDepth;
        varying float vWaterDepth;
        uniform float uWaterTime;
        ${shader.vertexShader}
      `.replace('#include <beginnormal_vertex>', `
        #include <beginnormal_vertex>
        vWaterDepth = aDepth;
        // duas ondas cruzadas na normal: brilho se mexe sem textura nenhuma
        float wa = position.x * 0.34 + uWaterTime * 1.35;
        float wb = position.z * 0.27 - uWaterTime * 1.05;
        objectNormal = normalize(objectNormal + vec3(sin(wa) * 0.11, 0.0, cos(wb) * 0.11));
      `).replace('#include <begin_vertex>', `
        #include <begin_vertex>
        transformed.y += sin(position.x * 0.5 + uWaterTime * 1.15) * 0.04
                       + cos(position.z * 0.42 - uWaterTime * 0.95) * 0.035;
      `);
      shader.fragmentShader = `
        varying float vWaterDepth;
        uniform float uWaterTime;
        ${shader.fragmentShader}
      `.replace('#include <dithering_fragment>', `
        #include <dithering_fragment>
        float d = vWaterDepth;
        float inside = smoothstep(-0.22, 0.14, d);      // fora do lago → some
        vec3 shallow = vec3(0.16, 0.52, 0.52);
        vec3 deep = vec3(0.02, 0.10, 0.15);
        vec3 water = mix(shallow, deep, smoothstep(0.0, 2.6, d));
        gl_FragColor.rgb = mix(gl_FragColor.rgb * 0.25 + water * 0.9, gl_FragColor.rgb, 0.35);
        // espuma na margem + brilhos de onda
        float band = smoothstep(0.42, 0.0, abs(d - 0.16));
        float ripple = 0.5 + 0.5 * sin(d * 18.0 - uWaterTime * 2.6);
        gl_FragColor.rgb += vec3(0.72, 0.82, 0.84) * band * (0.35 + 0.45 * ripple);
        gl_FragColor.a *= inside;
      `);
    };
    // o ShaderMaterial recompilado precisa de um key estável p/ cache
    mat.customProgramCacheKey = () => 'oz-water';

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, 0, cz);
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    mesh.frustumCulled = true; // bounds do próprio plano cobrem o lago
    mesh.renderOrder = 1; // transparente: depois dos opacos
    mesh.name = 'agua';
    this.mesh = mesh;
    this.geo = geo;
    this.mat = mat;
    this.scene.add(mesh);

    this._buildShore();
  }

  /**
   * Colisores da lâmina funda (anel polar). Raso continua andável — dar um
   * passo na água até a canela é gostoso; sumergir no lago, não.
   */
  _buildShore() {
    const { x: cx, z: cz, r } = Config.LAKE;
    const rings = 3;
    const steps = 40;
    for (let ring = 0; ring < rings; ring++) {
      const rr = r * (0.55 + ring * 0.18);
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const x = cx + Math.cos(a) * rr;
        const z = cz + Math.sin(a) * rr;
        const d = lakeDepth(x, z);
        if (d < 0.42) continue; // só onde é fundo
        this.colliders.push({
          kind: 'circle', x, z, r: rr * 0.06 + 0.9,
          minY: Config.WATER_LEVEL - 6, maxY: Config.WATER_LEVEL + 1.1,
          walkable: false,
        });
      }
    }
  }

  applyTo(collision) {
    for (const c of this.colliders) {
      collision.addCircle(c.x, c.z, c.r, c.minY, c.maxY, { walkable: c.walkable });
    }
    return this.colliders.length;
  }

  update(dt) {
    this._time.value += dt;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.geo.dispose();
    this.mat.dispose();
  }
}
