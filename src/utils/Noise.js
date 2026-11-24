/**
 * Noise.js — Ruído de valor determinístico (seed fixa) p/ o terreno.
 * Sem dependências externas: hash 2D + interpolação bilinear + fBm.
 * A mesma função gera a malha E responde getHeightAt(x,z) p/ o jogador
 * andar sobre o relevo sem precisar de raycast por frame.
 */

function hash2(x, y, seed) {
  let h = seed + x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return ((h >>> 0) % 10000) / 10000; // 0..1
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

function valueNoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  const u = smooth(xf);
  const v = smooth(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** fBm: soma de oitavas com frequência dobrando e amplitude caindo. */
export function fbm(x, y, octaves = 4, seed = 1337) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, y * freq, seed + i * 101) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm; // 0..1
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/* ------------------------------------------------------------------ mapa */
/* Estradas (polilinhas) e lago: dados puros, derivados de Config — o terreno
 * achata nas estradas e cava o lago, e Vegetação/itens consultam as máscaras.
 * Tudo em função pura p/ `getHeightAt` continuar sem raycast. */
import { Config } from '../core/Config.js';

const ROAD_HALF = 4.2; // metade da largura da estrada de terra
/** Pairs de POIs ligados por estrada (GDD §2: rotas de rotação). */
const ROAD_LINKS = [
  ['cidade', 'deposito'], ['cidade', 'fazenda'], ['cidade', 'antenas'],
  ['cidade', 'lago'], ['fazenda', 'lago'],
];
function _poi(id) {
  return Config.POIS.find((p) => p.id === id) || { x: 0, z: 0, r: 20 };
}
// A estrada liga a BORDA de cada POI (não o centro): senão o meio da cidade
// vira um disco de terra e a praça some.
const ROADS = ROAD_LINKS.map(([a, b]) => {
  const pa = _poi(a);
  const pb = _poi(b);
  const dx = pb.x - pa.x;
  const dz = pb.z - pa.z;
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len;
  const uz = dz / len;
  const offA = pa.r * 0.82;
  const offB = pb.r * 0.82;
  return {
    ax: pa.x + ux * offA, az: pa.z + uz * offA,
    bx: pb.x - ux * offB, bz: pb.z - uz * offB,
  };
});

function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz || 1;
  let t = ((px - ax) * dx + (pz - az) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/** 0 = longe, 1 = no meio do asfalto de terra. Barato (5 segmentos). */
export function roadAmount(x, z) {
  let d = 1e9;
  for (const r of ROADS) d = Math.min(d, distToSegment(x, z, r.ax, r.az, r.bx, r.bz));
  return 1 - smoothstep(ROAD_HALF, ROAD_HALF + 3.4, d);
}

/** Profundidade do lago (0 = fora, >0 = dentro). Borda suave p/ a praia. */
export function lakeDepth(x, z) {
  const { x: cx, z: cz, r } = Config.LAKE;
  const d = Math.hypot(x - cx, z - cz);
  const shore = smoothstep(r, r - 12, d); // entra devagar: vau na beira
  const wob = (fbm(x * 0.03 + 5, z * 0.03 + 5, 2, 91) - 0.5) * 0.22;
  return Math.max(0, shore * (1.15 + wob) - 0.06);
}

export function isWater(x, z) {
  return lakeDepth(x, z) * -Config.WATER_LEVEL > 0.45;
}

/** Altura do terreno em (x, z) — a mesma função desenha a malha. */
export function terrainHeight(x, z) {
  const n = fbm(x * 0.012 + 10, z * 0.012 + 10, 4, 1337);
  const detail = fbm(x * 0.06, z * 0.06, 3, 777);
  let h = (n - 0.5) * 14 + (detail - 0.5) * 2.2;
  // Achata o centro (spawn) p/ o protótipo começar em área jogável.
  const distCenter = Math.hypot(x, z);
  const flat = Math.max(0, Math.min(1, (distCenter - 18) / 30));
  h *= flat;
  // Fase 2: planície da cidade (base y = 0 dentro do raio 35).
  h *= smoothstep(35, 65, distCenter);
  // POIs novos: cada região nomeada tem seu platô (prédios/containers retos).
  for (const p of Config.POIS) {
    if (p.id === 'cidade') continue;
    const d = Math.hypot(x - p.x, z - p.z);
    h *= smoothstep(p.r * 0.55, p.r * 1.35, d);
  }
  // Estradas: niveladas (senão a terra flutua na encosta).
  const road = roadAmount(x, z);
  if (road > 0) {
    let flatRoad = 0;
    for (const p of Config.POIS) {
      const d = Math.hypot(x - p.x, z - p.z);
      const hPoi = h * smoothstep(p.r * 0.55, p.r * 1.35, d);
      flatRoad = Math.max(flatRoad, hPoi);
      if (d < p.r * 0.6) flatRoad = Math.max(flatRoad, 0);
    }
    h = h * (1 - road) + flatRoad * road;
    h *= 1 - road * 0.15; // leitaço: a estrada afunda 15% (drena p/ o meio)
  }
  // Lago: cava a bacia até abaixo do nível d'água.
  const depth = lakeDepth(x, z);
  if (depth > 0) {
    const bottom = Config.WATER_LEVEL - 3.6 * Math.min(1, depth);
    h = Math.min(h, bottom + (1 - Math.min(1, depth * 3)) * 2.2);
  }
  return h;
}

/** Cor base do solo (grama/terra/areia/rocha) p/ vertex colors e o minimapa. */
export function groundTint(x, z, h, out) {
  const road = roadAmount(x, z);
  const dry = fbm(x * 0.021, z * 0.021, 2, 4242); // manchas de solo seco
  const sand = 1 - smoothstep(-2.6, -0.5, h); // só a praia do lago / barranco
  const rock = smoothstep(4.4, 8.5, h);
  let r = 0.30 + dry * 0.16;
  let g = 0.44 + dry * 0.10;
  let b = 0.20 + dry * 0.06;
  // areia
  r += (0.72 - r) * sand; g += (0.64 - g) * sand; b += (0.44 - b) * sand;
  // rocha
  r += (0.50 - r) * rock; g += (0.49 - g) * rock; b += (0.47 - b) * rock;
  // estrada de terra por cima de tudo
  const t = road * 0.92;
  r += (0.48 - r) * t; g += (0.38 - g) * t; b += (0.26 - b) * t;
  out[0] = r; out[1] = g; out[2] = b;
  return out;
}
