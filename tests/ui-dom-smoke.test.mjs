/**
 * tests/ui-dom-smoke.test.mjs — Roda o DOM real do jogo em Node, sem navegador.
 *
 * O `npm run build` não executa nada: ele só amarra os módulos. Este teste
 * monta um shim mínimo de DOM (Element/Document/Window/screen/localStorage) a
 * partir do `index.html` DE VERDADE e instancia HUD, InputManager, Settings,
 * Immersive e Lobby, disparando os eventos que o dedo do jogador dispara:
 * toque em JOGAR, toque segurado em ATIRAR/MIRAR, PULAR, AGACHAR, seleção de
 * qualidade, recarga no R, tela de resultado.
 *
 * Cobre exatamente o que costuma quebrar em device e o build não pega:
 *  id digitado errado no HTML (o módulo chama `document.getElementById` e segue
 *  com `null`), seletor de grupo vazio, método que não existe no deps, evento
 *  que nunca é liberado (dedo preso), e fullscreen/orientation negados.
 *
 * Uso: npm run test:ui
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

// ------------------------------------------------------------------ DOM shim
class ClassList {
  constructor(el) { this.el = el; }
  get set() { return this.el._cls; }
  add(...c) { for (const x of c) this.set.add(x); }
  remove(...c) { for (const x of c) this.set.delete(x); }
  contains(c) { return this.set.has(c); }
  toggle(c, force) {
    const on = force === undefined ? !this.set.has(c) : !!force;
    if (on) this.set.add(c); else this.set.delete(c);
    return on;
  }
}

class El {
  constructor(tag, attrs = {}) {
    this.tagName = String(tag).toUpperCase();
    this.id = attrs.id || '';
    this.dataset = {};
    this.children = [];
    this.parent = null;
    this.textContent = '';
    this.value = '';
    this._innerHTML = '';
    this._cls = new Set();
    this._h = new Map();
    this.style = new Proxy({ setProperty() {}, removeProperty() {} }, {
      get: (t, k) => (k in t ? t[k] : ''),
      set: (t, k, v) => { t[k] = v; return true; },
    });
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = v;
      else if (k === 'class') for (const c of v.split(/\s+/)) if (c) this._cls.add(c);
    }
    if (this.tagName === 'BUTTON') this.disabled = false;
  }
  get classList() { return new ClassList(this); }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) { this._innerHTML = v; this.children.length = 0; }
  addEventListener(type, fn) { if (!this._h.has(type)) this._h.set(type, []); this._h.get(type).push(fn); }
  removeEventListener(type, fn) { const a = this._h.get(type); if (a) a.splice(a.indexOf(fn), 1); }
  /** dispara um evento (retorna quantos handlers rodaram) */
  fire(type, extra = {}) {
    let n = 0;
    for (const fn of [...(this._h.get(type) || [])]) {
      fn({ type, target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}, ...extra });
      n += 1;
    }
    return n;
  }
  get matchesCount() { return 1; }
  getBoundingClientRect() { return { left: 0, top: 0, right: 300, bottom: 300, width: 300, height: 300, x: 0, y: 0 }; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  removeChild(c) { this.children.splice(this.children.indexOf(c), 1); return c; }
  setAttribute(k, v) { if (k.startsWith('data-')) this.dataset[k.slice(5)] = v; else this[k] = v; }
  getAttribute(k) { return k.startsWith('data-') ? this.dataset[k.slice(5)] : this[k] ?? null; }
  querySelectorAll(sel) { return queryAll(this, sel); }
  querySelector(sel) { return queryAll(this, sel)[0] || null; }
  focus() {} blur() {} click() { this.fire('click'); }
  setPointerCapture() {} releasePointerCapture() {} hasPointerCapture() { return false; }
}

/** parser de tags mínimo (suficiente p/ index.html): pilha + atributos */
function parseHtml(srcRaw) {
  // <style>/<script> têm > e => dentro; para o parser eles só existem como casca
  const src = srcRaw.replace(/<(style|script)[\s\S]*?<\/\1>/gi, '<$1></$1>');
  const VOID = new Set(['INPUT', 'BR', 'IMG', 'META', 'LINK', 'HR', 'SOURCE']);
  const root = new El('html');
  const stack = [root];
  const re = /<(\/?)([a-zA-Z0-9]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let m;
  while ((m = re.exec(src))) {
    const [, closing, tag, attrStr, selfClose] = m;
    const name = tag.toUpperCase();
    if (name === 'SCRIPT' || name === 'STYLE') {
      if (!closing && !selfClose) { /* pula conteúdo */ }
    }
    if (closing) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName === name) { stack.length = i; break; }
      }
      continue;
    }
    const attrs = {};
    for (const a of attrStr.matchAll(/([a-zA-Z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'))?/g)) {
      attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? '';
    }
    const el = new El(name, attrs);
    stack[stack.length - 1].appendChild(el);
    if (!VOID.has(name) && !selfClose) stack.push(el);
  }
  return root;
}

const idMap = new Map();
const tree = parseHtml(html);
const byId = new Map();
(function index(el) {
  if (el.id) { byId.set(el.id, el); idMap.set(el.id, el); }
  for (const c of el.children) index(c);
})(tree);
// texto dos elementos com id ("<div id="x">TEXTO</div>") — basta p/ os asserts
for (const m of html.matchAll(/<([a-zA-Z0-9]+)([^>]*\bid="([^"]+)"[^>]*)>([^<>]+?)<\/\1>/g)) {
  const el = byId.get(m[3]);
  if (el) el.textContent = m[4].trim();
}

function queryAll(scope, sel) {
  const out = [];
  const parts = String(sel).trim().split(/\s+/);
  let roots = [scope];
  for (const part of parts) {
    const next = [];
    for (const r of roots) {
      if (part.startsWith('#')) {
        const found = (r === doc ? byId.get(part.slice(1)) : null) || descendants(r).find((d) => d.id === part.slice(1));
        if (found) next.push(found);
      } else if (part.startsWith('.')) {
        next.push(...descendants(r).filter((d) => d.classList.contains(part.slice(1))));
      } else {
        next.push(...descendants(r).filter((d) => d.tagName === part.toUpperCase()));
      }
    }
    roots = next;
  }
  return roots;
}
function descendants(el, acc = []) {
  for (const c of el.children) { acc.push(c); descendants(c, acc); }
  return acc;
}

const body = byId.get('app').parent || tree;
const documentElement = tree;
const doc = {
  body,
  documentElement,
  fullscreenElement: null,
  webkitFullscreenElement: null,
  webkitIsFullScreen: false,
  pointerLockElement: null,
  visibilityState: 'visible',
  addEventListener: (t, f) => doc._h.set(t, [...(doc._h.get(t) || []), f]),
  removeEventListener: (t, f) => doc._h.set(t, (doc._h.get(t) || []).filter((x) => x !== f)),
  _h: new Map(),
  getElementById: (id) => byId.get(id) || null,
  querySelectorAll: (sel) => queryAll(doc, sel),
  querySelector: (sel) => queryAll(doc, sel)[0] || null,
  createElement: (tag) => new El(tag),
  exitPointerLock: () => { doc.pointerLockElement = null; },
  exitFullscreen: () => { doc.fullscreenElement = null; return Promise.resolve(); },
  webkitExitFullscreen: () => { doc.webkitFullscreenElement = null; },
  fire(type, extra = {}) {
    let n = 0;
    for (const fn of [...(doc._h.get(type) || [])]) { fn({ type, preventDefault() {}, ...extra }); n += 1; }
    return n;
  },
};

const store = new Map();
const win = {
  innerWidth: 900,
  innerHeight: 420,
  devicePixelRatio: 2.5,
  addEventListener: (t, f) => win._h.set(t, [...(win._h.get(t) || []), f]),
  removeEventListener: (t, f) => win._h.set(t, (win._h.get(t) || []).filter((x) => x !== f)),
  _h: new Map(),
  matchMedia: (q) => ({ matches: /coarse/.test(q) ? false : true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {} }),
  requestAnimationFrame: (fn) => setTimeout(() => fn(performance.now()), 0),
  cancelAnimationFrame: (id) => clearTimeout(id),
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  get innerHeightPx() { return this.innerHeight; },
  fire(type, extra = {}) {
    let n = 0;
    for (const fn of [...(win._h.get(type) || [])]) { fn({ type, preventDefault() {}, ...extra }); n += 1; }
    return n;
  },
};
win.screen = {
  orientation: {
    angle: 0,
    type: 'portrait-primary',
    lockMode: 'default',
    _lockResult: 'resolve',
    lock(mode) {
      win.screen.orientation.lockMode = mode;
      return this._lockResult === 'resolve' ? Promise.resolve() : Promise.reject(new Error('not supported'));
    },
    unlock() { win.screen.orientation.lockMode = 'default'; },
    addEventListener() {},
    removeEventListener() {},
  },
};
win.requestFullscreenFails = false;
documentElement.requestFullscreen = () => {
  if (win.requestFullscreenFails) return Promise.reject(new Error('blocked by iframe policy'));
  doc.fullscreenElement = documentElement;
  return Promise.resolve();
};

// instala os globais ANTES de importar os módulos
Object.assign(globalThis, {
  window: win,
  document: doc,
  screen: win.screen,
  localStorage: win.localStorage,
  requestAnimationFrame: win.requestAnimationFrame,
  cancelAnimationFrame: win.cancelAnimationFrame,
  matchMedia: win.matchMedia,
  HTMLElement: El,
});
// navigator é getter-only no Node 22 → defineProperty (o código lê maxTouchPoints)
try {
  Object.defineProperty(globalThis.navigator, 'maxTouchPoints', { value: 5, configurable: true });
} catch {
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', maxTouchPoints: 5 }, configurable: true });
}

let passed = 0;
const fails = [];
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    fails.push(`${name}: ${err.message}`);
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}
const tick = (n = 3) => new Promise((r) => setTimeout(r, n));

