import * as THREE from 'three';
import { Config } from '../core/Config.js';
import { terrainHeight, lakeDepth } from '../utils/Noise.js';

/**
 * Landmarks.js — as regiões nomeadas do mapa (GDD §2: POIs + rotas de rotação).
 *
 * O mapa tinha UMA cidade e virou "árvore até o limite". Aqui entram 3 POIs
 * novos + subúrbios encostados na cidade, todos construídos como **dados**
 * (blocos) e materializados em 8 `InstancedMesh` (2 draw calls por material
 * quando tem cilindro) — o mesmo padrão do `Buildings`, então o cenário cresce
 * de 400 para ~1500 volumes por ~+8 draw calls, não +1500.
 *
 *   DEPÓSITO  containers, galpões, silos, tanques, cercas, caminhões
 *   FAZENDA   celeiro, silo, torre d'água, currais, fardos, trator
 *   ANTENAS   torres de treliça, dishes, bunkers, ruínas de concreto
 *   LAGO      píeres pisáveis, casinhas de praia, barco, quebra-ondas
 *   SUBÚRBIO  filas de casas iguais (baratas!) ao norte e ao sul da cidade
 *
 * Cada bloco sólido registra AABB/círculo no `Collision` (parede bloqueia,
 * piso/píer é pisável) e cada POI entra na lista de `spawnPoints()` p/ os bots
 * e no sorteio do centro da `Zone`.
 */
const CONTAINER_COLORS = [0x2f6f8f, 0xb0563a, 0x3f7a4f, 0xa8873c, 0x7a4f8c, 0x9a9a9a, 0x2f6f8f, 0xc4653a];
const HOUSE_COLORS = [0xd8c39a, 0xc9a88a, 0xa9b7a0, 0xbfae94, 0xd2b6a6, 0xc7b7a6];

export class Landmarks {
  constructor(scene, collision, rngSeed = 4242) {
    this.scene = scene;
    this.collision = collision;
    this.groups = new Map();
    this.spawnPoints = [];
    this.poiRings = [];
    this._box = new THREE.BoxGeometry(1, 1, 1);
    this._cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
    this._cylGroups = new Set();
    this._rng = mulberry(rngSeed);
    this._build();
    this._instantiate();
  }

  _push(group, block, cyl = false) {
    if (!this.groups.has(group)) this.groups.set(group, []);
    this.groups.get(group).push(block);
    if (cyl) this._cylGroups.add(group);
  }

  /** Bloco visual + colisão (mesma semântica do Buildings). */
  _solid(group, cx, cz, sx, sz, minY, maxY, opts = {}) {
    const color = opts.color ?? 0xffffff;
    this._push(group, {
      cx, cz, sx, sz,
      cy: (minY + maxY) / 2,
      sy: maxY - minY,
      color,
      rot: opts.rot || 0,
    }, !!opts.cyl);
    if (this.collision && opts.collide !== false) {
      if (opts.cyl) {
        this.collision.addCircle(cx, cz, Math.max(sx, sz) / 2, minY, maxY, { walkable: opts.walkable === true });
      } else {
        this.collision.addBox(cx, cz, sx, sz, minY, maxY, { walkable: opts.walkable !== false });
      }
    }
  }

  /** Casa simples com fachada, telhado em 2 águas, varanda e muro. */
  _house(x, z, rot, baseY, floors = 1, w = 8, d = 7) {
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const t = 0.3;
    const h = 3.1 * floors;
    const color = HOUSE_COLORS[(this._rng() * HOUSE_COLORS.length) | 0];
    const roofColor = 0x8a4b32;
    // 4 paredes (com vão de porta na frente)
    const walls = [
      [0, -d / 2, w, t, false],
      [0, d / 2, w, t, false],
      [-w / 2, 0, t, d, false],
      [w / 2, 0, t, d, false],
    ];
    for (const [ox, oz, sx, sz] of walls) {
      const cx = x + ox * cos - oz * sin;
      const cz = z + ox * sin + oz * cos;
      this._solid('wall', cx, cz, sx, sz, baseY - 0.5, baseY + h, { color, rot });
    }
    // laje do andar de cima + telhado
    this._solid('floor', x, z, w + 0.4, d + 0.4, baseY + 3.0, baseY + 3.2, { color: 0xb7a68d, rot });
    this._solid('roof', x, z, w + 1.1, d + 1.1, baseY + h, baseY + h + 0.45, { color: roofColor, rot, walkable: false });
    this._solid('roof', x, z - d * 0.18, w + 0.6, d * 0.55, baseY + h + 0.45, baseY + h + 1.25, { color: roofColor, rot, walkable: false });
    // escada/caixa d'água no telhado (pisável)
    this._solid('metal', x + w * 0.22, z + d * 0.12, 1.5, 1.5, baseY + h + 0.45, baseY + h + 1.35, { color: 0x9aa1a6, rot });
    // muro de fundo com vão
    this._solid('lowwall', x + Math.sin(rot) * (d / 2 + 2.4), z + Math.cos(rot) * (d / 2 + 2.4) * -1, w + 3, 0.35, baseY, baseY + 1.25, { color: 0xa89f8d, rot });
    return { x, z, w, d };
  }

