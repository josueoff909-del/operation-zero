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

/**
 * Altura do terreno em (x, z). Colinas suaves (amplitude ~7u) com
 * uma planície central p/ spawn. Pura e determinística.
 * Fase 2: a área da cidade (prédios/ruas) é achatada até o raio 35
 * e mistura com o relevo natural até o raio 65 (ver Config.TOWN_*).
 */
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
  return h;
}
