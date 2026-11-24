import * as THREE from 'three';
import { Config } from '../core/Config.js';

/**
 * Climate.js — Clima do cenário (Fase 6/11: "cenário enriquece com clima").
 *
 * Não é um sistema de partículas: em Android, o clima que vale o custo é o que
 * muda a **aparência** de tudo de uma vez, e isso já está nos materiais —
 * fog, céu, nuvens e exposição. Então o Climate só faz uma coisa:
 *
 *   interpola entre os presets de clima (claro → nublado → tempestade de gás)
 *   e escreve nos uniforms/materiais do Lighting + na fog da cena.
 *
 * Zero geometria nova, zero textura baixada, 1 lerp por frame. O preset
 * `GAZ` é acionado pelo Engine quando a zona está na fase final — o mesmo
 * céu que era azul fica alaranjado e a névoa encurta, e o jogador SENTE o
 * cerco fechando sem precisar olhar o HUD.
 *
 * Regra da skill `threejs-materials-lighting`: ao mexer na fog, atualize a
 * cor de fundo E a luz hemisférica junto — senão o horizonte "descola" do céu.
 */
export const CLIMATE = Object.freeze({
  CLEAR: 'CLEAR',
  OVERCAST: 'OVERCAST',
  GAZ: 'GAZ',
});

const PRESETS = {
  CLEAR: {
    fogColor: Config.FOG_COLOR, fogNear: Config.FOG_NEAR, fogFar: Config.FOG_FAR,
    hemiIntensity: Config.HEMI_INTENSITY, hemiSky: 0x9fc2e8, hemiGround: 0x54613c,
    exposure: Config.SKY_EXPOSURE, cloudCover: Config.CLOUD_COVER,
    sunTint: 0xffe6c2, sunIntensity: Config.SUN_INTENSITY,
  },
  OVERCAST: {
    fogColor: 0xbfc4c6, fogNear: 62, fogFar: 210,
    hemiIntensity: 0.86, hemiSky: 0xc6d2dd, hemiGround: 0x4a5038,
    exposure: 0.8, cloudCover: 0.86,
    sunTint: 0xdfe6ef, sunIntensity: 1.05,
  },
  GAZ: {
    fogColor: 0xc9a06a, fogNear: 34, fogFar: 132,
    hemiIntensity: 0.5, hemiSky: 0xd8a05a, hemiGround: 0x4a3218,
    exposure: 0.78, cloudCover: 0.7,
    sunTint: 0xffb469, sunIntensity: 1.5,
  },
};

export class Climate {
  /**
   * @param {THREE.Scene} scene
   * @param {{lighting?:object, quality?:string}} opts
   */
  scene;

  constructor(scene, opts = {}) {
    this.scene = scene;
    this.lighting = opts.lighting || null;
    this.preset = CLIMATE.CLEAR;
    this.target = CLIMATE.CLEAR;
    this.blend = 1; // 1 = chegou no target
    this.speed = 0.55; // s^-1: ~2 s para o clima virar (legível, não instantâneo)
    this._tmpColor = new THREE.Color();
    this._from = { ...PRESETS.CLEAR };
    this._to = { ...PRESETS.CLEAR };
    this._cur = { ...PRESETS.CLEAR, fogColor: new THREE.Color(Config.FOG_COLOR) };
  }

  /** Muda o clima; `instant=true` evita animação (ex.: volta ao lobby). */
  set(preset, { instant = false } = {}) {
    if (!PRESETS[preset] || preset === this.target) return;
    this.target = preset;
    this._from = this._snapshot();
    this._to = { ...PRESETS[preset] };
    this.blend = instant ? 1 : 0;
    if (instant) this._apply(1);
  }

  get active() {
    return this.preset;
  }

  update(dt) {
    if (this.blend >= 1) return;
    this.blend = Math.min(1, this.blend + dt * this.speed);
    this._apply(this.blend);
    if (this.blend >= 1) this.preset = this.target;
  }

  /** Engine chama quando a zona entra em fase final. */
  onZonePhase(phaseIndex, isFinal) {
    this.set(isFinal ? CLIMATE.GAZ : CLIMATE.CLEAR);
  }

  _snapshot() {
    return {
      fogColor: this._cur.fogColor.clone(),
      fogNear: this._cur.fogNear,
      fogFar: this._cur.fogFar,
      hemiIntensity: this._cur.hemiIntensity,
      hemiSky: this._cur.hemiSky,
      hemiGround: this._cur.hemiGround,
      exposure: this._cur.exposure,
      cloudCover: this._cur.cloudCover,
      sunTint: this._cur.sunTint,
      sunIntensity: this._cur.sunIntensity,
    };
  }

  _apply(t) {
    const a = this._from;
    const b = this._to;
    const fog = this.scene?.fog;
    if (fog) {
      // cores em espaço linear (three já trata Color como linear) → lerp direto
      this._tmpColor.set(a.fogColor.r, a.fogColor.g, a.fogColor.b);
      this._cur.fogColor.copy(this._tmpColor).lerp(
        new THREE.Color(b.fogColor.r, b.fogColor.g, b.fogColor.b), t,
      );
      fog.color.copy(this._cur.fogColor);
      fog.near = lerp(a.fogNear, b.fogNear, t);
      fog.far = lerp(a.fogFar, b.fogFar, t);
      // horizonte = fundo: sem isto o "céu" atrás da montanha fica preto
      if (this.scene.background && this.scene.background.isColor) {
        this.scene.background.copy(this._cur.fogColor);
      }
    }
    const L = this.lighting;
    if (L) {
      if (L.hemi) {
        L.hemi.intensity = lerp(a.hemiIntensity, b.hemiIntensity, t);
        L.hemi.color.set(b.hemiSky);
        L.hemi.groundColor.set(b.hemiGround);
      }
      if (L.sun) {
        L.sun.intensity = lerp(a.sunIntensity, b.sunIntensity, t);
        L.sun.color.set(b.sunTint);
      }
      if (L.setCloudCover) L.setCloudCover(lerp(a.cloudCover, b.cloudCover, t));
      if (L.setExposure && L.renderer) L.setExposure(lerp(a.exposure, b.exposure, t));
    }
  }

  dispose() {
    /* nada a liberar: o Climate não cria GPU resource */
  }
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
