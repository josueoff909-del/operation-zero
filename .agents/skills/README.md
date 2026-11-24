# Skills do OPERATION ZERO

Guia de referência dos agentes. Cada skill é um `SKILL.md` com frontmatter
(`name` / `description`) e, quando existe aprofundamento, uma pasta `references/`.

## Regra de precedência

1. **`threejs-android/SKILL.md`** — regras **obrigatórias** do projeto (mobile, arquitetura
   modular, touch, orçamento de performance). Vence qualquer conflito.
2. **`GDD_MASTER.md`** — o quê construir (fases, mecânicas, números do battle royale).
3. **Demais skills** — como fazer bem feito (técnica genérica de gênero/disciplina/engine).

## Índice — foco FPS

| Skill | Cobertura real da skill (verificada no texto) | Útil em |
|---|---|---|
| `threejs-android` | **Obrigatória.** Pixel ratio ≤1.5, `InstancedMesh`, `dispose()`, touch multicapacitivo, Euler `YXZ`, IA em lotes. | sempre |
| `fps-shooter` | Modelo de tiro hitscan × projétil; tabela de TTK por arma × HP; dano por banda de distância com multiplicador de headshot; munição/pente/recarga no *scheduled clock*; **sensibilidade em graus/s escalada pelo FOV** (ADS); granada balística com cooldown por tipo; PvE com *reaction delay*, telegrafia e erros propositais. | **Fase 4** (combate) |
| `game-feel` | Shake de câmera com ruído decaiente (não no corpo do mesh), hit-stop, easing, squash & stretch, flash de acerto, knockback, number pops, opções *reduce shake / reduce flash*. | Fases 4/5 |
| `camera-systems` | Câmera 1ª/3ª pessoa over-the-shoulder, suavização/damping, colisão e oclusão da câmera contra cenário, framing, shake. | **Fase 3** |
| `input-systems` | Ações nomeadas em vez de tecla crua (edge × held), *radial deadzone* + curva de resposta + sensibilidade no analógico, *action buffer* para toques discretos, remapeamento com detecção de conflito, acessibilidade (*toggle vs hold*, janelas ajustáveis). | Fases 2 (refino) e 5 |
| `game-ai` | FSM, *utility AI*, percepção (cone de visão, line-of-sight, audição), steering e caminho (navmesh/pathfinding em `references/`). | **Fases 6/7** (44 bots) |
| `level-design` | Critical path, ramos opcionais, ordem de gating, encontros, ensinar × testar mecânica, blockout e revisão contra soft-lock; *pacing/flow* em `references/`. | **Fase 8** |
| `performance-optimization` | Divisão do orçamento de frame por subsistema, corte de draw calls e *state changes*, pooling de objetos, alocações por frame (picos de GC), hitches de shader/pipeline; profiling e budgets em `references/`. | **Fase 9** |
| `threejs-materials-lighting` | `MeshStandard` × `Physical` × `Basic`, rig de luzes, sombras (frustum ortográfico ajustado, acne, `bias`/`normalBias`), texturas sRGB × mapas de dados, IBL/HDR, tone mapping + `OutputPass`. | Fase 8 / qualquer cena nova |
| `threejs-scene-setup` | Renderer, câmera e loop; `resize`/pixel ratio; loop guiado por `renderer.setAnimationLoop` com **delta limitado** (0–0.1 s) para sobreviver a aba em background; contexto WebGL perdido (gotcha + smoke test que perde e restaura o context com `forceContextLoss`). | base |
| `threejs-gltf-loading` | `GLTFLoader`, compressão `DRACO` e texturas `KTX2`, `AnimationMixer` (clipes de arma/personagem), materiais que chegam do glTF. | Fases 3+ (assets) |

## Como ler as skills de disciplina

São **engine-neutral nos conceitos, mas trazem código de Godot/Unity** (`godot-physics`,
`unity-input-system`, `unity-animation`, …). Aqui no Three.js: aplique a regra e o número,
**traduza o snippet** — e confirme contra `threejs-android` (ex.: o "shake" do `game-feel` vai
no offset da câmera, nunca na escala do mesh). As skills específicas de Godot/Unity/Unreal/Roblox
do repositório de origem **não** foram copiadas de propósito: não há engine delas neste projeto.

## Notas de versão (importante)

As três skills de three.js foram verificadas contra **three r187**; este projeto está em
**`three@0.160.1`** (r160). Ajustes concretos ao aplicar um padrão daqui:

- **HDR/IBL:** `HDRLoader` **não existe** na r160 — use `RGBELoader`
  (`three/addons/loaders/RGBELoader.js`).
- **Intensidade do ambiente:** `scene.environmentIntensity` é da **r163** — na r160 ajuste
  `material.envMapIntensity` material a material.
- **Sombra:** `PCFSoftShadowMap` (usada em `src/core/Renderer.js`) é válida e desejada na r160;
  a partir da r182 passa a ser fallback de `PCFShadowMap` com warning. Só trocar junto com o
  bump do three.
- **`RoomEnvironment`:** na r160 vem de `three/addons/environments/RoomEnvironment.js` com
  construtor sem argumentos; foi reposicionado na r183.
- O resto já vale para nós: *physically based lighting* é o padrão desde a **r155**, então as
  intensidades sugeridas (key ≈ 2–3, `HemisphereLight` ≈ 1.0) estão certas; `shadow.mapSize`
  ainda é 512 por padrão; `OutputPass` (r153+) funciona se entrarmos em pós-processamento.
- Em `three@0.160.1` o alias `three/addons/*` já existe (aponta para `examples/jsm/*`), então os
  imports dos padrões funcionam sem mudança.

## Procedência / licença

`threejs-android` é autoral deste repositório. As demais skills são **cópia integral, sem
modificações**, de
[gamedev-skills/awesome-gamedev-agent-skills](https://github.com/gamedev-skills/awesome-gamedev-agent-skills)
(arquivos de `skills/` na branch `main`), sob **Apache License 2.0** — texto completo em
[`LICENSE-Apache-2.0.txt`](LICENSE-Apache-2.0.txt). Os frontmatter e avisos de autoria do
original foram preservados.
