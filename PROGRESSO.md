# OPERATION ZERO — Progresso do Desenvolvimento (14 Fases)

> Acompanhamento oficial do projeto. Atualizado ao final de cada fase.
> Base: `GDD_MASTER.md` (Seção 22 — Primeira Ação) + skill
> `.agents/skills/threejs-android/SKILL.md`.

**Status geral:** ✅ Fases 1–2, 6 · 🟡 Fases 4, 8, 9 e 11 em andamento (combate real,
Lobby, bots hostis, zona segura + gás, minimapa e HUD de partida) — entregues por
pedido explícito do lead.
**Última atualização:** 2026-11-24 (cross-phase: escala do mapa + céu/atmosfera +
zona que encolhe com dano + minimapa + Lobby).

## Mapa das 14 fases

| # | Fase | Escopo (GDD) | Status |
|---|------|--------------|--------|
| 1 | Arquitetura técnica + protótipo 3D funcional | Iluminação, terreno base, controle FPS, monitor de performance/FPS | ✅ Concluída |
| 2 | FPS completo + cidade explorável | Paisagem, viewmodel (respiração/caminhada/corrida/ADS), touch completo (atirar/mirar/pular/correr/agachar + sensibilidade), prédios com interiores e colisão sólida | ✅ Concluída |
| 3 | Jogador em 3ª pessoa + física | Over-the-shoulder, colisão de câmera, agachar/deitar, pulo, escalada | ⚪ Não iniciada |
| 4 | Combate, armas e balística | AR/SMG/SG/SR/pistola, falloff, recuo, spread, hitboxes, hitmarkers | 🟡 Parcial (4 armas, cadência, spread, recuo, hitbox por parte, hitmarker — sem loot/munição compartilhada) |
| 5 | Inventário, loot, cura e habilidades | Loot/airdrops, munição, coletes, cura com canalização, habilidades | ⚪ Não iniciada |
| 6 | Zona segura / gás | Múltiplas fases, centro semi-ponderado, dano por tick, feedback | ✅ Concluída (Fase 6: `src/systems/Zone.js` — 6 fases, anti-camping, tick de 1 s no jogador E nos bots, parede + anel + HUD + minimapa) |
| 7 | Veículos terrestres | Carro/moto/jipe: dirigir, colisão, atropelamento, destruição | ⚪ Não iniciada |
| 8 | Fluxo da partida | Lobby → avião → paraquedas → pouso → rotação → Booyah | 🟡 Parcial (Lobby + DEPLOY + resultado/Booyah; avião/paraquedas pendentes) |
| 9 | Bots IA (44) + balanceamento | FSM, navegação, loot, combate, dificuldade, pacing | 🟡 Parcial (FSM + A* + lote + tiro com capa + **rotação sob a zona** + desempacotar; loot/pacing pendentes) |
| 10 | Multiplayer (rede) | Cliente-servidor, predição/reconciliação, interpolação, compressão | ⚪ Não iniciada |
| 11 | UI/UX completa | HUD, minimapa, lobby, configurações, SaveSystem | 🟡 Parcial (HUD de partida + **minimapa tático** + Lobby com preview da arena + configs persistidas; SaveSystem pendente) |
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

## Correções pós-Fase 2 (hotfix de runtime)

- **`Uncaught ReferenceError: randPos is not defined`** (Vercel/navegador): a chamada `randPos()` em
  `src/world/Vegetation.js` foi escrita, mas a declaração da função não tinha sido salva — o `place()`
  voltou ao sorteio antigo e o `catch` silencioso não existia, então a cena inteira morria no boot.
  Corrigido declarando `randPos` dentro de `_scatter()` (recusa posições dentro de
  `Config.VEGETATION_TOWN_CLEAR`), usada por **troncos/copas e pedras/arbustos**.
- **`stat-state` do HUD** sempre em "EM PÉ": `HUD.update()` recebia `playerState` mas não o escrevia
  no DOM. Ligado em `src/ui/HUD.js`.
