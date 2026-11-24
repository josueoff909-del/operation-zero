import { Config } from '../core/Config.js';

/**
 * Minimap.js — minimapa em canvas 2D (Fase 11, GDD §8: "minimapa com zona
 * segura e direção do avião, contador de vivos/abates").
 *
 * É um `<canvas>` de verdade (não WebGL): 140 px redesenhados ~12×/s custa
 * nada no Android, e é o jeito mais barato de mostrar a ÚNICA coisa que
 * importa num BR — onde está o círculo e o quanto falta para ele fechar.
 *
 * Mostra: contorno do mundo, estradas, POIs, o lago, o círculo atual (cheio
 * = muro ativo), o próximo círculo (trace), o jogador com o cone de visão e
 * os bots hostis num raio tático. Nada de "wallhack": bots longe demais não
 * aparecem (`MINIMAP_ENEMY_RADIUS`).
 */
const WORLD = Config.WORLD_SIZE;

export class Minimap {
  constructor(canvas) {
    this.canvas = canvas || null;
    if (!this.canvas || !this.canvas.getContext) {
      this.ctx = null;
    } else {
      this.ctx = this.canvas.getContext('2d');
      const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
      const css = this.canvas.clientWidth || 140;
      this.canvas.width = Math.round(css * dpr);
      this.canvas.height = Math.round(css * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.size = css;
    }
    this._accum = 0;
    this.world = { pois: Config.POIS, lake: Config.LAKE };
  }

  /** @param {number} dt @param {{player:object, zone:object, bots:object}} state */
  update(dt, state) {
    if (!this.ctx) return;
    this._accum += dt;
    if (this._accum < 1 / 12) return; // 12 Hz basta (e é o que não custa layout)
    this._accum = 0;
    this._draw(state);
  }

  _s() {
    return this.size / WORLD;
  }

  _draw({ player, zone, bots }) {
    if (player || zone || bots) {
      this._drawBase();
      this._drawOverlay({ player, zone, bots });
    } else {
      // preview estático do Lobby: só o mapa, sem jogador nem hostis
      Minimap.drawBaseMap(this.ctx, this.size, { frame: false });
    }
  }

  /** Mapa puro (terra + estradas + POIs + lago). Estático: serve p/ o Lobby. */
  _drawBase() {
    const ctx = this.ctx;
    const k = this._s();
    const S = this.size;
    const toX = (x) => (x + WORLD / 2) * k;
    const toZ = (z) => (z + WORLD / 2) * k;

    ctx.clearRect(0, 0, S, S);
    // base: terra
    ctx.fillStyle = '#2b3a26';
    ctx.fillRect(0, 0, S, S);

    // estradas
    ctx.strokeStyle = 'rgba(150,124,86,0.75)';
    ctx.lineWidth = Math.max(1.5, 3.4 * k * 8);
    for (const link of roadLinks()) {
      const [a, b] = link;
      ctx.beginPath();
      ctx.moveTo(toX(a.x), toZ(a.z));
      ctx.lineTo(toX(b.x), toZ(b.z));
      ctx.stroke();
    }

    // POIs
    for (const p of this.world.pois) {
      ctx.fillStyle = p.id === 'cidade' ? 'rgba(212,196,158,0.9)' : 'rgba(186,176,150,0.62)';
      const r = Math.max(3, p.r * 0.72 * k);
      ctx.beginPath();
      ctx.arc(toX(p.x), toZ(p.z), r, 0, Math.PI * 2);
      ctx.fill();
    }

    // lago
    const lake = this.world.lake;
    ctx.fillStyle = 'rgba(46,104,124,0.85)';
    ctx.beginPath();
    ctx.arc(toX(lake.x), toZ(lake.z), Math.max(4, lake.r * k), 0, Math.PI * 2);
    ctx.fill();

  }

  /** Camada dinâmica: círculo, hostis, jogador, moldura. */
  _drawOverlay({ player, zone, bots }) {
    const ctx = this.ctx;
    const k = this._s();
    const S = this.size;
    const toX = (x) => (x + WORLD / 2) * k;
    const toZ = (z) => (z + WORLD / 2) * k;

    // zona: atual (círculo) + próximo (trace)
    if (zone && zone.enabled) {
      const c = zone.center;
      ctx.save();
      // escurece o que está FORA da zona: leitura instantânea
      ctx.fillStyle = 'rgba(120,20,30,0.28)';
      ctx.beginPath();
      ctx.rect(0, 0, S, S);
      ctx.arc(toX(c.x), toZ(c.y), Math.max(2, zone.radius * k), 0, Math.PI * 2, true);
      ctx.fill('evenodd');
      ctx.restore();

      ctx.strokeStyle = zone.state === 'CLOSING' ? '#ff7a5c' : '#8fd3ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(toX(c.x), toZ(c.y), Math.max(2, zone.radius * k), 0, Math.PI * 2);
      ctx.stroke();

      const next = zone.getNext();
      if (next && next.r < zone.radius - 1) {
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = 'rgba(160,240,255,0.9)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(toX(next.x), toZ(next.z), Math.max(2, next.r * k), 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // bots hostis (só os relevantes)
    if (player && bots && bots.list) {
      const lim = Config.MINIMAP_ENEMY_RADIUS;
      ctx.fillStyle = '#ff5b5b';
      for (const b of bots.list) {
        if (!b.alive || b.team === player.team) continue;
        const d = Math.hypot(b.position.x - player.position.x, b.position.z - player.position.z);
        if (d > lim) continue;
        ctx.globalAlpha = 0.55 + 0.45 * (1 - d / lim);
        ctx.beginPath();
        ctx.arc(toX(b.position.x), toZ(b.position.z), 1.9, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // jogador + cone de visão
    if (player) {
      const px = toX(player.position.x);
      const pz = toZ(player.position.z);
      const yaw = player.yaw ?? player.rotation?.y ?? 0;
      const dirX = Math.sin(yaw);
      const dirZ = Math.cos(yaw);
      ctx.fillStyle = 'rgba(140,220,255,0.28)';
      ctx.beginPath();
      ctx.moveTo(px, pz);
      const fov = 0.6;
      for (const sign of [-1, 1]) {
        const a = Math.atan2(dirX, dirZ) + sign * fov;
        ctx.lineTo(px + Math.sin(a) * 16, pz + Math.cos(a) * 16);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#eaf6ff';
      ctx.beginPath();
      ctx.arc(px, pz, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // moldura
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, S - 1, S - 1);
  }
}

/**
 * Desenha o mapa estático em qualquer canvas 2D (usado pelo Lobby como
 * "preview da arena" sem depender do Engine estar correndo).
 */
Minimap.drawBaseMap = function drawBaseMap(ctx, size, { frame = true } = {}) {
  const k = size / WORLD;
  const toX = (x) => (x + WORLD / 2) * k;
  const toZ = (z) => (z + WORLD / 2) * k;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#26351f';
  ctx.fillRect(0, 0, size, size);
  // relevo fake (mesma forma do heightmap, mas sem importar Noise no UI)
  ctx.fillStyle = 'rgba(90,120,70,0.22)';
  for (let i = 0; i < 26; i++) {
    const a = i * 2.399;
    const r = size * (0.1 + 0.42 * ((i * 37) % 11) / 11);
    ctx.beginPath();
    ctx.arc(size / 2 + Math.cos(a) * r * 0.7, size / 2 + Math.sin(a) * r * 0.7, size * 0.07, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(168,140,96,0.9)';
  ctx.lineWidth = Math.max(1.6, 3.6 * k * 8);
  for (const [a, b] of roadLinks()) {
    ctx.beginPath();
    ctx.moveTo(toX(a.x), toZ(a.z));
    ctx.lineTo(toX(b.x), toZ(b.z));
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(46,104,124,0.9)';
  ctx.beginPath();
  ctx.arc(toX(Config.LAKE.x), toZ(Config.LAKE.z), Math.max(4, Config.LAKE.r * k), 0, Math.PI * 2);
  ctx.fill();
  for (const p of Config.POIS) {
    ctx.fillStyle = p.id === 'cidade' ? 'rgba(226,210,170,0.95)' : 'rgba(196,186,160,0.7)';
    ctx.beginPath();
    ctx.arc(toX(p.x), toZ(p.z), Math.max(3.2, p.r * 0.72 * k), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = `${Math.max(6, size * 0.052)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(p.id.toUpperCase(), toX(p.x), toZ(p.z) - Math.max(4, p.r * 0.72 * k) - 2);
  }
  if (frame) {
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
  }
};

/** Pares de POIs ligados por estrada (mesma lista do Noise, sem importar de lá). */
function roadLinks() {
  const byId = new Map(Config.POIS.map((p) => [p.id, p]));
  const links = [['cidade', 'deposito'], ['cidade', 'fazenda'], ['cidade', 'antenas'], ['cidade', 'lago'], ['fazenda', 'lago']];
  return links.map(([a, b]) => [byId.get(a), byId.get(b)]).filter(([a, b]) => a && b);
}
