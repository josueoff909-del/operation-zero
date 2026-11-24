import * as THREE from 'three';
import { Config } from '../core/Config.js';

/**
 * Buildings.js — Cidade explorável (Fase 2) + detalhamento arquitetônico.
 *
 * Cada prédios tem 1–2 andares com janelas (vidro + caixilho + peitoril),
 * porta aberta, faixada com faixa de laje, varanda com guarda-corpo,
 * platibanda (parapeto), caixa d'água/chaminé/unidade de ar-condicionado no
 * telhado, marquise sobre a porta e interior com divisória, crates e mesa.
 * A rua tem asfalto, calçada, meio-fio, faixas pintadas, postes de luz,
 * carros estacionados, barris, cercas de madeira e sacos de areia — tudo
 * como cobertura real com colisão.
 *
 * Performance (Skill §1): **13 draw calls** para a cidade inteira (um por
 * material/grupo) — tudo `InstancedMesh` de uma caixa unitária com cor por
 * instância (nada de `new Mesh()` por parede). Geometria e materiais são compartilhados.
 *
 * Colisão: cada volume sólido registra AABB/círculo no Collision (o meio-fio
 * e as sacadas são pisa-veis; paredes/troncos bloqueiam).
 */
const WALL_T = 0.3;
const FLOOR_H = 3.3;
const WALL_BASE = -0.6; // desce abaixo do chão: sem fresta escura na base
const DOOR_W = 1.3;
const DOOR_H = 2.25;
const WIN_W = 1.35;
const WIN_Y0 = 1.05; // peitoril
const WIN_Y1 = 2.35; // verga
const WIN_STEP = 3.0; // espaçamento entre janelas

// Paleta de fachada (nada de "bloco cinza sem graça")
const FACADES = [0xd8c39a, 0xc9a88a, 0xa9b7a0, 0xbfae94, 0xd2b6a6, 0x9fb0bb, 0xc7c2b4, 0xb98f79];

export class Buildings {
  constructor(scene, collision, groundHeight = () => 0) {
    this.scene = scene;
    this.collision = collision;
    this.groundHeight = groundHeight;
    this.groups = new Map(); // nome → lista de blocos {cx,cy,cz,sx,sy,sz,rot?,color}
    this.meshes = [];
    this.buildings = [];
    this.props = [];
    this.lamps = [];
    this._unitGeo = new THREE.BoxGeometry(1, 1, 1);
    this._build();
  }

  _push(name, block) {
    if (!this.groups.has(name)) this.groups.set(name, []);
    this.groups.get(name).push(block);
  }

  /** Bloco visual + caixa de colisão (opcional). */
  _solid(name, cx, cz, sx, sz, minY, maxY, opts = {}) {
    this._push(name, {
      cx, cz, sx, sz,
      cy: (minY + maxY) / 2,
      sy: maxY - minY,
      color: opts.color,
      rot: opts.rot || 0,
    });
    if (this.collision && opts.collide !== false) {
      this.collision.addBox(cx, cz, sx, sz, minY, maxY, { walkable: opts.walkable !== false });
    }
  }