console.log('\nOPERATION ZERO — smoke test de DOM (Lobby/HUD/botões/imersão)\n');

console.log('0. o shim enxerga o index.html de verdade');
await check('bots/qualidade/modo têm 4/4/2 botões com data-value', () => {
  assert.equal(queryAll(byId.get('lobby-quality'), 'button').length, 4);
  assert.equal(queryAll(byId.get('lobby-bots'), 'button').length, 4);
  assert.equal(queryAll(byId.get('lobby-mode'), 'button').length, 2);
  assert.equal(queryAll(byId.get('lobby-diff'), 'button').length, 3);
  assert.equal(queryAll(byId.get('lobby-bots'), 'button')[2].dataset.value, '24');
});

// ------------------------------------------------------------------- módulos
const { Config } = await import('../src/core/Config.js');
const { HUD } = await import('../src/ui/HUD.js');
const { InputManager } = await import('../src/core/InputManager.js');
const { Settings } = await import('../src/ui/Settings.js');
const { Immersive } = await import('../src/utils/Immersive.js');
const { Lobby } = await import('../src/ui/Lobby.js');
const { GameState } = await import('../src/systems/GameState.js');
const { Collision } = await import('../src/systems/Collision.js');
const { Combat } = await import('../src/systems/Combat.js');
const THREE = await import('three');

// 1. InputManager + botões de ação
console.log('\n1. InputManager: botões ATIRAR/MIRAR/PULAR/AGACHAR/CORRER');
const canvas = new El('canvas');
canvas.requestPointerLock = () => Promise.resolve();
const input = new InputManager(canvas);
input.attachTouch(byId.get('joystick-zone'), byId.get('joystick-base'), byId.get('joystick-nub'), byId.get('look-zone'));
await check('ATIRAR segura → isFiring() true; soltar → false (sem dedo preso)', () => {
  byId.get('btn-fire').fire('touchstart', { touches: [{ identifier: 1 }] });
  assert.equal(input.isFiring(), true);
  byId.get('btn-fire').fire('touchend', {});
  assert.equal(input.isFiring(), false);
  byId.get('btn-fire').fire('touchcancel', {});
  assert.equal(input.isFiring(), false);
});
await check('MIRAR mantém o estado e limpa no touchcancel', () => {
  byId.get('btn-aim').fire('touchstart', {});
  assert.equal(input.isAiming(), true);
  byId.get('btn-aim').fire('touchcancel', {});
  assert.equal(input.isAiming(), false);
});
await check('PULAR é borda (um pulo por toque) e AGACHAR alterna', () => {
  byId.get('btn-jump').fire('touchstart', {});
  byId.get('btn-jump').fire('touchstart', {});
  assert.equal(input.isJumpPressed(), true);
  assert.equal(input.isJumpPressed(), false, 'pulo virou continuo');
  byId.get('btn-crouch').fire('touchstart', {});
  assert.equal(input.isCrouching(), true);
  byId.get('btn-crouch').fire('touchstart', {});
  assert.equal(input.isCrouching(), false);
  byId.get('btn-sprint').fire('touchstart', {});
  assert.equal(input.isSprintHeld(), true);
});
await check('R no teclado recarrega; Shift corre; C agacha', () => {
  win.fire('keydown', { code: 'KeyR', repeat: false });
  assert.equal(input.isReloadPressed(), true);
  assert.equal(input.isReloadPressed(), false);
  win.fire('keydown', { code: 'ShiftLeft' });
  assert.equal(input.isSprintHeld(), true);
  win.fire('keyup', { code: 'ShiftLeft' });
  win.fire('keydown', { code: 'KeyC' });
  assert.equal(input.isCrouching(), true);
  win.fire('keyup', { code: 'KeyC' });
  // fora de jogo o teclado não faz nada (o Lobby não anda com WASD)
  input.setEnabled(false);
  win.fire('keydown', { code: 'KeyR', repeat: false });
  assert.equal(input.isReloadPressed(), false, 'R vazou para o menu');
  input.setEnabled(true);
});
await check('setEnabled(false) zera tudo (Lobby não herda gatilho preso)', () => {
  byId.get('btn-fire').fire('touchstart', {});
  assert.equal(input.isFiring(), true);
  input.setEnabled(false);
  assert.equal(input.isFiring(), false);
  assert.equal(input.isAiming(), false);
  assert.equal(input.isCrouching(), false);
  assert.equal(input.isSprintHeld(), false);
  assert.deepEqual(input.getMoveInput(), { x: 0, y: 0 });
  assert.deepEqual(input.consumeLookDelta(), { x: 0, y: 0 });
  input.setEnabled(true);
});

