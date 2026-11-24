/**
 * Config.js — Constantes centrais do jogo (fonte única de verdade).
 * Ajustes de balanceamento da Fase 1 vivem aqui, nunca espalhados pelo código.
 * Fases futuras (armas, zona, bots) adicionam suas seções neste mesmo arquivo.
 */
export const Config = Object.freeze({
  // --- Renderização mobile (Skill §1) ---
  PIXEL_RATIO_MAX: 1.5, // teto rígido p/ não superaquecer telas 2K/4K
  SHADOW_MAP_SIZE: 1024, // sombra única e leve (mobile)
  ANTIALIAS: true,

  // --- Mundo ---
  WORLD_SIZE: 400, // terreno 400x400 unidades
  TERRAIN_SEGMENTS: 128, // 128x128 = ~16k vértices (ok p/ Android)
  FOG_NEAR: 70,
  FOG_FAR: 240,

  // --- Jogador (protótipo FPS — Fase 3 vira 3ª pessoa) ---
  PLAYER_EYE_HEIGHT: 1.7,
  PLAYER_SPEED: 8, // unidades/s andando
  PLAYER_SPRINT_MULT: 1.65,
  PLAYER_GRAVITY: 24,
  PLAYER_JUMP_VELOCITY: 8.5,
  PLAYER_RADIUS: 0.6, // meio-largura p/ clamp de borda do mundo
  MOUSE_SENSITIVITY: 0.0022,
  TOUCH_SENSITIVITY: 0.0042,

  // --- Loop / performance ---
  MAX_DELTA: 0.05, // Skill §2: física não quebra se o navegador travar
  FPS_TARGET: 60,
  FPS_LOW_THRESHOLD: 45, // abaixo disso por 2s → reduz qualidade
  FPS_HIGH_THRESHOLD: 58, // acima disso por 5s → restaura qualidade

  // --- Vegetação instanciada (Skill §1: InstancedMesh obrigatório) ---
  TREE_COUNT: 260,
  ROCK_COUNT: 130,
  BUSH_COUNT: 160,
});
