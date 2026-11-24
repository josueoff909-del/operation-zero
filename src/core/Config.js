/**
 * Config.js — Constantes centrais do jogo (fonte única de verdade).
 * Fases 1–2 (arquitetura/FPS/cidade) + Fases 3/4/9 antecipadas pelo pedido
 * atual: Lobby/fluxo de partida, tela cheia, colisão sólida de cenário
 * (árvores/pedras inclusive), combate com dano real e bots.
 * Nada de número "mágico" espalhado: tudo vive aqui.
 */

// --- Armas (fps-shooter skill: "escreva toda arma como dados") ---
// damage = [dano corpo <30m, 30-55m, >55m] (falloff em bandas).
// head/legs = multiplicadores de hitbox. recoil = padrão FIXO (aprendível).
const WEAPONS = {
  rifle: {
    id: 'rifle', label: 'AR · Fuzil',
    damage: [34, 26, 20], head: 2.4, legs: 0.85,
    fireRate: 9.0, // tiros/s
    magazine: 30, reloadTime: 2.2,
    baseSpread: 0.006, spreadPerShot: 0.006, maxSpread: 0.05, spreadRecover: 0.09, // rad
    moveSpread: 0.02, adsSpreadMult: 0.35,
    recoilPattern: [[0.011, 0], [0.013, 0.002], [0.012, -0.003], [0.010, 0.004],
      [0.009, -0.002], [0.011, 0.003], [0.008, -0.004], [0.007, 0.001]],
    recoilRecoverDelay: 0.35, recoilRecoverSpeed: 6,
    range: 130, adsFov: 45,
  },
  smg: {
    id: 'smg', label: 'SMG',
    damage: [22, 17, 12], head: 2.0, legs: 0.8,
    fireRate: 13.0, magazine: 32, reloadTime: 1.9,
    baseSpread: 0.010, spreadPerShot: 0.005, maxSpread: 0.07, spreadRecover: 0.12,
    moveSpread: 0.03, adsSpreadMult: 0.5,
    recoilPattern: [[0.008, 0.001], [0.009, -0.001], [0.008, 0.002], [0.007, -0.002]],
    recoilRecoverDelay: 0.3, recoilRecoverSpeed: 7,
    range: 70, adsFov: 55,
  },
  sniper: {
    id: 'sniper', label: 'SR · Precisão',
    damage: [105, 95, 80], head: 2.0, legs: 0.6,
    fireRate: 1.1, magazine: 5, reloadTime: 3.0,
    baseSpread: 0.002, spreadPerShot: 0.02, maxSpread: 0.03, spreadRecover: 0.05,
    moveSpread: 0.06, adsSpreadMult: 0.15,
    recoilPattern: [[0.03, 0]],
    recoilRecoverDelay: 0.5, recoilRecoverSpeed: 4,
    range: 300, adsFov: 22,
  },
  pistol: {
    id: 'pistol', label: 'Pistola',
    damage: [30, 24, 16], head: 2.2, legs: 0.85,
    fireRate: 5.5, magazine: 12, reloadTime: 1.5,
    baseSpread: 0.010, spreadPerShot: 0.008, maxSpread: 0.06, spreadRecover: 0.14,
    moveSpread: 0.03, adsSpreadMult: 0.6,
    recoilPattern: [[0.010, 0], [0.009, 0.002]],
    recoilRecoverDelay: 0.28, recoilRecoverSpeed: 8,
    range: 60, adsFov: 58,
  },
};
export const Config = Object.freeze({
  // --- Renderização mobile (Skill §1) ---
  PIXEL_RATIO_MAX: 1.5, // teto rígido p/ não superaquecer telas 2K/4K
  SHADOW_MAP_SIZE: 1024, // sombra única e leve (mobile)
  SHADOW_FOLLOW_PLAYER: true, // materials-lighting skill: frustum da sombra em torno do jogador
  SHADOW_RADIUS: 34, // meia-largura da área de sombra (1024px / 68m ≈ 15px por metro)
  ANTIALIAS: true,

  // --- Iluminação (materials-lighting skill: luz fisicamente correta desde r155) ---
  SUN_INTENSITY: 2.7, // key ≈ 2–3
  SUN_COLOR: 0xfff1dc,
  SUN_POSITION: [70, 95, 35],
  HEMI_SKY: 0xbfd9ff,
  HEMI_GROUND: 0x4a5f3a,
  HEMI_INTENSITY: 0.95, // fill de céu/chão
  TONE_MAPPING_EXPOSURE: 1.0,
  FOG_COLOR: 0xa8cfe8,

  // --- Mundo ---
  WORLD_SIZE: 400,
  TERRAIN_SEGMENTS: 128,
  FOG_NEAR: 70,
  FOG_FAR: 240,

  // --- Jogador (protótipo FPS — Fase 3 vira 3ª pessoa) ---
  PLAYER_EYE_HEIGHT: 1.7,
  PLAYER_SPEED: 8,
  PLAYER_SPRINT_MULT: 1.65,
  PLAYER_GRAVITY: 24,
  PLAYER_JUMP_VELOCITY: 8.5,
  PLAYER_RADIUS: 0.6,
  PLAYER_HIT_RADIUS: 0.38, // cápsula p/ hitscan inimigo
  PLAYER_HEIGHT: 1.8,
  MOUSE_SENSITIVITY: 0.0022,
  TOUCH_SENSITIVITY: 0.0042,
  PITCH_LIMIT: 1.5533, // ±89° (fps-shooter skill)

  // --- Agachar / ADS / FOV ---
  PLAYER_CROUCH_EYE_HEIGHT: 1.05,
  PLAYER_CROUCH_SPEED_MULT: 0.55,
  BASE_FOV: 75,
  SPRINT_FOV: 82,
  ADS_SPEED_MULT: 0.6,
  // ADS sensibilidade = tan(adsFov/2) / tan(hipFov/2) (fps-shooter skill) —
  // calculado em runtime por Player/Combat a partir do FOV da arma.

  // --- Colisão ---
  COLLISION_STEP: 0.55, // altura máxima que o jogador "pisa" sem colidir
  COLLISION_CELL: 8, // célula da grade espacial (m)
  BOT_RADIUS: 0.5,

  // --- Cidade (prédios/ruas) ---
  TOWN_RADIUS: 35,
  TOWN_BLEND_END: 65,
  VEGETATION_TOWN_CLEAR: 60,
  STREET_HALF: 3, // metade da largura da rua (meio-fio/calçada)
  SIDEWALK_HALF: 5.5,

  // --- Viewmodel ---
  VIEWMODEL_HIP_POS: [0.22, -0.18, -0.45],
  VIEWMODEL_ADS_POS: [0, -0.095, -0.32],

  // --- Combate (Fase 4 antecipada: dano real + hitboxes) ---
  WEAPONS,
  START_WEAPON: 'rifle',
  PLAYER_HEALTH: 100,
  HITMARKER_MS: 140,

  // --- Bots (Fase 9 antecipada; Skill §4: IA em lotes) ---
  BOT_MAX: 44,
  BOT_HP: 100,
  BOT_DECISION_BATCH: 11, // 11 decisões/frame → ciclo de 4 frames
  BOT_REPATH_BUDGET: 3, // máx. de A* por tick de decisão (anti-hitch)
  BOT_SPEED_WALK: 3.2,
  BOT_SPEED_RUN: 6.4,
  BOT_VIEW_DISTANCE: 48, // alcance de visão (m)
  BOT_VIEW_FOV: 1.57, // cone de visão (rad, ~90°)
  BOT_HEAR_DISTANCE: 42, // ouvir tiro
  BOT_ATTACK_ENTER: 44, // histerese: entra em ATTACK
  BOT_ATTACK_EXIT: 60, // histerese: sai de ATTACK
  BOT_KEEP_DISTANCE_MIN: 12,
  BOT_KEEP_DISTANCE_MAX: 26,
  BOT_REACTION_MIN: 0.3, // 0.3–0.6s antes do primeiro tiro (fps-shooter skill)
  BOT_REACTION_MAX: 0.55,
  BOT_DAMAGE: 9,
  BOT_FIRE_INTERVAL: 0.15,
  BOT_BURST_MIN: 3,
  BOT_BURST_MAX: 6,
  BOT_SPREAD_BASE: 0.03, // erro proposital (tiros que "abrem")
  BOT_TRACER_POOL: 40,
  BOT_CORPSE_LIFE: 6,
  BOT_LEVELS: { treino: 0.35, normal: 0.6, dificil: 0.85 },

  // --- Navegação (game-ai skill: grafo mais grosseiro que funciona) ---
  NAV_CELL: 5,
  NAV_WAYPOINT_RADIUS: 1.4,
  NAV_STUCK_TIME: 2, // < 0.5u de progresso em 2s = preso
  NAV_STUCK_PROGRESS: 0.5,

  // --- Lobby / fluxo de partida (Fase 8 antecipada no essencial) ---
  LOBBY_ORBIT_RADIUS: 58,
  LOBBY_ORBIT_HEIGHT: 24,
  LOBBY_ORBIT_SPEED: 0.09, // rad/s
  LOBBY_BOT_PRESETS: [0, 12, 24, 44],

  // --- Tela cheia / orientação ---
  ORIENTATION_LOCK: 'landscape',

  // --- Loop / performance ---
  MAX_DELTA: 0.05,
  FPS_TARGET: 60,
  FPS_LOW_THRESHOLD: 45,
  FPS_HIGH_THRESHOLD: 58,

  // --- Vegetação instanciada (Skill §1) ---
  TREE_COUNT: 260,
  ROCK_COUNT: 130,
  BUSH_COUNT: 160,
  GRASS_COUNT: 520,
  TREE_PINE_RATIO: 0.55, // % de pinheiros (o resto é folhosa)
});
