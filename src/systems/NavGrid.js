import { Config } from '../core/Config.js';

/**
 * NavGrid.js — Grafo de navegação grosseiro p/ os bots (game-ai skill
 * §"path on the coarsest graph that works": grade 5m + A* com cache do
 * caminho, em vez de navmesh denso ou física por frame).
 *
 * - Construído UMA vez a partir do mundo de colisão (célula bloqueada se
 *   algum volume a cobre com folga do raio do bot).
 * - A* 4 direções com heurística de Manhattan (admissível — passos
 *   diagonais não existem aqui, então nada de octile).
 * - Sem cortar quina de parede: só andamos para vizinhos livres.
 * - Re-path é caro; quem chama (Bots) limita por tick (BOT_REPATH_BUDGET).
 */
export class NavGrid {
  /**
   * @param {import('../systems/Collision.js').Collision} collision
   * @param {{cell?:number, botRadius?:number}} [opts]
   */
  constructor(collision, opts = {}) {
    this.cell = opts.cell || Config.NAV_CELL;
    const world = Config.WORLD_SIZE;
    this.n = Math.floor(world / this.cell); // células por lado
    this.half = world / 2;
    this.solid = new Uint8Array(this.n * this.n);
    this._buildFrom(collision, opts.botRadius ?? Config.BOT_RADIUS);
  }

  _ix(x) {
    return Math.max(0, Math.min(this.n - 1, Math.floor((x + this.half) / this.cell)));
  }
  _iz(z) {
    return Math.max(0, Math.min(this.n - 1, Math.floor((z + this.half) / this.cell)));
  }
  /** Centro da célula em coordenadas de mundo. */
  cellX(ix) {
    return (ix + 0.5) * this.cell - this.half;
  }
  cellZ(iz) {
    return (iz + 0.5) * this.cell - this.half;
  }