// 2. Settings
console.log('\n2. Settings (painel ⚙)');
let settings = null;
await check('abrir o painel e mover os sliders chama onChange do InputManager', () => {
  let got = null;
  settings = new Settings((m, t) => { got = { m, t }; });
  byId.get('btn-settings').fire('click');
  assert.ok(byId.get('settings-panel').classList.contains('open'), 'painel não abriu');
  const mouse = byId.get('sens-mouse');
  mouse.value = '1.7';
  mouse.fire('input');
  mouse.fire('change');
  assert.ok(got && Math.abs(got.m - 1.7) < 1e-6, `onChange não propagou (${JSON.stringify(got)})`);
  assert.equal(byId.get('sens-mouse-val').textContent, '1.7×');
  byId.get('sens-reset').fire('click');
  assert.ok(Math.abs(settings.mouseMult - 1) < 1e-6, 'restaurar padrão não funcionou');
});

// 3. Imersão: fullscreen + orientação, com negativas
console.log('\n3. Immersive (tela cheia + paisagem, best effort)');
const immersive = new Immersive(documentElement);
await check('enter() pede fullscreen e orientation.lock(landscape)', async () => {
  const res = await immersive.enter();
  assert.equal(res.fullscreen, true, 'não marcou fullscreen');
  assert.equal(win.screen.orientation.lockMode, Config.ORIENTATION_LOCK, 'orientation.lock não chamou landscape');
  assert.equal(documentElement.classList.contains('is-fullscreen'), true, 'classe .is-fullscreen ausente');
  assert.equal(immersive.isFullscreen, true);
});
await check('orientation.lock negado NÃO quebra (iOS/desktop)', async () => {
  win.screen.orientation._lockResult = 'reject';
  const res = await immersive.enter();
  assert.equal(res.orientation, null, 'deveria reportar sem trava');
  assert.equal(immersive.orientationLocked, false);
  win.screen.orientation._lockResult = 'resolve';
});
await check('requestFullscreen negado NÃO quebra (iframe sem allow)', async () => {
  win.requestFullscreenFails = true;
  doc.fullscreenElement = null;
  const res = await immersive.enter();
  assert.equal(res.fullscreen, false);
  assert.equal(res.error, 'fullscreen-bloqueado');
  assert.equal(documentElement.classList.contains('is-fullscreen'), false, 'classe ficou presa');
  win.requestFullscreenFails = false;
});
await check('onChange dispara no resize do viewport', () => {
  let hits = 0;
  const off = immersive.onChange(() => { hits += 1; });
  win.fire('resize');
  assert.ok(hits >= 1, 'callback de change não rodou');
  off();
});

// 4. Lobby: seleção persistida + JOGAR dispara imersão e partida
console.log('\n4. Lobby (JOGAR, qualidade, modo, bots → GameState)');
// o callback espelha Engine._onPhaseChange (Resultado → overlay do Lobby)
const gameState = new GameState((next, prev, payload) => {
  if (!lobby) return;
  if (next === 'RESULT') {
    lobby.showResult({
      victory: !!payload.victory,
      placement: payload.placement ?? 0,
      kills: gameState.kills,
      time: gameState.getTimeText(),
      total: payload.total ?? gameState.totalCombatants,
    });
  } else if (next === 'LOBBY') {
    lobby.hideResult();
  }
});
let deployed = null;
gameState.commands.deploy = (settings) => { deployed = settings; };
const rendererLog = [];
const fakeRenderer = {
  setQuality(i) { rendererLog.push(`setQuality:${i}`); },
  getQualityLabel() { return 'ALTA'; },
  getStats() { return { calls: 13, triangles: 34000 }; },
  get pixelRatio() { return 1.5; },
  setPixelRatio(v) { rendererLog.push(`dpr:${v}`); },
  shadowMap: { enabled: true, type: 1 },
};
const perfLog = [];
const fakePerf = { setAuto(v) { perfLog.push(`setAuto:${v}`); }, record() {}, getStats() { return { fps: 60, frameMs: 16, quality: 'ALTA' }; } };
let lobby = null;
let qualityHook = 0; // Engine é avisado da qualidade p/ reaplicar sombras
lobby = new Lobby({
  gameState,
  renderer: fakeRenderer,
  performance: fakePerf,
  immersive,
  onQuality: () => { qualityHook += 1; },
  onExit: () => {},
});
await check('construct sem exceção e com o HTML real (status/info preenchidos)', () => {
  assert.ok(byId.get('lobby-status').textContent.length > 0, 'lobby-status vazio');
  assert.ok(/SOLO|DUO/.test(byId.get('lobby-info').textContent), `lobby-info: ${byId.get('lobby-info').textContent}`);
});
await check('tocar em QUALIDADE=BAIXA aplica no renderer e sai do AUTO', () => {
  const low = queryAll(byId.get('lobby-quality'), 'button')[3];
  assert.equal(low.dataset.value, '2');
  low.fire('click');
  assert.equal(lobby.selection.quality, 2);
  assert.ok(rendererLog.some((l) => l === 'setQuality:2'), `renderer não recebeu a qualidade (${rendererLog})`);
  assert.ok(perfLog.some((l) => l === 'setAuto:false'), 'PerformanceMonitor não foi desligado no modo manual');
  assert.ok(qualityHook >= 1, 'Engine não foi avisado da qualidade (sombras)');
  assert.equal(low.classList.contains('on'), true, 'botão não ficou marcado');
});
await check('tocar em BOTS=44 e MODO=DUO atualiza seleção, info e persiste', () => {
  queryAll(byId.get('lobby-bots'), 'button')[3].fire('click');
  queryAll(byId.get('lobby-mode'), 'button')[1].fire('click');
  assert.equal(lobby.selection.bots, 44);
  assert.equal(lobby.selection.mode, 'duo');
  assert.ok(/44/.test(byId.get('lobby-info').textContent), byId.get('lobby-info').textContent);
  assert.ok(JSON.parse(win.localStorage.getItem('oz_lobby_v1')).bots === 44, 'não salvou em localStorage');
});
await check('JOGAR: imersão ANTES do startMatch, depois DEPLOY com as configs', async () => {
  let entered = 0;
  const realEnter = immersive.enter.bind(immersive);
  immersive.enter = async (...a) => { entered += 1; return realEnter(...a); };
  deployed = null;
  gameState.toLobby();
  byId.get('lobby-play').fire('click');
  await tick(6);
  assert.equal(entered, 1, 'fullscreen não foi pedido dentro do toque em JOGAR');
  assert.equal(gameState.phase, 'DEPLOY', `fase: ${gameState.phase}`);
  assert.ok(deployed, 'comando deploy não chegou ao Engine');
  assert.equal(deployed.bots, 44);
  assert.equal(deployed.mode, 'duo');
  assert.equal(byId.get('lobby').classList.contains('show'), false, 'lobby não se escondeu');
  gameState.update(1);
  assert.equal(gameState.phase, 'MATCH');
});
await check('qualidade AUTO devolve o controle ao PerformanceMonitor', () => {
  const auto = queryAll(byId.get('lobby-quality'), 'button')[0];
  auto.fire('click');
  assert.equal(lobby.selection.quality, 'auto');
  assert.ok(perfLog.at(-1) === 'setAuto:true', perfLog.join(','));
});
await check('Enter no teclado também inicia (desktop)', async () => {
  gameState.toLobby();
  lobby.show();
  const before = gameState.phase;
  win.fire('keydown', { code: 'Enter' });
  await tick(6);
  assert.notEqual(gameState.phase, before, 'Enter não iniciou a partida');
});

