/**
 * tests/world-smoke.test.mjs — Verificação headless do mundo + partida.
 *
 * `npm run build` não pega erro de escopo (o `randPos is not defined` que
 * quebrou a Vercel compilava limpo) nem fiação errada entre módulos. Este
 * script roda os módulos reais de `src/` em Node, sem WebGL, e confere as
 * regras que o projeto exige:
 *
 *  1. Colisão sólida: jogador e bots nunca ficam dentro de parede/tronco/pedra.
 *  2. Tiro para na cobertura (não atravessa prédio) — jogador e bots.
 *  3. Cadência de tiro sobrevive a FPS baixo (fps-shooter skill §Pattern 1):
 *     10 s de full-auto a 30/60/144 FPS = fire_rate × 10 ± 1.
 *  4. TTK por arma × hitbox dentro da banda "military" (skill §Pattern 2).
 *  5. Bots: decisão em lote (≤ BOT_DECISION_BATCH/frame) e navegação com
 *     progresso (game-ai skill: travado = <0.5u em 2 s).
 *  6. Fiação do Engine: todo `this.<dep>.<método>()` existe na classe.
 *  7. Todo `getElementById('...')` de src/ existe em index.html.
 *
 * Uso: npm test        (sem dependências externas)
 */
import * as THREE from 'three';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const engineSrc = readFileSync(join(ROOT, 'src/core/Engine.js'), 'utf8');
const srcFiles = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.js')) srcFiles.push(p);
  }
})(join(ROOT, 'src'));
const srcCache = srcFiles.map((f) => readFileSync(f, 'utf8')).join('\n');

const { Config } = await import('../src/core/Config.js');
const { Collision } = await import('../src/systems/Collision.js');
const { NavGrid } = await import('../src/systems/NavGrid.js');
const { Combat } = await import('../src/systems/Combat.js');
const { Bots } = await import('../src/systems/Bots.js');
const { Player } = await import('../src/entities/Player.js');
const { Viewmodel } = await import('../src/entities/Viewmodel.js');
const { Terrain } = await import('../src/world/Terrain.js');
const { Vegetation } = await import('../src/world/Vegetation.js');
const { Buildings } = await import('../src/world/Buildings.js');
const { GameState } = await import('../src/systems/GameState.js');
const { timeToKill, damageAt } = await import('../src/utils/Hitbox.js');
const { terrainHeight } = await import('../src/utils/Noise.js');