  _build() {
    const gy = (x, z) => this.groundHeight(x, z);

    // ---------------- Ruas, calçadas e meio-fio ----------------
    const streetW = Config.STREET_HALF * 2;
    const walkW = (Config.SIDEWALK_HALF - Config.STREET_HALF) * 2;
    for (const axis of ['x', 'z']) {
      // asfalto (plano fino, sem colisão)
      this._push('asphalt', {
        cx: 0, cz: 0, cy: 0.03,
        sx: axis === 'x' ? 78 : streetW, sz: axis === 'x' ? streetW : 78,
        sy: 0.04, color: 0x3a3d42,
      });
      // faixas pintadas (tracejado no eixo)
      for (let d = -34; d <= 34; d += 5) {
        this._push('paint', {
          cx: axis === 'x' ? d : 0, cz: axis === 'x' ? 0 : d, cy: 0.06,
          sx: axis === 'x' ? 2.2 : 0.28, sz: axis === 'x' ? 0.28 : 2.2, sy: 0.02,
          color: 0xe8d27a,
        });
      }
      // calçadas nos dois lados + meio-fio (pisa-vel, não bloqueia)
      for (const side of [-1, 1]) {
        const off = (streetW + walkW / 2) * side * 0.5 + 0;
        const cx = axis === 'x' ? 0 : off;
        const cz = axis === 'x' ? off : 0;
        this._push('sidewalk', {
          cx, cz, cy: 0.1, sx: axis === 'x' ? 78 : walkW, sz: axis === 'x' ? walkW : 78,
          sy: 0.16, color: 0x9d988c,
        });
        if (this.collision) {
          this.collision.addBox(cx, cz, axis === 'x' ? 78 : walkW, axis === 'x' ? walkW : 78, 0, 0.18, { walkable: true });
        }
        // meio-fio
        const curbOff = (streetW / 2 + 0.18) * side;
        this._push('curb', {
          cx: axis === 'x' ? 0 : curbOff, cz: axis === 'x' ? curbOff : 0, cy: 0.14,
          sx: axis === 'x' ? 78 : 0.36, sz: axis === 'x' ? 0.36 : 78, sy: 0.28,
          color: 0x807b70,
        });
      }
    }

    // ---------------- Prédios ----------------
    const plan = [
      { x: -15, z: -13, w: 11, d: 9, side: 'S', floors: 2 },
      { x: 15, z: -13, w: 11, d: 9, side: 'S', floors: 1 },
      { x: -15, z: 13, w: 10, d: 9, side: 'N', floors: 1 },
      { x: 15, z: 13, w: 12, d: 10, side: 'N', floors: 2 },
      { x: -26, z: -22, w: 9, d: 8, side: 'E', floors: 1 },
      { x: 26, z: 22, w: 9, d: 8, side: 'W', floors: 2 },
      { x: -27, z: 8, w: 8, d: 12, side: 'E', floors: 1 },
      { x: 27, z: -8, w: 8, d: 12, side: 'W', floors: 1 },
    ];
    plan.forEach((b, i) => this._building(b.x, b.z, b.w, b.d, b.side, b.floors, FACADES[i % FACADES.length], gy(b.x, b.z)));

    // ---------------- Coberturas das ruas ----------------
    const crateSpots = [[6, 0], [-6, 0], [0, -9], [0, 15], [11, 2], [-11, -2], [20, -3], [-21, 5]];
    for (const [x, z] of crateSpots) this._crate(x, z, 0, gy(x, z));
    this._lowWall(0, -15, 3.4, 0.6, gy(0, -15), 0xb9a06a); // saco de areia
    this._lowWall(-13, 0, 0.6, 3.2, gy(-13, 0), 0xb9a06a);
    this._lowWall(13, 0, 0.6, 3.2, gy(13, 0), 0xa89f8d);
    this._lowWall(4, 22, 4, 0.6, gy(4, 22), 0xa89f8d);

    // carros estacionados (cobertura sólida) + barris + postes + cercas
    this._car(-9, 7.2, 0, gy(-9, 7.2), 0x8c3b34);
    this._car(9, -7.4, Math.PI, gy(9, -7.4), 0x39536b);
    this._car(22, 8, Math.PI / 2, gy(22, 8), 0x6d7b5e);
    const barrels = [[-3.5, 6.5], [-2.5, 6.8], [18, -12], [19.4, -11], [-20, -18], [7, 20]];
    for (const [x, z] of barrels) this._barrel(x, z, gy(x, z));
    const lampSpots = [[-20, -3.2], [20, 3.2], [-3.2, 20], [3.2, -20], [-20, 20]];
    for (const [x, z] of lampSpots) this._lamp(x, z, gy(x, z));
    const fenceSpots = [[-8, -21, 8, 0], [8, -21, 8, 0], [-8, 21, 8, 0], [8, 21, 8, 0]];
    for (const [x, z, len, rot] of fenceSpots) this._fence(x, z, len, rot, gy(x, z));

    this._instantiate();
  }

