import * as THREE from 'three';
import { Config } from '../core/Config.js';
import { terrainHeight } from '../utils/Noise.js';

/**
 * Vegetation.js — Vegetação e pedras com InstancedMesh (Skill §1).
 *
 * Duas espécies de árvore (pinheiro + folhosa com 2 blobs de copa), pedras e
 * arbustos + tufos de grama, tudo em **6 draw calls**. Cor por instância
 * (`setColorAt`) quebra o visual "chapado" sem custo de textura
 * (threejs-materials-lighting skill: nada de material fosco idêntico).
 *
 * Reaproveitamento: 1 geometria por classe + materiais compartilhados.
 * RNG com seed fixa → mapa determinístico e colisões reproduzíveis.
 *
 * Fase 3/pedido atual: a vegetação também produz **colisores** (troncos e
 * pedras sólidos — não dá mais para atravessar árvore). O módulo entrega
 * `this.colliders` como dados puros; quem liga no mundo de colisão é o
 * `Engine` (world/ não conhece systems/).
 */
export class Vegetation {
  constructor(scene) {
    this.scene = scene;
    this.instancedMeshes = [];
    /** Caixas/círculos sólidos p/ o Collision (dados puros, sem importar systems/). */
    this.colliders = [];
    /** posições das árvores p/ o Lobby/itens decorativos consultarem */
    this.trees = [];
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
    const half = Config.WORLD_SIZE / 2 - 8;
    const clear = Config.VEGETATION_TOWN_CLEAR;

    // Sorteio com rejeição: nada nasce dentro da cidade (prédios/ruas).
    const randPos = (minRadius = clear) => {
      let x = 0;
      let z = 0;
      for (let tries = 0; tries < 24; tries++) {
        x = (rand() * 2 - 1) * half;
        z = (rand() * 2 - 1) * half;
        if (Math.hypot(x, z) >= minRadius) break;
      }
      return { x, z };
    };

    // --- Árvores (2 espécies) ---
    const pineGeoms = [];
    for (let i = 0; i < Config.TREE_COUNT; i++) {
      const { x, z } = randPos();
      const y = terrainHeight(x, z);
      const pine = rand() < Config.TREE_PINE_RATIO;
      const scale = 0.8 + rand() * 0.9;
      const tree = {
        x, y, z,
        rot: rand() * Math.PI * 2,
        scale,
        squash: 0.9 + rand() * 0.3,
        hue: rand(),
        pine,
        canopy: 1 + (pine ? 0 : rand() < 0.5 ? 1 : 0), // folhosas às vezes têm 2 blobs
      };
      this.trees.push(tree);
      pineGeoms.push(tree);
      // tronco sólido: não dá mais p/ atravessar árvore; topo não é piso
      this.colliders.push({ kind: 'circle', x, z, r: 0.42 * scale, minY: y - 0.4, maxY: y + 2.6 * scale, walkable: false });
    }

    // --- Pedras / arbustos / grama ---
    const rocks = [];
    for (let i = 0; i < Config.ROCK_COUNT; i++) {
      const { x, z } = randPos();
      const s = 0.5 + rand() * 1.3;
      const y = terrainHeight(x, z);
      rocks.push({ x, z, y, s, rot: rand() * Math.PI * 2, tilt: rand() * 0.4, hue: rand() });
      // pedra: sólida e subível (dá p/ pular em cima dela)
      this.colliders.push({ kind: 'circle', x, z, r: 0.72 * s, minY: y - 0.4, maxY: y + 0.62 * s, walkable: true });
    }
    const bushes = [];
    for (let i = 0; i < Config.BUSH_COUNT; i++) {
      const { x, z } = randPos();
      const s = 0.6 + rand() * 0.9;
      bushes.push({ x, z, y: terrainHeight(x, z), s, rot: rand() * Math.PI * 2, hue: rand() });
    }
    const grass = [];
    for (let i = 0; i < Config.GRASS_COUNT; i++) {
      const { x, z } = randPos(30); // grama pode chegar mais perto da cidade
      grass.push({ x, z, y: terrainHeight(x, z), s: 0.7 + rand() * 0.9, rot: rand() * Math.PI * 2, hue: rand() });
    }

    // --- Geometrias compartilhadas (low poly — Skill §1) ---
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 2.4, 5);
    trunkGeo.translate(0, 1.2, 0);
    const pineGeo = new THREE.ConeGeometry(1.7, 3.6, 7);
    pineGeo.translate(0, 3.9, 0);
    const blobGeo = new THREE.IcosahedronGeometry(1.5, 0);
    blobGeo.translate(0, 3.3, 0);
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const bushGeo = new THREE.IcosahedronGeometry(0.8, 0);
    const grassGeo = new THREE.ConeGeometry(0.22, 0.85, 3);
    grassGeo.translate(0, 0.42, 0);

