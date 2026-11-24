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

  // --- Fase 2: agachar / ADS / tiro visual ---
  PLAYER_CROUCH_EYE_HEIGHT: 1.05,
  PLAYER_CROUCH_SPEED_MULT: 0.55,
  ADS_FOV: 50, // zoom da mira (ADS)
  SPRINT_FOV: 82, // leve abertura ao correr
  BASE_FOV: 75,
  ADS_SENS_MULT: 0.6, // sensibilidade reduzida ao mirar
  ADS_SPEED_MULT: 0.6, // andar mirando é mais lento
  FIRE_RATE: 8, // tiros/s (visual — dano real é da Fase 4)
  RECOIL_PITCH: 0.007, // coice de câmera por tiro (rad)
  COLLISION_STEP: 0.55, // altura máxima que o jogador "pisa" sem colidir

  // --- Fase 2: cidade (prédios/ruas) ---
  TOWN_RADIUS: 35, // área plana da cidade (raio)
  TOWN_BLEND_END: 65, // mistura p/ o relevo natural até este raio
  VEGETATION_TOWN_CLEAR: 60, // vegetação não nasce dentro deste raio

  // --- Fase 2: viewmodel (arma em 1ª pessoa) ---
  VIEWMODEL_HIP_POS: [0.22, -0.18, -0.45],
  VIEWMODEL_ADS_POS: [0, -0.095, -0.32], // alinha a massa de mira ao centro

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