- **Como foi validado** (o `npm run build` não pega esse tipo de erro — é referência a nome, não sintaxe):
  `eslint --rule no-undef` em todo `src/` (0 erros), teste de runtime dos módulos `Vegetation` +
  `Buildings` + `Collision` fora do navegador (sem `ReferenceError`, vegetação a ≥ 60 m do centro,
  jogador empurrado para fora de parede) e checagem de que todo `getElementById` tem o id em `index.html`.

## Cross-phase — Lobby, imersão, colisão sólida e bots (2026-11-24)

Pedido: entrar no jogo por Lobby, tela cheia + paisagem, cenário bonito e
sólido, bots que patrulham/atiram, tudo dentro do orçamento mobile e **sem**
reescrever o núcleo das Fases 1–2.

### Fase 8 (parcial) — Lobby e fluxo da partida
- [x] `src/systems/GameState.js` — máquina `LOBBY → DEPLOY (0.6s) → MATCH → RESULT`,
  DOM-free, `kills/placement/tempo`, comandos (`deploy`/`toLobby`) injetados pelo Engine.
- [x] `src/ui/Lobby.js` — título OPERATION ZERO, JOGAR, seletores de modo
  (SOLO/DUO), bots (treino/12/24/44), dificuldade e qualidade (AUTO/ALTA/MÉDIA/BAIXA),
  persistência em `localStorage` (`oz_lobby_v1`), tela de resultado (JOGAR DE NOVO /
  VOLTAR AO LOBBY) e preview de qualidade imediato.
- [x] `src/utils/Immersive.js` — `requestFullscreen` (+ fallback webkit) e
  `screen.orientation.lock('landscape')` em `try/catch` que não quebra o boot;
  classe `.is-fullscreen` + `100dvh` (sem barras escuras) + `viewport-fit=cover`.
- [x] `Engine` entra em LOBBY: input travado, câmera orbital sobre a cidade,
  botões de partida ocultos por `body[data-phase]`.

### Fase 9 (parcial) — bots ativos
- [x] `src/entities/Bot.js` — entidade real (cabeça/torso/pernas), FSM com
  histerese temporal e espacial, tempo de reação 0.3–0.55 s, rajadas,
  reposition/fuga, A* + steering para o **próximo nó**, anti-"preso",
  `takeDamage` devolvendo `{died, credits}`.
- [x] `src/systems/Bots.js` — decisão em lote (`BOT_DECISION_BATCH`/frame),
  integração de todos os bots todo frame, percepção barata→cara (dist² → cone →
  1 raycast), separation, tiro com chance de erro e **parando na cobertura**,
  tracer em `InstancedMesh` pooled, 6 `InstancedMesh` de corpo (7 draw calls p/ 44 bots).
- [x] `src/systems/NavGrid.js` — A* 5 m sobre a grade de colisão (pulando
  volumes pisáveis), `nearestFreeWorld`, `randomFreeNear`, orçamento de repath/frame.

### Fase 4 (parcial) — combate
- [x] `src/systems/Combat.js` — relógio de cadência agendado (`while nextShotAt <= now`),
  pente/reserva com recarga e auto-recarga, spread de disco com recuperação,
  padrão de recuo por arma, falloff por bandas, dano por parte, occlusão por
  cobertura antes do alvo, hooks `onShot/onHit/onAmmoChange`.
- [x] `src/utils/Hitbox.js` — `intersectCylinder` (cabeça/torso/pernas), `damageAt`,
  `timeToKill`, `applyConeSpread` (base ortonormal).
- [x] `Viewmodel` deixou de ter fire loop próprio: o visual obedece ao Combat
  (`playShot(hitDistance)` → trace para no impacto).

### Cenário, iluminação e colisão sólida
- [x] `src/world/Buildings.js` — cidade com telhado, fachada, janelas, portas,
  sacadas, cercas/vãos, lajes internas e **paredes do térreo até o piso**
  (13 draw calls, 483+11 colisores, 69 spawns).