  _build() {
    for (const poi of Config.POIS) {
      const gy = terrainHeight(poi.x, poi.z);
      if (poi.id === 'deposito') this._depot(poi, gy);
      else if (poi.id === 'fazenda') this._farm(poi, gy);
      else if (poi.id === 'antenas') this._antennas(poi, gy);
      else if (poi.id === 'lago') this._lakefront(poi, gy);
      else this._suburb(poi, gy);
    }
  }

  // ------------------------------------------------------------- DEPÓSITO
  _depot(poi, y0) {
    const rows = 4;
    const cols = 5;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = poi.x - 22 + c * 10;
        const z = poi.z - 16 + r * 10;
        const stack = this._rng() < 0.42 ? 2 : 1;
        for (let s = 0; s < stack; s++) {
          this._solid('metal', x, z, 6.1, 2.5, y0 + s * 2.7, y0 + s * 2.7 + 2.6, {
            color: CONTAINER_COLORS[((r + c + s) * 3) % CONTAINER_COLORS.length],
            rot: (r + c) % 2 ? Math.PI / 2 : 0,
            walkable: s === 0, // dá p/ subir no container de baixo
          });
        }
      }
    }
    // 2 galpões com telhado metálico e porta aberta
    for (let i = 0; i < 2; i++) {
      const bx = poi.x + 22;
      const bz = poi.z - 26 + i * 52;
      this._warehouse(bx, bz, 20, 14, y0, i === 0 ? 0 : Math.PI);
    }
    // 3 silos + tanque
    for (let i = 0; i < 3; i++) {
      const sx = poi.x - 30 + i * 6;
      const sz = poi.z + 26;
      this._solid('metal', sx, sz, 5.2, 5.2, y0, y0 + 13, { color: 0xc7c2b4, cyl: true, walkable: false });
      this._solid('metal', sx, sz, 5.6, 5.6, y0 + 13, y0 + 14.1, { color: 0x9aa1a6, cyl: true, walkable: true });
    }
    this._solid('metal', poi.x - 24, poi.z + 34, 9, 9, y0, y0 + 5.2, { color: 0xb8b3a6, cyl: true, walkable: false });
    // cercas + postes + caminhões estacionados
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      this._solid('lowwall', poi.x + Math.cos(a) * 38, poi.z + Math.sin(a) * 38, 8, 0.3, y0, y0 + 1.7, { color: 0x8b8f86, rot: -a });
    }
    for (let i = 0; i < 3; i++) this._truck(poi.x - 8 + i * 11, poi.z - 30, y0, 0.3 * i);
    this._poiSpawns(poi, 10);
  }

  _warehouse(x, z, w, d, y0, rot) {
    const t = 0.35;
    const h = 6.4;
    const color = 0xa9b0a6;
    for (const [ox, oz, sx, sz, isFront] of [
      [0, -d / 2, w, t, true], [0, d / 2, w, t, false],
      [-w / 2, 0, t, d, false], [w / 2, 0, t, d, false],
    ]) {
      const cx = x + ox * Math.cos(rot) - oz * Math.sin(rot);
      const cz = x * 0 + z + ox * Math.sin(rot) + oz * Math.cos(rot);
      if (isFront) {
        // frente com vão de portão (6 m)
        this._solid('wall', cx - (w / 2 - 3) * Math.cos(rot), cz - (w / 2 - 3) * Math.sin(rot), 6, sz, y0 - 0.5, y0 + h, { color, rot });
        this._solid('wall', cx + (w / 2 - 3) * Math.cos(rot), cz + (w / 2 - 3) * Math.sin(rot), 6, sz, y0 - 0.5, y0 + h, { color, rot });
        this._solid('wall', cx, cz, 6.4, sz, y0 + h - 1.1, y0 + h, { color, rot });
      } else {
        this._solid('wall', cx, cz, sx, sz, y0 - 0.5, y0 + h, { color, rot });
      }
    }
    this._solid('floor', x, z, w - 0.6, d - 0.6, y0 - 0.05, y0 + 0.08, { color: 0x8f8c86, rot, walkable: true });
    this._solid('roof', x, z, w + 1.2, d + 1.2, y0 + h, y0 + h + 0.5, { color: 0x7d858c, rot, walkable: true });
    for (let i = 0; i < 3; i++) {
      this._solid('metal', x - w * 0.3 + i * 4, z + d * 0.2, 2.2, 2.2, y0 + 0.08, y0 + 1.9, { color: 0x8b6b43, rot });
    }
  }

  _truck(x, z, y0, rot) {
    this._solid('metal', x, z, 6.2, 2.4, y0 + 0.55, y0 + 2.6, { color: 0xd8d3c4, rot });
    this._solid('metal', x + Math.cos(rot) * 4.2, z + Math.sin(rot) * 4.2, 2.6, 2.3, y0 + 0.5, y0 + 2.2, { color: 0x39506b, rot });
    this._solid('wall', x, z, 5.4, 1.6, y0 - 0.6, y0 + 0.6, { color: 0x2b2f33, rot, walkable: true, collide: true });
  }

  // -------------------------------------------------------------- FAZENDA
  _farm(poi, y0) {
    // celeiro grande (parede vermelha, telhado em 2 águas)
    const bx = poi.x - 6;
    const bz = poi.z + 4;
    const w = 16;
    const d = 11;
    for (const [ox, oz, sx, sz] of [[0, -d / 2, w, 0.35], [0, d / 2, w, 0.35], [-w / 2, 0, 0.35, d], [w / 2, 0, 0.35, d]]) {
      this._solid('wall', bx + ox, bz + oz, sx, sz, y0 - 0.5, y0 + 4.6, { color: 0x9d4b3a });
    }
    this._solid('floor', bx, bz, w - 0.5, d - 0.5, y0 - 0.05, y0 + 0.1, { color: 0x8a6a48, walkable: true });
    this._solid('roof', bx, bz - d * 0.26, w + 1.4, d * 0.62, y0 + 4.6, y0 + 6.4, { color: 0x6b4a35, rot: 0.24, walkable: true });
    this._solid('roof', bx, bz + d * 0.26, w + 1.4, d * 0.62, y0 + 4.6, y0 + 6.4, { color: 0x6b4a35, rot: -0.24, walkable: true });
    this._solid('roof', bx, bz, w + 1.4, 1.6, y0 + 6.3, y0 + 6.9, { color: 0x6b4a35 });
    // silo + torre d'água
    this._solid('metal', bx + 15, bz - 2, 6.4, 6.4, y0, y0 + 17, { color: 0xcfc9bb, cyl: true, walkable: false });
    this._solid('metal', bx + 15, bz - 2, 7.0, 7.0, y0 + 17, y0 + 18.4, { color: 0x9aa1a6, cyl: true, walkable: true });
    for (let i = 0; i < 4; i++) {
      const ox = (i < 2 ? -1 : 1) * 3.2;
      const oz = (i % 2 ? -1 : 1) * 3.2;
      this._solid('wood', bx + 24 + ox, bz + 12 + oz, 0.5, 0.5, y0, y0 + 11, { color: 0x6b4a2b });
    }
    this._solid('metal', bx + 24, bz + 12, 8.4, 8.4, y0 + 11, y0 + 13.6, { color: 0x8c9aa3, cyl: true, walkable: true });
    // currais (muros baixos) + fardos pisáveis
    for (let p = 0; p < 3; p++) {
      const px = poi.x - 22 + p * 15;
      const pz = poi.z - 20;
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        this._solid('lowwall', px + Math.cos(a) * 5.5, pz + Math.sin(a) * 5.5, 11, 0.3, y0, y0 + 1.35, { color: 0x8b6b43, rot: -a + Math.PI / 2 });
      }
      for (let b = 0; b < 3; b++) {
        this._solid('wood', px - 2 + b * 2, pz + 2, 2.1, 2.1, y0, y0 + 1.5, { color: 0xc9a94f, cyl: false, walkable: true });
      }
    }
    // casas da fazenda + trator
    this._house(poi.x + 6, poi.z - 26, 0.2, y0, 1, 8, 6.5);
    this._house(poi.x + 17, poi.z - 24, -0.4, y0, 1, 7, 6);
    this._solid('metal', poi.x - 14, poi.z + 16, 4.4, 2.6, y0 + 0.4, y0 + 2.2, { color: 0xc2502f });
    this._solid('metal', poi.x - 12.4, poi.z + 16, 1.8, 2.2, y0 + 0.4, y0 + 2.8, { color: 0x33445a });
    this._poiSpawns(poi, 8);
  }

  // -------------------------------------------------------------- ANTENAS
  _antennas(poi, y0) {
    for (let i = 0; i < 3; i++) {
      const tx = poi.x - 12 + i * 13;
      const tz = poi.z - 6 + (i % 2) * 14;
      const hgt = 24 + i * 4;
      // 4 pernas + corpo + pratos
      for (let k = 0; k < 4; k++) {
        const ox = (k < 2 ? -1 : 1) * 2.4;
        const oz = (k % 2 ? -1 : 1) * 2.4;
        this._solid('metal', tx + ox, tz + oz, 0.7, 0.7, y0, y0 + hgt * 0.55, { color: 0x8f9599 });
      }
      this._solid('metal', tx, tz, 1.5, 1.5, y0 + hgt * 0.5, y0 + hgt, { color: 0xb9bfc4 });
      for (let s = 1; s <= 3; s++) {
        this._solid('metal', tx, tz, 5.4 - s * 0.6, 5.4 - s * 0.6, y0 + hgt * (s / 4), y0 + hgt * (s / 4) + 0.35, { color: 0x767c81, walkable: s === 3 });
      }
      this._solid('metal', tx + 2.2, tz, 0.8, 3.4, y0 + hgt * 0.82, y0 + hgt * 0.9, { color: 0x6f7b86 });
    }
    // base de concreto: bunkers + geradores + ruínas
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const bx = poi.x + Math.cos(a) * 20;
      const bz = poi.z + Math.sin(a) * 20;
      this._solid('wall', bx, bz, 6, 5, y0 - 0.4, y0 + 2.6, { color: 0x9c978c });
      this._solid('roof', bx, bz, 6.6, 5.6, y0 + 2.6, y0 + 3.1, { color: 0x83837c, walkable: true });
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      this._solid('lowwall', poi.x + Math.cos(a) * 28, poi.z + Math.sin(a) * 28, 7 + (i % 3) * 3, 0.7, y0, y0 + 1.1 + (i % 2) * 1.4, { color: 0xa8a196, rot: -a });
    }
    this._solid('metal', poi.x + 4, poi.z + 24, 4.2, 4.2, y0, y0 + 9, { color: 0x8b8f86, cyl: true, walkable: false });
    this._poiSpawns(poi, 7);
  }

  // ----------------------------------------------------------------- LAGO
  _lakefront(poi, y0) {
    const { x: cx, z: cz, r } = Config.LAKE;
    // 3 píeres entrando na água (pisáveis) + casas de praia na margem
    for (let i = 0; i < 3; i++) {
      const a = Math.PI * (0.15 + i * 0.32);
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      for (let s = 0; s < 7; s++) {
        const px = cx + dx * (r * 0.72 + s * 1.9);
        const pz = cz + dz * (r * 0.72 + s * 1.9);
        if (lakeDepth(px, pz) < 0.15 && s > 3) break;
        this._solid('wood', px, pz, 2.6, 3.4, Config.WATER_LEVEL - 0.12, Config.WATER_LEVEL + 0.08, { walkable: true, collide: false });
        if (s % 2 === 0) this._solid('wood', px, pz, 0.34, 0.34, Config.WATER_LEVEL - 2.4, Config.WATER_LEVEL, { color: 0x6b4a2b, collide: false });
      }
      // barquinho amarrado
      const bx = cx + dx * (r * 0.72 + 8 * 1.9);
      const bz = cz + dz * (r * 0.72 + 8 * 1.9);
      this._solid('wood', bx, bz, 2.2, 4.6, Config.WATER_LEVEL, Config.WATER_LEVEL + 0.7, { color: 0xe0d6c0, rot: a, walkable: true });
      this._solid('wood', bx, bz, 1.8, 4.2, Config.WATER_LEVEL + 0.7, Config.WATER_LEVEL + 1.0, { color: 0xb9563a, rot: a, walkable: false, collide: false });
    }
    for (let i = 0; i < 4; i++) {
      const a = Math.PI * (0.95 + i * 0.22);
      const hx = cx + Math.cos(a) * (r + 7);
      const hz = cz + Math.sin(a) * (r + 7);
      this._house(hx, hz, -a + Math.PI / 2, terrainHeight(hx, hz), 1, 6.5, 5.5);
    }
    // guarda-sóis (coloridos, sem colisão) + caiaques na areia
    for (let i = 0; i < 8; i++) {
      const a = Math.PI * 2 * (i / 8) + 0.2;
      const sx = cx + Math.cos(a) * (r + 3.2);
      const sz = cz + Math.sin(a) * (r + 3.2);
      const y = terrainHeight(sx, sz);
      this._solid('wood', sx, sz, 0.2, 0.2, y, y + 2.4, { color: 0x8b6b43, collide: false });
      this._solid('paint', sx, sz, 3.0, 3.0, y + 2.4, y + 2.65, { color: [0xd9534f, 0xf0ad4e, 0x5bc0de, 0x8ec63f][i % 4], cyl: true, collide: false });
    }
    this._poiSpawns(poi, 6);
  }

  // ------------------------------------------------------------- SUBÚRBIO
  /** Filas de casas idênticas coladas na cidade: a impressão de bairro grande. */
  _suburb(poi) {
    const rows = [
      { z: -62, count: 6, rot: 0 },
      { z: 62, count: 6, rot: Math.PI },
      { x: -62, count: 5, rot: Math.PI / 2, vertical: true },
      { x: 62, count: 5, rot: -Math.PI / 2, vertical: true },
    ];
    for (const row of rows) {
      for (let i = 0; i < row.count; i++) {
        const t = (i - (row.count - 1) / 2) * 13;
        const x = row.vertical ? poi.x + row.x : poi.x + t;
        const z = row.vertical ? poi.z + t : poi.z + row.z;
        const y = terrainHeight(x, z);
        this._house(x, z, row.rot + (this._rng() - 0.5) * 0.06, y, this._rng() < 0.35 ? 2 : 1, 8 + this._rng() * 2, 6.5 + this._rng() * 1.5);
        if (i % 3 === 0) this._solid('wood', x + 5, z + 5, 1.6, 1.6, y, y + 1.2, { color: 0x8b6b43 }); // caixote
      }
    }
    this._poiSpawns(poi, 12);
  }

  /** Pontos de spawn livres ao redor do POI (p/ bots e para o centro da zona). */
  _poiSpawns(poi, n) {
    const ring = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      for (const rr of [poi.r * 0.55, poi.r * 0.8, poi.r * 1.05]) {
        const x = poi.x + Math.cos(a) * rr;
        const z = poi.z + Math.sin(a) * rr;
        if (lakeDepth(x, z) > 0.1) continue;
        if (this.collision && this.collision.isBlockedCircle(x, z, Config.PLAYER_RADIUS)) continue;
        ring.push({ x, z, poi: poi.id, name: poi.name });
        break;
      }
    }
    this.spawnPoints.push(...ring);
    this.poiRings.push({ id: poi.id, name: poi.name, x: poi.x, z: poi.z, r: poi.r, points: ring });
  }

  _instantiate() {
    const specs = {
      wall: { roughness: 0.92, metalness: 0.0, cast: true, receive: true },
      roof: { roughness: 0.85, metalness: 0.02, cast: true, receive: true },
      floor: { roughness: 1.0, metalness: 0.0, cast: false, receive: true },
      lowwall: { roughness: 0.95, metalness: 0.0, cast: true, receive: true },
      wood: { roughness: 0.9, metalness: 0.0, cast: true, receive: true },
      metal: { roughness: 0.5, metalness: 0.42, cast: true, receive: true },
      paint: { roughness: 0.7, metalness: 0.0, cast: true, receive: false },
    };
    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();
    this.meshes = [];
    for (const [name, list] of this.groups) {
      if (!list.length) continue;
      const s = specs[name] || specs.wall;
      const material = new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: s.roughness, metalness: s.metalness,
      });
      const geo = this._cylGroups.has(name) ? this._cyl : this._box;
      const mesh = new THREE.InstancedMesh(geo, material, list.length);
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        dummy.position.set(b.cx, b.cy, b.cz);
        dummy.rotation.set(name === 'roof' && b.rot ? 0 : 0, b.rot || 0, 0);
        if (name === 'roof' && b.rot) dummy.rotation.set(0, b.rot, 0);
        dummy.scale.set(b.sx, b.sy, b.sz);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        tint.setHex(b.color === undefined ? 0xffffff : b.color);
        mesh.setColorAt(i, tint);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = !!s.cast;
      mesh.receiveShadow = !!s.receive;
      mesh.frustumCulled = true; // bounds estáticos: o three calcula p/ o conjunto
      mesh.name = `poi-${name}`;
      this.scene.add(mesh);
      this.meshes.push(mesh);
    }
  }

  dispose() {
    for (const m of this.meshes || []) {
      this.scene.remove(m);
      m.material.dispose();
    }
    this._box.dispose();
    this._cyl.dispose();
    this.groups.clear();
  }
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
