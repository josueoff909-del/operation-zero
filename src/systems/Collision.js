import { Config } from '../core/Config.js';

/**
 * Collision.js — Mundo de colisão sólido (Fase 2 → expandido).
 *
 * Primitivas (todas alinhadas aos eixos, sem rotação — rápido e robusto):
 *  • boxes   → paredes, telhados, crates, mesas, muros, veículos
 *  • circles → troncos de árvore, pedras, barris, postes (pilares sólidos)
 *
 * Grade espacial uniforme (`Config.COLLISION_CELL`) com cubos por *footprint*:
 * resolveCircle/getGroundHeight/rayDistance só testam as caixas das células
 * vizinhas. Com prédios + ~390 props de vegetação isso mantém o custo por
 * frame O(poucas caixas) em vez de O(todas) — necessário p/ 44 bots + jogador.
 *
 * API (estável, usada por Player, Bot, Combat):
 *   addBox(cx, cz, sx, sz, minY, maxY, opts)
 *   addCircle(cx, cz, r, minY, maxY, opts)
 *   resolveCircle(position, radius, feetY)   → desliza pelas paredes
 *   getGroundHeight(x, z, feetY)             → topo de caixa/pedra subível
 *   rayDistance(origin, dirXZ, maxDist)      → onde o tiro bate em cobertura
 *   isBlockedCircle(x, z, r)                 → p/ spawn/waypoint válido
 *   count / dispose()
 */
export class Collision {
  constructor(cell = Config.COLLISION_CELL) {
    this.cell = cell;
    /** @type {Array<{minX:number,maxX:number,minZ:number,maxZ:number,minY:number,maxY:number,walkable:boolean}>} */
    this.boxes = [];
    /** @type {Array<{cx:number,cz:number,r:number,minY:number,maxY:number,walkable:boolean}>} */
    this.circles = [];
    /** grade cellKey → { boxes:number[], circles:number[] } */
    this.grid = new Map();
    // buffers reutilizados (nada de alocação por frame — performance-optimization skill)
    this._s = { boxes: [], circles: [] };
    this._seenB = [];
    this._seenC = [];
    this._stamp = 0;
  }

  _key(ix, iz) {
    return ix * 46337 + iz; // chave composta barata (sem alocação de string)
  }

  _bucket(ix, iz) {
    const k = this._key(ix, iz);
    let b = this.grid.get(k);
    if (!b) {
      b = { boxes: [], circles: [] };
      this.grid.set(k, b);
    }
    return b;
  }