- [x] `src/world/Vegetation.js` — tronco+copa, arbustos, pedras, postes
  (6 draw calls, 390 colisores) + `applyTo(collision)`.
- [x] `src/world/Lighting.js` — `hemisphere(sky,ground)` + direcional 2.4
  balanceado, `ACESFilmicToneMapping`, `SRGBColorSpace`, caixa de sombra
  (`SHADOW_RADIUS`) seguindo o jogador, `bias/normalBias` sem acne,
  sombras desligadas na qualidade MÍNIMA.
- [x] `src/systems/Collision.js` — `resolveCircle` (2 passadas quando há
  contato), `rayDistance` com passo de meio-ponto, `isBlockedCircle`,
  `getGroundHeight`, volumes pisáveis × bloqueantes.
- [x] `index.html` — HUD de partida (vida no topo, munição/recarga, abates,
  vivos, hitmarker, vinheta de dano, kill feed), botões **ATIRAR/MIRAR/PULAR/
  AGACHAR/CORRER** em grade sem sobreposição, `touch-action:none`, `user-select:none`,
  Lobby/resultado, `100dvh`.
- [x] `src/core/InputManager.js` — `setEnabled()` (Lobby não herda gatilho),
  botões de ação com `touchcancel` soltando, recarga no R, pointer-lock com
  `.catch()`.

### Verificação (build não basta)
- [x] `tests/world-smoke.test.mjs` — **32 checks**: colisão (varredura de 260
  troncos + 120 paredes + andar contra o prédio), tiro na cobertura, cadência
  10 s @30/60/144 FPS = `fire_rate×10 ±1`, TTK 0.2–0.6 s e headshot, spawn de
  24 bots, lote ≤ `BOT_DECISION_BATCH`, 10 s de IA sem NaN/sem atravessar,
  0 janelas "preso", engajamento com dano real, fiação Engine→métodos,
  `Config.*` × `index.html` e as **skills aplicadas de verdade** (ACES/sRGB,
  teto de pixel ratio 1.5, PBR compartilhado, culling coerente, `Math.min(dt,
  MAX_DELTA)`, Euler YXZ, cadência agendada, histerese e orçamento de A*).
- [x] `tests/ui-dom-smoke.test.mjs` — **26 checks** com o DOM real do
  `index.html`: JOGAR → `immersive.enter()` → DEPLOY → MATCH, qualidade
  aplicada no toque, persistência, Enter/resultado, botões de toque, recarga,
  hitmarker (e o bug dos dois relógios), `getElementById` de UI, cache de
  elementos `null`, z-index e **geometria 640×360 sem sobreposição**.
- [x] `tests/perf-bench.mjs` — 41 draw calls com 44 bots, 75k tris,
  0.22 ms de lógica/frame, A* full-map 0.5–1.8 ms.
- [x] `npm run build` ok; `eslint src/` (`no-undef`/`no-unused-vars`) 0 erros,
  0 avisos; módulos servidos pelo dev server sem erro de transform.

### Skill nova
- [x] `.agents/skills/fps-mobile-core/SKILL.md` — gate de Lobby, imersão com
  fallback, geometria de toque, colisão única para jogador/IA/bala, IA em lote,
  feel de tiro e os checks obrigatórios. As skills upstream
  (`threejs-materials-lighting`, `threejs-scene-setup`, `threejs-gltf-loading`)
  foram **lidas e seguidas, não reescritas** — continuam byte-idênticas ao
  apache/incubator… (awesome-gamedev-agent-skills), sem diff neste PR.

### Pendências honestas
- Avião/paraquedas/pouso (Fase 8 real), loot/colete/cura (Fase 5) e áudio (12).
  (Zona — Fase 6 — e minimapa — Fase 11 — saíram desta lista no ciclo seguinte;
  ver a seção "Cross-phase — escala do mapa, céu, zona e minimapa".) A qualidade manual do Lobby agora desliga o
  adaptativo (`performance.setAuto(false)`) e re-aplica as sombras via callback
  `onQuality` do Engine — nenhum módulo de UI escreve no renderer por fora.
