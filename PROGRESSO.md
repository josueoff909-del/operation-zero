# OPERATION ZERO — Progresso do Desenvolvimento (14 Fases)

> Acompanhamento oficial do projeto. Atualizado ao final de cada fase.
> Base: `GDD_MASTER.md` (Seção 22 — Primeira Ação) + skill
> `.agents/skills/threejs-android/SKILL.md`.

**Status geral:** 🟡 Fase 1 em andamento (arquitetura + protótipo 3D).
**Última atualização:** 2026-11-24 (Fase 1).

## Mapa das 14 fases

| # | Fase | Escopo (GDD) | Status |
|---|------|--------------|--------|
| 1 | Arquitetura técnica + protótipo 3D funcional | Iluminação, terreno base, controle FPS, monitor de performance/FPS | 🟡 Em andamento |
| 2 | Mapa completo: POIs, biomas e coberturas | Regiões nomeadas, densidade de loot, prédios/muros, clima | ⚪ Não iniciada |
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
- [x] Commit na branch

## Decisões técnicas da Fase 1

- **Sem assets externos:** terreno/céu/vegetação gerados por código (seed fixa).
- **Pixel ratio ≤ 1.5** e **sombra única 1024px** (Skill §1).
- **Instancing:** 550 objetos em 5 draw calls (Skill §1).
- **Qualidade adaptativa:** 4 níveis (pixel ratio + sombra) por FPS EMA (Fase 1: "controle de performance/FPS").
- **FPS em 1ª pessoa no protótipo:** a Fase 3 converte p/ 3ª pessoa reaproveitando o núcleo de movimento.
- **Sem rede/multiplayer na Fase 1** (Fase 10). Sem armas/loot/zona/bots (Fases 4–9).

## Como testar a Fase 1

```bash
npm install
npm run dev   # http://localhost:5173
```

Desktop: WASD + mouse (clique p/ travar) + Shift + Espaço.
Android: joystick esquerdo + arrastar direita + botões PULAR/CORRER.
HUD mostra FPS, ms/frame, draw calls, triângulos, qualidade e posição.

## Próximos passos (Fase 2 — NÃO iniciar sem concluir a Fase 1)

1. Validar FPS em dispositivo Android real (orçamento: 60 FPS estáveis).
2. Expandir mapa: POIs nomeados, prédios modulares (InstancedMesh), coberturas.
3. Clima básico (nuvens/neblina) com custo mobile controlado.
