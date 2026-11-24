import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Config } from '../core/Config.js';

/**
 * Lighting.js — Céu atmosférico + luz key/fill + sombra que segue o jogador.
 *
 * O que mudou (upgrade visual, sem baixar asset nenhum):
 *  • Céu: `three/addons/objects/Sky` (modelo de Preetham — dispersão
 *    atmosférica real). Um gradiente à mão nunca casa com o horizonte, e era
 *    isso que deixava a "emenda" no fim do mapa. As cores do sol/ambiente são
 *    derivadas da MESMA direção solar → o mundo inteiro concorda com o céu.
 *  • Environment: `PMREMGenerator` gera um cubemap irradiado do céu UMA vez no
 *    boot e ele vira `scene.environment` → vidro/metal dos prédios ganham
 *    reflexo e as superfícies deixam de parecer "plasticina". r160 não tem
 *    `scene.environmentIntensity` (só r163+), então a força é aplicada em
 *    `material.envMapIntensity` por `applyEnvironment()`.
 *  • Nuvens: 1 dome com fbm procedural (sem textura, sem download) e scroll
 *    lento. Desligada em BAIXA/MÍNIMA (fill-rate é caro no mobile).
 *  • Sombra: um único shadow map, frustum ortográfico de ±SHADOW_RADIUS
 *    centrado no jogador (skill), `bias`/`normalBias` calibrados p/ terreno
 *    grande (sem o "orvalho"/acne que aparecia na grama).
 *  • Fog: cor = horizonte do céu e FAR longo o bastante p/ as montanhas de
 *    fundo virarem névoa azulada em vez de um corte seco no limite do mapa.
 *
 * `follow(x,y,z)` é chamado todo frame pelo Engine (jogador OU centro do
 * lobby) — move luz, target, céu e nuvens juntos (o céu não pode ter paralaxe).
 */