  /**
   * Prédio com 1–2 andares. `side` = onde fica a porta (S/N/E/W).
   * Gera: paredes com vãos, janelas com vidro e caixilho, faixa de laje,
   * varanda no 2º andar, platibanda, telhado, marquise e interior.
   */
  _building(cx, cz, w, d, side, floors, facadeColor, baseY) {
    const x0 = cx - w / 2;
    const x1 = cx + w / 2;
    const z0 = cz - d / 2;
    const z1 = cz + d / 2;
    const top = baseY + floors * FLOOR_H;
    this.buildings.push({ cx, cz, w, d, floors, baseY, top, side });

    // Piso e telhado
    this._push('floor', { cx, cz, cy: baseY + 0.06, sx: w - 0.2, sz: d - 0.2, sy: 0.12, color: 0x8f8a80 });
    this._push('roof', { cx, cz, cy: top + 0.14, sx: w + 0.7, sz: d + 0.7, sy: 0.26, color: 0x4a4f57 });

    // Platibanda (beiral baixo no entorno do telhado) — visual, sem colisão
    for (const [sx, sz, ox, oz] of [[w + 0.9, 0.28, 0, -d / 2 - 0.35], [w + 0.9, 0.28, 0, d / 2 + 0.35],
      [0.28, d + 0.9, -w / 2 - 0.35, 0], [0.28, d + 0.9, w / 2 + 0.35, 0]]) {
      this._push('trim', { cx: cx + ox, cz: cz + oz, cy: top + 0.45, sx, sz, sy: 0.62, color: 0x6f6a5f });
    }

    // Props do telhado: caixa d'água, chaminé, ar-condicionado
    this._push('metal', { cx: cx - w / 4, cz: cz - d / 4, cy: top + 0.85, sx: 1.5, sz: 1.5, sy: 1.2, color: 0x9aa3a8 });
    this._push('trim', { cx: cx + w / 4, cz: cz + d / 5, cy: top + 0.75, sx: 0.7, sz: 0.7, sy: 1.0, color: 0x7d766c });
    this._push('metal', { cx: cx + w / 5, cz: cz - d / 3, cy: top + 0.4, sx: 1.1, sz: 0.8, sy: 0.5, color: 0xb3b8bb });

    // 4 fachadas
    const faces = [
      { axis: 'x', fixed: z1, from: x0, to: x1, out: 1, key: 'S' },
      { axis: 'x', fixed: z0, from: x0, to: x1, out: -1, key: 'N' },
      { axis: 'z', fixed: x1, from: z0, to: z1, out: 1, key: 'E' },
      { axis: 'z', fixed: x0, from: z0, to: z1, out: -1, key: 'W' },
    ];
    for (const f of faces) {
      const len = f.to - f.from;
      for (let lvl = 0; lvl < floors; lvl++) {
      const y0 = baseY + lvl * FLOOR_H;
        const y1 = y0 + FLOOR_H;
      const openings = [];
      const isDoorFace = f.key === side && lvl === 0;
        if (isDoorFace) {
          const c = f.axis === 'x' ? cx : cz;
          openings.push({ from: c - DOOR_W / 2, to: c + DOOR_W / 2, y0, y1: y0 + DOOR_H, kind: 'door', face: f });
        }
        // janelas a cada WIN_STEP, evitando o vão da porta
        const start = f.from + 1.5;
        for (let p = start; p < f.to - 0.8; p += WIN_STEP) {
          if (isDoorFace && Math.abs(p - (f.axis === 'x' ? cx : cz)) < DOOR_W + 0.9) continue;
          openings.push({ from: p - WIN_W / 2, to: p + WIN_W / 2, y0: y0 + WIN_Y0, y1: y0 + WIN_Y1, kind: 'window' });
        }
        // parede do terreo desce ate WALL_BASE: sem fresta escura contra o terreno
        const bottom = lvl === 0 ? y0 + WALL_BASE : y0;
        this._wall(f.axis, f.fixed, f.from, f.to, openings, bottom, y1, facadeColor);

        // faixa de laje (destaque horizontal na fachada)
        this._push('trim', {
          cx: f.axis === 'x' ? (f.from + f.to) / 2 : f.fixed + f.out * (WALL_T / 2 + 0.05),
          cz: f.axis === 'x' ? f.fixed + f.out * (WALL_T / 2 + 0.05) : (f.from + f.to) / 2,
          cy: y1 - 0.12,
          sx: f.axis === 'x' ? len : WALL_T + 0.14,
          sz: f.axis === 'x' ? WALL_T + 0.14 : len,
          sy: 0.3, color: 0x7d766c,
        });

        // varanda no 2º andar, na fachada da porta
        if (lvl === 1 && f.key === side && floors > 1) {
          const bcx = f.axis === 'x' ? cx : f.fixed + f.out * 1.05;
          const bcz = f.axis === 'x' ? f.fixed + f.out * 1.05 : cz;
          this._push('floor', { cx: bcx, cz: bcz, cy: y0 + 0.12, sx: f.axis === 'x' ? 2.6 : 0.28, sz: f.axis === 'x' ? 0.28 : 2.6, sy: 0.16, color: 0x9a9384 });
          if (this.collision) this.collision.addBox(bcx, bcz, f.axis === 'x' ? 2.6 : 0.28, f.axis === 'x' ? 0.28 : 2.6, y0, y0 + 0.2, { walkable: true });
          // guarda-corpo: 3 peças finas
          for (const [ox, sz, sx] of [[-1.2, 1.3, 0.14], [1.2, 1.3, 0.14], [0, 0.14, 2.5]]) {
            this._push('trim', {
              cx: bcx + (f.axis === 'x' ? ox : 0), cz: bcz + (f.axis === 'x' ? 0 : ox),
              cy: y0 + 0.75,
              sx: f.axis === 'x' ? sz : sx, sz: f.axis === 'x' ? sx : sz, sy: 1.05, color: 0x5f6b74,
            });
          }
        }
      }
    }

    // Porta aberta (batente + folha girada) + marquise sobre a entrada
    const doorFace = faces.find((f) => f.key === side);
    if (doorFace) {
      const dc = doorFace.axis === 'x' ? cx : cz;
      const dfx = doorFace.axis === 'x' ? dc : doorFace.fixed + doorFace.out * (WALL_T / 2 + 0.06);
      const dfz = doorFace.axis === 'x' ? doorFace.fixed + doorFace.out * (WALL_T / 2 + 0.06) : dc;
      this._push('wood', { cx: dfx, cz: dfz, cy: baseY + DOOR_H / 2, sx: doorFace.axis === 'x' ? DOOR_W : 0.12, sz: doorFace.axis === 'x' ? 0.12 : DOOR_W, sy: DOOR_H, color: 0x6b4a2b, rot: (doorFace.axis === 'x' ? 0 : Math.PI / 2) + 1.1 });
      // batentes
      for (const s of [-1, 1]) {
        this._push('trim', {
          cx: doorFace.axis === 'x' ? dc + s * (DOOR_W / 2 + 0.12) : doorFace.fixed,
          cz: doorFace.axis === 'x' ? doorFace.fixed : dc + s * (DOOR_W / 2 + 0.12),
          cy: baseY + DOOR_H / 2, sx: doorFace.axis === 'x' ? 0.24 : WALL_T + 0.1, sz: doorFace.axis === 'x' ? WALL_T + 0.1 : 0.24,
          sy: DOOR_H + 0.2, color: 0x6d675d,
        });
      }
      // marquise
      this._push('trim', { cx: dfx + (doorFace.axis === 'z' ? doorFace.out * 0.9 : 0), cz: dfz + (doorFace.axis === 'x' ? doorFace.out * 0.9 : 0), cy: baseY + DOOR_H + 0.25, sx: doorFace.axis === 'x' ? DOOR_W + 1.4 : 1.8, sz: doorFace.axis === 'x' ? 1.8 : DOOR_W + 1.4, sy: 0.18, color: 0x8a5f45 });
    }

    // --- Interior: divisória com vão + props ---
    if (w > 8 && d > 7) {
      this._wall('x', cz, x0 + WALL_T, x1 - WALL_T, [{ from: cx - DOOR_W / 2, to: cx + DOOR_W / 2, y0: baseY, y1: baseY + DOOR_H, kind: 'door' }], baseY, top - 0.4, 0xc4bba9);
    }
    this._crate(cx - w / 4, cz - d / 4, 0, baseY);
    this._table(cx + w / 4, cz + d / 4, baseY);
    this._push('wood', { cx: cx + w / 4, cz: cz - d / 4, cy: baseY + 0.45, sx: 1.8, sz: 0.5, sy: 0.12, color: 0x8a6b3f });
    if (this.collision) this.collision.addBox(cx + w / 4, cz - d / 4, 1.8, 0.5, baseY, baseY + 0.9, { walkable: true });
  }

