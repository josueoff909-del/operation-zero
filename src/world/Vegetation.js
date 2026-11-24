import * as THREE from 'three';
import { Config } from '../core/Config.js';
import { terrainHeight } from '../utils/Noise.js';

/**
 * Vegetation.js — Vegetação e pedras com InstancedMesh (Skill §1).
 * Centenas de objetos repetidos em apenas 5 draw calls:
 * troncos, copas, pedras e arbustos. Geometrias de baixo polígono
 * (tronco 5 lados, copa 7 lados) p/ caber no orçamento mobile.
 * RNG com seed fixa: o mapa é o mesmo em toda sessão/dispositivo.
 */
export class Vegetation {
  constructor(scene) {
    this.scene = scene;
    this.instancedMeshes = [];
    this._scatter();
  }

  /** RNG determinístico (mulberry32). */
  _rng(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  _scatter() {
    const rand = this._rng(20241124);
    const half = Config.WORLD_SIZE / 2 - 6;
    const dummy = new THREE.Object3D();

    // Fase 2: a cidade (prédios/ruas) ocupa o centro — vegetação só fora dela.
    const randPos = () => {
      let x = 0;
      let z = 0;
      for (let tries = 0; tries < 24; tries++) {
        x = (rand() * 2 - 1) * half;
        z = (rand() * 2 - 1) * half;
        if (Math.hypot(x, z) >= Config.VEGETATION_TOWN_CLEAR) break;
      }
      return { x, z };
    };

    const place = (mesh, minScale, maxScale) => {
      for (let i = 0; i < mesh.count; i++) {
        const { x, z } = randPos();
        const y = terrainHeight(x, z);
        const s = minScale + rand() * (maxScale - minScale);
        dummy.position.set(x, y, z);
        dummy.rotation.set(0, rand() * Math.PI * 2, 0);
        dummy.scale.set(s, s * (0.9 + rand() * 0.3), s);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = true;
      this.scene.add(mesh);
      this.instancedMeshes.push(mesh);
    };

    // --- Troncos (cilindro 5 lados) ---
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 2.4, 5);
    trunkGeo.translate(0, 1.2, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, Config.TREE_COUNT);
    trunks.castShadow = true;
    trunks.receiveShadow = true;

    // --- Copas (cone 7 lados) ---
    const canopyGeo = new THREE.ConeGeometry(1.7, 3.6, 7);
    canopyGeo.translate(0, 3.6, 0);
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x2f6b2f, roughness: 0.9 });
    const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, Config.TREE_COUNT);
    canopies.castShadow = true;
    canopies.receiveShadow = true;

    // --- Pedras (dodecaedro achatado) ---
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a8578, roughness: 1 });
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, Config.ROCK_COUNT);
    rocks.castShadow = true;
    rocks.receiveShadow = true;

    // --- Arbustos (icosaedro pequeno) ---
    const bushGeo = new THREE.IcosahedronGeometry(0.8, 0);
    const bushMat = new THREE.MeshStandardMaterial({ color: 0x3d7a35, roughness: 1 });
    const bushes = new THREE.InstancedMesh(bushGeo, bushMat, Config.BUSH_COUNT);
    bushes.castShadow = false; // arbusto não projeta sombra (economia)
    bushes.receiveShadow = true;

    // Troncos e copas compartilham a mesma distribuição (árvore = 2 instâncias).
    // Para isso, geramos posições uma vez e aplicamos nos dois meshes.
    const positions = [];
    for (let i = 0; i < Config.TREE_COUNT; i++) {
      const { x, z } = randPos();
      positions.push({
        x,
        z,
        rot: rand() * Math.PI * 2,
        scale: 0.8 + rand() * 0.9,
        squash: 0.9 + rand() * 0.3,
      });
    }
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      const y = terrainHeight(p.x, p.z);
      dummy.position.set(p.x, y, p.z);
      dummy.rotation.set(0, p.rot, 0);
      dummy.scale.set(p.scale, p.scale * p.squash, p.scale);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
      canopies.setMatrixAt(i, dummy.matrix);
    }
    trunks.instanceMatrix.needsUpdate = true;
    canopies.instanceMatrix.needsUpdate = true;
    trunks.frustumCulled = true;
    canopies.frustumCulled = true;
    this.scene.add(trunks, canopies);
    this.instancedMeshes.push(trunks, canopies);

    place(rocks, 0.5, 1.8);
    place(bushes, 0.6, 1.4);
  }

  dispose() {
    for (const mesh of this.instancedMeshes) {
      mesh.geometry.dispose();
      mesh.material.dispose();
      this.scene.remove(mesh);
    }
    this.instancedMeshes = [];
  }
}
