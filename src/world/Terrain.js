import * as THREE from 'three';
import { Config } from '../core/Config.js';
import { terrainHeight } from '../utils/Noise.js';

/**
 * Terrain.js — Terreno base da Fase 1.
 * PlaneGeometry deslocado pelo heightmap + cores por vértice
 * (areia/grama/rocha conforme a altura e a inclinação).
 * Expõe getHeightAt(x,z) p/ o jogador "andar" sobre o relevo.
 */
export class Terrain {
  constructor() {
    this.size = Config.WORLD_SIZE;
    this.mesh = this._buildMesh();
  }

  _buildMesh() {
    const geo = new THREE.PlaneGeometry(
      this.size, this.size,
      Config.TERRAIN_SEGMENTS, Config.TERRAIN_SEGMENTS,
    );
    geo.rotateX(-Math.PI / 2); // deita no plano XZ

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const sand = new THREE.Color(0xc2b280);
    const grass = new THREE.Color(0x4a7c3a);
    const grassDry = new THREE.Color(0x7a9a4a);
    const rock = new THREE.Color(0x7d7a72);
    const tmp = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = terrainHeight(x, z);
      pos.setY(i, h);

      // Cor por altura: baixo = areia, médio = grama, alto = rocha.
      if (h < -1.2) tmp.copy(sand);
      else if (h < 3.5) tmp.copy(grass).lerp(grassDry, Math.min(1, Math.max(0, (h + 1.2) / 4.7)));
      else tmp.copy(grassDry).lerp(rock, Math.min(1, (h - 3.5) / 3.5));
      // Variação sutil p/ não ficar "chapado".
      const jitter = 0.94 + ((i * 37) % 13) / 100;
      colors[i * 3] = tmp.r * jitter;
      colors[i * 3 + 1] = tmp.g * jitter;
      colors[i * 3 + 2] = tmp.b * jitter;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0.0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    return mesh;
  }

  /** Altura do solo em (x,z) — mesma função usada p/ gerar a malha. */
  getHeightAt(x, z) {
    return terrainHeight(x, z);
  }

  /** Limita a posição às bordas do mundo (parede invisível da Fase 1). */
  clampToWorld(position, radius) {
    const half = this.size / 2 - radius;
    position.x = Math.max(-half, Math.min(half, position.x));
    position.z = Math.max(-half, Math.min(half, position.z));
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