  /** Parede com vãos (porta/janela) + vidros/caixilhos/peitoris. */
  _wall(axis, fixed, from, to, openings, minY, maxY, facadeColor) {
    const sorted = [...openings].sort((a, b) => a.from - b.from);
    let cursor = from;
    const T = WALL_T;
    const add = (center, len, y0, y1) => {
      if (len <= 0.01 || y1 - y0 <= 0.01) return;
      const block = { color: facadeColor };
      if (axis === 'x') this._solid('wall', center, fixed, len, T, y0, y1, block);
      else this._solid('wall', fixed, center, T, len, y0, y1, block);
    };
    for (const o of sorted) {
      if (o.from > cursor) add((cursor + o.from) / 2, o.from - cursor, minY, maxY);
      if (o.y0 > minY) add((o.from + o.to) / 2, o.to - o.from, minY, o.y0); // alvenaria abaixo do vão
      if (o.y1 < maxY) add((o.from + o.to) / 2, o.to - o.from, o.y1, maxY); // e acima
      cursor = Math.max(cursor, o.to);

      if (o.kind === 'window') {
        const c = (o.from + o.to) / 2;
        const h = o.y1 - o.y0;
        const cy = (o.y0 + o.y1) / 2;
        // vidro (fino, levemente reflexivo) na face externa
        if (axis === 'x') this._push('glass', { cx: c, cz: fixed, cy, sx: o.to - o.from - 0.1, sz: 0.06, sy: h - 0.1, color: 0x9fd6e8 });
        else this._push('glass', { cx: fixed, cz: c, cy, sx: 0.06, sz: o.to - o.from - 0.1, sy: h - 0.1, color: 0x9fd6e8 });
        // peitoril externo + caixilho cruzado
        const sillOff = axis === 'x' ? [c, fixed + (fixed > 0 ? 0.02 : -0.02)] : [fixed + (fixed > 0 ? 0.02 : -0.02), c];
        this._push('trim', { cx: sillOff[0], cz: sillOff[1], cy: o.y0 - 0.06, sx: axis === 'x' ? o.to - o.from + 0.3 : 0.42, sz: axis === 'x' ? 0.42 : o.to - o.from + 0.3, sy: 0.14, color: 0x77716a });
        this._push('trim', { cx: sillOff[0], cz: sillOff[1], cy, sx: axis === 'x' ? 0.1 : 0.34, sz: axis === 'x' ? 0.34 : 0.1, sy: h, color: 0x545049 });
        // sacada de janela no térreo (detalhe de fachada)
        if (o.y0 < minY + 1.4 && (o.to - o.from) > 1) {
          this._push('trim', { cx: sillOff[0], cz: sillOff[1], cy: o.y0 - 0.2, sx: axis === 'x' ? o.to - o.from + 0.5 : 0.6, sz: axis === 'x' ? 0.6 : o.to - o.from + 0.5, sy: 0.12, color: 0x6d675d });
        }
      }
    }
    if (cursor < to) add((cursor + to) / 2, to - cursor, minY, maxY);
  }

