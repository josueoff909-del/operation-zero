import * as THREE from 'three';
import { Config } from '../core/Config.js';
import { terrainHeight, groundTint, fbm } from '../utils/Noise.js';

/** Ruído de grão 128px em canvas → `map` repetido. Barato e elimina o chapado. */
function makeGroundDetail() {
  const size = 128;
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!canvas || !canvas.getContext) return null;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const speck = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
      const v = 214 + Math.abs(speck) * 42; // 0.84..1.0 → multiplica o vertexColor
      img.data[i] = v;
      img.data[i + 1] = v * 0.995;
      img.data[i + 2] = v * 0.96;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(64, 64);
  tex.anisotropy = 4;
  return tex;
}

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
    const tmp = new THREE.Color();
    const tint = [0, 0, 0];
    // variação de cor por mancha (nada de "grama chapada") + inclinação = rocha
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = terrainHeight(x, z);
      pos.setY(i, h);
      groundTint(x, z, h, tint);
      // encosta íngreme = pedra exposta (avalia a altura vizinha, barato)
      const slope = Math.abs(terrainHeight(x + 2.3, z) - h) + Math.abs(terrainHeight(x, z + 2.3) - h);
      const rocky = Math.min(1, Math.max(0, (slope - 0.9) * 0.9));
      const patch = 0.9 + fbm(x * 0.05, z * 0.05, 2, 313) * 0.24;
      tmp.setRGB(
        (tint[0] * (1 - rocky) + 0.47 * rocky) * patch,
        (tint[1] * (1 - rocky) + 0.46 * rocky) * patch,
        (tint[2] * (1 - rocky) + 0.44 * rocky) * patch,
      );
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const detail = makeGroundDetail();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.94,
      metalness: 0.0,
      // grão de detalhe gerado em canvas (zero download): sem isso o terreno
      // de 400 m com cor por vértice parece tinta de parede
      map: detail,
    });
    if (detail) detail.colorSpace = THREE.SRGBColorSpace;
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
    if (this.mesh.material.map) this.mesh.material.map.dispose();
    this.mesh.material.dispose();
  }
}