- Nada foi testado em aparelho real: os números acima vêm do harness headless
  (lógica + draw calls teóricos), não de um Snapdragon.

## Cross-phase — escala do mapa, céu, zona e minimapa (2026-11-24)

Pedido do lead: *"tá cheio de bug gráficos, o lobby tá feio, só tem uma cidade
pequena cercada de árvore com um limite duro, e falta a zona que encolhe e dá
dano fora"*. Cada item abaixo é uma resposta direta, com o arquivo onde mora.

### 1 · Mapa: 5 POIs, estradas e um lago (não "uma cidade + mato")
- [x] `Config.POIS` — cidade (0,0), **Lago Zero**, **Depósito**, **Fazenda** e
  **Antenas**, cada um com raio e `weight` (peso usado no sorteio da zona).
- [x] `utils/Noise.terrainHeight` agora é **o mapa como dado puro**: achanca o
  plateau de cada POI, nivela as estradas e cava a bacia do lago. Mesh,
  colisão, spawns e minimapa leem a MESMA função (nunca duas verdades).
- [x] `roadAmount` liga a **borda** de cada POI (centro→centro deixava a praça
  da cidade com chão de terra — bug pego pelo teste, não pelo build).
- [x] `world/Landmarks.js` — DEPÓSITO (armazém + containers + caminhões),
  FAZENDA (celeiro/silo/cercas), ANTENAS (torres + cabos), orla do LAGO
  (píeres/barco/quebra-ondas) e SUBÚRBIO (4 filas de casas) montados como
  blocos → **7 `InstancedMesh`** (466 instâncias) + 409 AABB + 11 círculos de
  colisão, 43 spawns validados no grafo.
- [x] `world/Water.js` — lago com `onBeforeCompile` (ondas + cor por
  profundidade + espuma na margem), pisável na beira e **bloqueado no fundo**
  (colisor `walkable:false`).
- [x] `world/Backdrop.js` — anel de chão até 920 m amostrando o mesmo heightmap
  + 3 cortinas de silhueta (mata/montanha perto/montanha longe) com cor
  **lerpada à cor da névoa** e `fog:false`: o "limite" some, e o fundo casa com
  o clima (re-lerp a 4 Hz durante transição, `refreshTint`).
- [x] `world/Vegetation.js` — sorteio com rejeição também de **estrada, água,
  margem alagada e plateau de POI**: 0 árvores em cima de via ou no lago.

### 2 · Céu, atmosfera e fim dos "bugs gráficos"
- [x] `world/Lighting.js` reescrito: `three/addons/objects/Sky` (Preetham) +
  dome de nuvens fbm em shader + sol posicionado **pela direção do céu** (antes
  a luz vinha de outro ângulo do que o brilho do horizonte) + sombra que segue
  o jogador com `bias/normalBias` calibrados.
- [x] `PMREMGenerator.fromScene` → `scene.environment`, aplicado por traversal
  (`applyEnvironment`) porque o r160 **não** tem `scene.environmentIntensity`;
  dentro de `try/catch` para continuar bootando sem WebGL.
- [x] `FOG_COLOR === cor do horizonte do Sky` e `EXPOSURE` única (0,86) para
  renderer e céu — sem emenda horizonte/névoa e sem o duplo escurecimento que
  fazia tudo parecer preto.
- [x] `Terrain` sem jitter por índice (as "bandas" visíveis): cor vem de
  `groundTint` (grama → seca → areia → rocha → terra da estrada) + rampa de
  rocha por **inclinação** + grão em canvas (`makeGroundDetail`, zero download).
- [x] `SceneManager` `far` 600 → **1250 m** (senão a montanha distante era
  cortada pelo frustum).
