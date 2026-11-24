# OPERATION ZERO — Progresso do Desenvolvimento (14 Fases)

> Acompanhamento oficial do projeto. Atualizado ao final de cada fase.
> Base: `GDD_MASTER.md` (Seção 22 — Primeira Ação) + skill
> `.agents/skills/threejs-android/SKILL.md`.

**Status geral:** ✅ Fases 1–2 concluídas (protótipo FPS + cidade explorável).
**Última atualização:** 2026-11-24 (Fase 2).

## Mapa das 14 fases

| # | Fase | Escopo (GDD) | Status |
|---|------|--------------|--------|
| 1 | Arquitetura técnica + protótipo 3D funcional | Iluminação, terreno base, controle FPS, monitor de performance/FPS | ✅ Concluída |
| 2 | FPS completo + cidade explorável | Paisagem, viewmodel (respiração/caminhada/corrida/ADS), touch completo (atirar/mirar/pular/correr/agachar + sensibilidade), prédios com interiores e colisão sólida | ✅ Concluída |
| 3 | Jogador em 3ª pessoa + física | Over-the-shoulder, colisão de câmera, agachar/deitar, pulo, escalada | ⚪ Não iniciada |
| 4 | Combate, armas e balística | AR/SMG/SG/SR/pistola, falloff, recuo, spread, hitboxes, hitmarkers | ⚪ Não iniciada |
| 5 | Inventário, loot, cura e habilidades | Loot/airdrops, munição, coletes, cura com canalização, habilidades | ⚪ Não iniciada |
| 6 | Zona segura / gás | Múltiplas fases, centro semi-ponderado, dano por tick, feedback | ⚪ Não iniciada |
| 7 | Veículos terrestres | Carro/moto/jipe: dirigir, colisão, atropelamento, destruição | ⚪ Não iniciada |
| 8 | Fluxo da partida | Lobby → avião → paraquedas → pouso → rotação → Booyah | ⚪ Não iniciada |
| 9 | Bots IA (44) + balanceamento | FSM, navegação, loot, combate, dificuldade, pacing | ⚪ Não iniciada |
| 10 | Multiplayer (rede) | Cliente-servidor, predição/reconciliação, interpolação, compressão | ⚪ Não iniciada |
| 11 | UI/UX completa | HUD, minimapa, lobby, configurações, SaveSystem | ⚪ Não iniciada |
| 12 | Áudio posicional 3D | Passos, tiros direcionais, veículos, alertas de zona | ⚪ Não iniciada |
| 13 | Otimização mobile extrema | LOD, oclusão, pooling, testes em Android real, bateria/temperatura | ⚪ Não iniciada |
| 14 | Polimento, QA e release | Balanceamento final, QA, build release, publicação | ⚪ Não iniciada |

Legenda: ✅ Concluída · 🟡 Em andamento · ⚪ Não iniciada

## Fase 1 — Checklist

- [x] Análise do repositório (GDD + skill lidos integralmente)
- [x] Arquitetura modular de pastas definida (`ARQUITETURA.md`)
- [x] `PROGRESSO.md` criado (este arquivo)
- [x] Scaffold Vite + Three.js (ES Modules, WebGL 2)
- [x] `src/core/` — Engine, Renderer, SceneManager, Loop, InputManager, PerformanceMonitor, Config
- [x] `src/world/` — Terrain (heightmap), Lighting (sol/sombra/céu/fog), Vegetation (InstancedMesh)
- [x] `src/entities/Player.js` — controlador FPS (Euler YXZ, gravidade, pulo, chão = terreno)
- [x] `src/ui/` — HUD de performance, Joystick flutuante, Touch Look (multitouch)
- [x] Stubs das Fases 2–14 (interfaces reservadas, sem implementação)
- [x] Protótipo rodando no navegador (build OK + servidor dev testado)
- [x] Commit na branch + PR #1 mergeado na `main`

## Fase 2 — Checklist

- [x] Interface paisagem: HUD compacto, dica "vire o celular" (só touch/retrato), mensagens de mouse ocultas no mobile
- [x] Câmera FPS completa + viewmodel (arma + luvas): respiração, bob de caminhada/corrida, inclinação ao correr, sway do olhar, ADS (FOV 75→50)
- [x] Touch simultâneo: joystick esquerdo + olhar direito + ATIRAR/MIRAR (segurar) + PULAR/CORRER/AGACHAR (alterna/borda)
- [x] Sensibilidade ajustável (mouse/toque 0.5×–2.0×, painel ⚙, persistida em localStorage)
- [x] Cidade explorável: 6 prédios com portas/janelas/divisória/telhado, ruas em cruz, crates/mesas/muros baixos
- [x] Colisão sólida (AABB): paredes não atravessáveis, desliza nas paredes, dá p/ pular/subir em crates de 1m
- [x] `npm run build` validado (zero erros, 24 módulos)
- [x] Commit na branch + PR para a `main`

## Decisões técnicas da Fase 1

- **Sem assets externos:** terreno/céu/vegetação gerados por código (seed fixa).
- **Pixel ratio ≤ 1.5** e **sombra única 1024px** (Skill §1).
- **Instancing:** 550 objetos em 5 draw calls (Skill §1).
- **Qualidade adaptativa:** 4 níveis (pixel ratio + sombra) por FPS EMA (Fase 1: "controle de performance/FPS").
- **FPS em 1ª pessoa no protótipo:** a Fase 3 converte p/ 3ª pessoa reaproveitando o núcleo de movimento.
- **Sem rede/multiplayer na Fase 1** (Fase 10). Sem armas/loot/zona/bots (Fases 4–9).

## Decisões técnicas da Fase 2

- **Tiro visual, sem dano:** flash + tracer + coice (dano/balística real é da Fase 4).
- **Colisão AABB alinhada aos eixos** (`Collision.js`): prédios sem rotação p/ colisão rápida; movimento por eixos separados (desliza nas paredes).
- **Cidade achata o terreno** (raio 35, mistura até 65) e a vegetação não nasce dentro do raio 60 — spawn continua na rua em cruz.
- **Instancing na cidade:** paredes/telhados/pisos/crates/muros em 5 `InstancedMesh` (Skill §1). LOD fica p/ a Fase 13.
- **Sensibilidade em radianos** no InputManager (mouse/toque separados × multiplicador do Settings); ADS reduz ×0.6 no Player.
- **Paisagem:** layout de botões pensado p/ celular deitado; retrato no touch mostra apenas a dica de virar (jogo segue jogável).

## Como testar a Fase 2

```bash
npm install
npm run dev   # http://localhost:5173
```

Desktop: WASD + mouse (clique p/ travar) + botão esq. atirar + botão dir. mirar (ADS) + Shift correr + C agachar + Espaço pular.
Android (paisagem): joystick esquerdo + arrastar direita + ATIRAR/MIRAR (segurar) + PULAR/CORRER/AGACHAR. ⚙ ajusta a sensibilidade.
Explore a cidade: entre nos prédios pelas portas, suba nos crates, use os muros baixos como cobertura.
HUD mostra FPS, ms/frame, draw calls, triângulos, qualidade, posição e estado (EM PÉ/CORRENDO/MIRANDO/AGACHADO).

## Próximos passos (Fase 3 — NÃO iniciar sem concluir a Fase 2)

1. Validar FPS em dispositivo Android real (orçamento: 60 FPS estáveis).
2. Converter o controlador p/ 3ª pessoa over-the-shoulder (reaproveitar núcleo de movimento/colisão).
3. Colisão de câmera contra paredes/terreno.
