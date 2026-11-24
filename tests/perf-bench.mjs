/**
 * tests/perf-bench.mjs — Orçamento de CPU/draw calls (sem GPU).
 *
 * Roda a cena inteira em Node (sem WebGL) e mede o que dá para medir de forma
 * honesta fora do device: quantas draw calls teóricas a cena tem, e quanto a
 * LÓGICA de um frame custa (player + viewmodel + combat + 44 bots + sombra).
 * O teto mobile do projeto é ~8 ms de lógica p/ sobrar folga nos 16.6 ms.
 *
 * Uso: npm run bench
 */
globalThis.window = { innerWidth: 900, innerHeight: 420, devicePixelRatio: 2.5, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }) };
globalThis.document = { addEventListener() {}, removeEventListener() {}, getElementById: () => null, documentElement: { classList: { toggle() {} } }, createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} }) };
const THREE = await import('three');
const { Config } = await import('../src/core/Config.js');
const { Collision } = await import('../src/systems/Collision.js');
const { NavGrid } = await import('../src/systems/NavGrid.js');
const { Bots } = await import('../src/systems/Bots.js');
const { Combat } = await import('../src/systems/Combat.js');
const { Terrain } = await import('../src/world/Terrain.js');
const { Buildings } = await import('../src/world/Buildings.js');
const { Vegetation } = await import('../src/world/Vegetation.js');
const { Lighting } = await import('../src/world/Lighting.js');
const { Player } = await import('../src/entities/Player.js');
const { Viewmodel } = await import('../src/entities/Viewmodel.js');
const { terrainHeight } = await import('../src/utils/Noise.js');

const scene = new THREE.Scene(); const col = new Collision(); const terrain = new Terrain();
scene.add(terrain.mesh);
const lighting = new Lighting(scene);
new Buildings(scene, col, (x, z) => terrainHeight(x, z));
const v = new Vegetation(scene); v.applyTo(col);
const nav = new NavGrid(col);
const camera = new THREE.PerspectiveCamera(Config.BASE_FOV, 900 / 420, 0.1, 600);
camera.rotation.order = 'YXZ';
scene.add(camera);
const player = new Player(camera, terrain, col); player.reset(0, 60);
const vm = new Viewmodel(camera, scene);
const bots = new Bots(scene, { collision: col, terrain, nav, onKill() {}, onPlayerDamage() {} });
const combat = new Combat({ collision: col, scene, getTargets: () => bots.targetsFor() });
player.setWeapon(combat.weapon);
bots.spawn(Config.BOT_MAX, { playerPos: player.position, level: Config.BOT_LEVELS.normal });

let meshes = 0, tris = 0, inst = 0, lights = 0, visible = 0;
scene.traverse((o) => { if (o.isLight) lights++; if (!o.visible) return; if (o.isMesh || o.isInstancedMesh) { visible++; const g = o.geometry; const c = (g?.index ? g.index.count : (g?.attributes?.position?.count || 0)) || 0; tris += (o.isInstancedMesh ? c * o.count : c) / 3; if (o.isInstancedMesh) inst++; } });
scene.traverse(() => { meshes++; });
console.log(`objetos no grafo: ${meshes} | malhas visiveis (draw calls teoricas): ${visible} | tris: ${Math.round(tris).toLocaleString('pt-BR')} | instanced: ${inst} | luzes: ${lights}`);
for (const n of [0, 12, 24, 44]) {
  bots.despawn(); bots.spawn(n, { playerPos: player.position });
  for (let i = 0; i < 120; i++) bots.update(1 / 60, { player });
  const t0 = process.hrtime.bigint(); const N = 600;
  for (let i = 0; i < N; i++) {
    player.update(1 / 60, { move: { x: 0.4, y: 1 }, jump: false, sprint: false, crouch: false, aiming: false });
    vm.update(1 / 60, { speed: 4, sprinting: false, aiming: i % 3 === 0, onGround: true, lookX: 0.01, lookY: 0 });
    combat.update(1 / 60, { trigger: i % 2 === 0, aiming: false, moving: true, player, camera });
    bots.update(1 / 60, { player });
    lighting.follow(player.position.x, 0, player.position.z);
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / N;
  let vis2 = 0; scene.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && o.visible) vis2++; });
  console.log(`  bots=${String(n).padStart(2)}  logica: ${ms.toFixed(3)} ms/frame  | draw calls teoricas: ${vis2}`);
}
const t1 = process.hrtime.bigint(); const path = nav.findPath(-90, -90, 90, 90); console.log(`  A* full-map: ${path.length} nos em ${(Number(process.hrtime.bigint()-t1)/1e6).toFixed(2)} ms`);