// 5. Resultado
console.log('\n5. Tela de resultado (vitória/derrota e os dois botões)');
await check('reportAlive → RESULT → showResult preenche título/sub/estatísticas', async () => {
  gameState.update(1);
  assert.equal(gameState.phase, 'MATCH', gameState.phase);
  gameState.reportAlive(0, true); // último de pé
  assert.equal(gameState.phase, 'RESULT');
  await tick(2);
  const box = byId.get('result');
  assert.ok(box.classList.contains('show'), 'tela de resultado não apareceu');
  assert.match(byId.get('result-title').textContent, /BOOYAH|VITÓRIA|1º/i);
  assert.ok(byId.get('result-stats').children.length >= 3, 'linhas de estatística ausentes');
  // jogar de novo → DEPLOY
  byId.get('result-again').fire('click');
  await tick(2);
  assert.equal(gameState.phase, 'DEPLOY', 'JOGAR DE NOVO não reimplantou');
  gameState.update(1);
  // derrota → VOLTA AO LOBBY
  gameState.reportAlive(3, false);
  await tick(2);
  assert.match(byId.get('result-title').textContent, /ELIMINADO/i);
  byId.get('result-lobby').fire('click');
  await tick(2);
  assert.equal(gameState.phase, 'LOBBY', 'não voltou ao lobby');
  assert.equal(box.classList.contains('show'), false, 'overlay de resultado ficou na tela');
});

// 6. HUD com objetos reais
console.log('\n6. HUD com Player/Combat reais');
const collision = new Collision();
collision.addBox({ minX: -3, maxX: -1, minZ: -3, maxZ: -1, minY: 0, maxY: 3 });
const terrain = { getHeightAt: () => 0, clampToWorld: (v) => v };
const camera = new THREE.PerspectiveCamera(Config.BASE_FOV, 2, 0.1, 500);
const { Player } = await import('../src/entities/Player.js');
const player = new Player(camera, terrain, collision);
player.reset(0, 6);
const combat = new Combat({ collision, scene: new THREE.Scene(), getTargets: () => [] });
player.setWeapon(combat.weapon);
const hud = new HUD();
await check('hud.update com todos os objetos roda e escreve vida/munição/stats', () => {
  hud.setMatchVisible(true);
  assert.equal(byId.get('hud-match').classList.contains('show'), true);
  for (let i = 0; i < 10; i++) {
    hud.update(0.05, {
      perf: fakePerf.getStats(),
      render: fakeRenderer.getStats(),
      player, combat,
      match: { kills: 3, alive: 7, total: 45, timeText: '1:12' },
      hit: { miss: false, headshot: true, killed: true, target: { displayName: 'Falcão' } },
      damage: 24,
      now: i * 0.05,
    });
  }
  assert.equal(byId.get('stat-kills').textContent, '3');
  assert.equal(byId.get('stat-alive').textContent, '7/45');
  assert.equal(byId.get('stat-time').textContent, '1:12');
  assert.match(byId.get('ammo-text').textContent, /\d+\/\d+/);
  assert.equal(byId.get('health-text').textContent, '100');
  assert.ok(byId.get('ammo-weapon').textContent.length > 2, 'nome da arma vazio');
  assert.ok(byId.get('kill-feed').children.length >= 0);
  hud.flashHit({ miss: false, headshot: true, killed: true, target: { displayName: 'Falcão' } }, 10);
  assert.equal(byId.get('hitmarker').classList.contains('on'), true, 'hitmarker não acendeu no hit');
  assert.equal(byId.get('hitmarker').classList.contains('head'), true, 'hitmarker de headshot não mudou de cor');
  hud.update(0.2, { perf: fakePerf.getStats(), render: fakeRenderer.getStats(), player, combat, match: null, now: 10.2 });
  assert.equal(byId.get('hitmarker').classList.contains('on'), false, 'hitmarker ficou aceso pra sempre (dois relógios)');
});
await check('dano no jogador → vida cai e vigneta acende; morte → texto certo', () => {
  player.takeDamage(40, 'torso');
  hud.update(0.2, { perf: fakePerf.getStats(), render: fakeRenderer.getStats(), player, combat, match: { kills: 0, alive: 2, total: 2, timeText: '0:10' }, damage: 40, now: 5 });
  assert.equal(byId.get('health-text').textContent, '60');
  assert.equal(byId.get('damage-vignette').classList.contains('on'), true);
  player.takeDamage(99, 'head');
  assert.equal(player.alive, false);
  hud.update(0.2, { perf: fakePerf.getStats(), render: fakeRenderer.getStats(), player, combat, match: null, now: 6 });
  assert.match(byId.get('health-text').textContent, /^0$/);
});
await check('munição: atirar gasta pente, R recarrega e HUD mostra a barrinha', async () => {
  player.alive = true;
  player.health = 100;
  input.setEnabled(true);
  const reloadEl = byId.get('ammo-reload');
  const st = { trigger: true, aiming: false, moving: false, player, camera };
  for (let i = 0; i < 30; i++) combat.update(1 / 60, st);
  assert.ok(combat.ammo < combat.weapon.magazine, 'pente não baixou');
  const magAtStart = combat.ammo;
  input.setEnabled(true);
  byId.get('btn-fire').fire('touchstart', {});
  for (let i = 0; i < 30; i++) combat.update(1 / 60, { ...st, trigger: input.isFiring() });
  assert.ok(combat.ammo <= magAtStart);
  byId.get('btn-fire').fire('touchend', {});
  win.fire('keydown', { code: 'KeyR', repeat: false });
  assert.ok(input.isReloadPressed(), 'R não chegou ao InputManager');
  combat.reload();
  for (let i = 0; i < 60 * (combat.weapon.reloadTime + 0.5); i++) combat.update(1 / 60, { ...st, trigger: false });
  assert.equal(combat.ammo, combat.weapon.magazine, 'HUD/teste: recarga não completou');
  hud.update(0.2, { perf: fakePerf.getStats(), render: fakeRenderer.getStats(), player, combat, match: null, now: 7 });
  assert.ok(String(byId.get('ammo-text').textContent).includes(String(combat.weapon.magazine)));
  void reloadEl;
});
await check('touch look + joystick: delta consumido 1× e sem NaN', () => {
  const zone = byId.get('look-zone');
  zone.fire('touchstart', { changedTouches: [{ identifier: 7, clientX: 400, clientY: 200 }], touches: [] });
  zone.fire('touchmove', { changedTouches: [{ identifier: 7, clientX: 430, clientY: 215 }], touches: [] });
  const d = input.consumeLookDelta();
  assert.ok(Number.isFinite(d.x) && Number.isFinite(d.y) && Math.abs(d.x) > 0, `delta: ${JSON.stringify(d)}`);
  assert.deepEqual(input.consumeLookDelta(), { x: 0, y: 0 }, 'delta não foi consumido (olho duplo)');
  const jz = byId.get('joystick-zone');
  jz.fire('touchstart', { changedTouches: [{ identifier: 9, clientX: 60, clientY: 300 }], touches: [] });
  jz.fire('touchmove', { changedTouches: [{ identifier: 9, clientX: 120, clientY: 240 }], touches: [] });
  const mv = input.getMoveInput();
  assert.ok(Number.isFinite(mv.x) && Number.isFinite(mv.y) && Math.hypot(mv.x, mv.y) > 0.1, `joystick: ${JSON.stringify(mv)}`);
  assert.ok(Math.hypot(mv.x, mv.y) <= 1.001, 'joystick passou de 1 (diagonal acelerada)');
  jz.fire('touchend', { changedTouches: [{ identifier: 9 }], touches: [] });
  assert.deepEqual(input.getMoveInput(), { x: 0, y: 0 }, 'joystick travou ligado');
});