  // ---------------- Props de rua ----------------
  _crate(x, z, rot = 0, baseY = 0) {
    const s = 1 + ((Math.abs(x * 7 + z * 13) % 3) - 1) * 0.12;
    this._solid('wood', x, z, s, s, baseY, baseY + s, { color: 0x8a6b3f, rot });
    this.props.push({ kind: 'crate', x, z, top: baseY + s });
  }

  _table(x, z, baseY = 0) {
    this._solid('wood', x, z, 1.6, 0.85, baseY, baseY + 0.78, { color: 0x7a5c37 });
  }

  _lowWall(x, z, sx, sz, baseY = 0, color = 0xa89f8d) {
    this._solid('lowwall', x, z, sx, sz, baseY, baseY + 1.0, { color });
  }

  _barrel(x, z, baseY = 0) {
    const r = 0.36;
    this._push('metal', { cx: x, cz: z, cy: baseY + 0.5, sx: r * 2, sz: r * 2, sy: 1.0, color: 0x7d6a4a });
    if (this.collision) this.collision.addCircle(x, z, r, baseY - 0.1, baseY + 1.0, { walkable: true });
    this.props.push({ kind: 'barrel', x, z, top: baseY + 1.0 });
  }

  /** Carro estacionado: corpo + cabine + rodas, colisão em duas caixas. */
  _car(x, z, rot, baseY, color) {
    this._push('metal', { cx: x, cz: z, cy: baseY + 0.55, sx: 4.2, sz: 1.9, sy: 0.75, color, rot });
    this._push('glass', { cx: x, cz: z, cy: baseY + 1.12, sx: 2.1, sz: 1.75, sy: 0.5, color: 0x2c3a44, rot });
    for (const [ox, oz] of [[-1.35, 0.95], [1.35, 0.95], [-1.35, -0.95], [1.35, -0.95]]) {
      const rx = x + ox * Math.cos(rot) - oz * Math.sin(rot);
      const rz = z + ox * Math.sin(rot) + oz * Math.cos(rot);
      this._push('trim', { cx: rx, cz: rz, cy: baseY + 0.34, sx: 0.55, sz: 0.3, sy: 0.66, color: 0x25282c, rot });
    }
    if (this.collision) {
      // caixa folgada nas dimensões giradas (AABB cobrindo o OBB do carro)
      const c = Math.abs(Math.cos(rot));
      const s = Math.abs(Math.sin(rot));
      const sx = 4.2 * c + 1.9 * s;
      const sz = 4.2 * s + 1.9 * c;
      this.collision.addBox(x, z, sx, sz, baseY, baseY + 1.4, { walkable: false });
    }
    this.props.push({ kind: 'car', x, z, top: baseY + 1.4 });
  }

