import * as THREE from 'three';

/**
 * SceneManager.js — Gerencia a cena ativa e o ciclo de vida dela.
 * Skill §1: ao trocar de cena (Lobby → Avião → Mapa, Fases 8+),
 * TODAS as geometrias/materiais/texturas da cena antiga devem
 * receber .dispose() p/ não vazar memória no Android.
 */
export class SceneManager {
  constructor() {
    this.scene = null;
    this.camera = null;
  }

  /** Cria a câmera padrão (perspectiva 75° — FOV de FPS). */
  createCamera() {
    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      600, // longe o bastante p/ ver o mapa inteiro + céu
    );
    camera.rotation.order = 'YXZ'; // Skill §3: Euler YXZ evita Gimbal Lock
    return camera;
  }

  /** Define a cena ativa, descartando a anterior com dispose() completo. */
  setScene(scene, camera) {
    if (this.scene) this.disposeScene(this.scene);
    this.scene = scene;
    this.camera = camera;
    window.addEventListener('resize', () => {
      if (this.camera) {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
      }
    });
  }

  /** Percorre a cena e libera GPU resources (geometrias, materiais, texturas). */
  disposeScene(scene) {
    scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of materials) {
          for (const key of Object.keys(mat)) {
            const value = mat[key];
            if (value && value.isTexture) value.dispose();
          }
          mat.dispose();
        }
      }
    });
  }
}