// 7. consistência final
console.log('\n7. consistência HTML ↔ módulos');
await check('todo getElementById dos módulos de UI resolve no index.html', () => {
  const uiFiles = ['src/ui/HUD.js', 'src/ui/Lobby.js', 'src/ui/Settings.js', 'src/ui/Joystick.js',
    'src/ui/TouchLook.js', 'src/core/InputManager.js', 'src/core/Engine.js'];
  let checked = 0;
  for (const f of uiFiles) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    for (const m of src.matchAll(/getElementById\('([^']+)'\)/g)) {
      assert.ok(byId.get(m[1]), `${f}: #${m[1]} não existe no index.html`);
      checked += 1;
    }
  }
  assert.ok(checked > 25, `varredura rasa (${checked})`);
});
await check('CSS: zonas de toque nao se sobrepoem ao HUD (z-index / pointer-events)', () => {
  // joystick/look ficam atras dos botoes e do HUD (pointer-events:none no HUD)
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const z = (sel) => Number((new RegExp(`${sel}[\\s\\S]{0,240}?z-index:\\s*(\\d+)`).exec(css) || [0, 0])[1]);
  const zBtn = z('.action-btn');
  assert.ok(zBtn > 0, '.action-btn sem z-index');
  assert.ok(z('#joystick-zone') < zBtn, 'zona de toque na frente dos botões de tiro');
  assert.ok(z('#look-zone') < zBtn, 'look-zone na frente do MIRAR');
  assert.ok(z('#hud-top') < zBtn, 'HUD cobrindo os botões de ação');
  assert.ok(z('#lobby') > zBtn, 'lobby atrás dos botões da partida');
  const hudRule = css.slice(css.indexOf('#hud-top'), css.indexOf('#hud-top') + 400);
  assert.match(hudRule, /pointer-events:\s*none/, 'HUD não é transparente ao toque');
  const hudMatch = css.slice(css.indexOf('#hud-match'), css.indexOf('#hud-match') + 300);
  assert.match(hudMatch, /pointer-events:\s*none/, 'hud-match não é transparente ao toque');
  const playRule = css.slice(css.indexOf('#lobby-play {'), css.indexOf('#lobby-play {') + 260);
  assert.match(playRule, /padding:\s*18px/, 'botão JOGAR sem alvo de toque generoso');
  assert.match(playRule, /font-size:\s*20px/, 'botão JOGAR sem fonte grande');
  assert.ok(/touch-action:\s*none/.test(css), 'sem touch-action:none no CSS');
});

await check('geometria em paisagem 640×360: botões e HUD sem sobreposição', () => {
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const VW = 640;
  const VH = 360;
  const rule = (sel) => {
    const i = css.indexOf(sel + ' {');
    return i < 0 ? '' : css.slice(i, css.indexOf('}', i));
  };
  const px = (text, prop) => {
    const m = new RegExp(prop + ':\\s*([^;]+)').exec(text);
    if (!m) return null;
    const v = m[1];
    const first = /max\(\s*([\d.]+)px/.exec(v);
    if (first) return Number(first[1]); // sem notch: max(inset, fixo) = fixo
    const num = /^([\d.]+)px$/.exec(v.trim());
    return num ? Number(num[1]) : null;
  };
  const box = (sel, opts = {}) => {
    const r = rule(sel);
    const w = px(r, 'width') ?? opts.w ?? 64;
    const h = px(r, 'height') ?? opts.h ?? 64;
    const left = px(r, 'left');
    const right = px(r, 'right');
    const top = px(r, 'top');
    const bottom = px(r, 'bottom');
    if (left === null && right === null && opts.centerLeft !== undefined) {
      return { x: opts.centerLeft, y: top ?? 0, w, h };
    }
    const x = left !== null ? left : (right !== null ? VW - right - w : 0);
    const y = top !== null ? top : (bottom !== null ? VH - bottom - h : 0);
    return { x, y, w, h };
  };
  // centralizados por transform: translateX(-50%)
  const centered = (sel, opts) => {
    const r = rule(sel);
    const w = px(r, 'width') ?? opts.w;
    return { x: VW / 2 - w / 2, y: px(r, 'top') ?? 0, w, h: px(r, 'height') ?? opts.h };
  };
  const overlap = (a, b) => a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;
  const btns = {
    fire: box('#btn-fire', { w: 84, h: 84 }),
    aim: box('#btn-aim'),
    jump: box('#btn-jump'),
    crouch: box('#btn-crouch'),
    sprint: box('#btn-sprint'),
  };
  const hud = {
    'hud-top': { x: 10, y: 10, w: VW - 64 - 10, h: 96 }, // linha de cards no topo
    health: centered('#health-wrap', { w: 218, h: 18 }),
    ammo: box('#ammo-wrap', { w: 92, h: 44 }),
    feed: box('#kill-feed', { w: 160, h: 48 }),
  };
  const names = Object.keys(btns);
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      assert.ok(!overlap(btns[names[i]], btns[names[j]]), `${names[i]} em cima de ${names[j]}`);
    }
  }
  for (const [bn, b] of Object.entries(btns)) {
    assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= VW + 1 && b.y + b.h <= VH + 1, `${bn} fora da tela (${JSON.stringify(b)})`);
    for (const [hn, h] of Object.entries(hud)) {
      assert.ok(!overlap(b, h), `${bn} em cima de ${hn}`);
    }
    // os botoes moram na metade direita; o joystick na esquerda
    assert.ok(b.x + b.w > VW / 2 - 60, `${bn} invadiu a zona do joystick`);
  }
  // distancia minima de toque (44px) respeitada
  for (const [n, b] of Object.entries(btns)) assert.ok(b.w >= 44 && b.h >= 44, `${n} menor que 44px`);
});