  _fence(x, z, len, rot, baseY = 0) {
    const along = rot === 0 ? len : 0.3;
    const across = rot === 0 ? 0.3 : len;
    const step = 1 / Math.max(1, Math.round(len / 1.6));
    for (let k = -0.5; k <= 0.5 + 1e-6; k += step) {
      const px = x + (rot === 0 ? k * len : 0);
      const pz = z + (rot === 0 ? 0 : k * len);
      this._push('wood', { cx: px, cz: pz, cy: baseY + 0.55, sx: 0.16, sz: 0.16, sy: 1.1, color: 0x7a6242 });
    }
    this._solid('wood', x, z, along, across, baseY + 0.55, baseY + 1.05, { color: 0x84694a });
    this._solid('wood', x, z, along, across, baseY + 0.15, baseY + 0.62, { color: 0x84694a });
  }

  /** Poste de luz: haste + luminária (a luminária é MeshBasic, emite sozinha). */
  _lamp(x, z, baseY = 0) {
    this._push('metal', { cx: x, cz: z, cy: baseY + 3.0, sx: 0.22, sz: 0.22, sy: 6.0, color: 0x54585c });
    this._push('metal', { cx: x, cz: z, cy: baseY + 6.0, sx: 1.0, sz: 0.2, sy: 0.18, color: 0x54585c });
    this._push('lamp', { cx: x + 0.45, cz: z, cy: baseY + 5.8, sx: 0.6, sz: 0.34, sy: 0.16, color: 0xffe6a8 });
    if (this.collision) this.collision.addCircle(x, z, 0.2, baseY - 0.1, baseY + 6.2, { walkable: false });
    this.lamps.push({ x, z: z, y: baseY + 5.8 });
  }