  /** Registra um volume e o indexa nas células que ele cobre. */
  _insert(volume, kind) {
    const i0 = Math.floor(volume.minX / this.cell);
    const i1 = Math.floor(volume.maxX / this.cell);
    const j0 = Math.floor(volume.minZ / this.cell);
    const j1 = Math.floor(volume.maxZ / this.cell);
    const idx = kind === 'box' ? this.boxes.length - 1 : this.circles.length - 1;
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const b = this._bucket(i, j);
        if (kind === 'box') b.boxes.push(idx);
        else b.circles.push(idx);
      }
    }
  }

  /** Caixa sólida. `walkable:false` = sem piso (ex.: tronco, parede fina). */
  addBox(cx, cz, sx, sz, minY, maxY, opts = {}) {
    this.boxes.push({
      minX: cx - sx / 2, maxX: cx + sx / 2,
      minZ: cz - sz / 2, maxZ: cz + sz / 2,
      minY, maxY,
      walkable: opts.walkable !== false,
    });
    this._insert(this.boxes[this.boxes.length - 1], 'box');
  }

  /** Pilar circular sólido (árvore, pedra, barril, poste). */
  addCircle(cx, cz, r, minY, maxY, opts = {}) {
    this.circles.push({ cx, cz, r, minY, maxY, walkable: opts.walkable !== false });
    // footprint para a grade
    const v = { minX: cx - r, maxX: cx + r, minZ: cz - r, maxZ: cz + r };
    this._insert(v, 'circle');
  }

  /** Candidatos únicos nas células ao redor do ponto (dedupe por visited stamp). */
  _candidates(x, z, _out) {
    _out.boxes.length = 0;
    _out.circles.length = 0;
    const ix = Math.floor(x / this.cell);
    const iz = Math.floor(z / this.cell);
    this._stamp++;
    const stamp = this._stamp;
    for (let i = ix - 1; i <= ix + 1; i++) {
      for (let j = iz - 1; j <= iz + 1; j++) {
        const b = this.grid.get(this._key(i, j));
        if (!b) continue;
        for (const k of b.boxes) {
          if (this._seenB[k] !== stamp) { this._seenB[k] = stamp; _out.boxes.push(k); }
        }
        for (const k of b.circles) {
          if (this._seenC[k] !== stamp) { this._seenC[k] = stamp; _out.circles.push(k); }
        }
      }
    }
    return _out;
  }

  _scratch() {
    return this._s;
  }

  /**
   * Empurra o círculo (pés + raio) para fora dos sólidos, eixo a eixo.
   * Caixas cuja base está acima de `feetY + STEP` são ignoradas → dá p/
   * pular/subir em cobertura baixa; círculos altos (tronco/muro) bloqueiam.
   */
  resolveCircle(position, radius, feetY) {
    // Duas passadas quando a primeira moveu algo: solidos encostados (barril +
    // poste) podem empurrar o circulo A e empurrar de volta para dentro dele na
    // passada unica. Custa 1 varredura a mais so quando houve contato.
    for (let pass = 0; pass < 2; pass++) {
      const sx = position.x;
      const sz = position.z;
      if (this._resolveOnce(position, radius, feetY) === false) return;
      if (Math.hypot(position.x - sx, position.z - sz) < 1e-4) return;
    }
  }

  _resolveOnce(position, radius, feetY) {
    const step = Config.COLLISION_STEP;
    const cand = this._candidates(position.x, position.z, this._scratch());
    let moved = false;

    for (const k of cand.boxes) {
      const b = this.boxes[k];
      if (feetY >= b.maxY - step) continue;
      if (feetY + Config.PLAYER_HEIGHT <= b.minY) continue;
      const closestX = Math.max(b.minX, Math.min(b.maxX, position.x));
      const closestZ = Math.max(b.minZ, Math.min(b.maxZ, position.z));
      const dx = position.x - closestX;
      const dz = position.z - closestZ;
      const distSq = dx * dx + dz * dz;
      if (distSq >= radius * radius) continue;
      if (distSq > 1e-8) {
        const dist = Math.sqrt(distSq);
        const push = radius - dist;
        position.x += (dx / dist) * push;
        position.z += (dz / dist) * push;
        moved = true;
      } else {
        const penLeft = position.x - b.minX;
        const penRight = b.maxX - position.x;
        const penBack = position.z - b.minZ;
        const penFront = b.maxZ - position.z;
        const minPen = Math.min(penLeft, penRight, penBack, penFront);
        if (minPen === penLeft) position.x = b.minX - radius;
        else if (minPen === penRight) position.x = b.maxX + radius;
        else if (minPen === penBack) position.z = b.minZ - radius;
        else position.z = b.maxZ + radius;
        moved = true;
      }
    }

    for (const k of cand.circles) {
      const c = this.circles[k];
      if (feetY >= c.maxY - step) continue;
      if (feetY + Config.PLAYER_HEIGHT <= c.minY) continue;
      const dx = position.x - c.cx;
      const dz = position.z - c.cz;
      const minDist = radius + c.r;
      const distSq = dx * dx + dz * dz;
      if (distSq >= minDist * minDist) continue;
      if (distSq > 1e-8) {
        const dist = Math.sqrt(distSq);
        const push = minDist - dist;
        position.x += (dx / dist) * push;
        position.z += (dz / dist) * push;
        moved = true;
      } else {
        position.x = c.cx + minDist; // centro exato: empurra p/ +X
        moved = true;
      }
    }
    return moved;
  }

  /**
   * Altura do piso no ponto (topo de caixa/pedra subível). -Infinity = só terreno.
   */
  getGroundHeight(x, z, feetY) {
    let ground = -Infinity;
    const step = Config.COLLISION_STEP;
    const cand = this._candidates(x, z, this._scratch());
    for (const k of cand.boxes) {
      const b = this.boxes[k];
      if (!b.walkable) continue;
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      if (b.maxY <= feetY + step && b.maxY > ground) ground = b.maxY;
    }
    for (const k of cand.circles) {
      const c = this.circles[k];
      if (!c.walkable) continue;
      const dx = x - c.cx;
      const dz = z - c.cz;
      if (dx * dx + dz * dz > c.r * c.r * 0.55) continue; // só o miolo do topo
      if (c.maxY <= feetY + step && c.maxY > ground) ground = c.maxY;
    }
    return ground;
  }

  /**
   * Distância até bater em cobertura, a partir de `origin` na direção XZ dada.
   * Usado por Combat (tiro do jogador) e pelos Bots (linha de fogo bloqueada).
   * Retorna maxDist se nada bloqueia.
   */
  rayDistance(originX, originZ, originY, dirX, dirZ, maxDist, halfHeight = 0.35, dirY = 0) {
    let best = maxDist;
    const stepLen = this.cell * 0.5;
    // Marcha pela grade: passo ≤ meia célula garante visitar toda célula cruzada.
    for (let t = 0; t < best; t += stepLen) {
      const px = originX + dirX * t;
      const pz = originZ + dirZ * t;
      const py = originY + dirY * t; // altura do projétil neste t (bloco só na faixa Y dele)
      const ix = Math.floor(px / this.cell);
      const iz = Math.floor(pz / this.cell);
      const b = this.grid.get(this._key(ix, iz));
      if (!b) continue;
      for (const k of b.boxes) {
        const box = this.boxes[k];
        if (py + halfHeight < box.minY || py - halfHeight > box.maxY) continue;
        // t de entrada na caixa (slab 2D)
        const tEnter = Collision._slabEnter(originX, originZ, dirX, dirZ, box.minX, box.maxX, box.minZ, box.maxZ);
        if (tEnter >= 0 && tEnter < best) best = tEnter;
      }
      for (const k of b.circles) {
        const c = this.circles[k];
        if (py + halfHeight < c.minY || py - halfHeight > c.maxY) continue;
        const tEnter = Collision._circleEnter(originX - c.cx, originZ - c.cz, dirX, dirZ, c.r);
        if (tEnter >= 0 && tEnter < best) best = tEnter;
      }
    }
    return best;
  }

  static _slabEnter(ox, oz, dx, dz, minX, maxX, minZ, maxZ) {
    let tmin = 0;
    let tmax = Infinity;
    // eixo X
    if (Math.abs(dx) < 1e-8) {
      if (ox < minX || ox > maxX) return -1;
    } else {
      let t1 = (minX - ox) / dx;
      let t2 = (maxX - ox) / dx;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
    // eixo Z
    if (Math.abs(dz) < 1e-8) {
      if (oz < minZ || oz > maxZ) return -1;
    } else {
      let t1 = (minZ - oz) / dz;
      let t2 = (maxZ - oz) / dz;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
    return tmin;
  }

  static _circleEnter(ox, oz, dx, dz, r) {
    const a = dx * dx + dz * dz;
    if (a < 1e-12) return -1;
    const b = 2 * (ox * dx + oz * dz);
    const c = ox * ox + oz * oz - r * r;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return -1;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    return t;
  }

  /** true se (x,z) com raio `r` tem algo que BLOQUEIA (spawn/waypoint válido).
   * Volumetria baixa (meio-fio, calçada, crate de 0.2m) não conta: pisa-se em cima. */
  /**
   * Vetor p/ SAIR do bolso de colisão em (x,z): soma das normais de cada
   * sólido que intersecta o círculo, ponderada pela penetração. Usado pelo
   * Bot quando o NavGrid não acha célula livre ao redor (canto de prédio /
   * beco do subúrbio) — sem isso o bot "patina" parado e parece burro.
   * @returns {{x:number,z:number,pen:number}|null} null quando já está livre
   */
  escapeVector(x, z, r, feetY = 0) {
    const step = Config.COLLISION_STEP;
    const cand = this._candidates(x, z, this._scratch());
    let ex = 0;
    let ez = 0;
    let pen = 0;
    for (const k of cand.boxes) {
      const b = this.boxes[k];
      if (b.maxY <= feetY + step) continue;
      if (b.minY >= feetY + Config.PLAYER_HEIGHT) continue;
      const cx = Math.max(b.minX, Math.min(b.maxX, x));
      const cz = Math.max(b.minZ, Math.min(b.maxZ, z));
      const dx = x - cx;
      const dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      const d = Math.sqrt(d2);
      if (d < 1e-4) {
        // centro dentro da caixa: empurra p/ a face mais próxima
        const toLeft = Math.abs(x - b.minX);
        const toRight = Math.abs(b.maxX - x);
        const toNear = Math.abs(z - b.minZ);
        const toFar = Math.abs(b.maxZ - z);
        const m = Math.min(toLeft, toRight, toNear, toFar);
        if (m === toLeft) ex -= toLeft + r;
        else if (m === toRight) ex += toRight + r;
        else if (m === toNear) ez -= toNear + r;
        else ez += toFar + r;
        pen = Math.max(pen, r);
        continue;
      }
      const p = r - d;
      ex += (dx / d) * p;
      ez += (dz / d) * p;
      pen = Math.max(pen, p);
    }
    for (const k of cand.circles) {
      const c = this.circles[k];
      if (c.maxY <= feetY + step || c.minY >= feetY + Config.PLAYER_HEIGHT) continue;
      if (c.walkable === false && c.block !== false) { /* sólido: conta */ }
      const dx = x - c.cx;
      const dz = z - c.cz;
      const rr = r + c.r;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) continue;
      const d = Math.max(1e-4, Math.sqrt(d2));
      const p = rr - d;
      ex += (dx / d) * p;
      ez += (dz / d) * p;
      pen = Math.max(pen, p);
    }
    if (pen <= 1e-4) return null;
    return { x: ex, z: ez, pen };
  }

  isBlockedCircle(x, z, r, feetY = 0) {
    const step = Config.COLLISION_STEP;
    const cand = this._candidates(x, z, this._scratch());
    for (const k of cand.boxes) {
      const b = this.boxes[k];
      if (b.maxY <= feetY + step) continue; // baixo o bastante p/ pisar: não bloqueia
      if (b.minY >= feetY + Config.PLAYER_HEIGHT) continue;
      const cx = Math.max(b.minX, Math.min(b.maxX, x));
      const cz = Math.max(b.minZ, Math.min(b.maxZ, z));
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return true;
    }
    for (const k of cand.circles) {
      const c = this.circles[k];
      if (c.maxY <= feetY + step) continue;
      if (c.minY >= feetY + Config.PLAYER_HEIGHT) continue;
      if ((x - c.cx) ** 2 + (z - c.cz) ** 2 < (r + c.r) ** 2) return true;
    }
    return false;
  }

  /**
   * Volumes p/ o NavGrid. O 5º argumento diz se o volume BLOQUEIA a célula
   * (volume baixo o bastante p/ subir não bloqueia: calçada/meio-fio/crate).
   */
  forEachVolume(fn) {
    const step = Config.COLLISION_STEP;
    for (const b of this.boxes) {
      fn(b.minX, b.maxX, b.minZ, b.maxZ, b.maxY - b.minY > step);
    }
    for (const c of this.circles) {
      fn(c.cx - c.r, c.cx + c.r, c.cz - c.r, c.cz + c.r, c.maxY - c.minY > step);
    }
  }

  get count() {
    return this.boxes.length + this.circles.length;
  }

  dispose() {
    this.boxes.length = 0;
    this.circles.length = 0;
    this.grid.clear();
  }
}