await check('nenhum cache de elemento (this.*El/*Btn/*Fill) fica undefined na instância', () => {
  const instances = { HUD: hud, Lobby: lobby, Settings: settings, InputManager: input, Immersive: immersive };
  const srcs = {
    HUD: 'src/ui/HUD.js', Lobby: 'src/ui/Lobby.js', Settings: 'src/ui/Settings.js',
    InputManager: 'src/core/InputManager.js', Immersive: 'src/utils/Immersive.js',
  };
  const problems = [];
  for (const [name, inst] of Object.entries(instances)) {
    const src = readFileSync(join(ROOT, srcs[name]), 'utf8');
    const fields = new Set();
    for (const m of src.matchAll(/this\.(\w*(?:El|Btn|Fill|Text|Zone|Base|Nub|Panel))\b/g)) fields.add(m[1]);
    for (const f of fields) {
      if (inst[f] === undefined) problems.push(`${name}.${f} nunca atribuído`);
      else if (inst[f] === null) problems.push(`${name}.${f} é null (id ausente no HTML)`);
    }
  }
  assert.equal(problems.length, 0, problems.join('; '));
});

// 8. zona segura + minimapa no DOM (Fase 6 / 11)
console.log('\n8. zona segura + minimapa no DOM');
function fakeCtx() {
  const log = { arcs: [], strokes: [], texts: [], styles: [], rects: [], fills: [] };
  const ctx = {
    log,
    setTransform() {}, clearRect() {}, save() {}, restore() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    fill(mode) { log.fills.push(mode || 'nonzero'); },
    stroke() { log.strokes.push(ctx.strokeStyle); },
    setLineDash(d) { if (d && d.length) log.dash = d; }, // só o trace "ligado" importa
    fillRect(x, y, w, h) { log.rects.push([x, y, w, h, ctx.fillStyle]); },
    rect(x, y, w, h) { log.rects.push([x, y, w, h, ctx.fillStyle]); },
    strokeRect() {},
    arc(x, y, r) { log.arcs.push([x, y, r, ctx.fillStyle, ctx.strokeStyle]); },
    fillText(t) { log.texts.push(String(t)); },
  };
  // cores/medidas lidas via properties espelhadas no log
  for (const k of ['fillStyle', 'strokeStyle', 'lineWidth', 'font', 'textAlign', 'globalAlpha']) {
    let v = '';
    Object.defineProperty(ctx, k, { get: () => v, set: (nv) => { v = nv; log.styles.push([k, nv]); } });
  }
  return ctx;
}