- [x] `Climate.js` deixou de ser stub: `CLEAR / OVERCAST / GAZ` interpolando
  fog, hemisfério, exposição, cor do sol e cobertura de nuvens. A zona final
  acende o **GAZ** — o feedback é no mundo, não só no HUD.
- [x] Orçamento: `TERRAIN_SEGMENTS` 176 → 160 e água 72×72 → 48×48 →
  **42 draw calls / ~94k tris** (era 121k com o novo mapa) — a perda era só
  triângulo de longe.

### 3 · Fase 6 — zona segura que encolhe e queima
- [x] `Config.ZONE_PHASES` (6 fases `{radius, wait, close, dps}`): 205 → 3 m,
  dano 1,2 → 14 de vida/s, mais `ZONE_MIN_BREATH` = 8 s de respiro antes do
  primeiro fechamento (Fase 5 ainda não existe; sem arma o gás seria só morte).
- [x] `systems/Zone.js`: centro do novo círculo **semi-ponderado por POI +
  ruído** (GDD l.15 anti-camping) e **sempre contido** no círculo atual
  (`d ≤ R − r`) — testado em 400 seeds × partida inteira, 0 saltos ilegais.
- [x] Dano por **tick** de 1 s (`ZONE_TICK`) com rampa de tolerância na borda
  (`ZONE_EDGE_FALLOFF`), aplicado pelo Engine no jogador **e** pelo mesmo
  `zoneTick` nos bots. Durante o FECHAMENTO já vale o dps da fase de destino.
- [x] Visual: parede em `CylinderGeometry` com fresnel + listras (vermelha
  enquanto fecha) e o **próximo círculo** em `depthTest:false` (holograma: sem
  o anel sumindo atrás de cada colina). 2 draw calls, zero textura.
- [x] HUD: `#zone-hud` (estado/contador/distância/barra), `#gas-vignette`
  pulsando e `#zone-alarm`; o kill feed avisa FECHANDO/FINAL e marca
  `🔥 NO GÁS` no abate pelo zone.
- [x] Bots: fora do círculo o **único** objetivo é entrar (rotação com offset
  próprio, rajada cancelada), e o gás fere e mata → a partida termina.

### 4 · Lobby e minimapa (Fase 11)
- [x] `ui/Minimap.js` — canvas 2D a **12 Hz** com mapa, estradas, POIs, lago,
  área fora da zona escurecida (`evenodd`), círculo atual, próximo tracejado,
  hostis só dentro de `MINIMAP_ENEMY_RADIUS` (78 m — sem wallhack) e o cone de
  visão do jogador.
- [x] Lobby: badge "SERVIDOR ONLINE", kicker, régua de destaque, chips de
  escopo (5 POIs / 6 fases / 44 bots / 60 FPS), **preview estático da arena**
  (`Minimap.drawBaseMap` — 1 paint, sem depender do Engine) e botão
  `▶ DEPLOY` com brilho; o `#lobby::before` é um véu tático em gradiente — sem
  o "formulário cinza sobre cinza" de antes.

### Verificação deste ciclo
- [x] `npm run test` → **50 checks ok** (eram 32): +8 de mapa (POIs, plateau,
  estradas, lago/margem, Landmarks sem NaN e com spawns secos, vegetação
  respeitando via/água, terreno sem streak, céu/PMREM/Backdrop) e +10 de zona
  (6 fases monotônicas, simulação de 5 min fechando até a FINAL, 400 seeds de
  "centro cabe no círculo", rampa de dano, tick compartilhado, bots fugindo do
  gás, parede/anel, fiação do Engine, ordem colisão→nav).
- [x] `npm run test:ui` → **34 checks ok** (eram 26): `_updateZone` no DOM real,
  minimapa desenhando círculo/trace/`evenodd` com um mock de ctx, throttle 12 Hz
  e no-op sem canvas, preview do Lobby, CSS (gás/minimapa/zona com
  `pointer-events:none`, keyframes de pulso, HUD da zona só no MATCH) e
  **uma simulação de 2:30 do mundo inteiro** com zona fechando: dano chegou aos
  bots, `NaN` em nenhum lugar, `fog` encurtou com o gás e ninguém atravessou.