    const mat = (color, roughness, opts = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, flatShading: !!opts.flat, vertexColors: false });

    const trunkMat = mat(0x6b4a2b, 1);
    const pineMat = mat(0x2f6b2f, 0.9, { flat: true });
    const leafMat = mat(0x3f7a34, 0.92, { flat: true });
    const rockMat = mat(0x8a8578, 1, { flat: true });
    const bushMat = mat(0x3d7a35, 0.95, { flat: true });
    const grassMat = mat(0x6f9a45, 1, { flat: true });

    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();

    /** Cria um InstancedMesh a partir de uma lista + função de placement. */
    const build = (name, count, geometry, material, placeFn, opts = {}) => {
      if (count === 0) return null;
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      let hasColor = false;
      for (let i = 0; i < count; i++) {
        const color = placeFn(i, dummy, tint);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        if (color) {
          if (!hasColor) { hasColor = true; }
          mesh.setColorAt(i, color);
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = !!opts.cast;
      mesh.receiveShadow = opts.receive !== false;
      mesh.frustumCulled = true; // bounds calculados p/ o conjunto de instâncias
      mesh.name = name;
      this.scene.add(mesh);
      this.instancedMeshes.push(mesh);
      return mesh;
    };

    // Troncos (todas as árvores)
    build('tree-trunks', this.trees.length, trunkGeo, trunkMat, (i, d) => {
      const t = this.trees[i];
      d.position.set(t.x, t.y, t.z);
      d.rotation.set(0, t.rot, 0);
      d.scale.set(t.scale, t.scale * t.squash, t.scale);
      return null;
    }, { cast: true });

    // Copas de pinheiro (1 cone) + copas de folhosa (1–2 blobs) num só mesh
    const pineCanopies = pineGeoms.filter((t) => t.pine);
    const leafBlobs = [];
    for (const t of pineGeoms) {
      if (t.pine) continue;
      for (let b = 0; b < t.canopy; b++) leafBlobs.push({ t, b });
    }
    build('canopy-pine', pineCanopies.length, pineGeo, pineMat, (i, d) => {
      const t = pineCanopies[i];
      d.position.set(t.x, t.y, t.z);
      d.rotation.set(0, t.rot, 0);
      d.scale.set(t.scale, t.scale * t.squash, t.scale);
      // verde varia do musgo ao oliva (nunca "chapado")
      tint.setHSL(0.29 + t.hue * 0.07, 0.42 + t.hue * 0.14, 0.26 + t.hue * 0.1);
      return tint;
    }, { cast: true });

    build('canopy-broadleaf', leafBlobs.length, blobGeo, leafMat, (i, d) => {
      const { t, b } = leafBlobs[i];
      const off = b === 0 ? 0 : 0.9;
      d.position.set(t.x + (b ? Math.cos(t.rot) * 0.8 : 0), t.y + off, t.z + (b ? Math.sin(t.rot) * 0.8 : 0));
      d.rotation.set(t.hue * 0.3, t.rot + b, t.hue * 0.2);
      const s = t.scale * (b === 0 ? 1 : 0.72);
      d.scale.set(s, s * t.squash, s);
      tint.setHSL(0.24 + t.hue * 0.09, 0.4 + t.hue * 0.16, 0.3 + t.hue * 0.12);
      return tint;
    }, { cast: true });

    build('rocks', rocks.length, rockGeo, rockMat, (i, d) => {
      const r = rocks[i];
      d.position.set(r.x, r.y + 0.1 * r.s, r.z);
      d.rotation.set(r.tilt, r.rot, r.tilt * 0.5);
      d.scale.set(r.s, r.s * 0.72, r.s * (0.9 + r.hue * 0.3));
      tint.setHSL(0.09 + r.hue * 0.06, 0.05 + r.hue * 0.06, 0.42 + r.hue * 0.16);
      return tint;
    }, { cast: true });

    build('bushes', bushes.length, bushGeo, bushMat, (i, d) => {
      const b = bushes[i];
      d.position.set(b.x, b.y + 0.18 * b.s, b.z);
      d.rotation.set(0, b.rot, 0);
      d.scale.set(b.s, b.s * (0.7 + b.hue * 0.3), b.s * (0.9 + b.hue * 0.2));
      tint.setHSL(0.26 + b.hue * 0.08, 0.38 + b.hue * 0.18, 0.24 + b.hue * 0.12);
      return tint;
    }, { cast: false });

    build('grass', grass.length, grassGeo, grassMat, (i, d) => {
      const g = grass[i];
      d.position.set(g.x, g.y, g.z);
      d.rotation.set(0, g.rot, 0);
      d.scale.set(g.s, g.s * (0.8 + g.hue * 0.6), g.s);
      tint.setHSL(0.22 + g.hue * 0.1, 0.42, 0.34 + g.hue * 0.14);
      return tint;
    }, { cast: false, receive: false });
  }

  /** Registra os colisores no mundo de colisão (chamado pelo Engine). */
  applyTo(collision) {
    for (const c of this.colliders) {
      if (c.kind === 'circle') collision.addCircle(c.x, c.z, c.r, c.minY, c.maxY, { walkable: c.walkable });
      else collision.addBox(c.x, c.z, c.sx, c.sz, c.minY, c.maxY, { walkable: c.walkable });
    }
    return this.colliders.length;
  }

  dispose() {
    for (const mesh of this.instancedMeshes) {
      mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
      else mesh.material.dispose();
      this.scene.remove(mesh);
    }
    this.instancedMeshes = [];
    this.colliders = [];
    this.trees = [];
  }
}