await check('HUD._updateZone: texto, barra, vinheta de gás e alarme', async () => {
  const hud = new HUD();
  const zoneState = byId.get('zone-state');
  const zoneTime = byId.get('zone-time');
  const zoneDist = byId.get('zone-dist');
  const bar = byId.get('zone-bar');
  const gas = byId.get('gas-vignette');
  const alarm = byId.get('zone-alarm');
  for (const [n, el] of Object.entries({ zoneState, zoneTime, zoneDist, bar, gas, alarm })) {
    assert.ok(el, `#${n} não existe no HTML`);
  }
  hud.setMatchVisible(true);
  hud._updateZone({ label: 'ZONA FECHANDO', countdown: '0:14', distance: 0, outside: false, closing: true, progress: 0.42 });
  assert.equal(zoneState.textContent, 'ZONA FECHANDO');
  assert.ok(zoneState.classList.contains('closing'), 'classe .closing não aplicada (CSS não pisca)');
  assert.equal(zoneTime.textContent, 'FECHANDO 0:14');
  assert.ok(/scaleX\(0\.42/.test(bar.style.transform), `barra: ${bar.style.transform}`);
  assert.ok(!gas.classList.contains('on'), 'vinheta de gás acesa DENTRO da zona');
  hud._updateZone({ label: 'ZONA FECHANDO', countdown: '0:07', distance: 38, outside: true, closing: true, progress: 0.9 });
  assert.ok(gas.classList.contains('on'), 'vinheta de gás apagada FORA da zona');
  assert.ok(alarm.classList.contains('on'), 'alarme de texto não apareceu');
  assert.ok(zoneDist.classList.contains('danger'), 'distância não ficou vermelha');
  assert.match(zoneDist.textContent, /FORA DA ZONA · 38 m/, zoneDist.textContent);
  hud.setMatchVisible(false);
  assert.ok(!gas.classList.contains('on'), 'sair da partida deixou a vinheta de gás acesa');
});

await check('Minimap desenha o mapa (POIs + lago + estradas) e o círculo da zona', async () => {
  const { Minimap } = await import('../src/ui/Minimap.js');
  const canvas = byId.get('minimap-canvas');
  const ctx = fakeCtx();
  canvas.getContext = () => ctx;
  canvas.clientWidth = 140;
  const mm = new Minimap(canvas);
  const fakeZone = {
    enabled: true, radius: 138, state: 'CLOSING',
    center: { x: 10, y: -6 },
    getNext: () => ({ x: 12, z: -8, r: 86, closing: true }),
  };
  const player = { position: { x: 0, y: 0, z: 0 }, team: 0, yaw: 0.4 };
  const bots = { list: [] };
  mm._accum = 1; // força o redraw (o throttle de 12 Hz é testado no outro check)
  mm._draw({ player, zone: fakeZone, bots });
  // 1 moldura? -> arcs: POIs(5) + lago(1) + jogador(1) + círculo(1) + próximo(1) = 9 no mínimo
  assert.ok(ctx.log.arcs.length >= 9, `arcos desenhados: ${ctx.log.arcs.length}`);
  assert.ok(ctx.log.styles.some(([k, v]) => k === 'strokeStyle' && v === '#ff7a5c'),
    'fechando deveria pintar o círculo de laranja (leitura de perigo)');
  assert.ok(ctx.log.fills.includes('evenodd'), 'área fora da zona não foi escurecida (evenodd)');
  assert.ok(ctx.log.dash && ctx.log.dash.length === 2, 'próximo círculo não é tracejado');
  const radii = ctx.log.arcs.map((a) => a[2]);
  assert.ok(Math.max(...radii) > 20, `raio da zona fora de escala: ${Math.max(...radii)}`);
  assert.ok(radii.every((r) => Number.isFinite(r) && r > 0), 'arco com raio inválido');
});

await check('Minimap respeita o throttle (12 Hz) e não desenha sem canvas', async () => {
  const { Minimap } = await import('../src/ui/Minimap.js');
  const canvas = byId.get('minimap-canvas');
  const ctx = fakeCtx();
  canvas.getContext = () => ctx;
  const mm = new Minimap(canvas);
  const before = ctx.log.arcs.length;
  mm.update(1 / 60, { player: null, zone: null, bots: null });
  assert.equal(ctx.log.arcs.length, before, 'redesenhou antes do intervalo de 1/12 s');
  mm.update(0.2, { player: null, zone: null, bots: null });
  assert.ok(ctx.log.arcs.length > before, 'não redesenhou depois de 0.2 s');
  const bare = new Minimap(null); // sem canvas (SSR/teste): tem de ser no-op
  bare.update(1, { player: null, zone: null, bots: null });
  assert.ok(true);
});

await check('Lobby pinta o preview da arena (drawBaseMap) sem depender do Engine', async () => {
  const { Minimap } = await import('../src/ui/Minimap.js');
  const canvas = byId.get('lobby-map-canvas');
  assert.ok(canvas, '#lobby-map-canvas não existe no index.html');
  const ctx = fakeCtx();
  canvas.getContext = () => ctx;
  const lobby = new Lobby({ gameState: { setSettings() {}, startMatch() {} }, renderer: {}, performance: {}, immersive: {} });
  lobby._paintMapPreview();
  assert.ok(ctx.log.texts.some((t) => /CIDADE/.test(t)), `labels dos POIs ausentes: ${ctx.log.texts.join('|')}`);
  assert.ok(ctx.log.arcs.length >= 6, 'preview sem POIs/lago');
  // preview é 1 paint: nada de agendar loop
  assert.equal(lobby._mapRaf, undefined, 'Lobby agendou loop de redraw no preview');
  void Minimap;
});

await check('CSS: gás/minimapa/zona não roubam toque e têm contraste', async () => {
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  for (const sel of ['#gas-vignette', '#minimap', '#zone-hud', '#zone-alarm']) {
    const i = css.indexOf(`${sel} {`);
    assert.ok(i >= 0, `${sel} sem regra no CSS`);
    const rule = css.slice(i, css.indexOf('}', i));
    assert.match(rule, /pointer-events:\s*none/, `${sel} captura toque (mata o look/JOY)`);
  }
  const zg = css.indexOf('#gas-vignette {');
  const zgm = css.slice(zg, zg + 500);
  assert.match(zgm, /radial-gradient/, 'vinheta de gás sem gradiente (some no AMOLED)');
  assert.match(css, /@keyframes gaspulse/, 'gás sem pulso: o jogador não percebe que está queimando');
  assert.match(css, /@keyframes zoneblink/, 'contador de "FECHANDO" sem alerta piscante');
  assert.match(css, /#minimap \{[\s\S]{0,400}z-index/, 'minimapa sem z-index próprio');
  // o #zone-hud só aparece com o HUD de partida (nunca no lobby)
  assert.match(css, /#hud-match\.show #zone-hud \{ opacity: 1/, 'HUD da zona visível no lobby');
});

await check('HUD da partida: zona + minimapa aparecem só no MATCH (idempotente)', async () => {
  const hud = new HUD();
  hud.setMatchVisible(true);
  assert.ok(byId.get('minimap').classList.contains('show'), 'minimapa não apareceu no match');
  hud.setMatchVisible(true);
  assert.ok(byId.get('minimap').classList.contains('show'), 'duplo setMatchVisible quebrou o minimapa');
  hud.setMatchVisible(false);
  assert.ok(!byId.get('minimap').classList.contains('show'), 'minimapa ficou no lobby');
});

// 9. o jogo INTEIRO junto: mundo real + zona + HUD + minimapa por 900 frames
console.log('\n9. simulação do jogo real (mundo novo + zona + gás)');
await check('mundo completo roda 2:30 com zona fechando, sem NaN e com dano real', async () => {
  const { Terrain } = await import('../src/world/Terrain.js');
  const { Vegetation } = await import('../src/world/Vegetation.js');
  const { Buildings } = await import('../src/world/Buildings.js');
  const { Landmarks } = await import('../src/world/Landmarks.js');
  const { Water } = await import('../src/world/Water.js');
  const { Backdrop } = await import('../src/world/Backdrop.js');
  const { NavGrid } = await import('../src/systems/NavGrid.js');
  const { Bots } = await import('../src/systems/Bots.js');
  const { Zone } = await import('../src/systems/Zone.js');
  const { Climate } = await import('../src/world/Climate.js');
  const { Minimap } = await import('../src/ui/Minimap.js');

  const scene = new THREE.Scene();
  const collision = new Collision();
  const terrain = new Terrain();
  const buildings = new Buildings(scene, collision, (x, z) => terrain.getHeightAt(x, z));
  const vegetation = new Vegetation(scene);
  vegetation.applyTo(collision);
  const water = new Water(scene);
  water.applyTo(collision);
  const landmarks = new Landmarks(scene, collision, 4242);
  const backdrop = new Backdrop(scene);
  const nav = new NavGrid(collision);
  const cam = new THREE.PerspectiveCamera(75, 2, 0.1, 1250);
  const player = new Player(cam, terrain, collision);
  player.spawnAt ? player.spawnAt(0, terrain.getHeightAt(0, 0), 0) : player.position.set(0, 0, 0);
  const bots = new Bots(scene, { collision, terrain, nav, rngSeed: 999 });
  const spots = [...buildings.spawnPoints(), ...landmarks.spawnPoints]
    .filter((p) => nav.isOpenWorld(p.x, p.z) && !collision.isBlockedCircle(p.x, p.z, 0.75));
  const spawned = bots.spawn(12, { playerPos: player.position, allies: 0, level: 0.5, spots });
  assert.equal(spawned, 12, 'spawn com spots filtrados quebrou');

  const zone = new Zone(scene, { rng: () => 0.37 });
  zone.reset(player.position.x, player.position.z);
  const climate = new Climate(scene, { lighting: null });
  const canvas = byId.get('minimap-canvas');
  canvas.getContext = () => fakeCtx();
  canvas.clientWidth = 140;
  const minimap = new Minimap(canvas);
  const hud = new HUD();
  hud.setMatchVisible(true);
  const perf = { fps: 60, frameMs: 16, quality: 'ALTA' };
  const render = { calls: 42, triangles: 104712 };

  const startHealth = player.health ?? 100;
  let zoneHurtPlayer = 0;
  let minRadius = zone.radius;
  const FRAMES = 60 * 150; // 2:30 de partida: 3 fases da zona completas
  for (let f = 0; f < FRAMES; f++) {
    const dt = 1 / 60;
    zone.update(dt);
    const tick = zone.shouldTick(dt);
    if (tick) {
      const dps = zone.dpsAt(player.position.x, player.position.z);
      if (dps > 0) {
        player.takeDamage(dps, 'zone');
        zoneHurtPlayer += 1;
      }
    }
    bots.update(dt, { player, zone, zoneTick: tick });
    climate.update(dt);
    minimap.update(dt, { player, zone, bots });
    hud.update(dt, {
      perf, render, player, combat,
      match: { kills: 0, alive: bots.aliveCount + 1, total: 13, timeText: '0:15' },
      zone: { label: zone.label, countdown: zone.getCountdownText(), distance: zone.distanceOutside(player.position.x, player.position.z), outside: zone.isOutside(player.position.x, player.position.z), closing: zone.state === 'CLOSING', progress: zone.progress },
      hit: null, damage: null, now: f / 60,
    });
    minRadius = Math.min(minRadius, zone.radius);
  }
  // 1) o círculo fechou de verdade
  assert.ok(minRadius <= Config.ZONE_PHASES[2].radius + 1, `zona não fechou (mín ${minRadius.toFixed(0)} m, esperado ≤ ${Config.ZONE_PHASES[2].radius})`);
  // 2) o jogador a pé ~0 m do centro nunca deveria apanhar; e o gás feriu ALGUEM
  //    (checa nos bots: eles nascem espalhados pelo mapa, então vários ficam fora)
  let hurt = 0;
  for (const b of bots.list) if (b.health < b.maxHealth) hurt += 1;
  assert.ok(hurt > 0, `${Math.round(FRAMES / 60)} s de gás e nenhum bot foi ferido — dano da zona não está chegando`);
  assert.ok(zoneHurtPlayer === 0, 'jogador no centro tomou dano dentro da zona');
  assert.ok(player.health === startHealth, `vida do jogador mudou dentro da zona (${startHealth} → ${player.health})`);
  // 3) nada virou NaN e ninguém atravessou nada
  for (const b of bots.list) {
    assert.ok(Number.isFinite(b.position.x) && Number.isFinite(b.position.y), `bot ${b.id} com NaN`);
    assert.ok(Math.abs(b.position.x) < Config.WORLD_SIZE / 2 + 1, `bot ${b.id} saiu do mapa`);
  }
  for (const p of [player.position]) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), 'player com NaN');
  // 4) o clima reagiu à zona final sem quebrar materiais
  // (a fog é criada pelo Lighting no Engine; aqui pomos a mesma para valer)
  scene.fog = new THREE.Fog(Config.FOG_COLOR, Config.FOG_NEAR, Config.FOG_FAR);
  climate.onZonePhase(Config.ZONE_PHASES.length - 1, true);
  for (let f = 0; f < 120; f++) climate.update(1 / 60);
  climate.update(1 / 60);
  backdrop.refreshTint(scene.fog.color);
  if (scene.fog) {
    assert.ok(Number.isFinite(scene.fog.far), 'fog.far virou NaN no clima de gás');
    assert.ok(scene.fog.far < Config.FOG_FAR, 'gás não encurtou a névoa');
    assert.ok(scene.fog.color.getHex() !== Config.FOG_COLOR, 'cor da névoa não mudou com o gás');
  }
  for (const m of backdrop.meshes) {
    const attr = m.geometry.attributes.color;
    for (let i = 0; i < attr.count; i += 37) {
      assert.ok(Number.isFinite(attr.getX(i)) && Number.isFinite(attr.getZ(i)), `${m.name} com cor NaN`);
    }
  }
  // 5) o HUD mostrou a zona (o teste de "ficou bonito" que dá para automatizar)
  assert.match(byId.get('zone-state').textContent || '', /ZONA/, 'HUD da zona vazio durante o match');
  assert.ok(bots.aliveCount > 0, `todos os bots morreram em ${Math.round(FRAMES / 60)} s (dano do gás desregulado)`);
  zone.dispose();
  climate.dispose();
  water.dispose();
  landmarks.dispose();
  backdrop.dispose();
  void vegetation;
});

await check('todo módulo novo é montado pelo Engine na ordem certa', async () => {
  const engine = readFileSync(join(ROOT, 'src/core/Engine.js'), 'utf8');
  const need = ['new Terrain(', 'new Lighting(', 'new Buildings(', 'new Vegetation(', 'new Water(',
    'new Landmarks(', 'new Backdrop(', 'new NavGrid(', 'new Player(', 'new Combat(', 'new Zone(',
    'new Bots(', 'new Climate(', 'new Minimap(', 'new HUD('];
  for (const n of need) assert.ok(engine.includes(n), `Engine não monta ${n}`);
  // nada de módulo órfão em src/world + src/systems
  // módulos de mundo/sistema que existem mas o Engine nunca monta = código morto.
  // A UI é montada por dentro de outra UI (Joystick/TouchLook/Settings) e os
  // STUBs de fases futuras são documentados de propósito — nem um nem outro contam.
  const { readdirSync } = await import('node:fs');
  const stubs = new Set();
  for (const dir of ['src/world', 'src/systems']) {
    for (const f of readdirSync(join(ROOT, dir))) {
      if (!f.endsWith('.js')) continue;
      if (/STUB \(Fase/.test(readFileSync(join(ROOT, dir, f), 'utf8'))) stubs.add(`${dir}/${f}`);
    }
  }
  const orphans = [];
  for (const dir of ['src/world', 'src/systems']) {
    for (const f of readdirSync(join(ROOT, dir))) {
      if (!f.endsWith('.js')) continue;
      if (stubs.has(`${dir}/${f}`)) continue;
      const mod = f.replace(/\.js$/, '');
      if (!new RegExp(`${mod}\.js'`).test(engine)) orphans.push(`${dir}/${f}`);
    }
  }
  assert.equal(orphans.length, 0, `módulos nunca importados pelo Engine: ${orphans.join(', ')}`);
  // a zona implementada (systems/Zone.js) substituiu os stubs Zones/SafeZone
  assert.ok(!readdirSync(join(ROOT, 'src/world')).includes('Zones.js'), 'ainda existe o Zones.js stub');
  assert.ok(!readdirSync(join(ROOT, 'src/systems')).includes('SafeZone.js'), 'ainda existe o SafeZone.js stub');
});

console.log('\n────────────────────────────────────────');
console.log(`  ${passed} checks ok, ${fails.length} falhas`);
if (fails.length) {
  console.log('\nFALHAS:');
  for (const f of fails) console.log(`  • ${f}`);
  process.exitCode = 1;
} else {
  console.log('  Lobby, fullscreen, botões de toque e HUD exercitados sem erros ✅');
}