- [x] `npm run bench` → 42 draw calls, 93.960 tris, 26 `InstancedMesh`, 3 luzes;
  lógica 0,093 ms/frame (0 bots) → 0,273 ms (44 bots); A* 0,55 ms.
- [x] `npm run lint` → 0 erros (5 avisos de variáveis só-de-leitura nos harness);
  `npm run build` ok; todos os módulos novos servidos pelo dev server sem erro
  de transform.
- [!] **Nada foi medido em aparelho real.** Sem WebGL headless, o que foi
  validado aqui é geometria, grafo, GPU budget teórico, matemática da zona e
  DOM — não FPS de Snapdragon, nem como o `Sky`+PMREM+nuvens caem no olho.
  Isso precisa de um teste manual no celular (ver "Como testar" abaixo).

### Como testar o ciclo (visual e zona)
1. `npm run dev` e abrir o preview. **Lobby**: conferir céu com nuvens, lago à
   esquerda, 5 POIs legíveis, preview do mapa no canto e o `▶ DEPLOY`.
2. TOCAR/CLICAR em DEPLOY → tela cheia + paisagem; rodar ~30 s e olhar o
   `#zone-hud`: `ZONA SEGURA · PRÓXIMA 0:xx`, depois `ZONA FECHANDO` (parede
   vermelha piscando, contador correndo, barra encolhendo).
3. Sair do círculo (correr para fora enquanto fecha): vinheta laranja pulsando,
   alarme `⚠ FORA DA ZONA`, vida caindo ~1 tick/s e o **minimapa** com a área
   externa escurecida e o próximo círculo tracejado.
4. Deixar correr até a fase FINAL: céu vira **gás** (laranja, névoa curta),
   o feed avisa `ZONA FINAL · gás subindo`, e os bots fora do círculo correm
   para dentro em vez de atirar em parede.
5. Andar pelas estradas: nenhuma árvore no meio da via, nenhuma dentro do lago,
   chão de terra batida contínuo cidade↔depósito↔fazenda↔antenas.
6. Girar a câmera 360°: não existe borda dura do mundo — o relevo continua até
   a silhueta de montanha (a névoa e a cor casam com o horizonte).

### Pendências que este ciclo NÃO esconde
- Loot/inventário/cura (Fase 5) seguem fora: por isso a 1ª zona tem dano 0 e o
  dano só cresce a partir da fase 2. Sem colete, `dps 14` mata em ~7 s — é o
  intenção do GDD, mas o balanceamento final depende da Fase 5.
- `saveSystem` (Fase 11) e áudio (Fase 12) continuam stubs declarados.
- O `escapeVector`/desempacotar dos bots resolve o "bot parado empurrando
  parede" (uma janela de 2 s é o tempo de detecção; a janela seguinte já tem
  pulo ou realocação), mas é remendo de IA — o certo seria o NavGrid marcar
  células de tamanho insuficiente como bloqueadas na origem.
- `WORLD_SIZE` continua 400 m (o mapa *parece* maior por causa do Backdrop e
  dos 5 POIs). Ampliar de verdade exige revisar `NavGrid` (100×100 células já
  custa 0,55 ms no A*) e o orçamento de tris.
- Texturas são procedurais (canvas 128 px para o grão do solo). Nada foi
  baixado da internet — o pedido de "baixar coisas" foi lido como autorização
  de pesquisa, e a pesquisa apontou os addons do próprio `three` (Sky, PMREM)
  como o caminho de maior ganho por MB em Android.

## Próximos passos (Fase 3 — NÃO iniciar sem concluir a Fase 2)

1. Validar FPS em dispositivo Android real (orçamento: 60 FPS estáveis).
2. Converter o controlador p/ 3ª pessoa over-the-shoulder (reaproveitar núcleo de movimento/colisão).
3. Colisão de câmera contra paredes/terreno.
