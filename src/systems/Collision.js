import { Config } from '../core/Config.js';

/**
 * Collision.js — Colisão sólida por caixas AABB (Fase 2).
 * Paredes, portas, crates e coberturas registram caixas aqui;
 * o Player resolve círculo × AABB no plano XZ (com suporte a "piso"
 * de caixas baixas: dá p/ pular/subir em crates de 1m).
 * Todas as caixas são alinhadas aos eixos (sem rotação) — rápido e
 * robusto o bastante p/ o orçamento mobile. Sem dependência de Three.js.
 */
export class Collision {
  constructor() {
    /** @type {{minX:number,maxX:number,minZ:number,maxZ:number,minY:number,maxY:number}[]} */
    this.boxes = [];
  }

  /** Registra uma caixa sólida. (cx,cz) = centro XZ, (minY,maxY) = altura. */
  addBox(cx, cz, sx, sz, minY, maxY) {
    this.boxes.push({
      minX: cx - sx / 2,
      maxX: cx + sx / 2,
      minZ: cz - sz / 2,
      maxZ: cz + sz / 2,
      minY,
      maxY,
    });
  }

  /**
   * Empurra o círculo (posição XZ + raio) para fora das caixas.
   * Caixas cuja base está acima dos pés + STEP são ignoradas
   * (permite pular sobre coberturas baixas).
   * Chamar após mover cada eixo (X e Z separados) p/ deslizar nas paredes.
   */
  resolveCircle(position, radius, feetY) {
    const step = Config.COLLISION_STEP;
    for (const b of this.boxes) {
      if (feetY >= b.maxY - step) continue; // alto o bastante p/ passar por cima
      if (feetY + 1.8 <= b.minY) continue; // caixa acima da cabeça (ex.: telhado)
      const closestX = Math.max(b.minX, Math.min(b.maxX, position.x));
      const closestZ = Math.max(b.minZ, Math.min(b.maxZ, position.z));
      const dx = position.x - closestX;
      const dz = position.z - closestZ;
      const distSq = dx * dx + dz * dz;
      if (distSq >= radius * radius) continue;
      if (distSq > 1e-8) {
        // Fora da caixa: empurra radialmente p/ fora.
        const dist = Math.sqrt(distSq);
        const push = radius - dist;
        position.x += (dx / dist) * push;
        position.z += (dz / dist) * push;
      } else {
        // Centro dentro da caixa: empurra pelo menor eixo de penetração.
        const penLeft = position.x - b.minX;
        const penRight = b.maxX - position.x;
        const penBack = position.z - b.minZ;
        const penFront = b.maxZ - position.z;
        const minPen = Math.min(penLeft, penRight, penBack, penFront);
        if (minPen === penLeft) position.x = b.minX - radius;
        else if (minPen === penRight) position.x = b.maxX + radius;
        else if (minPen === penBack) position.z = b.minZ - radius;
        else position.z = b.maxZ + radius;
      }
    }
  }

  /**
   * Altura do "piso" de caixas em (x,z): maior topo de caixa que contém
   * o ponto e cujo topo está a no máximo STEP acima dos pés.
   * Retorna -Infinity se não houver caixa (usar o terreno).
   */
  getGroundHeight(x, z, feetY) {
    let ground = -Infinity;
    const step = Config.COLLISION_STEP;
    for (const b of this.boxes) {
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      if (b.maxY <= feetY + step && b.maxY > ground) ground = b.maxY;
    }
    return ground;
  }

  get count() {
    return this.boxes.length;
  }

  dispose() {
    this.boxes.length = 0;
  }
}