  // ---------------- Instanciação (1 draw call por material) ----------------
  _instantiate() {
    const specs = {
      wall: { color: 0xffffff, roughness: 0.92, metalness: 0.0, cast: true, receive: true },
      trim: { color: 0xffffff, roughness: 0.85, metalness: 0.05, cast: true, receive: true },
      roof: { color: 0xffffff, roughness: 0.95, metalness: 0.0, cast: true, receive: true },
      floor: { color: 0xffffff, roughness: 1.0, metalness: 0.0, cast: false, receive: true },
      wood: { color: 0xffffff, roughness: 0.9, metalness: 0.0, cast: true, receive: true },
      lowwall: { color: 0xffffff, roughness: 0.95, metalness: 0.0, cast: true, receive: true },
      metal: { color: 0xffffff, roughness: 0.45, metalness: 0.55, cast: true, receive: true },
      asphalt: { color: 0xffffff, roughness: 1.0, metalness: 0.0, cast: false, receive: true },
      sidewalk: { color: 0xffffff, roughness: 1.0, metalness: 0.0, cast: false, receive: true },
      curb: { color: 0xffffff, roughness: 1.0, metalness: 0.0, cast: false, receive: true },
      paint: { color: 0xffffff, roughness: 0.8, metalness: 0.0, cast: false, receive: true },
      glass: { color: 0xffffff, roughness: 0.12, metalness: 0.35, transparent: true, opacity: 0.42, cast: false, receive: false },
      lamp: { emissive: 0xffe6a8, color: 0xffffff, roughness: 0.4, metalness: 0, cast: false, receive: false },
    };
    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();
    for (const [name, list] of this.groups) {
      if (!list.length) continue;
      const s = specs[name] || specs.trim;
      const material = name === 'lamp'
        ? new THREE.MeshBasicMaterial({ color: 0xfff2cf }) // luminária "acesa" sem custo de luz
        : new THREE.MeshStandardMaterial({
          color: s.color, roughness: s.roughness, metalness: s.metalness,
          transparent: !!s.transparent, opacity: s.opacity ?? 1,
          emissive: s.emissive ?? 0x000000, emissiveIntensity: s.emissive ? 0.9 : 0,
        });
      const mesh = new THREE.InstancedMesh(this._unitGeo, material, list.length);
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        dummy.position.set(b.cx, b.cy, b.cz);
        dummy.rotation.set(0, b.rot || 0, 0);
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
      mesh.frustumCulled = true;
      mesh.name = `town-${name}`;
      this.scene.add(mesh);
      this.meshes.push(mesh);
    }
  }

  /** Pontos de interesse p/ spawn de bots (ruas e praças livres). */
  spawnPoints() {
    const pts = [];
    for (const b of this.buildings) pts.push({ x: b.cx, z: b.cz + (b.d / 2 + 2.5) });
    for (const p of this.props) pts.push({ x: p.x, z: p.z });
    for (const ring of [26, 40, 55]) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
        pts.push({ x: Math.cos(a) * ring, z: Math.sin(a) * ring });
      }
    }
    return pts;
  }

  dispose() {
    for (const mesh of this.meshes) {
      if (mesh.material) mesh.material.dispose();
      this.scene.remove(mesh);
    }
    this.meshes = [];
    this.groups.clear();
    if (this._unitGeo) this._unitGeo.dispose();
  }
}