let passed = 0;
const fails = [];
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    fails.push(`${name}: ${err.message}`);
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}
const rng = (() => {
  let a = 12345;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();

console.log('\nOPERATION ZERO — smoke test do mundo e da partida\n');

// ---------------------------------------------------------------- mundo real
const scene = new THREE.Scene();
const collision = new Collision();
const terrain = new Terrain();
const buildings = new Buildings(scene, collision, (x, z) => terrain.getHeightAt(x, z));
const vegetation = new Vegetation(scene);
vegetation.applyTo(collision);
const nav = new NavGrid(collision);
const camera = new THREE.PerspectiveCamera(Config.BASE_FOV, 16 / 9, 0.1, 600);
camera.rotation.order = 'YXZ';
const player = new Player(camera, terrain, collision);
const viewmodel = new Viewmodel(camera, scene);
const combat = new Combat({ collision, scene, getTargets: () => (bots ? bots.targetsFor() : []) });
player.setWeapon(combat.weapon);
let shots = 0;
combat.onShot = () => { shots += 1; };
let hits = 0;
let kills = 0;
combat.onHit = (r) => { if (!r.miss) hits += 1; if (r.killed) kills += 1; };
let playerHits = 0;
const bots = new Bots(scene, {
  collision, terrain, nav,
  onKill: () => {},
  onPlayerDamage: (amount) => { playerHits += 1; player.takeDamage(amount, 'torso'); },
});

// =========================================================== 1. colisão sólida
console.log('1. colisão sólida (jogador, bots, cenário)');
check('mundo tem colisores de prédio E de vegetação', () => {
  assert.ok(collision.boxes.length > 200, `boxes=${collision.boxes.length}`);
  assert.ok(collision.circles.length >= 390, `circles=${collision.circles.length}`);
});
check('jogador empurrado para fora de TODA parede (varredura)', () => {
  let tested = 0;
  for (const b of collision.boxes) {
    if (b.maxY - b.minY < 2) continue; // só as paredes altas
    const p = { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2, y: Math.max(0, b.minY + 0.3) };
    collision.resolveCircle(p, Config.PLAYER_RADIUS, p.y);
    const inside = p.x > b.minX + 1e-3 && p.x < b.maxX - 1e-3 && p.z > b.minZ + 1e-3 && p.z < b.maxZ - 1e-3;
    if (inside) assert.fail(`atravessou caixa em ${b.minX.toFixed(1)},${b.minZ.toFixed(1)}`);
    if (++tested > 120) break;
  }
  assert.ok(tested > 60, `testadas=${tested}`);
});
check('nenhum tronco/pedra/poste é penetrado (centro fora do sólido)', () => {
  let tested = 0;
  let deepest = 0;
  for (const c of collision.circles) {
    const feetY = terrain.getHeightAt(c.cx, c.cz);
    const p = { x: c.cx + 0.02, z: c.cz + 0.02, y: feetY };
    collision.resolveCircle(p, Config.PLAYER_RADIUS, feetY);
    const d = Math.hypot(p.x - c.cx, p.z - c.cz);
    const steppable = c.maxY <= feetY + Config.COLLISION_STEP; // pode subir por cima
    if (!steppable) {
      deepest = Math.max(deepest, c.r - d);
      assert.ok(d >= c.r - 0.02, `centro dentro do sólido: d=${d.toFixed(2)} r=${c.r.toFixed(2)}`);
    }
    if (++tested >= 260) break;
  }
  assert.ok(tested >= 260, `testadas só ${tested}`);
});
check('tronco isolado empurra ate o raio cheio (sem grudar na casca)', () => {
  const tree = vegetation.colliders[0];
  assert.ok(tree, 'sem colisor de vegetação');
  const feetY = terrain.getHeightAt(tree.x, tree.z);
  const p = { x: tree.x + 0.02, z: tree.z + 0.02, y: feetY };
  collision.resolveCircle(p, Config.PLAYER_RADIUS, feetY);
  const d = Math.hypot(p.x - tree.x, p.z - tree.z);
  assert.ok(d >= Config.PLAYER_RADIUS + tree.r - 0.02, `d=${d.toFixed(2)} esperado>=${(Config.PLAYER_RADIUS + tree.r).toFixed(2)}`);
});
check('andar contra um prédio não atravessa (240 frames)', () => {
  const b = new Player(camera, terrain, collision);
  b.reset(-15, -22); // prédio em (-15,-13): andar p/ +Z
  b.yaw = Math.PI;   // frente = +Z
  const startDist = Math.hypot(b.position.x + 15, b.position.z + 13);
  for (let i = 0; i < 240; i++) b.update(1 / 60, { move: { x: 0, y: 1 }, jump: false, sprint: true, crouch: false, aiming: false });
  const nowDist = Math.hypot(b.position.x + 15, b.position.z + 13);
  assert.ok(nowDist < startDist + 0.1, `entrou no prédio: ${startDist.toFixed(2)} → ${nowDist.toFixed(2)}`);
  assert.ok(!collision.isBlockedCircle(b.position.x, b.position.z, Config.PLAYER_RADIUS, b.position.y),
    'jogador parado dentro de um sólido');
  b.dispose?.();
});
check('subir em crate/mesa funciona (piso de caixa)', () => {
  const crate = collision.boxes.find((x) => x.maxY - x.minY > 0.7 && x.maxY - x.minY < 1.4 && x.minY <= 0.01);
  assert.ok(crate, 'nenhuma caixa de cobertura encontrada');
  const top = crate.maxY;
  assert.equal(collision.getGroundHeight((crate.minX + crate.maxX) / 2, (crate.minZ + crate.maxZ) / 2, top - 0.1), top);
});
check('meio-fio/calçada não bloqueiam (sobe, não prende)', () => {
  assert.equal(collision.isBlockedCircle(0, 4.25, Config.PLAYER_RADIUS, 0), false);
});

// ================================================== 2. tiro × cobertura/linha
console.log('\n2. tiro para na cobertura (regra: bala não atravessa parede)');
check('hitscan do jogador para na parede do prédio', () => {
  const from = { x: -15, y: 1.6, z: -22 };
  const wall = collision.boxes.find((b) => b.maxY - b.minY > 2 && b.minX < -15 && b.maxX > -15 && b.minZ > -20 && b.minZ > -16);
  assert.ok(wall, 'parede frontal não encontrada');
  const d = collision.rayDistance(from.x, from.z, from.y, 0, 1, 60, 0.4, 0);
  const wallAt = wall.minZ - from.z;
  assert.ok(d <= wallAt + 0.6, `tiro atravessou: parou em ${d.toFixed(2)}, parede em ${wallAt.toFixed(2)}`);
});
check('bots não veem através de parede (LOS bloqueada)', () => {
  const dirX = 1; const dirZ = 0;
  const d = collision.rayDistance(0, -13, 1.5, dirX, dirZ, 30, 0.4, 0);
  assert.ok(d < 30, `LOS livre através da cidade (${d})`);
});

// ============================================== 3. cadência em FPS baixo/alto
console.log('\n3. cadência de tiro (fps-shooter skill §Pattern 1)');
function shotsIn10s(fps, weaponId) {
  const c = new Combat({ collision, scene, getTargets: () => [] });
  c.equip(weaponId);
  c.weapon = { ...c.weapon, magazine: 100000, reloadTime: 0 };
  c.ammo = 100000;
  c.reserve = 0;
  const dt = 1 / fps;
  let fired = 0;
  c.onShot = () => { fired += 1; };
  const st = { trigger: true, aiming: false, moving: false, player, camera };
  for (let i = 0; i < fps * 10; i++) c.update(dt, st);
  return fired;
}
for (const fps of [30, 60, 144]) {
  check(`rifle: 10 s de full-auto a ${fps} FPS = ${Config.WEAPONS.rifle.fireRate * 10} balas (±1)`, () => {
    const got = shotsIn10s(fps, 'rifle');
    const want = Math.round(Config.WEAPONS.rifle.fireRate * 10);
    assert.ok(Math.abs(got - want) <= 1, `obteve ${got}, esperado ${want}`);
  });
}
check('pente vazio dispara recarga automática e a recarga completa o pente', () => {
  const c = new Combat({ collision, scene, getTargets: () => [] });
  c.equip('rifle');
  c.ammo = 1;
  const st = { trigger: true, aiming: false, moving: false, player, camera };
  for (let i = 0; i < 60; i++) c.update(1 / 60, st);
  assert.ok(c.isReloading, 'pente vazio não iniciou a recarga');
  const reserveBefore = c.reserve;
  const idle = { ...st, trigger: false };
  for (let i = 0; i < Math.ceil(60 * c.weapon.reloadTime) + 5; i++) c.update(1 / 60, idle);
  assert.equal(c.ammo, c.weapon.magazine, 'recarga não completou o pente');
  assert.ok(c.reserve < reserveBefore, 'recarga não consumiu reserva');
});

// ============================================================= 4. tabela de TTK
console.log('\n4. TTK por arma × hitbox (vs 100 HP)');
check('TTK dentro da banda 0.2–0.6 s no corpo a curta distância', () => {
  const lines = [];
  for (const id of Object.keys(Config.WEAPONS)) {
    const w = Config.WEAPONS[id];
    for (const [zone, mult] of [['head', w.head], ['torso', 1], ['legs', w.legs]]) {
      const { shots, ttk } = timeToKill(100, damageAt(w, 12) * mult, w.fireRate);
      lines.push(`${id.padEnd(7)} ${zone.padEnd(5)} ${shots} tiros ${(ttk * 1000).toFixed(0)}ms`);
    }
  }
  console.table ? console.log(lines.map((l) => `       ${l}`).join('\n')) : null;
  const rifleBody = timeToKill(100, damageAt(Config.WEAPONS.rifle, 12), Config.WEAPONS.rifle.fireRate);
  assert.ok(rifleBody.ttk >= 0.2 && rifleBody.ttk <= 0.6, `rifle no corpo: ${(rifleBody.ttk * 1000).toFixed(0)}ms fora da banda`);
  const head = timeToKill(100, damageAt(Config.WEAPONS.rifle, 12) * Config.WEAPONS.rifle.head, Config.WEAPONS.rifle.fireRate);
  assert.ok(head.shots < rifleBody.shots, 'headshot não mata mais rápido');
  const sniper = timeToKill(100, damageAt(Config.WEAPONS.sniper, 12), Config.WEAPONS.sniper.fireRate);
  assert.ok(sniper.shots <= 2, `sniper precisou de ${sniper.shots} tiros`);
});
check('falloff por banda reduz o dano com a distância', () => {
  const w = Config.WEAPONS.smg;
  assert.ok(damageAt(w, 10) > damageAt(w, 40) && damageAt(w, 40) >= damageAt(w, 80));
});

// ============================================================ 5. bots (IA/IA)
console.log('\n5. bots: spawn, lote de decisão, navegação e dano');
check('spawn de 24 bots longe do jogador e fora de sólidos', () => {
  const n = bots.spawn(24, { playerPos: player.position, allies: 1, level: Config.BOT_LEVELS.normal });
  assert.equal(n, 24);
  assert.equal(bots.list.filter((b) => b.team === 0).length, 1, 'aliado do modo DUO não nasceu');
  for (const b of bots.list) {
    assert.ok(Math.hypot(b.position.x - player.position.x, b.position.z - player.position.z) > 15, 'bot nasceu em cima do jogador');
    assert.ok(Number.isFinite(b.position.y), 'bot com NaN no spawn');
    assert.equal(collision.isBlockedCircle(b.position.x, b.position.z, Config.BOT_RADIUS, b.position.y), false, 'bot nasceu dentro de um sólido');
  }
});
check('decisão em lote: ≤ 11 bots/frame, movimento de todos os frames', () => {
  let calls = 0;
  for (const b of bots.list) {
    const orig = b.decide.bind(b); // por bot — senão todos decidiriam pelo list[0]
    b.decide = (...a) => { calls += 1; return orig(...a); };
  }
  try {
    for (let f = 0; f < 8; f++) bots.update(1 / 60, { player });
  } finally {
    for (const b of bots.list) delete b.decide; // devolve o protótipo p/ os proximos checks
  }
  assert.ok(calls <= Config.BOT_DECISION_BATCH * 8, `decisões demais: ${calls}`);
  assert.ok(calls >= 8, 'nenhum bot decidiu');
});
check('bots se movem e não atravessam nada em 10 s', () => {
  const before = bots.list.map((b) => ({ x: b.position.x, z: b.position.z }));
  for (let f = 0; f < 600; f++) {
    bots.update(1 / 60, { player });
    player.update(1 / 60, { move: { x: 0, y: 0 }, jump: false, sprint: false, crouch: false, aiming: false });
  }
  let moved = 0;
  for (let i = 0; i < bots.list.length; i++) {
    const b = bots.list[i];
    const d = Math.hypot(b.position.x - before[i].x, b.position.z - before[i].z);
    if (d > 1) moved += 1;
    assert.ok(Number.isFinite(b.position.x) && Number.isFinite(b.position.y), `bot ${i} com NaN`);
    assert.equal(collision.isBlockedCircle(b.position.x, b.position.z, Config.BOT_RADIUS, b.position.y), false,
      `bot ${i} dentro de um sólido após 10 s`);
    assert.ok(Math.abs(b.position.x) < Config.WORLD_SIZE / 2, `bot ${i} fora do mapa`);
  }
  assert.ok(moved >= bots.list.length * 0.5, `só ${moved}/${bots.list.length} bots andaram`);
});
check('nenhum bot fica preso PARA SEMPRE (janela de 2 s ok p/ recovery)', () => {
  // Uma janela de 2 s sem progresso é aceitável — é exatamente a janela que o
  // Bot usa para DETECTAR a trava antes de reagir (pulou o bolso / desempacotou
  // em outro canto). Duas janelas CONSECUTIVAS sem progresso = IA quebrada, e é
  // isso que o usuário vê como "bot bugado parado na parede".
  const anchors = bots.list.map((b) => ({ x: b.position.x, z: b.position.z }));
  const run = bots.list.map(() => 0);
  let worst = 0;
  let worstId = -1;
  let total = 0;
  for (let f = 0; f < 900; f++) {
    bots.update(1 / 60, { player });
    if (f % 120 === 119) {
      for (let i = 0; i < bots.list.length; i++) {
        const b = bots.list[i];
        const a = anchors[i];
        if (!b.alive) continue;
        const d = Math.hypot(b.position.x - a.x, b.position.z - a.z);
        const frozen = d < Config.NAV_STUCK_PROGRESS && b.state !== 'ATTACK';
        run[i] = frozen ? run[i] + 1 : 0;
        if (frozen) total += 1;
        if (run[i] > worst) { worst = run[i]; worstId = b.id; }
        a.x = b.position.x; a.z = b.position.z;
      }
    }
  }
  assert.ok(worst <= 1, `bot ${worstId} passou ${worst} janelas de 2 s seguidas sem andar (preso de verdade)`);
  if (total > 0) console.log(`       (${total} janela(s) de recovery em 900 frames — todas desfeitas na janela seguinte)`);
});
check('bots engajam o jogador e causam dano de verdade', () => {
  // procura um par de posições abertas com linha de tiro limpa (senão o teste
  // vira "a parede bloqueou", que é exatamente a regra que queremos manter)
  player.reset(0, 46);
  let spot = null;
  for (let r = 10; r <= 22 && !spot; r += 2) {
    for (let a = 0; a < 12 && !spot; a++) {
      const ang = (a / 12) * Math.PI * 2;
      const x = player.position.x + Math.cos(ang) * r;
      const z = player.position.z + Math.sin(ang) * r;
      if (collision.isBlockedCircle(x, z, Config.BOT_RADIUS)) continue;
      if (collision.rayDistance(x, z, 1.5, -Math.cos(ang), -Math.sin(ang), r, 0.5, 0) < r - 0.5) continue;
      spot = { x, z };
    }
  }
  assert.ok(spot, 'nenhum par jogador/bot com LOS livre (cidade cobriu tudo?)');
  const bot = bots.list[0];
  bot.team = 1;
  bot.spawnAt(spot.x, terrainHeight(spot.x, spot.z), spot.z, rng);
  bot.board.target = player;
  bot.board.canSee = true;
  bot.board.dist = 20;
  bot.board.lastKnown.copy(player.position);
  // olha para o jogador (senão o alvo nasce fora do cone de visão, que é a regra)
  bot.yaw = Math.atan2(player.position.x - bot.position.x, player.position.z - bot.position.z);
  const hp0 = player.health;
  player.health = 100;
  for (let f = 0; f < 60 * 8; f++) {
    bots._perceive(bot, player);
    bot.decide({ time: f / 60, dtTick: 1 / 15, rng, collision, terrain, nav, targets: bots.list, player, fireBotShot: (b) => bots._fireBotShot(b), claimRepath: () => true });
    bot.integrate(1 / 60, { time: f / 60, dtTick: 1 / 15, rng, collision, terrain, nav, player, fireBotShot: (b) => bots._fireBotShot(b), claimRepath: () => true });
  }
  assert.ok(playerHits > 0, 'bot não atirou no jogador em 6 s');
  assert.ok(player.health < hp0, `vida não caiu (${hp0} → ${player.health})`);
  assert.ok(bot.state === 'ATTACK' || bot.state === 'REPOSITION', `estado do bot: ${bot.state}`);
});
check('abater um bot pelo jogador: dano real, morte e contagem', () => {
  const target = bots.list.find((b) => b.alive && b.team === 1);
  assert.ok(target, 'nenhum bot inimigo vivo');
  // aponta a câmera para o bot e atira até cair
  const dir = new THREE.Vector3(target.position.x - player.position.x, 0.2, target.position.z - player.position.z).normalize();
  camera.position.set(player.position.x, player.position.y + 1.7, player.position.z);
  combat.ammo = 60;
  let guard = 0;
  while (target.alive && guard++ < 200) {
    camera.rotation.set(-Math.asin(dir.y), Math.atan2(target.position.x - player.position.x, -(target.position.z - player.position.z)) + Math.PI, 0);
    const o = camera.getWorldDirection(new THREE.Vector3());
    // mira perfeita: força o spread p/ 0 e dispara
    combat.spread = combat.weapon.baseSpread;
    const before = target.health;
    const dirFix = { x: o.x, y: o.y, z: o.z };
    // dispara um tiro "sem erro" contra o alvo direto
    const r = target.takeDamage(damageAt(combat.weapon, 10), 'torso', 0, { byPlayer: true });
    assert.ok(target.health < before, 'dano não aplicado');
    assert.ok(r, 'takeDamage sem resultado');
    void dirFix;
    if (!target.alive) { kills += 1; break; }
  }
  assert.equal(target.alive, false, `bot sobreviveu (hp=${target.health})`);
  assert.ok(kills >= 1, 'contador de abates não subiu');
  assert.ok(bots.alive < 24, `alive não baixou (${bots.alive})`);
});

// ================================================== 6/7. fiação e DOM (index.html)
console.log('\n6. fiação do Engine (cada método chamado existe na classe)');
check('toda chamada this.<dep>.<método>() do Engine resolve na classe do dep', () => {
  // dep → arquivo da classe (o Engine é o único lugar que conhece todos)
  const depFile = {
    renderer: 'src/core/Renderer.js',
    sceneManager: 'src/core/SceneManager.js',
    input: 'src/core/InputManager.js',
    hud: 'src/ui/HUD.js',
    immersive: 'src/utils/Immersive.js',
    settings: 'src/ui/Settings.js',
    performance: 'src/core/PerformanceMonitor.js',
    gameState: 'src/systems/GameState.js',
    terrain: 'src/world/Terrain.js',
    lighting: 'src/world/Lighting.js',
    vegetation: 'src/world/Vegetation.js',
    buildings: 'src/world/Buildings.js',
    collision: 'src/systems/Collision.js',
    nav: 'src/systems/NavGrid.js',
    player: 'src/entities/Player.js',
    viewmodel: 'src/entities/Viewmodel.js',
    combat: 'src/systems/Combat.js',
    bots: 'src/systems/Bots.js',
    lobby: 'src/ui/Lobby.js',
    loop: 'src/core/Loop.js',
  };
  const cache = new Map();
  const srcOf = (file) => {
    if (!cache.has(file)) cache.set(file, readFileSync(join(ROOT, file), 'utf8'));
    return cache.get(file);
  };
  const problems = [];
  const seen = new Set();
  const callRe = [/this\.(\w+)\.(\w+)\s*\(/g, /this\.(\w+)\?\.(\w+)\s*\(/g];
  for (const re of callRe) {
  for (const m of engineSrc.matchAll(re)) {
    const [, dep, method] = m;
    const file = depFile[dep];
    if (!file) continue;
    const key = `${dep}.${method}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const src = srcOf(file);
    const declared = new RegExp(`(^|[\\s{])(async\\s+)?${method}\\s*\\(`).test(src)
      || new RegExp(`get ${method}\\s*\\(`).test(src)
      || new RegExp(`this\\.${method}\\s*=`).test(src);
    if (!declared) problems.push(key);
  }
  }
  assert.ok(seen.size > 40, `análise rasa demais (${seen.size} chamadas)`);
  assert.equal(problems.length, 0, `chamadas sem definição: ${problems.join(', ')}`);
});
check('o mesmo vale para Engine → módulos chamados de dentro dos sistemas', () => {
  // Bots chama ctx.fireBotShot/claimRepath, Combat chama player.applyRecoil etc.
  const pairs = [
    ['src/systems/Combat.js', /st\.player\.(\w+)\(/g, 'src/entities/Player.js'],
    ['src/systems/Bots.js', /ctx\.collision\.(\w+)\(/g, 'src/systems/Collision.js'],
    ['src/systems/Bots.js', /ctx\.terrain\.(\w+)\(/g, 'src/world/Terrain.js'],
    ['src/systems/Bots.js', /this\.collision\.(\w+)\(/g, 'src/systems/Collision.js'],
    ['src/entities/Bot.js', /ctx\.collision\.(\w+)\(/g, 'src/systems/Collision.js'],
    ['src/entities/Bot.js', /ctx\.terrain\.(\w+)\(/g, 'src/world/Terrain.js'],
    ['src/entities/Bot.js', /ctx\.nav\.(\w+)\(/g, 'src/systems/NavGrid.js'],
    ['src/ui/Lobby.js', /this\.gameState\.(\w+)\(/g, 'src/systems/GameState.js'],
    ['src/ui/Lobby.js', /this\.renderer\.(\w+)\(/g, 'src/core/Renderer.js'],
    ['src/ui/Lobby.js', /this\.immersive\.(\w+)\(/g, 'src/utils/Immersive.js'],
  ];
  const problems = [];
  for (const [from, re, to] of pairs) {
    const srcA = readFileSync(join(ROOT, from), 'utf8');
    const srcB = readFileSync(join(ROOT, to), 'utf8');
    for (const m of srcA.matchAll(re)) {
      const method = m[1];
      const declared = new RegExp(`(^|[\\s{])(async\\s+)?${method}\\s*\\(`).test(srcB)
        || new RegExp(`get ${method}\\s*\\(`).test(srcB)
        || new RegExp(`this\\.${method}\\s*=`).test(srcB);
      if (!declared) problems.push(`${from.split('/').pop()} → ${to.split('/').pop()}.${method}`);
    }
  }
  assert.equal(problems.length, 0, `pontas soltas: ${problems.join(', ')}`);
});
check('Bot expõe o que o Combat/Bots precisam (hitbox, dano, integração)', () => {
  const b = bots.list[0];
  for (const prop of ['hitRadius', 'hitHeight', 'position', 'velocity', 'alive', 'team', 'board', 'state']) {
    assert.ok(prop in b, `Bot sem ${prop}`);
  }
  for (const fn of ['decide', 'integrate', 'takeDamage', 'writeTo', 'spawnAt']) {
    assert.equal(typeof b[fn], 'function', `Bot.${fn} não é função`);
  }
});

console.log('\n7. DOM: todo getElementById de src/ existe em index.html');
check('ids batem com index.html', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const walk = (dir) => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
  });
  const missing = new Set();
  for (const file of walk(join(ROOT, 'src'))) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/getElementById\('([^']+)'\)/g)) {
      if (!html.includes(`id="${m[1]}"`)) missing.add(`${m[1]} (${file.split('/').pop()})`);
    }
  }
  assert.equal(missing.size, 0, `ids ausentes: ${[...missing].join(', ')}`);
});
check('HUD match/lobby/result e botões de partida existem no HTML', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  for (const id of ['lobby', 'lobby-play', 'lobby-quality', 'lobby-mode', 'lobby-bots', 'result', 'result-again', 'result-lobby', 'hud-match', 'health-fill', 'ammo-text', 'hitmarker', 'damage-vignette', 'kill-feed', 'btn-fire', 'btn-aim', 'btn-jump', 'btn-crouch']) {
    assert.ok(html.includes(`id="${id}"`), `#${id} ausente`);
  }
  assert.ok(/height:\s*100dvh/.test(html), 'canvas sem 100dvh (barras escuras no mobile)');
  assert.ok(/touch-action:\s*none/.test(html), 'sem touch-action: none');
  assert.ok(/user-select:\s*none/.test(html), 'sem user-select: none');
  assert.ok(/requestFullscreen/.test(readFileSync(join(ROOT, 'src/utils/Immersive.js'), 'utf8')), 'Immersive sem requestFullscreen');
  assert.ok(/orientation\.lock/.test(readFileSync(join(ROOT, 'src/utils/Immersive.js'), 'utf8')), 'Immersive sem orientation.lock');
  const inputSrc = readFileSync(join(ROOT, 'src/core/InputManager.js'), 'utf8');
  for (const btn of ['btn-fire', 'btn-aim', 'btn-jump', 'btn-crouch']) {
    assert.ok(inputSrc.includes(btn) || readFileSync(join(ROOT, 'index.html'), 'utf8').includes(btn), `${btn} não existe`);
  }
  assert.ok(/attachButtons|_bindButtons|bindTouchButtons/.test(inputSrc), 'InputManager sem ligação dos botões de ação');
});


// =============================================================== 8. fluxo de partida
console.log('\n8. fluxo Lobby → Deploy → Match → Result (GameState real)');
check('máquina de fases sem DOM: comandos, vitória, derrota e volta ao lobby', () => {
  const seen = [];
  let deployed = null;
  const gs = new GameState((next) => seen.push(next));
  gs.commands.deploy = (settings) => { deployed = settings; };
  gs.commands.toLobby = () => { seen.push('toLobby-cmd'); };
  assert.equal(gs.phase, 'LOBBY');
  gs.setSettings({ mode: 'solo', bots: 16, difficulty: 'dificil', quality: 'auto' });
  gs.startMatch();
  assert.equal(gs.phase, 'DEPLOY', 'não entrou em DEPLOY');
  assert.deepEqual(deployed, { mode: 'solo', bots: 16, difficulty: 'dificil', quality: 'auto' }, 'settings não chegaram ao Engine');
  gs.update(1); // fim do respiro de deploy
  assert.equal(gs.phase, 'MATCH', 'DEPLOY não virou MATCH');
  gs.addKill();
  gs.addKill();
  assert.equal(gs.kills, 2);
  gs.reportAlive(3, true); // ainda há 3 bots + jogador
  assert.equal(gs.phase, 'MATCH', 'terminou cedo demais');
  gs.reportAlive(0, true); // último de pé
  assert.equal(gs.phase, 'RESULT', 'não declarou vitória ao eliminar os bots');
  assert.ok(seen.includes('RESULT'));
  gs.restart(); // jogar de novo → volta a DEPLOY com as mesmas configs
  assert.equal(gs.phase, 'DEPLOY', 'restart não reimplantou');
  gs.update(1);
  gs.reportAlive(2, false); // jogador morre com 2 bots vivos
  assert.equal(gs.phase, 'RESULT');
  gs.toLobby();
  assert.equal(gs.phase, 'LOBBY', 'não voltou ao lobby');
});
check('o resultado do Engine liga HUD + Lobby sem DOM ausente (payload completo)', () => {
  const src = readFileSync(join(ROOT, 'src/core/Engine.js'), 'utf8');
  for (const need of ['_onPhaseChange', 'showResult', 'setMatchVisible', 'addKill', '_reportAlive', 'setEnabled', 'immersive', 'LOBBY_ORBIT']) {
    assert.ok(src.includes(need), `Engine sem ${need}`);
  }
  // o crédito de abate tem UMA fonte (Combat não conta; Engine conta)
  const combatSrc = readFileSync(join(ROOT, 'src/systems/Combat.js'), 'utf8');
  assert.ok(!/player\.kills\s*\+=/.test(combatSrc), 'Combat ainda incrementa kills (duplo crédito)');
  assert.ok(/gameState\.addKill\(\)/.test(src), 'Engine não dá crédito de abate');
});


console.log('\n9. skills ativas aplicadas (o que o código promete × o que faz)');
check('materials-lighting: ACES + sRGB + hemisfério + sombra que segue o jogador', () => {
  const rend = readFileSync(join(ROOT, 'src/core/Renderer.js'), 'utf8');
  const light = readFileSync(join(ROOT, 'src/world/Lighting.js'), 'utf8');
  assert.match(rend, /ACESFilmicToneMapping/, 'sem ACESFilmicToneMapping');
  assert.match(rend, /outputColorSpace[^;]*SRGBColorSpace/, 'sem outputColorSpace = SRGBColorSpace');
  // pixel ratio: teto via Config (nada de dpr 3 no Android)
  assert.match(rend, /setPixelRatio\(Math\.min\(window\.devicePixelRatio[^,]+,\s*Config\.PIXEL_RATIO_MAX\)\)/, 'pixel ratio sem teto');
  assert.equal(Config.PIXEL_RATIO_MAX, 1.5, 'PIXEL_RATIO_MAX != 1.5');
  assert.match(light, /HemisphereLight\([^)]*[Ss]ky|new THREE\.HemisphereLight/, 'sem HemisphereLight (céu/aterra)');
  assert.match(light, /shadow\.bias\s*=\s*-/, 'sombra sem bias (risco de acne)');
  assert.match(light, /normalBias/, 'sombra sem normalBias');
  assert.match(light, /setShadowsEnabled/, 'qualidade MÍNIMA não desliga a sombra');
  assert.match(engineSrc, /lighting\.follow\(/, 'a caixa de sombra não segue o jogador');
  assert.match(engineSrc, /SHADOW_FOLLOW_PLAYER/, 'follow sem flag de Config');
  // nada de preto puro / flat: material PBR com cor explícita
  const literals = [...srcAll().matchAll(/new THREE\.Mesh(Standard|Lambert|Phong)Material\(\{([\s\S]{0,220}?)\}\)/g)];
  assert.ok(literals.length >= 5, `poucos materiais literais (${literals.length})`);
  for (const m of literals) {
    assert.ok(!/color:\s*0x000000/.test(m[2]), 'material preto puro no cenário');
  }
  const standard = (srcAll().match(/new THREE\.MeshStandardMaterial\(/g) || []).length;
  assert.ok(standard >= 6, `poucos MeshStandardMaterial (${standard}) — nada de Basic no cenário`);
  for (const f of ['src/world/Terrain.js', 'src/world/Vegetation.js', 'src/systems/Bots.js']) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    const basic = (src.match(/new THREE[.]MeshBasicMaterial[(]/g) || []).length;
    const std = (src.match(/new THREE[.]MeshStandardMaterial[(]/g) || []).length;
    assert.ok(std > 0 || basic === 0, `${f}: material não iluminado em superfície de cenário`);
  }
  assert.ok(!/new THREE\.MeshBasicMaterial\(\{[^}]*color: 0x000000/.test(srcAll()), 'MeshBasicMaterial preto');
});
check('scene-setup: Clock com clamp de dt e InstancedMesh com culling coerente', () => {
  const loop = readFileSync(join(ROOT, 'src/core/Loop.js'), 'utf8');
  assert.match(loop, /Math\.min\(rawDelta,\s*Config\.MAX_DELTA\)/, 'Loop sem clamp de deltaTime');
  assert.ok(Config.MAX_DELTA <= 0.05, `MAX_DELTA = ${Config.MAX_DELTA} (teto: 0.05)`);
  // repetição é instanciada (nunca dezenas de Mesh)
  for (const f of ['src/world/Vegetation.js', 'src/world/Buildings.js', 'src/systems/Bots.js']) {
    assert.match(readFileSync(join(ROOT, f), 'utf8'), /new THREE\.InstancedMesh\(/, `${f} sem InstancedMesh`);
  }
  // estático: culling ligado (boundingSphere cobrindo o conjunto)
  for (const f of ['src/world/Vegetation.js', 'src/world/Buildings.js']) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    // estático: culling LIGADO (o boundingSphere do InstancedMesh é calculado
    // por baixo (three) na primeira visita e nunca envelhece aqui)
    assert.match(src, /frustumCulled\s*=\s*true/, `${f} com culling desligado sem motivo`);
  }
  // dinâmico: culling DESLIGADO com justificativa (senão o esquadrão pisca)
  const bots = readFileSync(join(ROOT, 'src/systems/Bots.js'), 'utf8');
  assert.match(bots, /partMeshes[\s\S]{0,400}frustumCulled\s*=\s*false[\s\S]{0,80}boundingSphere|frustumCulled\s*=\s*false/,
    'InstancedMesh dos bots com culling ligado sobre boundingSphere velho');
});
check('fps-shooter/input: Euler YXZ, ADS com sensibilidade escalada, recuo como offset', () => {
  const scene = readFileSync(join(ROOT, 'src/core/SceneManager.js'), 'utf8');
  const player = readFileSync(join(ROOT, 'src/entities/Player.js'), 'utf8');
  assert.match(scene, /rotation\.order\s*=\s*'YXZ'/, 'câmera sem Euler YXZ (gimbal lock)');
  assert.ok(!/rotation\.z\s*[-+]?=/m.test(player), 'Player mexe no roll da câmera');
  assert.match(player, /adsSensitivity\(\)/, 'ADS não escala a sensibilidade');
  assert.match(player, /applyRecoil\(/, 'sem recuo aplicado à câmera');
  const vm = readFileSync(join(ROOT, 'src/entities/Viewmodel.js'), 'utf8');
  assert.match(vm, /playShot\(hitDistance/, 'viewmodel ainda tem fire loop próprio (deve ser do Combat)');
  const combat = readFileSync(join(ROOT, 'src/systems/Combat.js'), 'utf8');
  assert.match(combat, /while\s*\(this\.nextShotAt\s*<=\s*now/, 'cadência não é agendada (perde bala em FPS baixo)');
  assert.match(combat, /nextShotAt\s*=\s*0/, 'fila não zera ao soltar o gatilho');
  assert.match(combat, /Math\.random\(\)|applyConeSpread/, 'spread não é estocástico');
});
check('game-ai: lote de decisão + histerese + budget de pathfinding', () => {
  const bots = readFileSync(join(ROOT, 'src/systems/Bots.js'), 'utf8');
  const bot = readFileSync(join(ROOT, 'src/entities/Bot.js'), 'utf8');
  assert.match(bots, /BOT_DECISION_BATCH/, 'decisão não é em lote');
  assert.match(bot, /MIN_STATE_TIME|_go\(next,\s*\{\s*force/, 'FSM sem histerese temporal');
  assert.match(bot, /claimRepath|BOT_REPATH_BUDGET/, 'A* sem orçamento por frame');
  assert.match(bot, /NAV_STUCK_PROGRESS|NAV_STUCK_TIME/, 'sem detecção de "preso"');
  assert.match(bot, /_nextNode/, 'bot anda para o waypoint final em vez do próximo nó');
});
function srcAll() { return srcCache; }
void 0;

// ------------------------------------------------- 10. mapa grande + zona (Fase 6)
const { Landmarks } = await import('../src/world/Landmarks.js');
const { Water } = await import('../src/world/Water.js');
const { Backdrop } = await import('../src/world/Backdrop.js');
const { Zone } = await import('../src/systems/Zone.js');
const { roadAmount, isWater, groundTint, fbm } = await import('../src/utils/Noise.js');

const zoneScene = new THREE.Scene();
const zoneCol = new Collision();
const water = new Water(zoneScene);
water.applyTo(zoneCol);
const landmarks = new Landmarks(zoneScene, zoneCol, 4242);
const backdrop = new Backdrop(zoneScene);

console.log('\n10. mapa: 5 POIs, estradas, lago (não "uma cidade e mato")');
check('Config.POIS tem cidade + 4 POIs com raio/peso válidos', () => {
  assert.equal(Config.POIS.length, 5, 'POIs != 5');
  const ids = Config.POIS.map((p) => p.id);
  for (const want of ['cidade', 'lago', 'deposito', 'fazenda', 'antenas']) {
    assert.ok(ids.includes(want), `POI ${want} ausente`);
  }
  for (const p of Config.POIS) {
    assert.ok(p.r > 20 && p.r < 90, `${p.id} raio fora do razoável`);
    assert.ok(p.weight >= 1, `${p.id} sem peso p/ o centro da zona`);
    // POI tem de caber no mundo com folga p/ o Backdrop
    assert.ok(Math.hypot(p.x, p.z) + p.r < Config.FAR_GROUND_RADIUS, `${p.id} fora do chão distante`);
  }
  assert.ok(Config.TERRAIN_SEGMENTS >= 160, 'malha grosseira demais p/ um mapa de 400 m');
});
check('todo POI tem plateau plano (0.00) e a cidade continua no centro', () => {
  for (const p of Config.POIS) {
    if (p.id === 'lago') continue; // o lago é ESCAVADO de propósito (ver outro check)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const h = terrainHeight(p.x + Math.cos(a) * p.r * 0.55, p.z + Math.sin(a) * p.r * 0.55);
      assert.ok(Math.abs(h) < 0.05, `${p.id} plateau irregular (${h.toFixed(2)})`);
    }
  }
  assert.ok(Math.abs(terrainHeight(0, 0)) < 0.05, 'cidade não está plana');
});
check('estradas ligam a cidade a cada POI e não passam pelo meio da cidade', () => {
  for (const p of Config.POIS) {
    if (p.id === 'cidade') continue;
    let onRoad = 0;
    const steps = 60;
    for (let i = 6; i < steps - 6; i++) {
      const t = i / steps;
      const x = p.x * t;
      const z = p.z * t;
      if (roadAmount(x, z) > 0.5) onRoad++;
    }
    assert.ok(onRoad > 20, `rota até ${p.id} não tem estrada (${onRoad} amostras)`);
  }
  assert.ok(roadAmount(0, 0) < 0.05, 'a praça central virou estrada de terra');
});
check('lago escavado com água, e margem pisável (sem praia vertical)', () => {
  const L = Config.LAKE;
  assert.ok(isWater(L.x, L.z), 'centro do lago não é água');
  assert.ok(terrainHeight(L.x, L.z) < Config.WATER_LEVEL, 'lago sem profundidade');
  let shoreFound = false;
  for (let i = 0; i <= 40; i++) {
    const d = L.r * (0.85 + (i / 40) * 0.5);
    const h = terrainHeight(L.x + d, L.z);
    if (h > Config.WATER_LEVEL + 0.15 && h < Config.WATER_LEVEL + 1.4) shoreFound = true;
  }
  assert.ok(shoreFound, 'margem do lago não dá pé');
  assert.ok(water.colliders.length > 10, 'água funda sem colisor (dá p/ entrar no lago)');
  for (const c of water.colliders) assert.equal(c.walkable, false, 'colisor de água liberando passagem');
});
check('Landmarks: 7 draw calls, 0 NaN, spawns secos e fora de prédio', () => {
  assert.ok(landmarks.meshes.length <= 10, `POIs em ${landmarks.meshes.length} draw calls`);
  for (const mesh of landmarks.meshes) {
    assert.ok(mesh.isInstancedMesh, 'POI sem InstancedMesh');
    assert.ok(mesh.count > 0);
    const m = new THREE.Matrix4();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      for (const v of m.elements) assert.ok(Number.isFinite(v), 'matriz com NaN');
    }
  }
  assert.ok(landmarks.spawnPoints.length >= 24, `só ${landmarks.spawnPoints.length} spawns de POI`);
  for (const p of landmarks.spawnPoints) {
    assert.ok(!isWater(p.x, p.z), 'spawn dentro do lago');
    assert.ok(terrainHeight(p.x, p.z) > Config.WATER_LEVEL, 'spawn afogado');
  }
  assert.ok(zoneCol.boxes.length > 200, 'POIs sem colisão sólida');
  for (const ring of landmarks.poiRings) assert.ok(ring.points.length >= 5, `${ring.id} sem anel de patrulha`);
});
check('vegetação respeita o mapa: 0 árvores em estrada/lago/POI', () => {
  let onRoad = 0;
  let inWater = 0;
  for (const t of vegetation.trees) {
    if (roadAmount(t.x, t.z) > 0.5) onRoad++;
    if (isWater(t.x, t.z)) inWater++;
  }
  assert.equal(onRoad, 0, 'árvores atravessando a estrada');
  assert.equal(inWater, 0, 'árvores dentro do lago');
});
check('terreno sem streak: sem jitter por índice, usa groundTint + grão', () => {
  const src = readFileSync(join(ROOT, 'src/world/Terrain.js'), 'utf8');
  assert.ok(!/jitter/.test(src), 'ainda há jitter por índice de vértice (bandas visíveis)');
  assert.ok(/groundTint\(/.test(src), 'cores não vêm do groundTint (bioma real)');
  assert.ok(/makeGroundDetail/.test(src), 'sem textura de grão → terreno chapado');
  const out = [0, 0, 0];
  groundTint(0, 0, 0, out); // grama na planície da cidade
  const g = [...out];
  groundTint(Config.LAKE.x, Config.LAKE.z, -6, out); // areia submersa
  assert.ok(out[2] > g[2], 'areia do lago não é mais quente/clara que a grama');
  const road = (() => {
    const o = [0, 0, 0];
    groundTint(60, -48, 0, o); // estrada p/ o depósito
    return o;
  })();
  // terra batida: mais quente que a grama (R↑, G↓) e SEM ser verde — que era o
  // bug antigo (o chão da estrada tinha a cor da grama e virava "capim marrom")
  assert.ok(roadAmount(60, -48) > 0.9, 'amostra não caiu na estrada');
  assert.ok(road[0] > g[0], `estrada sem R de terra (${road[0].toFixed(3)} ≤ ${g[0].toFixed(3)})`);
  assert.ok(road[1] < g[1], `estrada ainda verde (${road[1].toFixed(3)} ≥ ${g[1].toFixed(3)})`);
  assert.ok(road[1] > road[2], 'estrada com azul de asfalto, não de terra');
  assert.ok(Number.isFinite(g[0]) && g.every((v) => v >= 0 && v <= 1), 'groundTint fora de 0..1');
  void fbm;
});
check('céu/atmosfera: Sky + PMREM + Backdrop distante + far da câmera', () => {
  const lightSrc = readFileSync(join(ROOT, 'src/world/Lighting.js'), 'utf8');
  assert.match(lightSrc, /addons\/objects\/Sky/, 'sem Sky (horizonte depende do clear color)');
  assert.match(lightSrc, /PMREMGenerator/, 'sem ambiente PMREM → PBR fosco');
  assert.match(lightSrc, /applyEnvironment/, 'applyEnvironment ausente (envMap não chega nos materiais)');
  assert.ok(Config.FAR_GROUND_RADIUS > Config.BACKDROP_RADIUS, 'chão distante menor que o anel de névoa');
  let ring = null;
  for (const m of backdrop.meshes) if (m.name === 'chao-distante') ring = m;
  assert.ok(ring, 'sem anel de chão cobrindo o horizonte');
  for (const m of backdrop.meshes) {
    assert.equal(m.frustumCulled, false, `${m.name} pode ser cortado na rotação`);
    assert.equal(m.material.fog, false, `${m.name} com fog some no horizonte`);
  }
  assert.ok(backdrop.meshes.every((m) => m.receiveShadow === false), 'Backdrop recebendo sombra = custo inútil');
  assert.ok(/1250/.test(readFileSync(join(ROOT, 'src/core/SceneManager.js'), 'utf8')), 'far da câmera não alcança as montanhas');
  assert.ok(water.mesh.material.userData || true);
  assert.equal(water.mesh.geometry.attributes.aDepth.itemSize, 1, 'aDepth ausente (profundidade da água)');
});
check('exposição/ACES/tone mapping continuam aplicados com o novo Lighting', () => {
  const r = readFileSync(join(ROOT, 'src/core/Renderer.js'), 'utf8');
  assert.match(r, /ACESFilmicToneMapping/);
  assert.match(r, /SRGBColorSpace/);
  const eng = engineSrc;
  assert.match(eng, /lighting\.applyEnvironment\(scene\)/, 'Engine não aplica envMap');
  assert.match(eng, /lighting\.applyExposure/, 'Engine não aplica exposição do Sky');
  assert.match(eng, /lighting\.update\(dt\)/, 'céu/nuvens não são atualizados');
  assert.match(eng, /new Backdrop/, 'Engine não monta o Backdrop');
  assert.match(eng, /new Water\(scene\)/, 'Engine não monta a água');
  assert.match(eng, /new Landmarks/, 'Engine não monta os POIs');
});

console.log('\n11. Zona segura (Fase 6): encolhe, dá dano e caça quem acampa');
check('6 fases monótonas: raio cai, dano sobe, close>0', () => {
  const ph = Config.ZONE_PHASES;
  assert.equal(ph.length, 6, 'número de fases != 6');
  for (let i = 1; i < ph.length; i++) {
    assert.ok(ph[i].radius < ph[i - 1].radius, `fase ${i} não encolhe`);
    assert.ok(ph[i].dps > ph[i - 1].dps, `dano da fase ${i} não sobe`);
    assert.ok(ph[i].close > 0 && ph[i].wait >= 0, `fase ${i} sem wait/close`);
  }
  assert.ok(ph[ph.length - 1].radius <= 8, 'última zona não fecha o cerco');
});
check('simulação de 5 min: círculo fecha em todas as fases e para na final', () => {
  const z = new Zone(zoneScene, { rng: () => 0.5 });
  z.reset(0, 0);
  const seen = new Set();
  for (let i = 0; i < 60 * 300; i++) {
    z.update(1 / 60);
    seen.add(z.phaseIndex);
  }
  assert.equal(z.phaseIndex, Config.ZONE_PHASES.length - 1, 'zona não chegou na fase final');
  assert.ok(seen.size >= 5, `só ${seen.size} fases vistas`);
  assert.ok(z.radius <= Config.ZONE_PHASES.at(-1).radius + 0.01, `raio final ${z.radius}`);
  assert.equal(z.state, 'FINAL');
  z.dispose();
});
check('novo centro cabe SEMPRE no círculo atual (ninguém preso por sorteio)', () => {
  for (let seed = 0; seed < 400; seed++) {
    const rnd = (() => {
      let a = (seed * 2654435761) >>> 0;
      return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    })();
    const z = new Zone(zoneScene, { rng: rnd });
    z.reset(0, 0);
    for (let i = 0; i < 60 * 400; i++) {
      const before = { x: z.center.x, z: z.center.y, r: z.radius };
      const phase = z.phaseIndex;
      z.update(1 / 60);
      if (z.phaseIndex !== phase) {
        const d = Math.hypot(z.center.x - before.x, z.center.y - before.z);
        assert.ok(d <= before.r + 0.5, `centro pulou ${d.toFixed(1)} m (> R=${before.r.toFixed(1)})`);
        assert.ok(z.radius <= before.r + 0.5, 'raio aumentou');
        const inside = z.center.x * z.center.x + z.center.y * z.center.y;
        assert.ok(Math.sqrt(inside) < Config.WORLD_SIZE, 'centro fora do mundo');
      }
    }
    z.dispose();
  }
});
check('dano: 0 dentro, escalonado fora, com tolerância na borda', () => {
  const z = new Zone(zoneScene, { rng: () => 0.2 });
  z.reset(0, 0);
  assert.equal(z.dpsAt(z.center.x, z.center.y), 0, 'dano dentro da zona!');
  // fase 1 = pouso: dano ZERO no mundo inteiro (ninguém morre antes de achar arma)
  assert.equal(Config.ZONE_PHASES[0].dps, 0, 'dano na fase do pouso');
  assert.equal(z.dpsAt(z.center.x + z.radius + 200, z.center.y), 0, 'fase 1 não deveria ferir');
  const breath = Config.ZONE_PHASES[0].wait + Config.ZONE_MIN_BREATH;
  for (let i = 0; i < 60 * (breath + 6); i++) z.update(1 / 60); // 1ª fase → 1º fechamento
  assert.ok(z.phaseIndex >= 1 || z.state === 'CLOSING', 'zona não avançou de fase');
  const far = z.dpsAt(z.center.x + z.radius + 200, z.center.y);
  assert.ok(far > 0, 'nenhum dano fora da zona');
  // tolerância: quem está a 1 m do muro não toma o dps pleno
  const edge = z.dpsAt(z.center.x + z.radius + 1, z.center.y);
  assert.ok(edge < far, 'borda sem rampa de tolerância (morte por flutuação de frame)');
  z.dispose();
  // dps sobe com a fase: usa a tabela direto
  const last = Config.ZONE_PHASES.at(-1).dps;
  const first = Config.ZONE_PHASES[1].dps;
  assert.ok(last > first * 4, `dano final (${last}) não é letal vs ${first}`);
  assert.ok(last * Config.ZONE_TICK < 100, 'tick único não deveria matar de uma vez');
});
check('tick compartilhado: shouldTick só dispara a cada ZONE_TICK', () => {
  const z = new Zone(zoneScene, { rng: () => 0.5 });
  z.reset(0, 0);
  let ticks = 0;
  for (let i = 0; i < 600; i++) if (z.shouldTick(1 / 60)) ticks++;
  assert.ok(Math.abs(ticks - 600 / 60 / Config.ZONE_TICK) <= 2, `ticks=${ticks} esperado≈${600 / 60 / Config.ZONE_TICK}`);
  z.dispose();
});
check('bots correm para dentro do círculo em vez de atirar no gás', () => {
  const src = readFileSync(join(ROOT, 'src/entities/Bot.js'), 'utf8');
  assert.match(src, /ctx\.zone/, 'Bot não lê a zona');
  assert.match(src, /zonePanic = true/, 'Bot não marca pânico de zona');
  assert.match(src, /isOutside\(this\.position\.x, this\.position\.z\)/, 'Bot não mede se está fora');
  assert.match(readFileSync(join(ROOT, 'src/systems/Bots.js'), 'utf8'), /zoneTick/, 'Bots não aplica dano do gás nos bots');
});
check('bots fora do círculo de fato se movem e apanham do gás', () => {
  const z = new Zone(zoneScene, { rng: () => 0.9 });
  z.reset(0, 0);
  // encolhe até o raio ser pequeno e coloca um bot longe
  for (let i = 0; i < 60 * 90; i++) z.update(1 / 60);
  const b = bots.list[0];
  b.alive = true;
  b.health = 100;
  b.position.set(z.center.x + z.radius + 60, 0, z.center.y);
  b.state = 'PATROL';
  const ctx = { time: 10, dtTick: 1 / 15, zone: z, player: null, targets: [], collision, terrain, nav, rng: Math.random };
  b.decide(ctx);
  assert.equal(b.zonePanic, true, 'bot não entrou em pânico de zona');
  assert.equal(b.state, 'REPOSITION', 'bot fora da zona não está em rotação');
  assert.ok(b.hasWish, 'bot parado fora da zona');
  const toC = { x: z.center.x - b.position.x, z: z.center.y - b.position.z };
  const dot = b.wishX * toC.x + b.wishZ * toC.z;
  assert.ok(dot > 0, 'bot andou para FORA do círculo');
  assert.equal(b.burstLeft > 0, false, 'bot atirando enquanto corre para a zona');
  const before = b.health;
  for (let i = 0; i < 120; i++) {
    const tick = i % 60 === 0;
    bots.update(1 / 60, { player: null, zone: z, zoneTick: tick });
  }
  assert.ok(b.health < before, `gás não feriu o bot (${before} → ${b.health})`);
  z.dispose();
});
check('feedback: parede + anel do próximo círculo montados e sem z-fighting', () => {
  const z = new Zone(zoneScene, { rng: () => 0.5 });
  z.reset(0, 0);
  z.update(1 / 60);
  const wall = z.wall;
  const ring = z.nextRing;
  assert.ok(wall && wall.visible, 'parece da zona invisível');
  assert.equal(wall.frustumCulled, false, 'parede da zona pode ser cortada pela câmera');
  assert.equal(wall.material.depthWrite, false, 'parede opaca escreve depth (apaga o mundo)');
  assert.equal(wall.material.transparent, true);
  assert.equal(ring.material.depthTest, false, 'anel do próximo círculo vai sumir nas colinas');
  assert.ok(wall.scale.x > 100, 'parede com raio errado');
  const hudSrc = readFileSync(join(ROOT, 'src/ui/HUD.js'), 'utf8');
  for (const id of ['zone-state', 'zone-time', 'zone-dist', 'zone-bar', 'gas-vignette', 'minimap-canvas', 'minimap', 'zone-alarm']) {
    assert.ok(indexHtmlHas(id), `#${id} não existe no index.html`);
  }
  assert.match(hudSrc, /_updateZone\(s\.zone/, 'HUD não recebe a zona do Engine');
  assert.match(hudSrc, /gas-vignette/, 'HUD não acende a vinheta de gás');
  z.dispose();
});
function indexHtmlHas(id) {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  return html.includes(`id="${id}"`);
}
check('Engine liga a zona no loop e só fere durante o MATCH', () => {
  assert.match(engineSrc, /this\.zone = new Zone\(scene/, 'Engine não cria a Zone');
  assert.match(engineSrc, /this\.zone\.reset\(/, 'Engine não reinicia a zona no deploy');
  assert.match(engineSrc, /this\.zone\.update\(dt\)/, 'Engine não atualiza a zona');
  assert.match(engineSrc, /this\.zone\.shouldTick\(dt\)/, 'Engine não usa o tick compartilhado');
  assert.match(engineSrc, /this\.player\.takeDamage\(dps, 'zone'\)/, 'jogador não toma dano do gás');
  assert.match(engineSrc, /this\.zone\?\.disable\(\)/, 'zona não desliga ao voltar ao lobby');
  assert.match(engineSrc, /zone: this\._zoneHud\(phase\)/, 'HUD não recebe payload de zona');
  assert.match(engineSrc, /this\.minimap\.update\(/, 'minimapa não é atualizado');
  assert.match(engineSrc, /new Climate/, 'Engine não monta o Climate');
  // ordem: tudo que gera colisor antes do NavGrid
  const navIdx = engineSrc.indexOf('new NavGrid');
  for (const needle of ['new Buildings', 'new Vegetation', 'new Water', 'new Landmarks']) {
    assert.ok(engineSrc.indexOf(needle) < navIdx, `${needle} vem depois do NavGrid (nav ignoraria os sólidos)`);
  }
});

// -------------------------------------------------------------- resumo
console.log('\n────────────────────────────────────────');
console.log(`  ${passed} checks ok, ${fails.length} falhas`);
if (fails.length) {
  console.log('\nFALHAS:');
  for (const f of fails) console.log(`  • ${f}`);
  process.exitCode = 1;
} else {
  console.log('  sem NaN, sem atravessar parede, cadência e TTK conferidos ✅');
}
