import * as THREE from 'three';

/**
 * Buildings.js — Cidade explorável da Fase 2 (primeiro POI).
 * 6 prédios com interiores (portas, janelas, divisória, telhado),
 * ruas em cruz e coberturas (crates, muros baixos, mesas).
 *
 * Performance (Skill §1): todas as paredes/telhados/crates são
 * InstancedMesh de uma caixa unitária (5 draw calls p/ a cidade toda).
 * Colisão: cada bloco registra uma caixa AABB no CollisionWorld.
 * Layout determinístico e alinhado aos eixos (sem rotação).
 */
const WALL_H = 3.2; // altura das paredes
const WALL_T = 0.3; // espessura das paredes
const DOOR_W = 1.2;
const DOOR_H = 2.2;
const WIN_W = 1.4;
const WIN_Y0 = 1.0; // peitoril da janela
const WIN_Y1 = 2.2; // verga da janela

export class Buildings {
  constructor(scene, collision) {
    this.scene = scene;
    this.collision = collision;
    this.walls = [];
    this.roofs = [];
    this.floors = [];
    this.crates = [];
    this.lowWalls = [];
    this.meshes = [];
    this._build();
  }

  _build() {
    // --- Ruas em cruz (asfalto) ---
    const streetMat = new THREE.MeshStandardMaterial({ color: 0x3c4043, roughness: 1 });
    const streetGeoX = new THREE.PlaneGeometry(70, 6);
    streetGeoX.rotateX(-Math.PI / 2);
    const streetX = new THREE.Mesh(streetGeoX, streetMat);
    streetX.position.set(0, 0.03, 0);
    streetX.receiveShadow = true;
    const streetGeoZ = new THREE.PlaneGeometry(6, 70);
    streetGeoZ.rotateX(-Math.PI / 2);
    const streetZ = new THREE.Mesh(streetGeoZ, streetMat);
    streetZ.position.set(0, 0.03, 0);
    streetZ.receiveShadow = true;
    this.scene.add(streetX, streetZ);
    this.meshes.push(streetX, streetZ);
    this._streetMat = streetMat;

    // --- Prédios (posições fixas, portas voltadas p/ as ruas/centro) ---
    this._building(-14, -12, 10, 8, 'S');
    this._building(14, -12, 10, 8, 'S');
    this._building(-14, 12, 10, 8, 'N');
    this._building(14, 12, 10, 8, 'N');
    this._building(-24, -20, 8, 8, 'E');
    this._building(24, 20, 8, 8, 'W');

    // --- Coberturas nas ruas (crates + muros baixos) ---
    this._crate(6, 0);
    this._crate(-6, 0);
    this._crate(0, -8);
    this._crate(0, 14);
    this._crate(10, 0);
    this._lowWall(0, -14, 3, 0.5);
    this._lowWall(-12, 0, 0.5, 3);
    this._lowWall(12, 0, 0.5, 3);

    // --- Instancia tudo (5 draw calls) ---
    const unitGeo = new THREE.BoxGeometry(1, 1, 1);
    this._unitGeo = unitGeo;
    this._makeInstanced(this.walls, new THREE.MeshStandardMaterial({ color: 0xb8b0a0, roughness: 0.9 }), true, true);
    this._makeInstanced(this.roofs, new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.95 }), true, true);
    this._makeInstanced(this.floors, new THREE.MeshStandardMaterial({ color: 0x8f8a80, roughness: 1 }), false, true);
    this._makeInstanced(this.crates, new THREE.MeshStandardMaterial({ color: 0x8a6b3f, roughness: 0.9 }), true, true);
    this._makeInstanced(this.lowWalls, new THREE.MeshStandardMaterial({ color: 0xa89f8d, roughness: 0.95 }), true, true);
  }

  _makeInstanced(list, material, castShadow, receiveShadow) {
    if (list.length === 0) return;
    const mesh = new THREE.InstancedMesh(this._unitGeo, material, list.length);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      dummy.position.set(b.cx, b.cy, b.cz);
      dummy.scale.set(b.sx, b.sy, b.sz);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    mesh.frustumCulled = true;
    this.scene.add(mesh);
    this.meshes.push(mesh);
  }

  /** Adiciona um bloco de parede + caixa de colisão. */
  _wallBox(cx, cz, sx, sz, minY, maxY) {
    this.walls.push({ cx, cy: (minY + maxY) / 2, cz, sx, sy: maxY - minY, sz });
    this.collision.addBox(cx, cz, sx, sz, minY, maxY);
  }

  /** Parede ao longo de X em z=zc, de x0 a x1, com aberturas (porta/janela). */
  _wallX(zc, x0, x1, openings = []) {
    const sorted = [...openings].sort((a, b) => a.from - b.from);
    let cursor = x0;
    for (const o of sorted) {
      if (o.from > cursor) this._wallBox((cursor + o.from) / 2, zc, o.from - cursor, WALL_T, -0.5, WALL_H);
      if (o.y0 > 0) this._wallBox((o.from + o.to) / 2, zc, o.to - o.from, WALL_T, 0, o.y0); // peitoril
      if (o.y1 < WALL_H) this._wallBox((o.from + o.to) / 2, zc, o.to - o.from, WALL_T, o.y1, WALL_H); // verga
      cursor = o.to;
    }
    if (cursor < x1) this._wallBox((cursor + x1) / 2, zc, x1 - cursor, WALL_T, -0.5, WALL_H);
  }

  /** Parede ao longo de Z em x=xc, de z0 a z1, com aberturas. */
  _wallZ(xc, z0, z1, openings = []) {
    const sorted = [...openings].sort((a, b) => a.from - b.from);
    let cursor = z0;
    for (const o of sorted) {
      if (o.from > cursor) this._wallBox(xc, (cursor + o.from) / 2, WALL_T, o.from - cursor, -0.5, WALL_H);
      if (o.y0 > 0) this._wallBox(xc, (o.from + o.to) / 2, WALL_T, o.to - o.from, 0, o.y0);
      if (o.y1 < WALL_H) this._wallBox(xc, (o.from + o.to) / 2, WALL_T, o.to - o.from, o.y1, WALL_H);
      cursor = o.to;
    }
    if (cursor < z1) this._wallBox(xc, (cursor + z1) / 2, WALL_T, z1 - cursor, -0.5, WALL_H);
  }

  /** Prédio retangular com porta, janelas, divisória, telhado e props. */
  _building(cx, cz, w, d, doorSide) {
    const x0 = cx - w / 2;
    const x1 = cx + w / 2;
    const z0 = cz - d / 2;
    const z1 = cz + d / 2;
    const door = { from: cx - DOOR_W / 2, to: cx + DOOR_W / 2, y0: 0, y1: DOOR_H };
    const win = { from: cx - WIN_W / 2, to: cx + WIN_W / 2, y0: WIN_Y0, y1: WIN_Y1 };

    // Paredes: porta num lado, janela no oposto, laterais cheias.
    const doorZ = { from: cz - DOOR_W / 2, to: cz + DOOR_W / 2, y0: 0, y1: DOOR_H };
    const winZ = { from: cz - WIN_W / 2, to: cz + WIN_W / 2, y0: WIN_Y0, y1: WIN_Y1 };
    if (doorSide === 'S') {
      this._wallX(z1, x0, x1, [door]); this._wallX(z0, x0, x1, [win]);
      this._wallZ(x0, z0, z1, []); this._wallZ(x1, z0, z1, []);
    } else if (doorSide === 'N') {
      this._wallX(z0, x0, x1, [door]); this._wallX(z1, x0, x1, [win]);
      this._wallZ(x0, z0, z1, []); this._wallZ(x1, z0, z1, []);
    } else if (doorSide === 'E') {
      this._wallZ(x1, z0, z1, [doorZ]); this._wallZ(x0, z0, z1, [winZ]);
      this._wallX(z0, x0, x1, []); this._wallX(z1, x0, x1, []);
    } else {
      this._wallZ(x0, z0, z1, [doorZ]); this._wallZ(x1, z0, z1, [winZ]);
      this._wallX(z0, x0, x1, []); this._wallX(z1, x0, x1, []);
    }

    // Piso e telhado (sem colisão: piso é plano, telhado está acima da cabeça).
    this.floors.push({ cx, cy: 0.05, cz, sx: w, sy: 0.1, sz: d });
    this.roofs.push({ cx, cy: WALL_H + 0.125, cz, sx: w + 0.8, sy: 0.25, sz: d + 0.8 });

    // Divisória interna com porta (ao longo de X no meio do prédio).
    this._wallX(cz, x0 + WALL_T, x1 - WALL_T, [door]);

    // Props internos: 2 crates + 1 mesa (cobertura dentro do prédio).
    this._crate(cx - w / 4, cz - d / 4);
    this._crate(cx + w / 4, cz + d / 4);
    this._table(cx + w / 4, cz - d / 4);

    // Cobertura externa perto da porta.
    const doorPos = {
      S: [cx + 1.5, z1 + 1.2], N: [cx + 1.5, z0 - 1.2],
      E: [x1 + 1.2, cz + 1.5], W: [x0 - 1.2, cz + 1.5],
    }[doorSide];
    this._crate(doorPos[0], doorPos[1]);
  }

  _crate(x, z) {
    this.crates.push({ cx: x, cy: 0.5, cz: z, sx: 1, sy: 1, sz: 1 });
    this.collision.addBox(x, z, 1, 1, 0, 1);
  }

  _table(x, z) {
    this.crates.push({ cx: x, cy: 0.4, cz: z, sx: 1.6, sy: 0.8, sz: 0.8 });
    this.collision.addBox(x, z, 1.6, 0.8, 0, 0.8);
  }

  _lowWall(x, z, sx, sz) {
    this.lowWalls.push({ cx: x, cy: 0.5, cz: z, sx, sy: 1, sz });
    this.collision.addBox(x, z, sx, sz, 0, 1);
  }

  dispose() {
    for (const mesh of this.meshes) {
      if (mesh.geometry && mesh.geometry !== this._unitGeo) mesh.geometry.dispose();
      if (mesh.material) mesh.material.dispose();
      this.scene.remove(mesh);
    }
    if (this._unitGeo) this._unitGeo.dispose();
    this.meshes = [];
  }
}