  _buildFrom(collision, radius) {
    const pad = this.cell * 0.5 + radius - 0.001; // volume "engole" a célula se tocar nela com folga
    collision.forEachVolume((minX, maxX, minZ, maxZ, blocks) => {
      if (!blocks) return; // calçada/meio-fio: o bot sobe, não desvia
      const i0 = this._ix(minX - pad);
      const i1 = this._ix(maxX + pad);
      const j0 = this._iz(minZ - pad);
      const j1 = this._iz(maxZ + pad);
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) this.solid[j * this.n + i] = 1;
      }
    });
    // borda do mundo = parede (nada de cair fora do mapa)
    for (let k = 0; k < this.n; k++) {
      this.solid[k * this.n] = 1; // i=0
      this.solid[k * this.n + this.n - 1] = 1; // i=n-1
      this.solid[k] = 1; // j=0
      this.solid[(this.n - 1) * this.n + k] = 1; // j=n-1
    }
  }

  isOpen(ix, iz) {
    if (ix < 0 || iz < 0 || ix >= this.n || iz >= this.n) return false;
    return this.solid[iz * this.n + ix] === 0;
  }

  isOpenWorld(x, z) {
    return this.isOpen(this._ix(x), this._iz(z));
  }

  /** Ponto livre mais próximo de (x,z) — usado p/ spawn/waypoint inválido. */
  nearestFreeWorld(x, z, maxRings = 6) {
    const ci = this._ix(x);
    const cj = this._iz(z);
    for (let r = 0; r <= maxRings; r++) {
      for (let di = -r; di <= r; di++) {
        for (let dj = -r; dj <= r; dj++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          if (this.isOpen(ci + di, cj + dj)) {
            return { x: this.cellX(ci + di), z: this.cellZ(cj + dj) };
          }
        }
      }
    }
    return null;
  }

  /**
   * A* (4 direções) → array de pontos {x,z} no mundo, sem incluir a origem.
   * Retorna [] se não houver caminho (o bot escolhe outro alvo).
   */
  findPath(fromX, fromZ, toX, toZ, maxNodes = 2600) {
    const startI = this._ix(fromX);
    const startJ = this._iz(fromZ);
    const goalI = this._ix(toX);
    const goalJ = this._iz(toZ);
    if (startI === goalI && startJ === goalJ) return [];
    if (!this.isOpen(goalI, goalJ)) return [];

    const n = this.n;
    const start = startJ * n + startI;
    const goal = goalJ * n + goalI;
    // Arrays reutilizados por chamada (alocação zero no hot path seria
    // possível com um pool por instância; mantido simples e sem estado global).
    const g = new Map();
    const came = new Map();
    const open = [start];
    const inOpen = new Set([start]);
    g.set(start, 0);
    const h = (idx) => {
      const i = idx % n;
      const j = (idx - i) / n;
      return (Math.abs(i - goalI) + Math.abs(j - goalJ)) * this.cell;
    };
    const f = new Map([[start, h(start)]]);
    let guard = 0;

    while (open.length > 0) {
      if (++guard > maxNodes) return [];
      // menor f (busca linear: grade pequena e budget de re-path limitado)
      let bi = 0;
      let bf = Infinity;
      for (let k = 0; k < open.length; k++) {
        const v = f.get(open[k]);
        if (v < bf) { bf = v; bi = k; }
      }
      const cur = open.splice(bi, 1)[0];
      inOpen.delete(cur);
      if (cur === goal) return this._reconstruct(came, cur, n);

      const ci = cur % n;
      const cj = (cur - ci) / n;
      const cg = g.get(cur);
      for (let d = 0; d < 4; d++) {
        const ni = ci + (d === 0 ? 1 : d === 1 ? -1 : 0);
        const nj = cj + (d === 2 ? 1 : d === 3 ? -1 : 0);
        if (!this.isOpen(ni, nj)) continue;
        const nidx = nj * n + ni;
        const tentative = cg + this.cell;
        if (tentative < (g.get(nidx) ?? Infinity)) {
          came.set(nidx, cur);
          g.set(nidx, tentative);
          f.set(nidx, tentative + h(nidx));
          if (!inOpen.has(nidx)) {
            open.push(nidx);
            inOpen.add(nidx);
          }
        }
      }
    }
    return [];
  }

  _reconstruct(came, end, n) {
    const out = [];
    let cur = end;
    while (cur !== undefined) {
      const i = cur % n;
      const j = (cur - i) / n;
      out.push({ x: this.cellX(i), z: this.cellZ(j) });
      cur = came.get(cur);
    }
    out.reverse();
    if (out.length > 1) out.shift(); // remove o ponto de origem
    return out;
  }

  /**
   * Waypoint aleatório livre a ~`minDist`..`maxDist` de (x,z) p/ patrulha.
   * @param {(x:number,z:number,r:number)=>boolean} blocked
   */
  randomFreeNear(x, z, minDist, maxDist, rng, blocked) {
    for (let tries = 0; tries < 12; tries++) {
      const a = rng() * Math.PI * 2;
      const d = minDist + rng() * (maxDist - minDist);
      const px = x + Math.cos(a) * d;
      const pz = z + Math.sin(a) * d;
      if (Math.abs(px) > this.half - 6 || Math.abs(pz) > this.half - 6) continue;
      if (blocked && blocked(px, pz, Config.BOT_RADIUS)) continue;
      if (!this.isOpenWorld(px, pz)) continue;
      return { x: px, z: pz };
    }
    // 12 amostras do anel pediram tudo: alargamos MUITO (beco entre prédios,
    // canto de depósito). Se ainda assim não achar, devolvemos null — quem
    // chama decide (o Bot passa a seguir a zona / o centro do mapa). Devolver
    // {x,z} aqui era o bug: waypoint == posição → bot parado para sempre.
    for (let tries = 0; tries < 10; tries++) {
      const a = rng() * Math.PI * 2;
      const d = 45 + rng() * 150;
      const px = x + Math.cos(a) * d;
      const pz = z + Math.sin(a) * d;
      if (Math.abs(px) > this.half - 6 || Math.abs(pz) > this.half - 6) continue;
      if (blocked && blocked(px, pz, Config.BOT_RADIUS)) continue;
      if (!this.isOpenWorld(px, pz)) continue;
      return { x: px, z: pz };
    }
    const free = this.nearestFreeWorld(x, z, 10);
    return free || null;
  }
}