export class Lighting {
  /**
   * @param {THREE.Scene} scene
   * @param {{renderer?:THREE.WebGLRenderer}} [opts] - renderer habilita o PMREM
   */
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.renderer = opts.renderer || null;
    this._sunDir = new THREE.Vector3();
    this._envRT = null;
    this.cloudsEnabled = true;
    this._buildSky();
    this._buildClouds();
    this._buildLights();
    scene.fog = new THREE.Fog(Config.FOG_COLOR, Config.FOG_NEAR, Config.FOG_FAR);
    this._buildEnvironment();
  }

  /** Direção do sol a partir de elevação/azimute (graus). */
  sunDirection() {
    const phi = THREE.MathUtils.degToRad(90 - Config.SUN_ELEVATION);
    const theta = THREE.MathUtils.degToRad(Config.SUN_AZIMUTH);
    this._sunDir.setFromSphericalCoords(1, phi, theta).normalize();
    return this._sunDir;
  }

  _buildSky() {
    const sky = new Sky();
    // Dentro do far plane (1000): dome gigante teria paralaxe/clipping.
    sky.scale.setScalar(940);
    sky.frustumCulled = false;
    const u = sky.material.uniforms;
    u.turbidity.value = Config.SKY_TURBIDITY;
    u.rayleigh.value = Config.SKY_RAYLEIGH;
    u.mieCoefficient.value = Config.SKY_MIE_COEFF;
    u.mieDirectionalG.value = Config.SKY_MIE_G;
    u.sunPosition.value.copy(this.sunDirection());
    this.scene.add(sky);
    this.sky = sky;
  }

  /** Nuvens procedural: fbm 3 oitavas num dome, alpha suave perto do topo. */
  _buildClouds() {
    const geo = new THREE.SphereGeometry(860, 32, 20);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      transparent: true,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uCover: { value: Config.CLOUD_COVER },
        uBrightness: { value: Config.CLOUD_BRIGHTNESS },
        uSunDir: { value: this._sunDir.clone() },
        uSkyTint: { value: new THREE.Color(0xbcd4ef) },
        uWarm: { value: new THREE.Color(0xffd9b0) },
      },
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        // fbm barato: value noise em 3 oitavas, domínio achatado (dome longe)
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          float a = hash(i), b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }
        uniform float uTime; uniform float uCover; uniform float uBrightness;
        uniform vec3 uSunDir; uniform vec3 uSkyTint; uniform vec3 uWarm;
        varying vec3 vDir;
        void main() {
          float h = vDir.y;
          if (h <= 0.01) { gl_FragColor = vec4(0.0); return; }
          // projeção no plano do "teto": nuvens não esticam no horizonte
          vec2 uv = vDir.xz / max(h, 0.12) * 0.55;
          uv += vec2(uTime * 0.006, uTime * 0.0022);
          float n = vnoise(uv * 1.0) * 0.55 + vnoise(uv * 2.3) * 0.3 + vnoise(uv * 5.1) * 0.15;
          float cover = mix(0.72, 0.36, clamp(uCover, 0.0, 1.0));
          float cl = smoothstep(cover, cover + 0.22, n);
          // fino no horizonte, cheio no zênite
          cl *= smoothstep(0.02, 0.34, h);
          float sunSide = max(dot(normalize(vec3(vDir.x, max(h, 0.05), vDir.z)), uSunDir), 0.0);
          vec3 col = mix(uSkyTint, vec3(1.0), 0.62) * uBrightness;
          col = mix(col, uWarm, pow(sunSide, 3.0) * 0.75);      // borda iluminada
          col *= 0.78 + 0.34 * smoothstep(cover, cover + 0.3, n); // miolo mais denso
          gl_FragColor = vec4(col, cl * 0.86);
        }
      `,
    });
    const clouds = new THREE.Mesh(geo, mat);
    clouds.frustumCulled = false;
    clouds.renderOrder = -2; // atrás de tudo, junto com o céu
    clouds.name = 'clouds';
    this.scene.add(clouds);
    this.clouds = clouds;
  }

  _buildLights() {
    const sun = this.sunDirection();
    // Fill céu/chão (nada de preto em sombra — regra da skill).
    const hemi = new THREE.HemisphereLight(Config.HEMI_SKY, Config.HEMI_GROUND, Config.HEMI_INTENSITY);
    this.scene.add(hemi);
    this.hemi = hemi;

    // Key solar: a posição vem da MESMA direção do Sky → sombras batem com o sol
    // que o jogador vê no céu (antes eram duas direções diferentes).
    const dir = new THREE.DirectionalLight(Config.SUN_COLOR, Config.SUN_INTENSITY);
    const off = sun.clone().multiplyScalar(150);
    dir.position.copy(off);
    this.sunOffset = off;
    dir.castShadow = true;
    dir.shadow.mapSize.set(Config.SHADOW_MAP_SIZE, Config.SHADOW_MAP_SIZE);
    const r = Config.SHADOW_RADIUS;
    const cam = dir.shadow.camera;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
    cam.near = 1;
    cam.far = 420;
    cam.updateProjectionMatrix();
    // acne em terreno grande: bias pequeno + normalBias maior que o quad (2.3 m)
    dir.shadow.bias = -0.0006;
    dir.shadow.normalBias = 0.09;
    dir.target.position.set(0, 0, 0);
    this.scene.add(dir);
    this.scene.add(dir.target);
    this.sun = dir;
    this.shadowRadius = r;
  }

  /**
   * Irradiância do céu em um cubemap (uma vez). Sem isso, `MeshStandardMaterial`
   * com metalness/reflexo fica preto — o clássico "cena sem environment".
   */
  _buildEnvironment() {
    if (!this.renderer || !this.renderer.capabilities) return;
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      pmrem.compileEquirectangularShader();
      const envSky = new Sky();
      envSky.scale.setScalar(1000);
      const su = envSky.material.uniforms;
      const src = this.sky.material.uniforms;
      su.turbidity.value = src.turbidity.value;
      su.rayleigh.value = src.rayleigh.value;
      su.mieCoefficient.value = src.mieCoefficient.value;
      su.mieDirectionalG.value = src.mieDirectionalG.value;
      su.sunPosition.value.copy(src.sunPosition.value);
      this._envRT = pmrem.fromScene(envSky, 0.04, 1, 4000);
      this.scene.environment = this._envRT.texture;
      envSky.geometry.dispose();
      envSky.material.dispose();
      pmrem.dispose();
    } catch {
      // PMREM pode falhar sem GL disponível (teste headless): segue sem envMap
      this._envRT = null;
    }
  }

  /**
   * Aplica o environment + exposição nos materiais criados até agora.
   * Chamado pelo Engine depois de montar o mundo (world/ não conhece a cena).
   */
  applyEnvironment(root = this.scene) {
    const env = this.scene.environment;
    root.traverse((o) => {
      const m = o.material;
      if (!m) return;
      const list = Array.isArray(m) ? m : [m];
      for (const mat of list) {
        if (!mat.isMeshStandardMaterial) continue;
        mat.envMap = env || null;
        mat.envMapIntensity = env ? Config.ENV_INTENSITY : 0;
        if ('roughness' in mat && mat.roughness < 0.35) mat.needsUpdate = true;
      }
    });
  }

  /** Centraliza a sombra no jogador e move céu/nuvens com ele (sem paralaxe). */
  follow(x, y, z) {
    this.sun.position.set(x + this.sunOffset.x, y + this.sunOffset.y, z + this.sunOffset.z);
    this.sun.target.position.set(x, y, z);
    this.sun.target.updateMatrixWorld();
    if (this.sky) this.sky.position.set(x, y * 0.2, z);
    if (this.clouds) this.clouds.position.set(x, 0, z);
  }

  update(dt) {
    if (this.clouds && this.cloudsEnabled) {
      this.clouds.material.uniforms.uTime.value += dt;
    }
  }

  /** MÍNIMA desliga a sombra (economiza 1 render pass do shadow map). */
  setShadowsEnabled(enabled) {
    if (this.sun.castShadow === enabled) return;
    this.sun.castShadow = enabled;
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null; // força re-cria no próximo frame
    }
  }

  /** Nuvens só em ALTA/MÉDIA: fill-rate é o que derruba FPS no Android. */
  setQuality(label) {
    const clouds = label !== 'BAIXA' && label !== 'MÍNIMA';
    if (this.clouds && this.clouds.visible !== clouds) this.clouds.visible = clouds;
    this.cloudsEnabled = clouds;
    // sombra menor em BAIXA (512px) — 1024 custa caro em GPU mobile fraca
    const size = label === 'ALTA' ? 1024 : label === 'MÉDIA' ? 1024 : 512;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null;
      }
    }
  }

  /** Exposição do tone mapping casada com o Sky (chamado pelo Engine). */
  /** Climate: cobre das nuvens (0 = céu limpo, 1 = céu fechado). */
  setCloudCover(v) {
    if (this.clouds && this.clouds.material.uniforms.uCover) {
      this.clouds.material.uniforms.uCover.value = Math.max(0, Math.min(1, v));
    }
  }

  /** Climate: exposição do tone mapping (0.78 tempestade → 0.9 claro). */
  setExposure(v) {
    const r = this.renderer;
    if (!r || !('toneMappingExposure' in r)) return;
    r.toneMappingExposure = Math.max(0.4, Math.min(1.4, v));
  }

  applyExposure(renderer) {
    if (renderer && 'toneMappingExposure' in renderer) {
      renderer.toneMappingExposure = Config.SKY_EXPOSURE;
    }
  }

  dispose() {
    if (this.sky) {
      this.scene.remove(this.sky);
      this.sky.geometry.dispose();
      this.sky.material.dispose();
    }
    if (this.clouds) {
      this.scene.remove(this.clouds);
      this.clouds.geometry.dispose();
      this.clouds.material.dispose();
    }
    if (this._envRT) {
      this._envRT.dispose();
      this.scene.environment = null;
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
