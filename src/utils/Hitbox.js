/**
 * Hitbox.js — Hitboxes de corpo (fps-shooter skill: cabeça / torso / membros
 * com multiplicadores) resolvidas por cápsula vertical em vez de malha.
 *
 * porque: um teste analítico contra um cilindro é O(1), não aloca nada e é
 * idêntico do lado do jogador e do bot — com 44 bots × vários tiros/frame,
 * raycast de triangulação está fora do orçamento mobile.
 *
 * `intersectCylinder` retorna o menor t > 0 em que o raio entra no cilindro
 * E a altura do ponto cai dentro da faixa [feetY, feetY + height].
 */

/** @returns {{t:number, part:'head'|'torso'|'legs', y:number}|null} */
export function intersectCylinder(ox, oy, oz, dx, dy, dz, cx, cz, feetY, radius, height, headFraction = 0.86, torsoFraction = 0.5) {
  const a = dx * dx + dz * dz;
  if (a < 1e-9) return null; // raio vertical puro: nunca acerta o cilindro
  const fx = ox - cx;
  const fz = oz - cz;
  const b = 2 * (fx * dx + fz * dz);
  const c = fx * fx + fz * fz - radius * radius;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  let t = (-b - sq) / (2 * a);
  if (t < 0) {
    // origem dentro do cilindro: usa a saída se ainda estiver na faixa de altura
    t = 0;
  }
  const y = oy + dy * t;
  if (y < feetY || y > feetY + height) {
    // tenta a saída do cilindro (o raio pode "subir" e entrar pela lateral de cima)
    const tOut = (-b + sq) / (2 * a);
    if (tOut <= 0) return null;
    const yOut = oy + dy * tOut;
    if (yOut < feetY || yOut > feetY + height) return null;
    t = tOut;
    return classify(oy + dy * t, feetY, height, headFraction, torsoFraction, t);
  }
  return classify(y, feetY, height, headFraction, torsoFraction, t);
}

function classify(y, feetY, height, headFraction, torsoFraction, t) {
  const rel = (y - feetY) / height;
  const part = rel >= headFraction ? 'head' : rel >= torsoFraction ? 'torso' : 'legs';
  return { t, part, y };
}

/** TTK: tiros necessários e tempo p/ matar (fps-shooter skill §Pattern 2). */
export function timeToKill(hp, damagePerShot, fireRate) {
  const shots = Math.ceil(hp / Math.max(0.001, damagePerShot));
  return { shots, ttk: (shots - 1) / fireRate };
}

/** Dano na banda de falloff: [0-30m, 30-55m, >55m]. */
export function damageAt(weapon, distance) {
  const bands = weapon.damage;
  if (distance <= 30) return bands[0];
  if (distance <= 55) return bands[1] ?? bands[0];
  return bands[2] ?? bands[1] ?? bands[0];
}

/**
 * Direção com dispersão cônica uniforme (fps-shooter skill: yaw e pitch
 * aleatórios independentes preenchem um QUADRADO — os cantos chegam a 1.41×
 * o spread. Aqui amostramos o disco com sqrt).
 */
export function applyConeSpread(dir, spreadRad, rand) {
  if (spreadRad <= 0) return dir;
  const r = spreadRad * Math.sqrt(rand()); // sqrt → distribuição uniforme no disco
  const a = rand() * Math.PI * 2;
  // base ortonormal (u, v) perpendicular a dir
  const ux = { x: 0, y: 1, z: 0 };
  if (Math.abs(dir.y) > 0.9) ux.x = 1, ux.y = 0;
  let u = {
    x: ux.y * dir.z - ux.z * dir.y,
    y: ux.z * dir.x - ux.x * dir.z,
    z: ux.x * dir.y - ux.y * dir.x,
  };
  let ul = Math.hypot(u.x, u.y, u.z);
  if (ul < 1e-9) { u = { x: 1, y: 0, z: 0 }; ul = 1; }
  u = { x: u.x / ul, y: u.y / ul, z: u.z / ul };
  const v = {
    x: dir.y * u.z - dir.z * u.y,
    y: dir.z * u.x - dir.x * u.z,
    z: dir.x * u.y - dir.y * u.x,
  };
  const s = Math.sin(r);
  const c = Math.cos(r);
  const ox = dir.x * c + (u.x * Math.cos(a) + v.x * Math.sin(a)) * s;
  const oy = dir.y * c + (u.y * Math.cos(a) + v.y * Math.sin(a)) * s;
  const oz = dir.z * c + (u.z * Math.cos(a) + v.z * Math.sin(a)) * s;
  const l = Math.hypot(ox, oy, oz) || 1;
  return { x: ox / l, y: oy / l, z: oz / l };
}
